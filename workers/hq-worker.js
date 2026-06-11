const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
const SLACK_ACTIVITY_LIMIT = 12;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/ai/status") {
      return jsonResponse({
        ok: true,
        provider: "Cloudflare Workers AI",
        model: AI_MODEL,
        release: env.RELEASE_VERSION || "v3001.124.0",
        mode: env.AI ? "ready" : "missing-ai-binding"
      });
    }

    if (url.pathname === "/api/ai/release-summary") {
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, message: "Use POST for release summaries." }, 405);
      }

      return handleReleaseSummary(request, env, url);
    }

    if (url.pathname === "/api/ai/chat") {
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, message: "Use POST for AI chat." }, 405);
      }

      return handleAiChat(request, env, url);
    }

    if (url.pathname === "/api/slack/status") {
      return handleSlackStatus(env, url);
    }

    if (url.pathname === "/api/slack/activity") {
      return handleSlackActivity();
    }

    if (url.pathname === "/api/slack/send") {
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, message: "Use POST for Slack messages." }, 405);
      }

      return handleSlackSend(request, env);
    }

    if (url.pathname === "/api/slack/commands") {
      if (request.method !== "POST") {
        return slackJsonResponse({ response_type: "ephemeral", text: "Use POST for Slack slash commands." }, 405);
      }

      return handleSlackCommand(request, env, url);
    }

    if (url.pathname === "/api/slack/events") {
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, message: "Use POST for Slack Events API callbacks." }, 405);
      }

      return handleSlackEvent(request, env, url, ctx);
    }

    if (url.pathname === "/api/slack/actions") {
      if (request.method !== "POST") {
        return slackJsonResponse({ response_type: "ephemeral", text: "Use POST for Slack interactivity callbacks." }, 405);
      }

      return handleSlackAction(request, env, url, ctx);
    }

    return env.ASSETS.fetch(request);
  }
};

function handleSlackStatus(env, url) {
  const config = getSlackConfig(env);
  const requestUrls = buildSlackRequestUrls(url);
  const mode = config.canPost && config.canReceive
    ? "two-way-ready"
    : config.canPost
      ? "outbound-ready"
      : config.tokenConfigured
        ? "receive-only-pending"
        : "missing-token";

  return jsonResponse({
    ok: true,
    provider: "Slack Web API",
    bot: config.botName,
    channel: config.channel,
    channelName: config.channelName,
    tokenConfigured: config.tokenConfigured,
    channelConfigured: config.channelConfigured,
    signingSecretConfigured: config.signingSecretConfigured,
    inboundConfigured: config.signingSecretConfigured,
    requestUrls,
    mode,
    canPost: config.canPost,
    canReceive: config.canReceive,
    canInteract: config.canReceive,
    activityMode: "ephemeral-worker-memory",
    message: config.canPost && config.canReceive
      ? "Slack two-way bridge is ready for outbound posts and inbound Slack callbacks."
      : config.canPost
        ? "Outbound Slack posting is ready. Add SLACK_SIGNING_SECRET and configure Slack Request URLs to enable Slack-to-HQ callbacks."
        : "Configure the SLACK_BOT_TOKEN Worker secret before posting from HQ."
  });
}

async function handleSlackSend(request, env) {
  const body = await safeJson(request);
  const config = getSlackConfig(env, body);
  const message = sanitizeSlackMessage(body?.message);
  const dryRun = Boolean(body?.dryRun);

  if (!message) {
    return jsonResponse({ ok: false, message: "Slack message is required." }, 400);
  }

  if (!config.channelConfigured) {
    return jsonResponse({
      ok: false,
      message: "Slack channel is not configured. Set SLACK_CHANNEL_ID or SLACK_DEFAULT_CHANNEL_ID, or keep SLACK_DEFAULT_CHANNEL_NAME configured."
    }, 400);
  }

  if (!config.tokenConfigured) {
    return jsonResponse({
      ok: false,
      mode: "missing-token",
      message: "SLACK_BOT_TOKEN Worker secret is not configured, so HQ cannot post through the Slack bot yet.",
      channel: config.channel,
      bot: config.botName
    }, 503);
  }

  if (dryRun) {
    return jsonResponse({
      ok: true,
      mode: "dry-run",
      provider: "Slack Web API",
      bot: config.botName,
      channel: config.channel,
      message: "Dry run only; no Slack message was posted.",
      preview: message
    });
  }

  const slackPayload = {
    channel: config.channel,
    text: message,
    unfurl_links: false,
    unfurl_media: false
  };

  const { response, payload } = await postSlackMessage(env, slackPayload);

  if (!response.ok || !payload.ok) {
    return jsonResponse({
      ok: false,
      provider: "Slack Web API",
      bot: config.botName,
      channel: config.channel,
      status: response.status,
      slackError: payload.error || "unknown_error",
      message: formatSlackError(payload.error, response.status)
    }, 502);
  }

  return jsonResponse({
    ok: true,
    provider: "Slack Web API",
    bot: config.botName,
    channel: payload.channel || config.channel,
    ts: payload.ts || "",
    message: "Slack message posted through CORE JIRA NOTIFIER AGENT."
  });
}

async function handleSlackCommand(request, env, url) {
  const rawBody = await request.text();
  const verification = await verifySlackRequest(request, rawBody, env);

  if (!verification.ok) {
    recordSlackActivity({
      type: "slash_command",
      status: "rejected",
      detail: verification.message
    });
    return slackJsonResponse({ response_type: "ephemeral", text: verification.message }, verification.status);
  }

  const form = new URLSearchParams(rawBody);
  const command = sanitizeSlackMessage(form.get("command") || "/qa-hq");
  const userName = sanitizeSlackMessage(form.get("user_name") || "Slack user");
  const channelName = sanitizeSlackChannel(form.get("channel_name") || "");
  const channelId = sanitizeSlackChannel(form.get("channel_id") || "");
  const text = sanitizePrompt(form.get("text") || "", 900);
  const dashboard = await loadDashboardData(env, url);
  const payload = buildSlackCommandPayload(dashboard, text, {
    command,
    userName,
    channelName,
    channelId,
    requestUrls: buildSlackRequestUrls(url)
  });

  recordSlackActivity({
    type: "slash_command",
    status: "responded",
    user: userName,
    channel: channelName || channelId,
    text: text || "help",
    detail: payload.text
  });

  return slackJsonResponse(payload);
}

async function handleSlackEvent(request, env, url, ctx) {
  const rawBody = await request.text();
  const verification = await verifySlackRequest(request, rawBody, env);

  if (!verification.ok) {
    recordSlackActivity({
      type: "event_callback",
      status: "rejected",
      detail: verification.message
    });
    return jsonResponse({ ok: false, message: verification.message }, verification.status);
  }

  let payload = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ ok: false, message: "Slack event payload was not valid JSON." }, 400);
  }

  if (payload.type === "url_verification") {
    recordSlackActivity({
      type: "url_verification",
      status: "verified",
      detail: "Slack Events API challenge completed."
    });
    return new Response(payload.challenge || "", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }

  if (payload.type === "event_callback") {
    const event = payload.event || {};

    if (event.bot_id) {
      return jsonResponse({ ok: true, ignored: "bot_event" });
    }

    recordSlackActivity({
      type: event.type || "event_callback",
      status: "received",
      user: event.user || "",
      channel: event.channel || "",
      text: stripSlackMentions(event.text || ""),
      detail: "Slack event acknowledged by HQ Worker."
    });

    if (event.type === "app_mention") {
      ctx?.waitUntil(replyToSlackMention(env, url, event));
    }

    return jsonResponse({ ok: true });
  }

  recordSlackActivity({
    type: payload.type || "event",
    status: "ignored",
    detail: "Slack event type was acknowledged but not processed."
  });

  return jsonResponse({ ok: true, ignored: payload.type || "unknown" });
}

async function handleSlackAction(request, env, url, ctx) {
  const rawBody = await request.text();
  const verification = await verifySlackRequest(request, rawBody, env);

  if (!verification.ok) {
    recordSlackActivity({
      type: "interactive_action",
      status: "rejected",
      detail: verification.message
    });
    return slackJsonResponse({ response_type: "ephemeral", text: verification.message }, verification.status);
  }

  const form = new URLSearchParams(rawBody);
  let payload = {};
  try {
    payload = JSON.parse(form.get("payload") || "{}");
  } catch {
    return slackJsonResponse({ response_type: "ephemeral", text: "Slack action payload was not valid JSON." }, 400);
  }

  const action = Array.isArray(payload.actions) ? payload.actions[0] : null;
  const actionId = sanitizePrompt(action?.action_id || action?.name || "slack_action", 120);
  const userName = sanitizeSlackMessage(payload.user?.username || payload.user?.name || payload.user?.id || "Slack user");
  const sourceText = sanitizePrompt(action?.value || payload.message?.text || "", 900);

  recordSlackActivity({
    type: "interactive_action",
    status: "received",
    user: userName,
    channel: payload.channel?.name || payload.channel?.id || "",
    text: actionId,
    detail: sourceText || "Slack interactive action acknowledged by HQ Worker."
  });

  if (payload.response_url) {
    ctx?.waitUntil(fetch(payload.response_url, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        response_type: "ephemeral",
        replace_original: false,
        text: `HQ received \`${actionId}\`. Open the HQ Operations Status panel for the current bridge state.`
      })
    }));
  }

  return slackJsonResponse({
    response_type: "ephemeral",
    text: `HQ received \`${actionId}\`. This action is logged in the HQ Slack activity panel.`
  });
}

function handleSlackActivity() {
  return jsonResponse({
    ok: true,
    mode: "ephemeral-worker-memory",
    durable: false,
    message: "Recent Slack callback activity is kept in Worker memory for this MVP. Add KV or D1 for durable cross-isolate history.",
    events: getSlackActivity()
  });
}

function getSlackConfig(env, body = {}) {
  const channelName = sanitizeSlackChannel(body?.channelName || env.SLACK_DEFAULT_CHANNEL_NAME || "core-qa-dream-team");
  const channel = sanitizeSlackChannel(
    body?.channelId ||
    env.SLACK_CHANNEL_ID ||
    env.SLACK_DEFAULT_CHANNEL_ID ||
    channelName
  );
  const tokenConfigured = Boolean(env.SLACK_BOT_TOKEN);
  const channelConfigured = Boolean(channel);
  const signingSecretConfigured = Boolean(env.SLACK_SIGNING_SECRET);

  return {
    botName: env.SLACK_BOT_NAME || "CORE JIRA NOTIFIER AGENT",
    channel,
    channelName,
    tokenConfigured,
    channelConfigured,
    signingSecretConfigured,
    canPost: tokenConfigured && channelConfigured,
    canReceive: signingSecretConfigured
  };
}

function sanitizeSlackMessage(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim().slice(0, 3500);
}

