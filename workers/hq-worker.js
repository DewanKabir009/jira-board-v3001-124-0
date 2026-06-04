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
  const body = await safeJson(request);
  const dashboard = await loadDashboardData(env, url);
  const stats = buildReleaseStats(dashboard);
  const ticketPlanRequest = extractTicketPlanRequest(dashboard, body);
  const missingTicketBrief = ticketPlanRequest?.missing ? buildMissingTicketBrief(dashboard, stats, ticketPlanRequest) : null;
  const directBrief = missingTicketBrief || (ticketPlanRequest ? null : buildDirectQuestionBrief(dashboard, stats, body));
  const promptTemplate = sanitizePrompt(body?.promptTemplate, 80);

  if (directBrief && (!env.AI || !Array.isArray(directBrief.ticketsToWatch) || directBrief.ticketsToWatch.length === 0)) {
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
  const promptLooksLikeLookup = /\b(ticket|tickets|issue|issues|assigned|assignee|developer|owner|component|components|from|with)\b/i.test(userPrompt);

  if (promptTemplate === "free_form") {
    return null;
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
