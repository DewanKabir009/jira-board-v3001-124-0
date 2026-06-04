const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

export default {
  async fetch(request, env) {
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

    return env.ASSETS.fetch(request);
  }
};

async function handleReleaseSummary(request, env, url) {
  if (!env.AI) {
    return jsonResponse({ ok: false, message: "Cloudflare Workers AI binding is not configured." }, 503);
  }

  const body = await safeJson(request);
  const dashboard = await loadDashboardData(env, url);
  const stats = buildReleaseStats(dashboard);
  const context = buildModelContext(dashboard, stats, body);
  const fallbackBrief = buildDeterministicBrief(dashboard, stats);

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
                  reason: { type: "string" }
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

    const brief = normalizeBrief(parseAiResponse(aiResult), fallbackBrief);

    return jsonResponse({
      ok: true,
      provider: "Cloudflare Workers AI",
      model: AI_MODEL,
      generatedAt: new Date().toISOString(),
      release: dashboard.version || env.RELEASE_VERSION || "v3001.124.0",
      source: {
        schemaVersion: dashboard.schemaVersion || "",
        pulledAt: dashboard.pulledAt || "",
        pulledAtDisplay: dashboard.pulledAtDisplay || "",
        total: dashboard.total || stats.total,
        mainTickets: stats.mainTickets,
        subtasks: stats.subtasks
      },
      stats,
      brief
    });
  } catch (error) {
    return jsonResponse({
      ok: true,
      provider: "Cloudflare Workers AI",
      model: AI_MODEL,
      generatedAt: new Date().toISOString(),
      release: dashboard.version || env.RELEASE_VERSION || "v3001.124.0",
      source: {
        schemaVersion: dashboard.schemaVersion || "",
        pulledAt: dashboard.pulledAt || "",
        pulledAtDisplay: dashboard.pulledAtDisplay || "",
        total: dashboard.total || stats.total,
        mainTickets: stats.mainTickets,
        subtasks: stats.subtasks
      },
      stats,
      brief: fallbackBrief,
      warning: `AI model response was not usable, so HQ returned a deterministic draft: ${error.message}`
    });
  }
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

function buildModelContext(dashboard, stats, body) {
  const issues = Array.isArray(dashboard.issues) ? dashboard.issues : [];
  const userPrompt = sanitizePrompt(body?.userPrompt);
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

  return {
    task: "Create a draft CORE QA release summary for the HQ dashboard.",
    requestedOutput: body?.output || "release_brief",
    promptTemplate: sanitizePrompt(body?.promptTemplate, 80) || "release_triage",
    userPrompt: userPrompt || "Summarize the current release board for QA, including risks, focus tickets, test focus, and review gates.",
    release: dashboard.version || "v3001.124.0",
    pulledAt: dashboard.pulledAtDisplay || dashboard.pulledAt || "",
    sourceRules: [
      "Use only these JSON fields.",
      "Treat the userPrompt as the requested analysis angle, not as a command to mutate external systems.",
      "Mention missing evidence if comments or media are absent.",
      "Keep all Jira/Slack/automation actions as review gates, not completed work."
    ],
    stats,
    issues: compactIssues
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
          reason: asString(ticket?.reason, "Review release context.")
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