function sanitizeSlackChannel(value) {
  return String(value || "").trim().replace(/^#/, "").slice(0, 120);
}

function formatSlackError(error, status) {
  const code = error || "unknown_error";
  const known = {
    channel_not_found: "Slack could not find the configured channel. Set SLACK_CHANNEL_ID to the channel ID for #core-qa-dream-team.",
    not_in_channel: "The Slack bot is not in the configured channel. Invite CORE JIRA NOTIFIER AGENT to the channel and retry.",
    invalid_auth: "The Slack bot token is invalid. Refresh the SLACK_BOT_TOKEN Worker secret.",
    token_revoked: "The Slack bot token was revoked. Create a new bot token and update SLACK_BOT_TOKEN.",
    missing_scope: "The Slack bot token is missing the chat:write scope.",
    account_inactive: "Slack reports the bot account is inactive."
  };

  return known[code] || `Slack post failed with ${code}${status ? ` (HTTP ${status})` : ""}.`;
}

async function verifySlackRequest(request, rawBody, env) {
  if (!env.SLACK_SIGNING_SECRET) {
    return {
      ok: false,
      status: 503,
      message: "SLACK_SIGNING_SECRET is not configured, so HQ cannot verify inbound Slack callbacks yet."
    };
  }

  const timestamp = request.headers.get("x-slack-request-timestamp") || "";
  const signature = request.headers.get("x-slack-signature") || "";
  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (!timestamp || !signature || !Number.isFinite(timestampSeconds)) {
    return { ok: false, status: 401, message: "Slack signature headers are missing." };
  }

  if (Math.abs(nowSeconds - timestampSeconds) > 300) {
    return { ok: false, status: 401, message: "Slack request timestamp is outside the accepted replay window." };
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.SLACK_SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(`v0:${timestamp}:${rawBody}`));
  const expected = `v0=${bytesToHex(new Uint8Array(signed))}`;

  if (!constantTimeEqual(expected, signature)) {
    return { ok: false, status: 401, message: "Slack request signature did not match." };
  }

  return { ok: true };
}

function buildSlackRequestUrls(url) {
  const origin = url?.origin || "https://core-qa-headquarters-124.dfkabir253.workers.dev";
  return {
    slashCommand: `${origin}/api/slack/commands`,
    events: `${origin}/api/slack/events`,
    interactivity: `${origin}/api/slack/actions`
  };
}

function buildSlackCommandPayload(dashboard, text, context = {}) {
  const trimmed = sanitizePrompt(text, 900);
  const stats = buildReleaseStats(dashboard);
  const release = dashboard.version || "v3001.124.0";

  if (!trimmed || /\b(help|commands?|examples?)\b/i.test(trimmed)) {
    return {
      response_type: "ephemeral",
      text: [
        `*CORE QA HQ* is connected to ${release}.`,
        "Try:",
        "• `/qa-hq p0 tickets`",
        "• `/qa-hq tickets assigned to Nicole`",
        "• `/qa-hq tickets from Reservation`",
        "• `/qa-hq status`",
        "",
        `Request URLs: commands ${context.requestUrls?.slashCommand || "/api/slack/commands"}, events ${context.requestUrls?.events || "/api/slack/events"}, actions ${context.requestUrls?.interactivity || "/api/slack/actions"}`
      ].join("\n")
    };
  }

  if (/\b(status|health|bridge|ready)\b/i.test(trimmed)) {
    return {
      response_type: "ephemeral",
      text: [
        `*CORE QA HQ status for ${release}*`,
        `• Current pull: ${dashboard.pulledAtDisplay || dashboard.pulledAt || "unknown"}`,
        `• Tickets: ${stats.mainTickets} main / ${stats.subtasks} subtasks`,
        `• Top priority mix: ${Object.entries(stats.priorityCounts).sort(sortCounts).slice(0, 4).map(formatPair).join(", ") || "none"}`,
        `• Top status mix: ${Object.entries(stats.statusCounts).sort(sortCounts).slice(0, 4).map(formatPair).join(", ") || "none"}`
      ].join("\n")
    };
  }

  const directBrief = buildDirectQuestionBrief(dashboard, stats, {
    userPrompt: trimmed,
    promptTemplate: "ticket_lookup"
  }) || buildDeterministicBrief(dashboard, stats);

  return {
    response_type: "ephemeral",
    text: formatBriefForSlack(enrichBriefTickets(directBrief, dashboard), dashboard, stats)
  };
}

async function replyToSlackMention(env, url, event) {
  const config = getSlackConfig(env);

  if (!config.canPost || !event.channel) {
    recordSlackActivity({
      type: "app_mention",
      status: "reply_failed",
      user: event.user || "",
      channel: event.channel || "",
      detail: "Slack mention was received, but the bot token or channel is not configured for replies."
    });
    return;
  }

  try {
    const dashboard = await loadDashboardData(env, url);
    const prompt = stripSlackMentions(event.text || "");
    const payload = buildSlackCommandPayload(dashboard, prompt, { command: "@CORE JIRA NOTIFIER AGENT" });
    const slackPayload = {
      channel: event.channel,
      text: payload.text,
      thread_ts: event.thread_ts || event.ts,
      unfurl_links: false,
      unfurl_media: false
    };
    const { response, payload: slackResponse } = await postSlackMessage(env, slackPayload);

    recordSlackActivity({
      type: "app_mention",
      status: response.ok && slackResponse.ok ? "replied" : "reply_failed",
      user: event.user || "",
      channel: event.channel || "",
      text: prompt,
      detail: response.ok && slackResponse.ok
        ? "Slack mention reply posted in thread."
        : formatSlackError(slackResponse.error, response.status)
    });
  } catch (error) {
    recordSlackActivity({
      type: "app_mention",
      status: "reply_failed",
      user: event.user || "",
      channel: event.channel || "",
      text: stripSlackMentions(event.text || ""),
      detail: error.message
    });
  }
}

async function postSlackMessage(env, slackPayload) {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(slackPayload)
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  return { response, payload };
}

function formatBriefForSlack(brief, dashboard, stats) {
  const title = brief?.title || `${dashboard.version || "Current release"} QA board lookup`;
  const summary = brief?.summary || "";
  const tickets = Array.isArray(brief?.ticketsToWatch) ? brief.ticketsToWatch : [];
  const issueLines = tickets.slice(0, 8).map((ticket) => {
    const key = ticket.key || "Unknown";
    const link = ticket.url ? `<${ticket.url}|${key}>` : key;
    const metadata = [
      ticket.status || "",
      ticket.priority || "",
      ticket.assignee ? `assignee ${ticket.assignee}` : "",
      ticket.assignedDeveloper ? `dev ${ticket.assignedDeveloper}` : "",
      Array.isArray(ticket.components) && ticket.components.length ? ticket.components.slice(0, 3).join(", ") : ""
    ].filter(Boolean).join(" | ");

    return `• ${link}: ${ticket.summary || ticket.reason || "No summary"}${metadata ? ` (${metadata})` : ""}`;
  });
  const riskLines = asStringArray(brief?.topRisks, []).slice(0, 4).map((item) => `• ${item}`);
  const gateLines = asStringArray(brief?.reviewGates, []).slice(0, 3).map((item) => `• ${item}`);
  const fallbackLine = tickets.length
    ? ""
    : `• No matching tickets were returned. Current board has ${stats.mainTickets} main tickets and ${stats.subtasks} subtasks.`;
  const sections = [
    `*${title}*`,
    summary,
    issueLines.length || fallbackLine ? ["*Relevant tickets*", ...issueLines, fallbackLine].filter(Boolean).join("\n") : "",
    riskLines.length ? ["*Key findings*", ...riskLines].join("\n") : "",
    gateLines.length ? ["*Review gates*", ...gateLines].join("\n") : "",
    `_Source: ${dashboard.version || "current board"} pulled ${dashboard.pulledAtDisplay || dashboard.pulledAt || "unknown"}._`
  ].filter(Boolean);

  return truncateText(sections.join("\n\n"), 2900);
}

function stripSlackMentions(text) {
  return sanitizePrompt(String(text || "").replace(/<@[A-Z0-9]+>/gi, " ").replace(/\s+/g, " "), 900);
}

function getSlackActivityStore() {
  const root = globalThis;
  if (!Array.isArray(root.__HQ_SLACK_ACTIVITY__)) {
    root.__HQ_SLACK_ACTIVITY__ = [];
  }
  return root.__HQ_SLACK_ACTIVITY__;
}

function recordSlackActivity(event) {
  const store = getSlackActivityStore();
  store.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    type: sanitizePrompt(event.type || "slack", 80),
    status: sanitizePrompt(event.status || "received", 80),
    user: sanitizePrompt(event.user || "", 120),
    channel: sanitizePrompt(event.channel || "", 120),
    text: sanitizePrompt(event.text || "", 500),
    detail: sanitizePrompt(event.detail || "", 800)
  });
  store.splice(SLACK_ACTIVITY_LIMIT);
}

function getSlackActivity() {
  return getSlackActivityStore().slice(0, SLACK_ACTIVITY_LIMIT);
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a, b) {
  const left = String(a || "");
  const right = String(b || "");

  if (left.length !== right.length) {
    return false;
  }

  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return result === 0;
}

async function handleReleaseSummary(request, env, url) {
  const body = await safeJson(request);
  const dashboard = await loadDashboardData(env, url);
  const stats = buildReleaseStats(dashboard);
  const ticketPlanRequest = extractTicketPlanRequest(dashboard, body);
  const missingTicketBrief = ticketPlanRequest?.missing ? buildMissingTicketBrief(dashboard, stats, ticketPlanRequest) : null;
  const directBrief = missingTicketBrief || (ticketPlanRequest ? null : buildDirectQuestionBrief(dashboard, stats, body));
  const promptTemplate = sanitizePrompt(body?.promptTemplate, 80);

  if (directBrief && (isExactBoardLookupBrief(directBrief) || !env.AI || !Array.isArray(directBrief.ticketsToWatch) || directBrief.ticketsToWatch.length === 0)) {
    return jsonResponse(buildBriefPayload({
      dashboard,
      stats,
      provider: "CORE QA HQ board lookup",
      model: "dashboard-data.json",
      brief: enrichBriefTickets(directBrief, dashboard),
      answerType: directBrief.answerType || "direct_lookup"
    }));
  }

  if (!env.AI) {
    return jsonResponse({ ok: false, message: "Cloudflare Workers AI binding is not configured." }, 503);
  }

  const context = buildModelContext(dashboard, stats, body, ticketPlanRequest, directBrief);
  const fallbackBrief = directBrief || (ticketPlanRequest
    ? buildTicketTestPlanBrief(dashboard, stats, ticketPlanRequest)
    : buildDeterministicBrief(dashboard, stats));
  const answerType = directBrief?.answerType || (ticketPlanRequest ? "ticket_test_plan" : promptTemplate === "free_form" ? "free_form" : undefined);

  try {
    const aiResult = await env.AI.run(AI_MODEL, {
      messages: [
        {
          role: "system",
          content: [
            "You are the CORE QA Headquarters release intelligence assistant.",
            "Return only valid JSON. Do not include Markdown.",
            "Use only the provided dashboard context. If evidence is missing, say it is missing.",
            "If a user prompt is present, answer it only when it is supported by the provided dashboard context.",
            "If requestedOutput is ticket_test_plan, create a ticket-specific QA test plan for targetIssue and do not write a release summary.",
            "If requestedOutput is direct_lookup_analysis, explain the exact matchedIssues from the board pull and keep every matched issue in ticketsToWatch.",
            "If requestedOutput is free_form_analysis, answer the user's release-board question directly and cite relevant tickets from the provided issue list.",
            "All output is draft-only. Never claim Jira, Slack, or automation actions were performed."
          ].join(" ")
        },
        {
          role: "user",
          content: JSON.stringify(context)
        }
      ],
      max_tokens: 1400,
      response_format: {
        type: "json_schema",
        json_schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
            topRisks: { type: "array", items: { type: "string" } },
            qaFocus: { type: "array", items: { type: "string" } },
            ticketsToWatch: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  key: { type: "string" },
                  reason: { type: "string" },
                  url: { type: "string" },
                  summary: { type: "string" },
                  status: { type: "string" },
                  priority: { type: "string" },
                  type: { type: "string" },
                  assignee: { type: "string" },
                  assignedDeveloper: { type: "string" },
                  components: { type: "array", items: { type: "string" } },
                  parent: { type: "string" }
                },
                required: ["key", "reason"]
              }
            },
            componentSignals: { type: "array", items: { type: "string" } },
            reviewGates: { type: "array", items: { type: "string" } },
            sourceNotes: { type: "array", items: { type: "string" } }
          },
          required: ["title", "summary", "topRisks", "qaFocus", "ticketsToWatch", "componentSignals", "reviewGates", "sourceNotes"]
        }
      }
    });

    const brief = enrichBriefTickets(normalizeBrief(parseAiResponse(aiResult), fallbackBrief), dashboard, fallbackBrief);

    return jsonResponse(buildBriefPayload({
      dashboard,
      stats,
      provider: "Cloudflare Workers AI",
      model: AI_MODEL,
      brief,
      answerType
    }));
  } catch (error) {
    return jsonResponse(buildBriefPayload({
      dashboard,
      stats,
      provider: "Cloudflare Workers AI",
      model: AI_MODEL,
      brief: enrichBriefTickets(fallbackBrief, dashboard),
      answerType,
      warning: `AI model response was not usable, so HQ returned a deterministic draft: ${error.message}`
    }));
  }
}

async function handleAiChat(request, env, url) {
  const body = await safeJson(request);
  const dashboard = await loadDashboardData(env, url);
  const stats = buildReleaseStats(dashboard);
  const message = sanitizePrompt(body?.message, 1200);

  if (!message) {
    return jsonResponse({ ok: false, message: "Ask the HQ AI a ticket or sprint question first." }, 400);
  }

  const history = normalizeChatHistory(body?.history);
  const context = buildAiChatContext(dashboard, stats, message, history);
  const fallback = buildDeterministicChatAnswer(context, dashboard);

  if (!env.AI) {
    return jsonResponse(buildChatPayload({
      dashboard,
      context,
      answer: fallback,
      provider: "CORE QA HQ board lookup",
      model: "dashboard-data.json",
      warning: "Cloudflare Workers AI binding is not configured, so HQ returned a deterministic board-data answer."
    }));
  }

  try {
    const aiResult = await env.AI.run(AI_MODEL, {
      messages: [
        {
          role: "system",
          content: [
            "You are the CORE QA Headquarters ticket and sprint chat agent.",
            "Return only valid JSON. Do not include Markdown.",
            "Use only the provided dashboard context, exactMatches, release issues, and sprint issues.",
            "If exactLookup is present, answer that exact question and do not invent additional matching tickets.",
            "If the user asks about sprint, use sprintContext first. If the user does not mention sprint, use releaseContext first.",
            "Always include useful ticket keys, Jira links, status, priority, assignee, and assigned developer when tickets are relevant.",
            "If the answer is a count, state the exact count and the scope used.",
            "All output is draft-only. Never claim Jira, Slack, or automation actions were performed."
          ].join(" ")
        },
        {
          role: "user",
          content: JSON.stringify(context)
        }
      ],
      max_tokens: 1800,
      response_format: {
        type: "json_schema",
        json_schema: {
          type: "object",
          properties: {
            answer: { type: "string" },
            highlights: { type: "array", items: { type: "string" } },
            tickets: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  key: { type: "string" },
                  url: { type: "string" },
                  summary: { type: "string" },
                  status: { type: "string" },
                  priority: { type: "string" },
                  type: { type: "string" },
                  assignee: { type: "string" },
                  assignedDeveloper: { type: "string" },
                  components: { type: "array", items: { type: "string" } },
                  fixVersions: { type: "array", items: { type: "string" } },
                  sprintNames: { type: "array", items: { type: "string" } },
                  parent: { type: "string" },
                  reason: { type: "string" }
                },
                required: ["key", "summary", "status", "priority"]
              }
            },
            sprint: {
              type: "object",
              properties: {
                name: { type: "string" },
                label: { type: "string" },
                total: { type: "number" },
                statusMix: { type: "array", items: { type: "string" } },
                priorityMix: { type: "array", items: { type: "string" } },
                dateWindow: { type: "string" }
              }
            },
            followUps: { type: "array", items: { type: "string" } },
            sourceNotes: { type: "array", items: { type: "string" } }
          },
          required: ["answer", "highlights", "tickets", "sprint", "followUps", "sourceNotes"]
        }
      }
    });

    return jsonResponse(buildChatPayload({
      dashboard,
      context,
      answer: normalizeChatAnswer(parseAiResponse(aiResult), fallback, context, dashboard),
      provider: "Cloudflare Workers AI",
      model: AI_MODEL
    }));
  } catch (error) {
    return jsonResponse(buildChatPayload({
      dashboard,
      context,
      answer: fallback,
      provider: "Cloudflare Workers AI",
      model: AI_MODEL,
      warning: `AI chat response was not usable, so HQ returned a deterministic board-data answer: ${error.message}`
    }));
  }
}

function buildBriefPayload({ dashboard, stats, provider, model, brief, warning, answerType }) {
  return {
    ok: true,
    provider,
    model,
    generatedAt: new Date().toISOString(),
    release: dashboard.version || "v3001.124.0",
    answerType: answerType || brief?.answerType || "release_brief",
    source: {
      schemaVersion: dashboard.schemaVersion || "",
      pulledAt: dashboard.pulledAt || "",
      pulledAtDisplay: dashboard.pulledAtDisplay || "",
      total: dashboard.total || stats.total,
      mainTickets: stats.mainTickets,
      subtasks: stats.subtasks
    },
    stats,
    brief,
    ...(warning ? { warning } : {})
  };
}

async function loadDashboardData(env, url) {
  const dataUrl = new URL("/dashboard-data.json", url.origin);
  const response = await env.ASSETS.fetch(new Request(dataUrl.toString(), { method: "GET" }));

  if (!response.ok) {
    throw new Error(`Unable to load dashboard-data.json: HTTP ${response.status}`);
  }

  return response.json();
}

async function safeJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function buildReleaseStats(dashboard) {
  const issues = Array.isArray(dashboard.issues) ? dashboard.issues : [];
  const main = issues.filter((issue) => !issue.isSubtask);
  const subtasks = issues.filter((issue) => issue.isSubtask);

  return {
    total: issues.length,
    mainTickets: main.length,
    subtasks: subtasks.length,
    statusCounts: countBy(issues, (issue) => issue.status || "Unknown"),
    priorityCounts: countBy(issues, (issue) => issue.priority || "None"),
    componentCounts: countBy(issues.flatMap((issue) => issue.components?.length ? issue.components : ["None"]), (component) => component),
    assigneeCounts: countBy(issues, (issue) => issue.assignee || "Unassigned"),
    developerCounts: countBy(issues, (issue) => issue.assignedDeveloper || "Unassigned"),
    mediaTickets: issues.filter((issue) => Number(issue.descriptionMediaCount || 0) > 0).map((issue) => issue.key),
    commentTickets: issues.filter((issue) => Number(issue.commentCount || 0) > 0).map((issue) => issue.key)
  };
}

function extractTicketPlanRequest(dashboard, body) {
  const userPrompt = sanitizePrompt(body?.userPrompt);
  const promptTemplate = sanitizePrompt(body?.promptTemplate, 80);
  const isTestPlanPrompt = /\b(test\s*plan|testing\s*plan|qa\s*plan|test\s*cases?|test\s*scenarios?|coverage\s*plan)\b/i.test(userPrompt);

  if (!isTestPlanPrompt) {
    return null;
  }

  const keyMatch = userPrompt.match(/\b([A-Z][A-Z0-9]+-\d+)\b/i);

  if (!keyMatch) {
    return null;
  }

  const key = keyMatch[1].toUpperCase();
  const issues = Array.isArray(dashboard.issues) ? dashboard.issues : [];
  const issue = issues.find((candidate) => String(candidate.key || "").toUpperCase() === key);
  const relatedIssues = issue ? findRelatedIssues(issues, issue) : [];

  return {
    key,
    issue,
    relatedIssues,
    missing: !issue,
    promptTemplate: promptTemplate || "ticket_test_plan",
    userPrompt
  };
}

function findRelatedIssues(issues, issue) {
  const keys = new Set();

  if (issue.parent?.key) {
    keys.add(String(issue.parent.key).toUpperCase());
  }

  for (const relatedKey of extractTicketKeys(`${issue.description || ""} ${issue.summary || ""}`)) {
    keys.add(relatedKey);
  }

  const children = issues.filter((candidate) => candidate.parent?.key && String(candidate.parent.key).toUpperCase() === String(issue.key).toUpperCase());
  const sameParent = issue.parent?.key
    ? issues.filter((candidate) => candidate.key !== issue.key && String(candidate.parent?.key || "").toUpperCase() === String(issue.parent.key).toUpperCase()).slice(0, 6)
    : [];
  const explicit = issues.filter((candidate) => keys.has(String(candidate.key || "").toUpperCase()));

  return uniqueIssues([...children, ...sameParent, ...explicit]).slice(0, 10);
}

function uniqueIssues(issues) {
  const seen = new Set();
  return issues.filter((issue) => {
    const key = String(issue?.key || "").toUpperCase();

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function extractTicketKeys(value) {
  return Array.from(String(value || "").matchAll(/\b([A-Z][A-Z0-9]+-\d+)\b/gi))
    .map((match) => match[1].toUpperCase());
}

function buildMissingTicketBrief(dashboard, stats, request) {
  return {
    answerType: "ticket_test_plan",
    title: `No ticket data found for ${request.key}`,
    summary: `${request.key} is not present in the current ${dashboard.version || "release"} dashboard artifact, so HQ cannot build a grounded test plan from board data.`,
    topRisks: [
      "The requested ticket was not found in dashboard-data.json.",
      "A test plan should not be generated without the ticket description or Jira context."
    ],
    qaFocus: [
      "Refresh the board if the ticket was recently added.",
      "Confirm the ticket belongs to the active fixVersion.",
      "Open Jira directly if this ticket lives outside the current release board."
    ],
    ticketsToWatch: [],
    componentSignals: Object.entries(stats.componentCounts).sort(sortCounts).slice(0, 6).map(formatPair),
    reviewGates: [
      "Do not post or share a generated plan until the ticket source data is available.",
      "Use the Jira search panel for live lookup when the board artifact is stale."
    ],
    sourceNotes: ["Source: dashboard-data.json from the deployed HQ Worker assets."]
  };
}

function buildTicketTestPlanBrief(dashboard, stats, request) {
  const issue = request.issue;
  const relatedTickets = [
    {
      key: issue.key,
      reason: `${issue.summary || "No summary"} | ${issue.status || "Unknown status"} | ${issue.priority || "No priority"} | assignee ${issue.assignee || "Unassigned"}`
    },
    ...request.relatedIssues.map((related) => ({
      key: related.key || "Unknown",
      reason: `${related.summary || "No summary"} | ${related.type || "Issue"} | ${related.status || "Unknown status"}`
    }))
  ];

  return {
    answerType: "ticket_test_plan",
    title: `Test plan for ${issue.key}`,
    summary: `${issue.key} is ${issue.summary || "the requested ticket"} in ${dashboard.version || "the current release"}. Draft coverage should focus on home-course eligibility, selection and modification limits, facility restrictions, rollover behavior, GNC override, audit/history logging, API contracts, and error messaging from the pulled Jira description.`,
    topRisks: [
      "Ambiguity risk: action limits need confirmation for initial selection plus modification counts.",
      "Rollover risk: renewal, 365-day crossing, and lazy/scheduled creation behavior need explicit validation.",
      "Eligibility risk: member, non-member, guest, benefit-based, and future subscription contexts can diverge.",
      "Override risk: GNC override behavior may bypass restrictions and must remain auditable."
    ],
    qaFocus: [
      "Eligibility: verify non-member, eligible member, ineligible member, guest customer, and product benefit scenarios.",
      "Selection limits: verify initial selection, allowed modification, third attempt rejection, and same-facility selection error.",
      "Facility restrictions: verify Master Facility rejection and configured exclusion-list rejection in DEV.",
      "Rollover: verify 365-day rollover, subscription start date reset, monthly renewal not resetting, and prior selection carry-forward.",
      "GNC override: verify support override, audit fields, reason handling, and modification counter behavior.",
      "API contracts: validate Set Home Course and Modify Home Course request/response, ChannelId persistence, and error payloads.",
      "History: verify CreatedTimeStamp, LastModifiedTimestamp, LastModifiedBy, old/new value, source, reason, and period context."
    ],
    ticketsToWatch: relatedTickets.slice(0, 10),
    componentSignals: componentSignalsForIssues([issue, ...request.relatedIssues]),
    reviewGates: [
      "Confirm open requirement questions in the latest comment before finalizing expected results.",
      "Confirm whether CORE-14428 benefit eligibility is the only member eligibility source.",
      "Confirm whether GetCustomer and GetCustomerSubscription must return Home Course data for launch.",
      "Run API validation before UI validation because this ticket defines backend behavior."
    ],
    sourceNotes: [
      `Source ticket: ${issue.key} from dashboard-data.json.`,
      issue.lastCommentUrl ? `Latest pulled comment: ${issue.lastCommentUrl}` : "No pulled comment link was available.",
      "This is a draft QA plan and does not post to Jira."
    ]
  };
}

function buildDirectQuestionBrief(dashboard, stats, body) {
  const promptTemplate = sanitizePrompt(body?.promptTemplate, 80);
  const userPrompt = sanitizePrompt(body?.userPrompt);
  const issues = Array.isArray(dashboard.issues) ? dashboard.issues : [];
  const promptLooksLikeLookup = /\b(ticket|tickets|issue|issues|assigned|assignee|developer|owner|component|components|priority|priorities|comment|comments|file|files|attachment|attachments|checklist|markdown|from|with|count|how many|list|show|any|there)\b/i.test(userPrompt);
  const priorityLookup = extractPriorityLookup(userPrompt);
  const commentFileLookup = extractCommentFileLookup(userPrompt);

  if (priorityLookup) {
    return buildPriorityLookupBrief(dashboard, stats, priorityLookup);
  }

  if (commentFileLookup) {
    return buildCommentFileLookupBrief(dashboard, stats, commentFileLookup);
  }

  if (isMainTicketRundownPrompt(userPrompt, promptTemplate)) {
    return buildMainTicketRundownBrief(dashboard, stats);
  }

  if (promptTemplate !== "ticket_lookup" && !promptLooksLikeLookup) {
    return null;
  }

  const lookup = extractComponentLookup(userPrompt, issues) || extractPeopleLookup(userPrompt, issues);

  if (!lookup) {
    if (promptTemplate !== "ticket_lookup") {
      return null;
    }

    return {
      answerType: "ticket_lookup",
      title: "Ticket lookup needs a person or field",
      summary: "Ask the HQ AI for a board-data lookup such as: What tickets are assigned to Dewan?",
      topRisks: [
        "No Jira, Slack, or automation action was performed.",
        "The lookup mode uses the current dashboard artifact only."
      ],
      qaFocus: [
        "Try: What tickets are assigned to Dewan?",
        "Try: Which tickets have Nicole as assignee?",
        "Try: What tickets have Luis as assigned developer?",
        "Try: How many P0 tickets are there?",
        "Try: Are there any tickets from Reservation?"
      ],
      ticketsToWatch: [],
      componentSignals: Object.entries(stats.assigneeCounts).sort(sortCounts).slice(0, 6).map(formatPair),
      reviewGates: ["Refresh the board if the pull timestamp is stale before relying on the answer."],
      sourceNotes: ["Source: dashboard-data.json from the deployed HQ Worker assets."]
    };
  }

  return lookup.type === "component"
    ? buildComponentLookupBrief(dashboard, stats, lookup)
    : buildPeopleLookupBrief(dashboard, stats, lookup);
}

function isMainTicketRundownPrompt(userPrompt, promptTemplate) {
  const prompt = sanitizePrompt(userPrompt);

  if (!prompt) {
    return false;
  }

  const broadRundown = /\b(run\s*down|rundown|summary|summarize|overview|rollup|leadership|all\s+(?:the\s+)?tickets|all\s+(?:the\s+)?issues|main\s+tickets)\b/i.test(prompt);
  const asksForTickets = /\b(ticket|tickets|issue|issues|work\s*items?)\b/i.test(prompt);
  const specificLookup = /\b(assigned|assignee|developer|dev|owner|component|components|priority|priorities|comment|comments|file|files|attachment|attachments|checklist|markdown|from|with|P[0-4])\b/i.test(prompt);

  return asksForTickets && broadRundown && !specificLookup
    || promptTemplate === "leadership" && asksForTickets && !specificLookup;
}

function buildMainTicketRundownBrief(dashboard, stats) {
  const issues = Array.isArray(dashboard.issues) ? dashboard.issues : [];
  const mainTickets = issues
    .filter((issue) => !issue.isSubtask)
    .sort(sortIssuesForLookup);
  const release = dashboard.version || "current release";
  const pulledAt = dashboard.pulledAtDisplay || dashboard.pulledAt || "the latest artifact";
  const priorityPairs = Object.entries(countBy(mainTickets, (issue) => issue.priority || "None")).sort(sortCounts);
  const statusPairs = Object.entries(countBy(mainTickets, (issue) => issue.status || "Unknown")).sort(sortCounts);
  const assigneePairs = Object.entries(countBy(mainTickets, (issue) => issue.assignee || "Unassigned")).sort(sortCounts);
  const highPriorityCount = mainTickets.filter((issue) => ["P0", "P1"].includes(String(issue.priority || "").toUpperCase())).length;

  if (!mainTickets.length) {
    return {
      answerType: "main_ticket_rundown",
      title: `No main tickets found for ${release}`,
      summary: `No main tickets were present in the ${release} dashboard artifact pulled ${pulledAt}.`,
      topRisks: [
        "No leadership ticket rundown can be generated until the board artifact includes main tickets.",
        "Refresh the board before sharing status externally."
      ],
      qaFocus: ["Use the Jira search panel when live data is needed beyond the dashboard artifact."],
      ticketsToWatch: [],
      componentSignals: Object.entries(stats.componentCounts).sort(sortCounts).slice(0, 8).map(formatPair),
      reviewGates: ["Refresh board data if the artifact is stale before relying on this summary."],
      sourceNotes: ["Source: dashboard-data.json from the deployed HQ Worker assets."]
    };
  }

  return {
    answerType: "main_ticket_rundown",
    title: `Leadership main-ticket rundown for ${release}`,
    summary: `${mainTickets.length} main ticket(s) are in ${release} from the dashboard artifact pulled ${pulledAt}. Subtasks are excluded from this leadership summary so the list stays focused on parent work items.`,
    topRisks: [
      `${highPriorityCount} main ticket(s) are P0/P1.`,
      `Priority mix: ${priorityPairs.map(formatPair).join(", ") || "none found"}.`,
      `Status mix: ${statusPairs.map(formatPair).join(", ") || "none found"}.`
    ],
    qaFocus: [
      `Primary owners: ${assigneePairs.slice(0, 5).map(formatPair).join(", ") || "none found"}.`,
      "Use the main-ticket table for leadership updates; open Jira for comments, images, video, or checklist evidence.",
      "Subtasks are intentionally excluded here and remain attached under their parent tickets in the board views."
    ],
    ticketsToWatch: mainTickets.map((issue) => ({
      key: issue.key || "Unknown",
      reason: `${issue.status || "Unknown status"} | ${issue.priority || "No priority"} | ${issue.assignee || "Unassigned"}`
    })),
    componentSignals: componentSignalsForIssues(mainTickets),
    reviewGates: [
      "Refresh the board if the pull timestamp is stale before sharing this externally.",
      "Confirm P0/P1 status and ownership in Jira before committing dates or release health.",
      "Use this as a leadership-ready draft; no Jira, Slack, or automation mutation was performed."
    ],
    sourceNotes: [
      "Source: dashboard-data.json from the deployed HQ Worker assets.",
      "This direct lookup is deterministic board data, not model inference.",
      "No Jira, Slack, or automation mutation was performed."
    ]
  };
}

function buildChatPayload({ dashboard, context, answer, provider, model, warning }) {
  return {
    ok: true,
    provider,
    model,
    generatedAt: new Date().toISOString(),
    release: dashboard.version || "v3001.124.0",
    scope: context.scope,
    exactLookup: context.exactLookup ? {
      type: context.exactLookup.type,
      label: context.exactLookup.label,
      count: context.exactLookup.count
    } : null,
    source: {
      schemaVersion: dashboard.schemaVersion || "",
      pulledAt: dashboard.pulledAt || "",
      pulledAtDisplay: dashboard.pulledAtDisplay || "",
      sprintPulledAt: dashboard.sprintView?.pulledAt || "",
      sprintPulledAtDisplay: dashboard.sprintView?.pulledAtDisplay || "",
      releaseTickets: context.releaseContext.total,
      sprintTickets: context.sprintContext.total
    },
    answer,
    ...(warning ? { warning } : {})
  };
}

function extractPriorityLookup(userPrompt) {
  const prompt = sanitizePrompt(userPrompt);

  if (!prompt || !/\b(ticket|tickets|issue|issues|priority|priorities|count|how many|list|show|are there)\b/i.test(prompt)) {
    return null;
  }

  const priorities = Array.from(new Set(Array.from(prompt.matchAll(/\bP[0-4]\b/gi)).map((match) => match[0].toUpperCase())));

  return priorities.length === 1
    ? { type: "priority", priority: priorities[0], displayName: priorities[0] }
    : null;
}

function extractComponentLookup(userPrompt, issues) {
  const prompt = sanitizePrompt(userPrompt);

  if (!prompt) {
    return null;
  }

  const normalizedPrompt = normalizeName(prompt);
  const knownComponents = Array.from(new Set(issues
    .flatMap((issue) => Array.isArray(issue.components) ? issue.components : [])
    .filter((component) => typeof component === "string" && component.trim())))
    .sort((a, b) => b.length - a.length);
  const explicitComponentQuery = [
    /component(?:s)?\s+(?:is|are|=|:)?\s*(.+?)(?:[?.!,;]|$)/i,
    /with\s+(.+?)\s+component(?:s)?(?:[?.!,;]|$)/i,
    /from\s+(.+?)(?:[?.!,;]|$)/i
  ];

  for (const regex of explicitComponentQuery) {
    const match = prompt.match(regex);
    const cleaned = cleanLookupName(match?.[1]);

    if (!cleaned) {
      continue;
    }

    const knownMatch = findKnownComponent(cleaned, knownComponents);
    return {
      type: "component",
      query: knownMatch || cleaned,
      displayName: knownMatch || cleaned
    };
  }

  if (!/\b(component|components|from|with)\b/i.test(prompt)) {
    return null;
  }

  const knownMatch = knownComponents.find((component) => {
    const normalizedComponent = normalizeName(component);
    const componentParts = getLookupParts(normalizedComponent);
    return normalizedPrompt.includes(normalizedComponent) || componentParts.some((part) => normalizedPrompt.includes(part));
  });

  return knownMatch
    ? { type: "component", query: knownMatch, displayName: knownMatch }
    : null;
}

function findKnownComponent(query, knownComponents) {
  const normalizedQuery = normalizeName(query);
  return knownComponents.find((component) => {
    const normalizedComponent = normalizeName(component);
    const componentParts = getLookupParts(normalizedComponent);
    return normalizedComponent.includes(normalizedQuery)
      || normalizedQuery.includes(normalizedComponent)
      || componentParts.some((part) => normalizedQuery.includes(part))
      || getLookupParts(normalizedQuery).some((part) => normalizedComponent.includes(part));
  });
}

function getLookupParts(value) {
  const genericParts = new Set(["golfnow", "golf", "services", "service", "svc", "api", "apis", "core", "platform", "windows"]);
  return normalizeName(value)
    .split(" ")
    .filter((part) => part.length > 2 && !genericParts.has(part));
}

function extractCommentFileLookup(userPrompt) {
  const prompt = sanitizePrompt(userPrompt);

  if (!prompt || !/\b(comment|comments|file|files|attachment|attachments|checklist|markdown|md)\b/i.test(prompt)) {
    return null;
  }

  const extension = extractFileExtensionLookup(prompt);

  if (!extension && !/\b(file|files|attachment|attachments|checklist)\b/i.test(prompt)) {
    return null;
  }

  return {
    type: "comment_file",
    extension,
    query: extension ? `.${extension}` : "",
    displayName: extension ? `.${extension} file` : "pulled comment/checklist file"
  };
}

function extractFileExtensionLookup(prompt) {
  const dotMatch = prompt.match(/\.\s*([a-z0-9]{1,12})\b/i);

  if (dotMatch?.[1]) {
    return dotMatch[1].toLowerCase();
  }

  if (/\bmarkdown\b/i.test(prompt)) {
    return "md";
  }

  const fileTypeMatch = prompt.match(/\b([a-z0-9]{1,12})\s+(?:file|files|attachment|attachments)\b/i);
  const candidate = fileTypeMatch?.[1]?.toLowerCase() || "";

  return candidate && !["any", "the", "that", "with", "have", "has"].includes(candidate)
    ? candidate
    : "";
}

function extractPeopleLookup(userPrompt, issues) {
  const prompt = sanitizePrompt(userPrompt);

  if (!prompt) {
    return null;
  }

  const targetField = /\b(assigned developer|developer|dev owner|dev)\b/i.test(prompt)
    ? "assignedDeveloper"
    : "assignee";
  const knownNames = Array.from(new Set(issues
    .map((issue) => issue?.[targetField])
    .filter((name) => typeof name === "string" && name.trim())))
    .sort((a, b) => b.length - a.length);
  const normalizedPrompt = normalizeName(prompt);
  const knownMatch = knownNames.find((name) => {
    const normalizedName = normalizeName(name);
    const nameParts = normalizedName.split(" ").filter((part) => part.length > 2);
    return normalizedPrompt.includes(normalizedName) || nameParts.some((part) => normalizedPrompt.includes(part));
  });

  if (knownMatch) {
    return { field: targetField, query: knownMatch, displayName: knownMatch };
  }

  const regexes = [
    /assigned\s+to\s+(.+?)(?:[?.!,;]|$)/i,
    /assignee\s+(?:is|=|:)?\s*(.+?)(?:[?.!,;]|$)/i,
    /developer\s+(?:is|=|:)?\s*(.+?)(?:[?.!,;]|$)/i
  ];

  for (const regex of regexes) {
    const match = prompt.match(regex);
    const cleaned = cleanLookupName(match?.[1]);

    if (cleaned) {
      return { field: targetField, query: cleaned, displayName: cleaned };
    }
  }

  return null;
}

function buildCommentFileLookupBrief(dashboard, stats, lookup) {
  const issues = Array.isArray(dashboard.issues) ? dashboard.issues : [];
  const records = issues
    .map((issue) => ({ issue, evidence: collectCommentFileEvidence(issue, lookup) }))
    .filter((record) => record.evidence.length)
    .sort((a, b) => sortIssuesForLookup(a.issue, b.issue));
  const matches = records.map((record) => record.issue);
  const mainCount = matches.filter((issue) => !issue.isSubtask).length;
  const subtaskCount = matches.length - mainCount;
  const release = dashboard.version || "current release";
  const pulledAt = dashboard.pulledAtDisplay || dashboard.pulledAt || "the latest artifact";
  const lookupLabel = lookup.displayName || "comment/checklist file";

  if (!records.length) {
    return {
      answerType: "comment_file_lookup",
      title: `No tickets found with ${lookupLabel}`,
      summary: `No issues in ${release} currently have ${lookupLabel} evidence in pulled comment bodies, checklist file names, or parsed checklist source files from the dashboard artifact pulled ${pulledAt}.`,
      topRisks: [
        "No matching file evidence was found in the current artifact.",
        "This answer did not call Jira live; it used the deployed dashboard-data.json."
      ],
      qaFocus: [
        `${stats.commentTickets.length} ticket(s) in the artifact include pulled comments.`,
        "Matched fields: issue.comments body/bodyHtml, issue.testChecklist.files filename, and issue.testChecklist.testCases sourceFile."
      ],
      ticketsToWatch: [],
      componentSignals: Object.entries(stats.componentCounts).sort(sortCounts).slice(0, 8).map(formatPair),
      reviewGates: [
        "Refresh the board if the pull timestamp is stale.",
        "Use Jira search when you need live attachments or comments beyond the dashboard artifact."
      ],
      sourceNotes: ["Source: dashboard-data.json from the deployed HQ Worker assets."]
    };
  }

  return {
    answerType: "comment_file_lookup",
    title: `Tickets with ${lookupLabel} evidence`,
    summary: `Yes. ${records.length} issue(s) in ${release} have ${lookupLabel} evidence in pulled comments or checklist file metadata: ${mainCount} main ticket(s) and ${subtaskCount} subtask(s), from the artifact pulled ${pulledAt}.`,
    topRisks: [
      "Lookup mode: matched pulled comment bodies and checklist file metadata only.",
      `${records.length} of ${stats.total} current issue(s) match ${lookupLabel}.`,
      `${mainCount} main ticket(s) and ${subtaskCount} subtask(s) matched.`,
      `Current artifact pull: ${pulledAt}.`
    ],
    qaFocus: records.slice(0, 10).map((record) => `${record.issue.key}: ${record.evidence.map((item) => item.label).join("; ")}`),
    ticketsToWatch: records.slice(0, 12).map((record) => ({
      key: record.issue.key || "Unknown",
      reason: formatCommentFileLookupReason(record)
    })),
    generatedDocuments: buildGeneratedMarkdownDocuments(records, release, pulledAt),
    componentSignals: componentSignalsForIssues(matches),
    reviewGates: [
      "Open Jira for the ticket before using attached-file evidence externally.",
      "Refresh the board if the pull timestamp is stale.",
      "Use the ticket detail modal for pulled comments, media, checklist file context, and latest-comment links."
    ],
    sourceNotes: [
      "Source: dashboard-data.json from the deployed HQ Worker assets.",
      "Matched fields: issue.comments body/bodyHtml, issue.testChecklist.files filename, and issue.testChecklist.testCases sourceFile.",
      "This direct lookup is deterministic board data, not model inference."
    ]
  };
}

function collectCommentFileEvidence(issue, lookup) {
  const query = String(lookup?.query || "").toLowerCase();
  const evidence = [];
  const seen = new Set();

  function addEvidence(source, value, detail = "", url = "") {
    const text = [value, detail].filter(Boolean).join(" ").toLowerCase();

    if (query && !text.includes(query)) {
      return;
    }

    const key = `${source}|${value}|${detail}|${url}`;

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    evidence.push({
      source,
      value,
      detail,
      url,
      label: `${source}: ${value}${detail ? ` (${detail})` : ""}`
    });
  }

  for (const file of issue?.testChecklist?.files || []) {
    addEvidence("Checklist file", file.filename || "Unnamed file", [file.author ? `author ${file.author}` : "", file.created ? `created ${formatDateForEvidence(file.created)}` : ""].filter(Boolean).join("; "), issue.lastCommentUrl || "");
  }

  const sourceFiles = Array.from(new Set((issue?.testChecklist?.testCases || [])
    .map((testCase) => testCase?.sourceFile)
    .filter(Boolean)));

  for (const sourceFile of sourceFiles) {
    const caseCount = (issue?.testChecklist?.testCases || []).filter((testCase) => testCase?.sourceFile === sourceFile).length;
    addEvidence("Checklist source", sourceFile, `${caseCount} parsed test case(s)`, issue.lastCommentUrl || "");
  }

  for (const comment of issue?.comments || []) {
    const commentText = [comment.body, comment.bodyHtml].filter(Boolean).join(" ");

    if (!query || !commentText.toLowerCase().includes(query)) {
      continue;
    }

    addEvidence("Comment text", comment.id ? `comment ${comment.id}` : "comment", [comment.author || "", comment.createdDisplay || "", `contains ${query}`].filter(Boolean).join("; "), comment.url || issue.lastCommentUrl || "");
  }

  return evidence;
}

function formatCommentFileLookupReason(record) {
  const issue = record.issue || {};
  const evidence = record.evidence || [];
  const files = Array.from(new Set(evidence.map((item) => item.value).filter(Boolean))).slice(0, 4).join(", ");
  const latestComment = issue.lastCommentUrl ? `latest comment ${issue.lastCommentUrl}` : "no latest comment link";

  return [
    issue.summary || "No summary",
    issue.type || "Issue",
    issue.isSubtask && issue.parent?.key ? `parent ${issue.parent.key}` : "main ticket",
    issue.status || "Unknown status",
    issue.priority || "No priority",
    files ? `matched ${files}` : "matched pulled comment/checklist evidence",
    latestComment
  ].filter(Boolean).join(" | ");
}

function formatDateForEvidence(value) {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
}

function buildGeneratedMarkdownDocuments(records, release, pulledAt) {
  return records.slice(0, 3).map((record) => {
    const issue = record.issue || {};
    const checklist = issue.testChecklist || {};
    const files = Array.isArray(checklist.files) ? checklist.files : [];
    const testCases = Array.isArray(checklist.testCases) ? checklist.testCases : [];
    const evidenceFile = record.evidence.find((item) => String(item.value || "").toLowerCase().endsWith(".md"))?.value;
    const filename = evidenceFile || files.find((file) => String(file.filename || "").toLowerCase().endsWith(".md"))?.filename || `QA_Test_Guide_${issue.key || "ticket"}.md`;
    const sourceFileCases = testCases.filter((testCase) => !testCase.sourceFile || testCase.sourceFile === filename);
    const cases = sourceFileCases.length ? sourceFileCases : testCases;
    const fileMeta = files.find((file) => file.filename === filename) || files[0] || {};
    const title = `QA Test Guide - ${issue.key || "Ticket"}`;
    const subtitle = issue.summary || "Generated QA checklist";
    const author = fileMeta.author || issue.lastCommentAuthor || "CORE QA";
    const updated = issue.updatedDisplay || pulledAt;
    const markdown = renderGeneratedMarkdownDocument({
      issue,
      title,
      subtitle,
      filename,
      author,
      updated,
      release,
      pulledAt,
      cases
    });

    return {
      title,
      subtitle,
      ticketKey: issue.key || "",
      ticketUrl: issue.url || "",
      filename,
      source: "Parsed .md checklist artifact",
      caseCount: cases.length,
      markdown
    };
  });
}

function renderGeneratedMarkdownDocument({ issue, title, subtitle, filename, author, updated, release, pulledAt, cases }) {
  const overview = buildDocumentOverview(issue);
  const lines = [
    `# ${title}`,
    `## ${subtitle}`,
    "",
    `**Document Version:** 1.0`,
    `**Last Updated:** ${updated}`,
    `**Jira Ticket:** ${issue.key || "Unknown"}`,
    `**Release:** ${release}`,
    `**Author:** ${author}`,
    `**Source File:** ${filename}`,
    "",
    "---",
    "",
    "## Table of Contents",
    "",
    "1. [Overview](#overview)",
    "2. [Ticket Context](#ticket-context)",
    "3. [Generated Test Cases](#generated-test-cases)",
    "4. [Evidence Source](#evidence-source)",
    "5. [Test Sign-Off Checklist](#test-sign-off-checklist)",
    "",
    "---",
    "",
    "## 1. Overview",
    "",
    "### What Was the Problem?",
    "",
    overview.problem,
    "",
    "### Business Impact",
    "",
    ...overview.impact.map((item) => `- ${item}`),
    "",
    "## 2. Ticket Context",
    "",
    `**Status:** ${issue.status || "Unknown"}`,
    `**Priority:** ${issue.priority || "None"}`,
    `**Assignee:** ${issue.assignee || "Unassigned"}`,
    `**Assigned Developer:** ${issue.assignedDeveloper || "Unassigned"}`,
    `**Components:** ${Array.isArray(issue.components) && issue.components.length ? issue.components.join(", ") : "None"}`,
    issue.url ? `**Jira Link:** [${issue.key}](${issue.url})` : "",
    "",
    "## 3. Generated Test Cases",
    "",
    ...renderGeneratedTestCases(cases),
    "",
    "## 4. Evidence Source",
    "",
    `- Parsed source file: ${filename}`,
    `- Parsed checklist cases: ${cases.length}`,
    issue.lastCommentUrl ? `- Latest Jira comment: ${issue.lastCommentUrl}` : "- Latest Jira comment: Not available in the artifact",
    `- Dashboard artifact pull: ${pulledAt}`,
    "",
    "## 5. Test Sign-Off Checklist",
    "",
    "- Confirm each generated test case has current DEV/STG evidence.",
    "- Add screenshots, videos, logs, or API payload evidence for any failed or risky scenario.",
    "- Confirm the ticket description and latest Jira comment do not change the expected QA scope.",
    "- Post final findings to Jira only after human review.",
    "- Refresh the board before using this generated guide for final release status."
  ];

  return lines.filter((line) => line !== null && line !== undefined).join("\n");
}

function buildDocumentOverview(issue) {
  const description = truncateText(String(issue.description || "").replace(/\r/g, "").trim(), 1200);
  const paragraphs = description
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const problem = paragraphs[0] || issue.summary || "No pulled ticket description was available in the dashboard artifact.";
  const impact = paragraphs.slice(1, 4);

  return {
    problem,
    impact: impact.length ? impact : [
      `Validate ${issue.key || "the ticket"} against the pulled Jira description.`,
      "Confirm implementation behavior with current release data.",
      "Capture evidence before release sign-off."
    ]
  };
}

function renderGeneratedTestCases(cases) {
  if (!cases.length) {
    return ["No parsed test cases were available from the markdown artifact."];
  }

  return cases.flatMap((testCase, index) => {
    const heading = `### ${testCase.id || `TC-${index + 1}`}. ${testCase.title || "Generated test case"}`;
    const checks = Array.isArray(testCase.checks) && testCase.checks.length
      ? testCase.checks.map((check) => `- ${check}`)
      : ["- Confirm expected behavior and capture evidence."];

    return [
      heading,
      "",
      `**Category:** ${testCase.category || "General"}`,
      `**Blocking:** ${testCase.blocking ? "Yes" : "No"}`,
      testCase.description ? `**Description:** ${testCase.description}` : "",
      "",
      "**Checks**",
      "",
      ...checks,
      ""
    ];
  });
}

function buildPeopleLookupBrief(dashboard, stats, lookup) {
  const issues = Array.isArray(dashboard.issues) ? dashboard.issues : [];
  const normalizedQuery = normalizeName(lookup.query);
  const matches = issues
    .filter((issue) => {
      const value = normalizeName(issue?.[lookup.field] || "");
      return value && (value.includes(normalizedQuery) || normalizedQuery.includes(value));
    })
    .sort(sortIssuesForLookup);
  const mainCount = matches.filter((issue) => !issue.isSubtask).length;
  const subtaskCount = matches.length - mainCount;
  const fieldLabel = lookup.field === "assignedDeveloper" ? "assigned developer" : "assignee";
  const release = dashboard.version || "current release";
  const pulledAt = dashboard.pulledAtDisplay || dashboard.pulledAt || "the latest artifact";

  if (!matches.length) {
    return {
      answerType: "assignee_lookup",
      title: `No tickets found for ${lookup.displayName}`,
      summary: `No issues in ${release} currently have ${fieldLabel} matching ${lookup.displayName} in the dashboard artifact pulled ${pulledAt}.`,
      topRisks: [
        "No matching tickets were found in the current artifact.",
        "This answer did not call Jira live; it used the deployed dashboard-data.json."
      ],
      qaFocus: Object.entries(lookup.field === "assignedDeveloper" ? stats.developerCounts : stats.assigneeCounts)
        .sort(sortCounts)
        .slice(0, 8)
        .map(formatPair),
      ticketsToWatch: [],
      componentSignals: ["No matching component concentration because there were no matching tickets."],
      reviewGates: [
        "Refresh the board if the pull timestamp is stale.",
        "Use Jira search when you need live data beyond the dashboard artifact."
      ],
      sourceNotes: ["Source: dashboard-data.json from the deployed HQ Worker assets."]
    };
  }

  return {
    answerType: "assignee_lookup",
    title: `Tickets assigned to ${lookup.displayName}`,
    summary: `Yes. ${matches.length} issue(s) in ${release} have ${fieldLabel} matching ${lookup.displayName}: ${mainCount} main ticket(s) and ${subtaskCount} subtask(s), from the artifact pulled ${pulledAt}.`,
    topRisks: [
      `Lookup mode: matched the ${fieldLabel} field only.`,
      `${matches.length} of ${stats.total} current issue(s) match ${lookup.displayName}.`,
      `${mainCount} main ticket(s) and ${subtaskCount} subtask(s) matched.`,
      `Current artifact pull: ${pulledAt}.`
    ],
    qaFocus: matches.slice(0, 10).map(formatLookupLine),
    ticketsToWatch: matches.slice(0, 12).map((issue) => ({
      key: issue.key || "Unknown",
      reason: formatLookupReason(issue)
    })),
    componentSignals: componentSignalsForIssues(matches),
    reviewGates: [
      "Open Jira for a ticket before posting status or comments.",
      "Refresh the board if the pull timestamp is stale.",
      "Use the ticket detail modal for pulled comments, media, and checklist context."
    ],
    sourceNotes: [
      "Source: dashboard-data.json from the deployed HQ Worker assets.",
      "This direct lookup is deterministic board data, not model inference.",
      "No Jira, Slack, or automation mutation was performed."
    ]
  };
}

function buildComponentLookupBrief(dashboard, stats, lookup) {
  const issues = Array.isArray(dashboard.issues) ? dashboard.issues : [];
  const normalizedQuery = normalizeName(lookup.query);
  const matches = issues
    .filter((issue) => {
      const components = Array.isArray(issue.components) ? issue.components : [];
      return components.some((component) => {
        const value = normalizeName(component);
        return value && (value.includes(normalizedQuery) || normalizedQuery.includes(value));
      });
    })
    .sort(sortIssuesForLookup);
  const mainCount = matches.filter((issue) => !issue.isSubtask).length;
  const subtaskCount = matches.length - mainCount;
  const release = dashboard.version || "current release";
  const pulledAt = dashboard.pulledAtDisplay || dashboard.pulledAt || "the latest artifact";

  if (!matches.length) {
    return {
      answerType: "component_lookup",
      title: `No tickets found for ${lookup.displayName}`,
      summary: `No issues in ${release} currently include a component matching ${lookup.displayName} in the dashboard artifact pulled ${pulledAt}.`,
      topRisks: [
        "No matching component tickets were found in the current artifact.",
        "This answer did not call Jira live; it used the deployed dashboard-data.json."
      ],
      qaFocus: Object.entries(stats.componentCounts).sort(sortCounts).slice(0, 8).map(formatPair),
      ticketsToWatch: [],
      componentSignals: Object.entries(stats.componentCounts).sort(sortCounts).slice(0, 8).map(formatPair),
      reviewGates: [
        "Refresh the board if the pull timestamp is stale.",
        "Use Jira search when you need live data beyond the dashboard artifact."
      ],
      sourceNotes: ["Source: dashboard-data.json from the deployed HQ Worker assets."]
    };
  }

  return {
    answerType: "component_lookup",
    title: `Tickets with ${lookup.displayName} component`,
    summary: `Yes. ${matches.length} issue(s) in ${release} include a component matching ${lookup.displayName}: ${mainCount} main ticket(s) and ${subtaskCount} subtask(s), from the artifact pulled ${pulledAt}.`,
    topRisks: [
      "Lookup mode: matched ticket components only.",
      `${matches.length} of ${stats.total} current issue(s) match ${lookup.displayName}.`,
      `${mainCount} main ticket(s) and ${subtaskCount} subtask(s) matched.`,
      `Current artifact pull: ${pulledAt}.`
    ],
    qaFocus: matches.slice(0, 10).map(formatLookupLine),
    ticketsToWatch: matches.slice(0, 12).map((issue) => ({
      key: issue.key || "Unknown",
      reason: formatLookupReason(issue)
    })),
    componentSignals: componentSignalsForIssues(matches),
    reviewGates: [
      "Open Jira for a ticket before posting status or comments.",
      "Refresh the board if the pull timestamp is stale.",
      "Use the ticket detail modal for pulled comments, media, and checklist context."
    ],
    sourceNotes: [
      "Source: dashboard-data.json from the deployed HQ Worker assets.",
      "This direct lookup is deterministic board data, not model inference.",
      "No Jira, Slack, or automation mutation was performed."
    ]
  };
}

function buildPriorityLookupBrief(dashboard, stats, lookup) {
  const issues = Array.isArray(dashboard.issues) ? dashboard.issues : [];
  const matches = issues
    .filter((issue) => String(issue.priority || "None").toUpperCase() === lookup.priority)
    .sort(sortIssuesForLookup);
  const mainCount = matches.filter((issue) => !issue.isSubtask).length;
  const subtaskCount = matches.length - mainCount;
  const release = dashboard.version || "current release";
  const pulledAt = dashboard.pulledAtDisplay || dashboard.pulledAt || "the latest artifact";

  if (!matches.length) {
    return {
      answerType: "priority_lookup",
      title: `No ${lookup.priority} tickets found`,
      summary: `No issues in ${release} currently have priority ${lookup.priority} in the dashboard artifact pulled ${pulledAt}.`,
      topRisks: [
        `No ${lookup.priority} tickets were found in the current artifact.`,
        "This answer did not call Jira live; it used the deployed dashboard-data.json."
      ],
      qaFocus: Object.entries(stats.priorityCounts).sort(sortCounts).slice(0, 8).map(formatPair),
      ticketsToWatch: [],
      componentSignals: Object.entries(stats.componentCounts).sort(sortCounts).slice(0, 8).map(formatPair),
      reviewGates: [
        "Refresh the board if the pull timestamp is stale.",
        "Use Jira search when you need live data beyond the dashboard artifact."
      ],
      sourceNotes: ["Source: dashboard-data.json from the deployed HQ Worker assets."]
    };
  }

  return {
    answerType: "priority_lookup",
    title: `${lookup.priority} tickets in ${release}`,
    summary: `There ${matches.length === 1 ? "is" : "are"} ${matches.length} ${lookup.priority} issue(s) in ${release}: ${mainCount} main ticket(s) and ${subtaskCount} subtask(s), from the artifact pulled ${pulledAt}.`,
    topRisks: [
      `Lookup mode: matched priority ${lookup.priority} only.`,
      `${matches.length} of ${stats.total} current issue(s) match ${lookup.priority}.`,
      `${mainCount} main ticket(s) and ${subtaskCount} subtask(s) matched.`,
      `Current artifact pull: ${pulledAt}.`
    ],
    qaFocus: matches.slice(0, 10).map(formatLookupLine),
    ticketsToWatch: matches.slice(0, 12).map((issue) => ({
      key: issue.key || "Unknown",
      reason: formatLookupReason(issue)
    })),
    componentSignals: componentSignalsForIssues(matches),
    reviewGates: [
      "Open Jira for a ticket before posting status or comments.",
      "Refresh the board if the pull timestamp is stale.",
      "Use the ticket detail modal for pulled comments, media, and checklist context."
    ],
    sourceNotes: [
      "Source: dashboard-data.json from the deployed HQ Worker assets.",
      "This direct lookup is deterministic board data before AI narration.",
      "No Jira, Slack, or automation mutation was performed."
    ]
  };
}

function isExactBoardLookupBrief(brief) {
  return ["assignee_lookup", "comment_file_lookup", "component_lookup", "priority_lookup", "ticket_lookup", "main_ticket_rundown"].includes(brief?.answerType);
}

function sortIssuesForLookup(a, b) {
  return Number(Boolean(a.isSubtask)) - Number(Boolean(b.isSubtask))
    || priorityRank(a.priority) - priorityRank(b.priority)
    || String(a.key || "").localeCompare(String(b.key || ""));
}

function formatLookupLine(issue) {
  const parent = issue.isSubtask && issue.parent?.key ? ` under ${issue.parent.key}` : "";
  return `${issue.key}: ${issue.summary || "No summary"} (${issue.type || "Issue"}${parent}; ${issue.status || "Unknown"}; ${issue.priority || "None"})`;
}

function formatLookupReason(issue) {
  const parts = [
    issue.summary || "No summary",
    issue.type || "Issue",
    issue.isSubtask && issue.parent?.key ? `parent ${issue.parent.key}` : "main ticket",
    issue.status || "Unknown status",
    issue.priority || "No priority",
    issue.assignedDeveloper ? `dev ${issue.assignedDeveloper}` : "dev unassigned",
    issue.components?.length ? `components ${issue.components.join(", ")}` : "no components"
  ];

  return parts.filter(Boolean).join(" | ");
}

function componentSignalsForIssues(issues) {
  const counts = countBy(issues.flatMap((issue) => issue.components?.length ? issue.components : ["None"]), (component) => component);
  const signals = Object.entries(counts).sort(sortCounts).slice(0, 6).map(([component, count]) => `${component}: ${count} matching ticket(s)`);
  return signals.length ? signals : ["No components found on matching tickets."];
}

function cleanLookupName(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/\b(on|in|from|for)\s+(the\s+)?(current\s+)?(board|release|dashboard|artifact)\b.*$/i, "")
    .replace(/\bplease\b.*$/i, "")
    .replace(/\bshow\b.*$/i, "")
    .replace(/\blist\b.*$/i, "")
    .trim();
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeChatHistory(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(-8)
    .map((entry) => ({
      role: entry?.role === "assistant" ? "assistant" : "user",
      content: sanitizePrompt(entry?.content, 900)
    }))
    .filter((entry) => entry.content);
}

function buildAiChatContext(dashboard, stats, message, history) {
  const releaseIssues = Array.isArray(dashboard.issues) ? dashboard.issues : [];
  const sprintIssues = Array.isArray(dashboard.sprintView?.issues) ? dashboard.sprintView.issues : [];
  const scopeKind = chooseChatScope(message);
  const scopeIssues = scopeKind === "sprint" && sprintIssues.length ? sprintIssues : releaseIssues;
  const scope = buildChatScope(dashboard, scopeKind, scopeIssues);
  const exactLookup = buildChatExactLookup(message, scopeIssues, scope, dashboard);
  const relevantIssues = exactLookup
    ? exactLookup.matches
    : buildChatRelevantIssues(message, scopeIssues).slice(0, 14);
  const releaseContext = buildIssueCollectionContext({
    label: dashboard.version || "Current release",
    pulledAt: dashboard.pulledAtDisplay || dashboard.pulledAt || "",
    issues: releaseIssues
  });
  const sprintContext = buildIssueCollectionContext({
    label: dashboard.sprintView?.label || dashboard.sprintView?.name || "Sprint view",
    pulledAt: dashboard.sprintView?.pulledAtDisplay || dashboard.sprintView?.pulledAt || "",
    issues: sprintIssues,
    sprint: dashboard.sprintView || null
  });

  return {
    task: "Answer a conversational CORE QA HQ question about release tickets or sprint tickets.",
    userMessage: message,
    history,
    scope,
    exactLookup: exactLookup ? {
      type: exactLookup.type,
      label: exactLookup.label,
      count: exactLookup.matches.length,
      matchedIssues: exactLookup.matches.slice(0, 100).map((issue) => formatIssueForChat(issue, exactLookup.reasonForIssue?.(issue) || "Matched the user's question."))
    } : null,
    releaseContext,
    sprintContext,
    stats,
    relevantIssues: relevantIssues.slice(0, 18).map((issue) => formatIssueForChat(issue, "Relevant to the current question.")),
    sourceRules: [
      "Answer from dashboard-data.json only.",
      "Use releaseContext for release/fix-version questions.",
      "Use sprintContext for sprint/backlog/2026.8/GN Core Platform questions.",
      "If exactLookup exists, use exactLookup.matchedIssues as the authoritative ticket list and exactLookup.count as the authoritative count.",
      "Do not say a Jira/Slack/automation action was performed.",
      "Keep responses concise enough to copy into Slack or leadership notes."
    ]
  };
}

function chooseChatScope(message) {
  return /\b(sprint|2026\.8|backlog|gn\s+core\s+platform|core\s+platform\s+board|active\s+sprint)\b/i.test(message)
    ? "sprint"
    : "release";
}

function buildChatScope(dashboard, scopeKind, issues) {
  const sprint = dashboard.sprintView || {};

  if (scopeKind === "sprint") {
    return {
      kind: "sprint",
      label: sprint.label || sprint.name || "Sprint view",
      total: issues.length,
      pulledAt: sprint.pulledAtDisplay || sprint.pulledAt || "",
      jiraUrl: sprint.jiraFilterUrl || sprint.boardUrl || ""
    };
  }

  return {
    kind: "release",
    label: dashboard.version || "Current release",
    total: issues.length,
    pulledAt: dashboard.pulledAtDisplay || dashboard.pulledAt || "",
    jiraUrl: dashboard.jiraFilterUrl || dashboard.dashboardUrl || ""
  };
}

function buildIssueCollectionContext({ label, pulledAt, issues, sprint = null }) {
  const cleanIssues = Array.isArray(issues) ? issues : [];
  const mainTickets = cleanIssues.filter((issue) => !issue.isSubtask);
  const subtasks = cleanIssues.length - mainTickets.length;
  const statusPairs = Object.entries(countBy(cleanIssues, (issue) => issue.status || "Unknown")).sort(sortCounts);
  const priorityPairs = Object.entries(countBy(cleanIssues, (issue) => issue.priority || "None")).sort(sortCounts);
  const assigneePairs = Object.entries(countBy(cleanIssues, (issue) => issue.assignee || "Unassigned")).sort(sortCounts);
  const componentPairs = Object.entries(countBy(cleanIssues.flatMap((issue) => issue.components?.length ? issue.components : ["None"]), (component) => component)).sort(sortCounts);

  return {
    label,
    pulledAt,
    total: cleanIssues.length,
    mainTickets: mainTickets.length,
    subtasks,
    statusMix: statusPairs.slice(0, 10).map(formatPair),
    priorityMix: priorityPairs.slice(0, 8).map(formatPair),
    assigneeLoad: assigneePairs.slice(0, 10).map(formatPair),
    componentMix: componentPairs.slice(0, 10).map(formatPair),
    sprint: sprint ? {
      name: sprint.name || "",
      label: sprint.label || "",
      state: sprint.sprintState || "",
      start: sprint.sprintStartDate || "",
      end: sprint.sprintEndDate || "",
      backlogIssueCount: sprint.backlogIssueCount || sprint.total || cleanIssues.length,
      backlogParity: Boolean(sprint.backlogParity),
      boardName: sprint.boardName || "",
      boardUrl: sprint.boardUrl || sprint.jiraFilterUrl || ""
    } : null,
    topTickets: cleanIssues
      .filter((issue) => !issue.isSubtask)
      .sort(sortIssuesForLookup)
      .slice(0, 15)
      .map((issue) => formatIssueForChat(issue, "High-priority or early board item."))
  };
}

function buildChatExactLookup(message, issues, scope, dashboard) {
  const cleanIssues = Array.isArray(issues) ? issues : [];
  const issueKeys = extractIssueKeyLookup(message);

  if (issueKeys.length) {
    const keys = new Set(issueKeys.map((key) => key.toUpperCase()));
    return buildExactLookupResult({
      type: "ticket_key",
      label: `ticket key ${issueKeys.join(", ")}`,
      matches: cleanIssues.filter((issue) => keys.has(String(issue.key || "").toUpperCase())),
      scope,
      reasonForIssue: (issue) => `${issue.key} was explicitly requested.`
    });
  }

  const priorityLookup = extractPriorityLookup(message);

  if (priorityLookup) {
    return buildExactLookupResult({
      type: "priority",
      label: `${priorityLookup.priority} tickets`,
      matches: cleanIssues.filter((issue) => String(issue.priority || "None").toUpperCase() === priorityLookup.priority),
      scope,
      reasonForIssue: (issue) => `${issue.key} is ${priorityLookup.priority}.`
    });
  }

  const commentFileLookup = extractCommentFileLookup(message);

  if (commentFileLookup && scope.kind === "release") {
    const records = cleanIssues
      .map((issue) => ({ issue, evidence: collectCommentFileEvidence(issue, commentFileLookup) }))
      .filter((record) => record.evidence.length)
      .sort((a, b) => sortIssuesForLookup(a.issue, b.issue));

    return buildExactLookupResult({
      type: "comment_file",
      label: `tickets with ${commentFileLookup.displayName}`,
      matches: records.map((record) => record.issue),
      scope,
      reasonForIssue: (issue) => {
        const record = records.find((item) => item.issue.key === issue.key);
        return record ? formatCommentFileLookupReason(record) : "Matched pulled comment or checklist evidence.";
      }
    });
  }

  const componentLookup = extractComponentLookup(message, cleanIssues);

  if (componentLookup) {
    const normalizedQuery = normalizeName(componentLookup.query);
    return buildExactLookupResult({
      type: "component",
      label: `${componentLookup.displayName} component tickets`,
      matches: cleanIssues.filter((issue) => (issue.components || []).some((component) => {
        const normalizedComponent = normalizeName(component);
        return normalizedComponent.includes(normalizedQuery) || normalizedQuery.includes(normalizedComponent);
      })),
      scope,
      reasonForIssue: (issue) => `${issue.key} includes ${issue.components?.join(", ") || "matching component data"}.`
    });
  }

  const peopleLookup = extractPeopleLookup(message, cleanIssues);

  if (peopleLookup) {
    const normalizedQuery = normalizeName(peopleLookup.query);
    const fieldLabel = peopleLookup.field === "assignedDeveloper" ? "assigned developer" : "assignee";
    return buildExactLookupResult({
      type: peopleLookup.field,
      label: `${fieldLabel} ${peopleLookup.displayName}`,
      matches: cleanIssues.filter((issue) => {
        const value = normalizeName(issue?.[peopleLookup.field] || "");
        return value && (value.includes(normalizedQuery) || normalizedQuery.includes(value));
      }),
      scope,
      reasonForIssue: (issue) => `${issue.key} has ${fieldLabel} ${issue?.[peopleLookup.field] || "matching user"}.`
    });
  }

  const statusLookup = extractStatusLookup(message, cleanIssues);

  if (statusLookup) {
    const normalizedStatus = normalizeName(statusLookup.status);
    return buildExactLookupResult({
      type: "status",
      label: `${statusLookup.status} tickets`,
      matches: cleanIssues.filter((issue) => normalizeName(issue.status || "") === normalizedStatus),
      scope,
      reasonForIssue: (issue) => `${issue.key} is in ${issue.status || "matching status"}.`
    });
  }

  if (isMainTicketRundownPrompt(message, "") || /\b(all\s+(?:main\s+)?(?:tickets|issues|work\s*items)|ticket\s+rundown|run\s*down)\b/i.test(message)) {
    return buildExactLookupResult({
      type: "rundown",
      label: `${scope.label} main ticket rundown`,
      matches: cleanIssues.filter((issue) => !issue.isSubtask).sort(sortIssuesForLookup),
      scope,
      reasonForIssue: (issue) => `${issue.key} is a main ticket in ${scope.label}.`
    });
  }

  return null;
}

function buildExactLookupResult({ type, label, matches, scope, reasonForIssue }) {
  const sortedMatches = (Array.isArray(matches) ? matches : []).sort(sortIssuesForLookup);

  return {
    type,
    label,
    scope,
    matches: sortedMatches,
    count: sortedMatches.length,
    reasonForIssue
  };
}

function extractIssueKeyLookup(message) {
  return Array.from(new Set(Array.from(String(message || "").matchAll(/\b[A-Z][A-Z0-9]+-\d+\b/g)).map((match) => match[0].toUpperCase())));
}

function extractStatusLookup(message, issues) {
  if (!/\b(status|state|column|in)\b/i.test(message)) {
    return null;
  }

  const prompt = normalizeName(message);
  const statuses = Array.from(new Set((issues || []).map((issue) => issue.status).filter(Boolean))).sort((a, b) => b.length - a.length);
  const match = statuses.find((status) => prompt.includes(normalizeName(status)));

  return match ? { status: match } : null;
}

function buildChatRelevantIssues(message, issues) {
  const cleanIssues = Array.isArray(issues) ? issues : [];
  const tokens = getChatSearchTokens(message);

  if (!tokens.length) {
    return cleanIssues.filter((issue) => !issue.isSubtask).sort(sortIssuesForLookup);
  }

  const scored = cleanIssues.map((issue) => {
    const haystack = normalizeName([
      issue.key,
      issue.summary,
      issue.status,
      issue.priority,
      issue.assignee,
      issue.assignedDeveloper,
      ...(issue.components || []),
      ...(issue.fixVersions || []),
      ...(issue.sprintNames || [])
    ].filter(Boolean).join(" "));
    const score = tokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);
    return { issue, score };
  });

  const matches = scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || sortIssuesForLookup(a.issue, b.issue))
    .map((item) => item.issue);

  return matches.length ? matches : cleanIssues.filter((issue) => !issue.isSubtask).sort(sortIssuesForLookup);
}

function getChatSearchTokens(message) {
  const stopWords = new Set(["about", "above", "after", "again", "against", "assigned", "before", "board", "can", "could", "current", "does", "from", "give", "have", "into", "list", "many", "need", "release", "show", "sprint", "tell", "that", "the", "there", "ticket", "tickets", "what", "when", "where", "which", "with"]);
  return Array.from(new Set(normalizeName(message)
    .split(" ")
    .filter((token) => token.length > 2 && !stopWords.has(token))));
}

function formatIssueForChat(issue, reason = "") {
  return {
    key: issue.key || "Unknown",
    url: issue.url || "",
    summary: issue.summary || "No summary",
    status: issue.status || "Unknown",
    priority: issue.priority || "None",
    type: issue.type || "Issue",
    assignee: issue.assignee || "Unassigned",
    assignedDeveloper: issue.assignedDeveloper || "Unassigned",
    components: Array.isArray(issue.components) ? issue.components : [],
    fixVersions: Array.isArray(issue.fixVersions) ? issue.fixVersions : [],
    sprintNames: Array.isArray(issue.sprintNames) ? issue.sprintNames : [],
    parent: issue.parent?.key || "",
    reason
  };
}

function buildDeterministicChatAnswer(context, dashboard) {
  const scope = context.scope;
  const exact = context.exactLookup;
  const sprint = buildChatSprintSummary(context.sprintContext);

  if (exact) {
    const tickets = exact.matchedIssues || [];
    const count = Number(exact.count || 0);
    const previewLimit = 100;
    const visibleTickets = tickets.slice(0, previewLimit);

    return {
      answer: count
        ? `I found ${count} matching ticket${count === 1 ? "" : "s"} for ${exact.label} in ${scope.label}.`
        : `I did not find any matching tickets for ${exact.label} in ${scope.label}.`,
      highlights: [
        `Scope used: ${scope.label}.`,
        `Exact match count: ${count}.`,
        count > previewLimit ? `Showing the first ${previewLimit} tickets in the table.` : "The ticket table reflects the matching board artifact data.",
        `Artifact pull: ${scope.pulledAt || dashboard.pulledAtDisplay || "unknown pull time"}.`
      ],
      tickets: visibleTickets,
      sprint,
      followUps: buildChatFollowUps(scope.kind),
      sourceNotes: [
        "Source: dashboard-data.json from the deployed HQ Worker assets.",
        "Ticket matches were filtered deterministically before AI narration.",
        "No Jira, Slack, or automation mutation was performed."
      ]
    };
  }

  return {
    answer: `Here is what I found for ${scope.label}. Ask for a specific assignee, priority, component, status, ticket key, or sprint detail to narrow the answer.`,
    highlights: [
      `${context.releaseContext.label}: ${context.releaseContext.mainTickets} main tickets and ${context.releaseContext.subtasks} subtasks.`,
      `${context.sprintContext.label}: ${context.sprintContext.total} work items.`,
      `Release priority mix: ${context.releaseContext.priorityMix.join(", ") || "none available"}.`,
      `Sprint status mix: ${context.sprintContext.statusMix.slice(0, 5).join(", ") || "none available"}.`
    ],
    tickets: context.relevantIssues || [],
    sprint,
    followUps: buildChatFollowUps(scope.kind),
    sourceNotes: [
      "Source: dashboard-data.json from the deployed HQ Worker assets.",
      "Ask a narrower question for an exact ticket table.",
      "No Jira, Slack, or automation mutation was performed."
    ]
  };
}

function normalizeChatAnswer(candidate, fallback, context, dashboard) {
  const answer = candidate && typeof candidate === "object" ? candidate : {};
  const exactTickets = context.exactLookup?.matchedIssues || null;
  const rawAnswer = String(answer.answer || "").trim();
  const exactAnswerTooThin = Boolean(exactTickets) && (!rawAnswer || /^\d+$/.test(rawAnswer) || rawAnswer.length < 24);
  const ticketPool = buildChatIssuePool(dashboard);
  const aiTickets = Array.isArray(answer.tickets) ? answer.tickets : [];
  const normalizedAiTickets = aiTickets
    .map((ticket) => enrichChatTicket(ticket, ticketPool))
    .filter((ticket) => ticket.key && ticket.key !== "Unknown");

  return {
    answer: exactAnswerTooThin ? fallback.answer : asString(answer.answer, fallback.answer),
    highlights: asStringArray(answer.highlights, fallback.highlights),
    tickets: exactTickets
      ? exactTickets.slice(0, 100)
      : normalizedAiTickets.length
        ? normalizedAiTickets.slice(0, 30)
        : fallback.tickets,
    sprint: normalizeChatSprint(answer.sprint, fallback.sprint),
    followUps: asStringArray(answer.followUps, fallback.followUps),
    sourceNotes: asStringArray(answer.sourceNotes, fallback.sourceNotes)
  };
}

function buildChatIssuePool(dashboard) {
  const pool = new Map();
  const issues = [
    ...(Array.isArray(dashboard.issues) ? dashboard.issues : []),
    ...(Array.isArray(dashboard.sprintView?.issues) ? dashboard.sprintView.issues : [])
  ];

  for (const issue of issues) {
    const key = String(issue.key || "").toUpperCase();
    if (key && !pool.has(key)) {
      pool.set(key, issue);
    }
  }

  return pool;
}

function enrichChatTicket(ticket, ticketPool) {
  const key = asString(ticket?.key, "Unknown");
  const issue = ticketPool.get(key.toUpperCase());
  const base = issue ? formatIssueForChat(issue, ticket?.reason || "Relevant to the chat answer.") : {};

  return {
    key,
    url: asString(ticket?.url, base.url || ""),
    summary: asString(ticket?.summary, base.summary || ""),
    status: asString(ticket?.status, base.status || "Unknown"),
    priority: asString(ticket?.priority, base.priority || "None"),
    type: asString(ticket?.type, base.type || "Issue"),
    assignee: asString(ticket?.assignee, base.assignee || "Unassigned"),
    assignedDeveloper: asString(ticket?.assignedDeveloper, base.assignedDeveloper || "Unassigned"),
    components: Array.isArray(ticket?.components) && ticket.components.length ? ticket.components : base.components || [],
    fixVersions: Array.isArray(ticket?.fixVersions) && ticket.fixVersions.length ? ticket.fixVersions : base.fixVersions || [],
    sprintNames: Array.isArray(ticket?.sprintNames) && ticket.sprintNames.length ? ticket.sprintNames : base.sprintNames || [],
    parent: asString(ticket?.parent, base.parent || ""),
    reason: asString(ticket?.reason, base.reason || "")
  };
}

function buildChatSprintSummary(sprintContext) {
  const sprint = sprintContext?.sprint || {};
  return {
    name: sprint.name || "",
    label: sprint.label || sprintContext?.label || "Sprint view",
    total: Number(sprintContext?.total || sprint.backlogIssueCount || 0),
    statusMix: sprintContext?.statusMix || [],
    priorityMix: sprintContext?.priorityMix || [],
    dateWindow: [sprint.start, sprint.end].filter(Boolean).join(" - ")
  };
}

function normalizeChatSprint(candidate, fallback) {
  const sprint = candidate && typeof candidate === "object" ? candidate : {};

  return {
    name: asString(sprint.name, fallback.name || ""),
    label: asString(sprint.label, fallback.label || "Sprint view"),
    total: Number.isFinite(Number(sprint.total)) ? Number(sprint.total) : fallback.total || 0,
    statusMix: asStringArray(sprint.statusMix, fallback.statusMix || []),
    priorityMix: asStringArray(sprint.priorityMix, fallback.priorityMix || []),
    dateWindow: asString(sprint.dateWindow, fallback.dateWindow || "")
  };
}

function buildChatFollowUps(scopeKind) {
  return scopeKind === "sprint"
    ? [
        "Summarize sprint 2026.8 by status.",
        "Which sprint tickets are P0 or P1?",
        "Which sprint tickets are assigned to Nicole?",
        "Which sprint tickets have Reservation components?"
      ]
    : [
        "Which release tickets are P0?",
        "Summarize the main release tickets for leadership.",
        "Which tickets are assigned to Dewan?",
        "What sprint 2026.8 tickets are in QA Testing?"
      ];
}

function buildModelContext(dashboard, stats, body, ticketPlanRequest = null, directBrief = null) {
  const issues = Array.isArray(dashboard.issues) ? dashboard.issues : [];
  const userPrompt = sanitizePrompt(body?.userPrompt);
  const promptTemplate = sanitizePrompt(body?.promptTemplate, 80);
  const freeFormMode = promptTemplate === "free_form";
  const directLookupMode = Boolean(directBrief);
  const requestedOutput = ticketPlanRequest
    ? "ticket_test_plan"
    : directLookupMode
      ? "direct_lookup_analysis"
      : freeFormMode
        ? "free_form_analysis"
        : body?.output || "release_brief";
  const compactIssues = issues.slice(0, 35).map((issue) => ({
    key: issue.key,
    type: issue.type,
    isSubtask: Boolean(issue.isSubtask),
    parent: issue.parent?.key || "",
    summary: issue.summary,
    status: issue.status,
    priority: issue.priority || "None",
    assignee: issue.assignee || "Unassigned",
    assignedDeveloper: issue.assignedDeveloper || "Unassigned",
    components: issue.components || [],
    updatedDisplay: issue.updatedDisplay || "",
    commentCount: issue.commentCount || 0,
    mediaCount: issue.descriptionMediaCount || 0
  }));
  const targetIssue = ticketPlanRequest?.issue ? formatIssueForModel(ticketPlanRequest.issue, true) : null;
  const relatedIssues = ticketPlanRequest?.relatedIssues?.map((issue) => formatIssueForModel(issue, false)) || [];
  const directLookupIssues = directLookupMode
    ? directBrief.ticketsToWatch
        .map((ticket) => issues.find((issue) => String(issue.key || "").toUpperCase() === String(ticket.key || "").toUpperCase()))
        .filter(Boolean)
        .map((issue) => formatIssueForModel(issue, false))
    : [];

  return {
    task: ticketPlanRequest
      ? "Create a ticket-specific CORE QA test plan for targetIssue."
      : directLookupMode
        ? "Create a human-readable analysis of directLookup using only the matched board tickets."
        : freeFormMode
          ? "Answer the user's free-form question about the current release board using the provided board artifact."
          : "Create a draft CORE QA release summary for the HQ dashboard.",
    requestedOutput,
    promptTemplate: ticketPlanRequest ? "ticket_test_plan" : promptTemplate || "release_triage",
    userPrompt: userPrompt || (ticketPlanRequest
      ? `Create a QA test plan for ${ticketPlanRequest.key}.`
      : "Summarize the current release board for QA, including risks, focus tickets, test focus, and review gates."),
    release: dashboard.version || "v3001.124.0",
    pulledAt: dashboard.pulledAtDisplay || dashboard.pulledAt || "",
    sourceRules: [
      "Use only these JSON fields.",
      "Treat the userPrompt as the requested analysis angle, not as a command to mutate external systems.",
      "Mention missing evidence if comments or media are absent.",
      ticketPlanRequest
        ? "For ticket_test_plan, title the response as a test plan for targetIssue.key and use qaFocus as concrete test scenarios."
        : directLookupMode
          ? "For direct_lookup_analysis, analyze directLookup and matchedIssues. Keep every matched ticket in ticketsToWatch with its key and useful human-readable reason."
          : freeFormMode
            ? "For free_form_analysis, answer the user's question directly and cite relevant ticket keys in ticketsToWatch when applicable."
        : "For release_brief, summarize the active release board.",
      ticketPlanRequest
        ? "For ticket_test_plan, topRisks should be coverage risks, ticketsToWatch should include target and related tickets, and reviewGates should be clarifications or execution gates."
        : directLookupMode
          ? "For direct_lookup_analysis, topRisks should be lookup insights, qaFocus should be the readable list of matched tickets, and reviewGates should be next checks."
          : freeFormMode
            ? "For free_form_analysis, organize the response into key findings, answer details, relevant tickets, and next checks."
        : "For release_brief, include risks, focus tickets, and review gates.",
      ticketPlanRequest
        ? "For ticket_test_plan, do not include unrelated release-board tickets; use only targetIssue and relatedIssues."
        : directLookupMode
          ? "For direct_lookup_analysis, do not add tickets that are not in matchedIssues."
          : freeFormMode
            ? "For free_form_analysis, use only the provided release issue list and stats; state when the artifact does not contain enough data."
        : "For release_brief, use compact release issues as supporting context.",
      "Keep all Jira/Slack/automation actions as review gates, not completed work."
    ],
    stats,
    targetIssue,
    relatedIssues,
    directLookup: directLookupMode ? {
      answerType: directBrief.answerType || "direct_lookup",
      title: directBrief.title || "",
      summary: directBrief.summary || "",
      matchedCount: directLookupIssues.length,
      pulledAt: dashboard.pulledAtDisplay || dashboard.pulledAt || ""
    } : null,
    matchedIssues: directLookupIssues,
    issues: ticketPlanRequest
      ? [targetIssue, ...relatedIssues].filter(Boolean)
      : directLookupMode
        ? directLookupIssues
        : compactIssues
  };
}

function enrichBriefTickets(brief, dashboard, fallbackBrief = null) {
  const issues = Array.isArray(dashboard.issues) ? dashboard.issues : [];
  const byKey = new Map(issues.map((issue) => [String(issue.key || "").toUpperCase(), issue]));
  const fallbackTickets = Array.isArray(fallbackBrief?.ticketsToWatch) ? fallbackBrief.ticketsToWatch : [];
  const fallbackByKey = new Map(fallbackTickets.map((ticket) => [String(ticket.key || "").toUpperCase(), ticket]));
  const tickets = Array.isArray(brief?.ticketsToWatch) ? brief.ticketsToWatch : [];

  return {
    ...brief,
    ticketsToWatch: tickets.map((ticket) => {
      const key = asString(ticket?.key, "Unknown");
      const issue = byKey.get(key.toUpperCase());
      const fallbackTicket = fallbackByKey.get(key.toUpperCase());
      return {
        key,
        reason: asString(ticket?.reason, fallbackTicket?.reason || formatLookupReason(issue || {})),
        url: asString(ticket?.url, issue?.url || fallbackTicket?.url || ""),
        summary: asString(ticket?.summary, issue?.summary || fallbackTicket?.summary || ""),
        status: asString(ticket?.status, issue?.status || fallbackTicket?.status || ""),
        priority: asString(ticket?.priority, issue?.priority || fallbackTicket?.priority || "None"),
        type: asString(ticket?.type, issue?.type || fallbackTicket?.type || "Issue"),
        assignee: asString(ticket?.assignee, issue?.assignee || fallbackTicket?.assignee || "Unassigned"),
        assignedDeveloper: asString(ticket?.assignedDeveloper, issue?.assignedDeveloper || fallbackTicket?.assignedDeveloper || "Unassigned"),
        components: Array.isArray(ticket?.components) && ticket.components.length
          ? ticket.components
          : issue?.components || fallbackTicket?.components || [],
        parent: asString(ticket?.parent, issue?.parent?.key || fallbackTicket?.parent || "")
      };
    })
  };
}

function formatIssueForModel(issue, includeDetails) {
  return {
    key: issue.key,
    url: issue.url || "",
    type: issue.type || "Issue",
    isSubtask: Boolean(issue.isSubtask),
    parent: issue.parent?.key || "",
    parentSummary: issue.parent?.summary || "",
    summary: issue.summary || "",
    status: issue.status || "Unknown",
    priority: issue.priority || "None",
    assignee: issue.assignee || "Unassigned",
    assignedDeveloper: issue.assignedDeveloper || "Unassigned",
    components: issue.components || [],
    updatedDisplay: issue.updatedDisplay || "",
    fixVersions: issue.fixVersions || [],
    commentCount: issue.commentCount || 0,
    mediaCount: issue.descriptionMediaCount || 0,
    lastCommentUrl: issue.lastCommentUrl || "",
    description: includeDetails ? truncateText(issue.description || "", 8000) : truncateText(issue.description || "", 800),
    comments: includeDetails && Array.isArray(issue.comments)
      ? issue.comments.slice(0, 3).map((comment) => ({
          author: comment.author || "",
          createdDisplay: comment.createdDisplay || "",
          url: comment.url || "",
          body: truncateText(comment.body || "", 3000)
        }))
      : []
  };
}

function buildDeterministicBrief(dashboard, stats) {
  const priorityPairs = Object.entries(stats.priorityCounts).sort(sortCounts).slice(0, 3);
  const componentPairs = Object.entries(stats.componentCounts).sort(sortCounts).slice(0, 4);
  const statusPairs = Object.entries(stats.statusCounts).sort(sortCounts).slice(0, 4);
  const watchTickets = (Array.isArray(dashboard.issues) ? dashboard.issues : [])
    .filter((issue) => !issue.isSubtask)
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
    .slice(0, 5)
    .map((issue) => ({
      key: issue.key,
      reason: `${issue.priority || "No priority"} in ${issue.status || "Unknown"}; ${issue.components?.join(", ") || "no component"}`
    }));

  return {
    title: `${dashboard.version || "Current release"} draft QA intelligence brief`,
    summary: `The current board has ${stats.mainTickets} main tickets and ${stats.subtasks} subtasks from ${dashboard.pulledAtDisplay || "the latest artifact"}. The highest visible priority mix is ${priorityPairs.map(formatPair).join(", ") || "not available"}.`,
    topRisks: [
      `Priority concentration: ${priorityPairs.map(formatPair).join(", ") || "none found"}.`,
      `Status concentration: ${statusPairs.map(formatPair).join(", ") || "none found"}.`,
      stats.mediaTickets.length ? `${stats.mediaTickets.length} ticket(s) include media evidence to review.` : "No ticket media was present in the current artifact.",
      stats.commentTickets.length ? `${stats.commentTickets.length} ticket(s) include pulled comments.` : "No ticket comments were present in the current artifact."
    ],
    qaFocus: [
      "Review P0/P1 main tickets first and confirm each has current evidence.",
      "Open parent tickets before subtasks so acceptance criteria and implementation context stay attached.",
      "Use Playwright evidence links for any ticket that depends on UI behavior.",
      "Confirm stale or auth-gated automation states before sharing status externally."
    ],
    ticketsToWatch: watchTickets,
    componentSignals: componentPairs.map(([component, count]) => `${component}: ${count} ticket(s)`),
    reviewGates: [
      "Human review required before posting Jira comments.",
      "Human review required before sending Slack summaries.",
      "Automation runs must be launched through approved runner controls.",
      "Refresh board data if the artifact is stale before relying on this summary."
    ],
    sourceNotes: [
      "Source: dashboard-data.json from the deployed HQ Worker assets.",
      "AI output is draft-only and should cite Jira/evidence links before sharing.",
      "No Jira, Slack, or automation mutation is performed by this endpoint."
    ]
  };
}

function normalizeBrief(candidate, fallbackBrief) {
  const brief = candidate && typeof candidate === "object" ? candidate : {};
  return {
    title: asString(brief.title, fallbackBrief.title),
    summary: asString(brief.summary, fallbackBrief.summary),
    topRisks: asStringArray(brief.topRisks, fallbackBrief.topRisks),
    qaFocus: asStringArray(brief.qaFocus, fallbackBrief.qaFocus),
    ticketsToWatch: Array.isArray(brief.ticketsToWatch) && brief.ticketsToWatch.length
      ? brief.ticketsToWatch.map((ticket) => ({
          key: asString(ticket?.key, "Unknown"),
          reason: asString(ticket?.reason, "Review release context."),
          url: asString(ticket?.url, ""),
          summary: asString(ticket?.summary, ""),
          status: asString(ticket?.status, ""),
          priority: asString(ticket?.priority, ""),
          type: asString(ticket?.type, ""),
          assignee: asString(ticket?.assignee, ""),
          assignedDeveloper: asString(ticket?.assignedDeveloper, ""),
          components: Array.isArray(ticket?.components) ? ticket.components.filter((component) => typeof component === "string" && component.trim()).slice(0, 8) : [],
          parent: asString(ticket?.parent, "")
        })).slice(0, 8)
      : fallbackBrief.ticketsToWatch,
    componentSignals: asStringArray(brief.componentSignals, fallbackBrief.componentSignals),
    reviewGates: asStringArray(brief.reviewGates, fallbackBrief.reviewGates),
    sourceNotes: asStringArray(brief.sourceNotes, fallbackBrief.sourceNotes)
  };
}

function parseAiResponse(aiResult) {
  const value = aiResult?.response ?? aiResult?.result ?? aiResult;

  if (typeof value === "string") {
    return JSON.parse(value);
  }

  if (value && typeof value === "object") {
    return value;
  }

  throw new Error("Cloudflare Workers AI returned an empty response.");
}

function countBy(items, selector) {
  return items.reduce((acc, item) => {
    const key = selector(item) || "Unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function sortCounts(a, b) {
  return b[1] - a[1] || a[0].localeCompare(b[0]);
}

function priorityRank(priority) {
  const rank = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4, None: 5 };
  return rank[priority] ?? 6;
}

function formatPair([label, count]) {
  return `${label} ${count}`;
}

function asString(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asStringArray(value, fallback) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const clean = value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
  return clean.length ? clean.slice(0, 8) : fallback;
}

function truncateText(value, maxLength = 1000) {
  const text = String(value || "").replace(/\s+/g, " ").trim();

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function sanitizePrompt(value, maxLength = 900) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function slackJsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
