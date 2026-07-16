const AI_MODEL = "@cf/zai-org/glm-4.7-flash";
const AI_MODEL_PROFILE = "dialogue-first Workers AI model for conversational ticket and sprint analysis";
const SLACK_ACTIVITY_LIMIT = 12;
const ASANA_REQUEST_TYPE_OPTIONS = [
  "QA support request",
  "Automation request",
  "Release risk follow-up",
  "Test data request",
  "Access request"
];
const ASANA_ENTITY_OPTIONS = [
  "GolfNow CORE",
  "GolfNow Web",
  "G1 - Pure",
  "EZL -Pure",
  "EZRTS",
  "Other"
];
const ASANA_ENVIRONMENT_OPTIONS = [
  "DEV TN000",
  "DEV TN001",
  "STG TN000",
  "STG TN001",
  "EZL QA",
  "EZL STAGE"
];
const ASANA_STATUS_OPTIONS = [
  "New",
  "In progress",
  "Pending",
  "Closed"
];
const EZRTS_MAPPING_PAGE_ID = "11204624385";
const EZRTS_MAPPING_SOURCE_URL =
  "https://golfnow.atlassian.net/wiki/spaces/PRO/pages/11204624385/G1+Stage+Multi-Tenant+EZRTS+Test+Locations";
const EZRTS_MAPPING_REFRESH_SECONDS = 300;
const DEFAULT_LIVE_ARTIFACT_ORIGIN = "https://raw.githubusercontent.com/DewanKabir009/jira-board-v3001-124-0/master";
const LIVE_ARTIFACT_EXACT_PATHS = new Set([
  "/dashboard-data.json",
  "/boards.json"
]);
const LIVE_ARTIFACT_PREFIXES = [
  "/assets/jira-media/",
  "/hq/assets/jira-media/",
  "/modern/assets/jira-media/"
];
const WORKER_ROUTES = [
  "GET /health",
  "GET /api/worker/status",
  "GET /dashboard-data.json",
  "GET /boards.json",
  "GET /assets/jira-media/*",
  "GET /api/ezrts/mapping",
  "GET /api/ezrts/media/*",
  "GET /api/ai/status",
  "POST /api/ai/release-summary",
  "POST /api/ai/chat",
  "POST /api/board/refresh",
  "GET /api/asana/status",
  "POST /api/asana/intake",
  "GET /api/asana/open-tasks",
  "POST /api/asana/complete",
  "GET /api/slack/status",
  "GET /api/slack/activity",
  "POST /api/slack/send",
  "POST /api/slack/commands",
  "POST /api/slack/events",
  "POST /api/slack/actions"
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/health" || url.pathname === "/api/worker/status") {
      return jsonResponse(buildWorkerStatus(env));
    }

    if (isLiveArtifactPath(url.pathname)) {
      return serveLiveArtifact(request, env, url);
    }

    if (url.pathname === "/api/ezrts/mapping") {
      return handleEzrtsMapping(request, env, url);
    }

    if (url.pathname === "/api/ezrts/media" || url.pathname.startsWith("/api/ezrts/media/")) {
      return handleEzrtsMedia(request, env, url);
    }

    if (url.pathname === "/api/ai/status") {
      return jsonResponse({
        ok: true,
        provider: "Cloudflare Workers AI",
        model: AI_MODEL,
        modelProfile: AI_MODEL_PROFILE,
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

    if (url.pathname === "/api/board/refresh") {
      if (request.method === "OPTIONS") {
        return refreshProxyOptionsResponse(request, env, url);
      }
      if (request.method !== "POST") {
        return refreshProxyJsonResponse(request, env, url, { ok: false, message: "Use POST for board refresh dispatch." }, 405);
      }

      return handleBoardRefresh(request, env, url);
    }

    if (url.pathname === "/api/asana/status") {
      return handleAsanaStatus(env, url);
    }

    if (url.pathname === "/api/asana/intake") {
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, message: "Use POST for Asana intake requests." }, 405);
      }

      return handleAsanaIntake(request, env, url);
    }

    if (url.pathname === "/api/asana/open-tasks") {
      if (request.method !== "GET") {
        return jsonResponse({ ok: false, message: "Use GET for open Asana tickets." }, 405);
      }

      return handleAsanaOpenTasks(request, env, url);
    }

    if (url.pathname === "/api/asana/complete") {
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, message: "Use POST to complete an Asana ticket." }, 405);
      }

      return handleAsanaComplete(request, env, url);
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

    return serveFreshAsset(request, env);
  }
};

async function handleBoardRefresh(request, env, url) {
  if (!isAllowedRefreshOrigin(request, env, url)) {
    return refreshProxyJsonResponse(request, env, url, {
      ok: false,
      message: "Ticket refresh must be triggered from an approved HQ or board origin."
    }, 403);
  }

  if (!env.ASSIGNEE_BRIDGE || typeof env.ASSIGNEE_BRIDGE.fetch !== "function") {
    return refreshProxyJsonResponse(request, env, url, {
      ok: false,
      mode: "missing-service-binding",
      message: "ASSIGNEE_BRIDGE service binding is not configured on this HQ Worker."
    }, 503);
  }

  const body = await request.text();
  const forwardedOrigin = request.headers.get("Origin") || preferredRefreshOrigin(env, url);
  const bridgeRequest = new Request("https://jira-board-assignee-bridge/refresh", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": request.headers.get("content-type") || "text/plain;charset=UTF-8",
      "x-core-qa-dashboard-origin": forwardedOrigin,
      "x-core-qa-refresh-proxy": env.WORKER_SERVICE_NAME || "core-qa-headquarters-124"
    },
    body
  });
  let bridgeResponse;
  try {
    bridgeResponse = await env.ASSIGNEE_BRIDGE.fetch(bridgeRequest);
  } catch (error) {
    return refreshProxyJsonResponse(request, env, url, {
      ok: false,
      mode: "bridge-service-binding-error",
      message: error && error.message ? error.message : "Assignee bridge service binding failed during refresh dispatch."
    }, 502);
  }

  const headers = new Headers(bridgeResponse.headers);

  for (const [key, value] of Object.entries(refreshProxyCorsHeaders(request, env, url))) {
    headers.set(key, value);
  }
  headers.set("cache-control", "no-store");
  headers.set("x-core-qa-refresh-proxy", "hq-service-binding");

  return new Response(bridgeResponse.body, {
    status: bridgeResponse.status,
    statusText: bridgeResponse.statusText,
    headers
  });
}

function refreshProxyOptionsResponse(request, env, url) {
  return new Response(null, {
    status: 204,
    headers: refreshProxyCorsHeaders(request, env, url)
  });
}

function refreshProxyJsonResponse(request, env, url, payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...refreshProxyCorsHeaders(request, env, url)
    }
  });
}

function refreshProxyCorsHeaders(request, env, url) {
  const origin = request.headers.get("Origin") || "";
  const headers = {
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
    "vary": "Origin"
  };

  if (origin && isAllowedRefreshOrigin(request, env, url)) {
    headers["access-control-allow-origin"] = origin;
  }

  return headers;
}

function isAllowedRefreshOrigin(request, env, url) {
  const origin = request.headers.get("Origin") || "";
  if (!origin) {
    return false;
  }

  return refreshAllowedOrigins(env, url).includes(origin);
}

function refreshAllowedOrigins(env, url) {
  return [
    url.origin,
    originFromUrl(env.CLOUDFLARE_BOARD_URL),
    originFromUrl(env.CLOUDFLARE_HQ_URL),
    originFromUrl(env.MORDERN_HQ_URL),
    originFromUrl(env.GITHUB_PAGES_FALLBACK_URL),
    "https://dewankabir009.github.io"
  ].filter(Boolean).filter((value, index, all) => all.indexOf(value) === index);
}

function preferredRefreshOrigin(env, url) {
  return originFromUrl(env.CLOUDFLARE_BOARD_URL) || url.origin;
}

function originFromUrl(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  try {
    return new URL(text).origin;
  } catch {
    return "";
  }
}

async function serveLiveArtifact(request, env, url) {
  const method = request.method.toUpperCase();
  if (!["GET", "HEAD"].includes(method)) {
    return jsonResponse({ ok: false, message: "Use GET for live board artifacts." }, 405);
  }

  const artifactPath = normalizeLiveArtifactPath(url.pathname);
  const { response, source, warning } = await fetchLiveArtifactResponse(request, env, artifactPath, url);
  const headers = liveArtifactHeaders(response.headers, source, warning, artifactPath);

  return new Response(method === "HEAD" ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function fetchLiveArtifactResponse(request, env, pathname, sourceUrl) {
  const accept = request.headers.get("accept") || "application/json, text/plain;q=0.9, */*;q=0.8";
  const liveOrigin = liveArtifactOrigin(env);
  let rawWarning = "";

  try {
    const rawUrl = new URL(pathname.replace(/^\/+/, ""), ensureTrailingSlash(liveOrigin));
    rawUrl.searchParams.set("hqLiveArtifact", Date.now().toString());
    const response = await fetch(rawUrl.toString(), {
      method: "GET",
      headers: {
        accept,
        "user-agent": "CORE-QA-HQ-live-artifact/1.0"
      },
      cf: {
        cacheTtl: 0,
        cacheEverything: false
      }
    });

    if (response.ok) {
      return { response, source: "github-raw-master", warning: "" };
    }

    rawWarning = `GitHub raw returned HTTP ${response.status}`;
  } catch (error) {
    rawWarning = error?.message || "GitHub raw artifact fetch failed";
  }

  const fallbackUrl = new URL(pathname, sourceUrl?.origin || "https://core-qa-assets.local");
  const fallbackResponse = await env.ASSETS.fetch(new Request(fallbackUrl.toString(), {
    method: "GET",
    headers: { accept }
  }));

  return {
    response: fallbackResponse,
    source: "worker-static-assets-fallback",
    warning: rawWarning
  };
}

function liveArtifactHeaders(sourceHeaders, source, warning, pathname = "") {
  const headers = new Headers(sourceHeaders);
  headers.set("cache-control", "no-store, no-cache, must-revalidate, max-age=0");
  headers.set("pragma", "no-cache");
  headers.set("expires", "0");
  headers.set("x-core-qa-cache-policy", "live-artifact");
  headers.set("x-core-qa-artifact-source", source);
  if (pathname) {
    headers.set("x-core-qa-artifact-path", pathname);
  }

  if (warning) {
    headers.set("x-core-qa-artifact-warning", warning.slice(0, 240));
  }

  return headers;
}

async function handleEzrtsMapping(request, env) {
  const method = request.method.toUpperCase();
  if (!["GET", "HEAD"].includes(method)) {
    return jsonResponse({ ok: false, message: "Use GET for EZRTS mapping data." }, 405);
  }

  try {
    const mapping = await fetchEzrtsMappingFromConfluence(env);
    return ezrtsMappingResponse(mapping, method, "confluence-live");
  } catch (error) {
    return ezrtsMappingResponse({
      ok: false,
      schemaVersion: "hq-ezrts-mapping/v1",
      title: "G1 Stage Multi-Tenant EZRTS Test Locations",
      space: "PRO",
      spaceName: "ETN Engineering",
      sourcePageId: EZRTS_MAPPING_PAGE_ID,
      sourceUrl: EZRTS_MAPPING_SOURCE_URL,
      sourceLastModified: "Unknown",
      sourceAuthor: "Unknown",
      pulledAt: new Date().toISOString(),
      pulledAtDisplay: formatShortDateTime(new Date().toISOString()),
      refreshSeconds: EZRTS_MAPPING_REFRESH_SECONDS,
      status: "error",
      message: `Confluence EZRTS mapping could not be refreshed: ${sanitizePlainText(error?.message || "unknown error", 220)}`,
      sections: []
    }, method, "confluence-error", 502);
  }
}

function ezrtsMappingResponse(payload, method, source, status = 200) {
  return new Response(method === "HEAD" ? null : JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      "pragma": "no-cache",
      "expires": "0",
      "x-core-qa-cache-policy": "live-artifact",
      "x-core-qa-ezrts-source": source
    }
  });
}

async function handleEzrtsMedia(request, env, url) {
  const method = request.method.toUpperCase();
  if (!["GET", "HEAD"].includes(method)) {
    return jsonResponse({ ok: false, message: "Use GET for EZRTS media." }, 405);
  }

  const auth = confluenceAuthHeader(env);
  if (!auth) {
    return ezrtsMediaPlaceholder("Confluence auth is not configured", method, 503);
  }

  const site = (env.JIRA_SITE_URL || "https://golfnow.atlassian.net").replace(/\/+$/g, "");
  const pageId = sanitizeExternalId(url.searchParams.get("pageId") || EZRTS_MAPPING_PAGE_ID);
  const filename = url.searchParams.get("filename") || "";
  const source = url.searchParams.get("source") || "";
  const mediaId = (
    url.searchParams.get("mediaId") ||
    decodeURIComponent(url.pathname.replace(/^\/api\/ezrts\/media\/?/, ""))
  ).trim();

  const candidates = [];
  if (filename && filename.toLowerCase() !== "null") {
    candidates.push(...await ezrtsAttachmentDownloadCandidates(site, pageId, filename, auth));
    candidates.push(`${site}/wiki/download/attachments/${pageId}/${encodeURIComponent(filename)}`);
    candidates.push(`${site}/wiki/download/attachments/${pageId}/${encodeURIComponent(filename)}?api=v2`);
  }

  if (source && source.startsWith(site)) {
    candidates.push(source);
  }

  if (mediaId && mediaId.toLowerCase() !== "null" && /^[a-f0-9-]{20,}$/i.test(mediaId)) {
    const collection = url.searchParams.get("collection") || `contentId-${pageId}`;
    candidates.push(`https://api.media.atlassian.com/file/${encodeURIComponent(mediaId)}/binary?collection=${encodeURIComponent(collection)}`);
  }

  let lastError = "";
  for (const candidate of candidates) {
    try {
      const response = await fetchEzrtsMediaCandidate(candidate, auth, site);

      if (response.ok) {
        const headers = new Headers(response.headers);
        headers.set("cache-control", "no-store, no-cache, must-revalidate, max-age=0");
        headers.set("pragma", "no-cache");
        headers.set("expires", "0");
        headers.set("x-core-qa-cache-policy", "live-artifact");
        headers.set("x-core-qa-ezrts-media-source", candidate.includes("api.media.atlassian.com") ? "atlassian-media-api" : "confluence-download");
        return new Response(method === "HEAD" ? null : response.body, {
          status: response.status,
          statusText: response.statusText,
          headers
        });
      }

      lastError = `HTTP ${response.status} from ${candidate}`;
    } catch (error) {
      lastError = error?.message || "media fetch failed";
    }
  }

  return ezrtsMediaPlaceholder(lastError || "No media source was available", method, 502);
}

async function ezrtsAttachmentDownloadCandidates(site, pageId, filename, auth) {
  const endpoint = `${site}/wiki/rest/api/content/${pageId}/child/attachment?filename=${encodeURIComponent(filename)}&expand=version`;
  try {
    const response = await fetch(endpoint, {
      headers: {
        authorization: auth,
        accept: "application/json",
        "user-agent": "CORE-QA-HQ-ezrts-media/1.0"
      },
      cf: {
        cacheTtl: 0,
        cacheEverything: false
      }
    });
    if (!response.ok) return [];
    const payload = await response.json();
    const attachment = Array.isArray(payload?.results) ? payload.results[0] : null;
    if (!attachment?.id) return [];
    const downloadPath = attachment?._links?.download || "";
    const candidates = [
      `${site}/wiki/rest/api/content/${encodeURIComponent(attachment.id)}/download`,
      `${site}/wiki/rest/api/content/${pageId}/child/attachment/${encodeURIComponent(attachment.id)}/download`,
      `${site}/wiki/api/v2/attachments/${encodeURIComponent(attachment.id)}/download`
    ];
    if (downloadPath) {
      candidates.unshift(downloadPath.startsWith("http") ? downloadPath : `${site}${downloadPath.startsWith("/") ? "" : "/"}${downloadPath}`);
    }
    return candidates;
  } catch {
    return [];
  }
}

async function fetchEzrtsMediaCandidate(candidate, auth, site) {
  const baseHeaders = {
    accept: "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8",
    "user-agent": "CORE-QA-HQ-ezrts-media/1.0"
  };
  const response = await fetch(candidate, {
    headers: {
      ...baseHeaders,
      authorization: auth
    },
    redirect: "manual",
    cf: {
      cacheTtl: 0,
      cacheEverything: false
    }
  });

  if (![301, 302, 303, 307, 308].includes(response.status)) {
    return response;
  }

  const location = response.headers.get("location") || "";
  if (!location) {
    return response;
  }

  const redirectUrl = new URL(location, candidate).toString();
  const redirectHeaders = redirectUrl.startsWith(site)
    ? { ...baseHeaders, authorization: auth }
    : baseHeaders;
  return fetch(redirectUrl, {
    headers: redirectHeaders,
    cf: {
      cacheTtl: 0,
      cacheEverything: false
    }
  });
}

function ezrtsMediaPlaceholder(message, method, status = 502) {
  const safeMessage = sanitizePlainText(message, 120);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540" role="img" aria-label="EZRTS screenshot unavailable"><rect width="960" height="540" rx="32" fill="#f7f4fb"/><rect x="28" y="28" width="904" height="484" rx="28" fill="#fff" stroke="#cfd8ea" stroke-width="4"/><text x="480" y="244" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#250854">Screenshot unavailable</text><text x="480" y="298" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" fill="#625f78">${escapeSvg(safeMessage)}</text></svg>`;
  return new Response(method === "HEAD" ? null : svg, {
    status,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      "x-core-qa-ezrts-media-source": "placeholder"
    }
  });
}

async function fetchEzrtsMappingFromConfluence(env) {
  const auth = confluenceAuthHeader(env);
  if (!auth) {
    throw new Error("JIRA_EMAIL plus JIRA_MCP_TOKEN/JIRA_API_TOKEN are required for Confluence page refresh.");
  }

  const site = (env.JIRA_SITE_URL || "https://golfnow.atlassian.net").replace(/\/+$/g, "");
  const endpoint = `${site}/wiki/rest/api/content/${EZRTS_MAPPING_PAGE_ID}?expand=body.storage,body.atlas_doc_format,version,space,history.lastUpdated,history.createdBy`;
  const response = await fetch(endpoint, {
    headers: {
      authorization: auth,
      accept: "application/json"
    },
    cf: {
      cacheTtl: 0,
      cacheEverything: false
    }
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${endpoint}`);
  }

  const payload = JSON.parse(text);
  const sections = enrichEzrtsMediaFromAdf(
    normalizeEzrtsSections(payload?.body?.storage?.value || ""),
    payload?.body?.atlas_doc_format?.value
  );
  if (!sections.length) {
    throw new Error("Confluence page did not contain parseable EZRTS mapping tables.");
  }

  const modifiedAt = payload?.version?.when || payload?.history?.lastUpdated?.when || "";
  const author =
    payload?.version?.by?.displayName ||
    payload?.history?.lastUpdated?.by?.displayName ||
    payload?.history?.createdBy?.displayName ||
    "Unknown";

  return {
    ok: true,
    schemaVersion: "hq-ezrts-mapping/v1",
    title: payload?.title || "G1 Stage Multi-Tenant EZRTS Test Locations",
    space: payload?.space?.key || "PRO",
    spaceName: payload?.space?.name || "ETN Engineering",
    sourcePageId: String(payload?.id || EZRTS_MAPPING_PAGE_ID),
    sourceUrl: EZRTS_MAPPING_SOURCE_URL,
    sourceLastModified: modifiedAt ? formatShortDateTime(modifiedAt) : "Unknown",
    sourceAuthor: author,
    pulledAt: new Date().toISOString(),
    pulledAtDisplay: formatShortDateTime(new Date().toISOString()),
    refreshSeconds: EZRTS_MAPPING_REFRESH_SECONDS,
    status: "loaded",
    notes: "Live-normalized from the Confluence PRO mapping page by the Legacy HQ Worker.",
    sections,
    relatedLinks: extractEzrtsRelatedLinks(payload?.body?.storage?.value || "")
  };
}

function confluenceAuthHeader(env) {
  const email = env.JIRA_EMAIL || env.ATLASSIAN_EMAIL || "";
  const token = env.JIRA_MCP_TOKEN || env.JIRA_API_TOKEN || env.ATLASSIAN_API_TOKEN || "";
  if (!email || !token) {
    return "";
  }
  return `Basic ${btoa(`${email}:${token}`)}`;
}

function normalizeEzrtsSections(html) {
  const blocks = String(html || "").match(/<h([1-4])\b[\s\S]*?<\/h\1>|<table\b[\s\S]*?<\/table>/gi) || [];
  const byId = new Map();
  let activeHeading = "G1_001_Stage Manual locations";

  for (const block of blocks) {
    if (/^<h[1-4]\b/i.test(block)) {
      activeHeading = normalizeConfluenceText(block) || activeHeading;
      continue;
    }

    const rows = parseEzrtsTable(block);
    if (!rows.length) {
      continue;
    }

    const id = ezrtsSectionId(activeHeading, byId.size);
    const section = byId.get(id) || {
      id,
      name: ezrtsSectionName(activeHeading, id),
      summary: ezrtsSectionSummary(id),
      rows: []
    };
    section.rows.push(...rows);
    byId.set(id, section);
  }

  return [...byId.values()];
}

function enrichEzrtsMediaFromAdf(sections, adfValue) {
  const mediaIndex = buildEzrtsAdfMediaIndex(adfValue);
  if (!mediaIndex.size) {
    return sections;
  }

  sections.forEach((section) => {
    (section.rows || []).forEach((row) => {
      if (row.mediaByField && typeof row.mediaByField === "object") {
        Object.keys(row.mediaByField).forEach((field) => {
          row.mediaByField[field] = (row.mediaByField[field] || []).map((item) => enrichEzrtsMediaItem(item, mediaIndex));
        });
        row.media = Object.values(row.mediaByField).flat();
        return;
      }

      if (Array.isArray(row.media)) {
        row.media = row.media.map((item) => enrichEzrtsMediaItem(item, mediaIndex));
      }
    });
  });

  return sections;
}

function buildEzrtsAdfMediaIndex(adfValue) {
  const index = new Map();
  if (!adfValue) {
    return index;
  }

  let root = adfValue;
  if (typeof adfValue === "string") {
    try {
      root = JSON.parse(adfValue);
    } catch {
      return index;
    }
  }

  const register = (metadata) => {
    [metadata.id, metadata.mediaId, metadata.localId, metadata.filename, metadata.title]
      .filter(Boolean)
      .forEach((key) => index.set(String(key), metadata));
  };

  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    const attrs = node.attrs || {};
    if (node.type === "media" || attrs.type === "media") {
      const id = cleanEzrtsMediaValue(attrs.id || attrs.mediaId);
      const localId = cleanEzrtsMediaValue(attrs.localId);
      const filename = cleanEzrtsMediaValue(attrs.alt || attrs.name || attrs.__fileName || attrs.fileName || attrs.filename);
      const collection = cleanEzrtsMediaValue(attrs.collection);
      const title = filename || cleanEzrtsMediaValue(attrs.title) || "EZRTS screenshot";
      register({
        id,
        mediaId: id,
        localId,
        collection,
        filename,
        title,
        alt: title,
        width: firstNumber(attrs.width),
        height: firstNumber(attrs.height)
      });
    }

    if (Array.isArray(node.content)) {
      node.content.forEach(walk);
    }

    if (Array.isArray(node.marks)) {
      node.marks.forEach(walk);
    }
  };

  walk(root);
  return index;
}

function enrichEzrtsMediaItem(item, mediaIndex) {
  const metadata =
    mediaIndex.get(String(item?.id || "")) ||
    mediaIndex.get(String(item?.mediaId || "")) ||
    mediaIndex.get(String(item?.localId || "")) ||
    mediaIndex.get(String(item?.filename || "")) ||
    {};
  const rawItemId = cleanEzrtsMediaValue(item?.id || item?.mediaId);
  const metadataId = cleanEzrtsMediaValue(metadata.id || metadata.mediaId);
  const id = metadataId || rawItemId;
  const filename = cleanEzrtsMediaValue(item?.filename || metadata.filename);
  const sourceUrl = cleanEzrtsMediaValue(item?.sourceUrl || metadata.sourceUrl);
  const collection = cleanEzrtsMediaValue(item?.collection || metadata.collection || `contentId-${EZRTS_MAPPING_PAGE_ID}`);
  const title = filename || cleanEzrtsMediaValue(item?.title || metadata.title) || "EZRTS screenshot";

  return {
    ...item,
    id,
    mediaId: id,
    localId: cleanEzrtsMediaValue(item?.localId || metadata.localId || (metadataId ? rawItemId : "")),
    collection,
    filename,
    sourceUrl,
    url: ezrtsMediaProxyUrl({
      mediaId: id || filename || sourceUrl || item?.url,
      filename,
      collection,
      sourceUrl
    }),
    width: firstNumber(item?.width || metadata.width),
    height: firstNumber(item?.height || metadata.height),
    title,
    alt: cleanEzrtsMediaValue(item?.alt || metadata.alt || title)
  };
}

function parseEzrtsTable(tableHtml) {
  const parsedRows = (String(tableHtml || "").match(/<tr\b[\s\S]*?<\/tr>/gi) || [])
    .map((row) => ({
      isHeader: /<th\b/i.test(row),
      cells: (row.match(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi) || []).map(parseEzrtsCell)
    }))
    .filter((row) => row.cells.length);

  if (parsedRows.length < 2) {
    return [];
  }

  const headerRow = parsedRows.find((row) => row.isHeader) || parsedRows[0];
  const headers = headerRow.cells.map((cell) => normalizeHeader(cell.text));
  const dataRows = parsedRows.slice(parsedRows.indexOf(headerRow) + 1);

  return dataRows
    .map((row) => normalizeEzrtsRow(headers, row.cells))
    .filter((row) => row && (row.accountName || row.locationName || row.ezFacilityId || row.gncFacilityId));
}

function parseEzrtsCell(cellHtml) {
  const media = extractEzrtsMedia(cellHtml);
  const links = [];
  String(cellHtml || "").replace(/href=["']([^"']+)["']/gi, (_match, href) => {
    const decoded = decodeHtmlEntities(href);
    links.push(decoded.startsWith("http") ? decoded : `https://golfnow.atlassian.net${decoded.startsWith("/") ? decoded : `/${decoded}`}`);
    return "";
  });

  return {
    text: normalizeConfluenceText(cellHtml),
    links,
    media
  };
}

function normalizeEzrtsRow(headers, cells) {
  const account = ezrtsCell(headers, cells, [/account/, /name/], 0);
  const brand = ezrtsCell(headers, cells, [/brand/], 1);
  const g1Created = ezrtsCell(headers, cells, [/g1.*created/, /location.*created/, /created/], 2);
  const location = ezrtsCell(headers, cells, [/location.*name/, /ez.*location/], 3);
  const ezFacility = ezrtsCell(headers, cells, [/ez.*facility/, /facility.*id/], 4);
  const ezCourses = ezrtsCell(headers, cells, [/course.*id/, /ezl.*course/], 5);
  const gncFacility = ezrtsCell(headers, cells, [/gnc.*facility.*id/], 6);
  const gncFacilityName = ezrtsCell(headers, cells, [/gnc.*facility.*name/, /gnc.*name/], 7);
  const setup = ezrtsCell(headers, cells, [/setup/], 8);
  const interfaceConfiguration = ezrtsCell(headers, cells, [/interface/], 9);
  const bookingEngine = ezrtsCell(headers, cells, [/booking.*engine.*link/, /\bbe\b.*link/], 10);
  const gncBooking = ezrtsCell(headers, cells, [/gnc.*booking/], 11);
  const beBooking = ezrtsCell(headers, cells, [/booking.*engine.*booking/, /\bbe\b.*booking/], 12);
  const notes = ezrtsCell(headers, cells, [/note/, /comment/], 13);
  const link = firstCellLink(bookingEngine) || firstUrl(bookingEngine.text);
  const mediaByField = ezrtsMediaByField(headers, cells);
  const media = Object.values(mediaByField).flat();

  return {
    accountName: account.text,
    brand: brand.text,
    g1EzLocationCreated: g1Created.text,
    locationName: location.text || account.text,
    ezFacilityId: firstNumber(ezFacility.text),
    ezCourseIds: numericList(ezCourses.text),
    gncFacilityId: firstNumber(gncFacility.text),
    gncFacilityName: gncFacilityName.text,
    setup: setup.text,
    interfaceConfiguration: interfaceConfiguration.text,
    bookingEngineLink: link,
    gncBooking: gncBooking.text,
    bookingEngineBooking: beBooking.text,
    notes: notes.text,
    media,
    mediaByField,
    status: inferEzrtsStatus([account, brand, g1Created, location, ezFacility, ezCourses, gncFacility, gncFacilityName, setup, interfaceConfiguration, bookingEngine, gncBooking, beBooking, notes])
  };
}

function ezrtsCell(headers, cells, patterns, fallbackIndex) {
  const index = ezrtsCellIndex(headers, patterns, fallbackIndex);
  return cells[index] || { text: "", links: [], media: [] };
}

function ezrtsCellIndex(headers, patterns, fallbackIndex) {
  const index = headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
  return index >= 0 ? index : fallbackIndex;
}

function ezrtsMediaByField(headers, cells) {
  const result = {};
  cells.forEach((cell, index) => {
    if (!Array.isArray(cell?.media) || !cell.media.length) return;
    const field = ezrtsMediaFieldLabel(headers[index] || `column ${index + 1}`);
    result[field] = (result[field] || []).concat(cell.media.map((item, mediaIndex) => ({
      ...item,
      field,
      title: item.title || `${field} screenshot ${mediaIndex + 1}`,
      alt: item.alt || `${field} screenshot`
    })));
  });
  return result;
}

function ezrtsMediaFieldLabel(header) {
  const value = String(header || "").toLowerCase();
  if (value.includes("gnc") && value.includes("booking")) return "GNC Booking";
  if (value.includes("booking engine") && value.includes("booking")) return "Booking Engine Booking";
  if (value.includes("gift")) return "Gift Certificate";
  if (value.includes("membership")) return "Membership";
  if (value.includes("note")) return "Notes";
  if (value.includes("interface")) return "Interface Configuration";
  return toTitleCase(value || "EZRTS Media");
}

function extractEzrtsMedia(cellHtml) {
  const raw = String(cellHtml || "");
  const media = [];

  raw.replace(/<ac:image\b[\s\S]*?<\/ac:image>/gi, (match) => {
    media.push(buildEzrtsMedia(match, media.length));
    return "";
  });

  raw.replace(/<ac:adf-node\b[\s\S]*?<\/ac:adf-node>/gi, (match) => {
    if (/media|file|image|attachment/i.test(match)) {
      media.push(buildEzrtsMedia(match, media.length));
    }
    return "";
  });

  raw.replace(/<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi, (match, src) => {
    media.push(buildEzrtsMedia(match, media.length, decodeHtmlEntities(src)));
    return "";
  });

  raw.replace(/!\[[^\]]*]\(([^)]+)\)/g, (match, src) => {
    media.push(buildEzrtsMedia(match, media.length, decodeHtmlEntities(src)));
    return "";
  });

  return dedupeEzrtsMedia(media.filter((item) => item.id || item.filename || item.sourceUrl || item.url));
}

function buildEzrtsMedia(rawRef, index, src = "") {
  const decoded = decodeHtmlEntities(String(rawRef || ""));
  const sourceUrl =
    src ||
    extractAttr(decoded, "src") ||
    extractAttr(decoded, "ri:value") ||
    extractJsonLike(decoded, "url") ||
    extractJsonLike(decoded, "src") ||
    "";
  const filename = cleanEzrtsMediaValue(
    queryParam(sourceUrl, "__fileName") ||
    extractJsonLike(decoded, "__fileName") ||
    extractJsonLike(decoded, "fileName") ||
    extractJsonLike(decoded, "filename") ||
    extractJsonLike(decoded, "alt") ||
    extractAttr(decoded, "ri:filename") ||
    extractAttr(decoded, "data-file-name") ||
    extractAttr(decoded, "filename") ||
    extractAttr(decoded, "alt") ||
    extractAttr(decoded, "title") ||
    ""
  );
  const id = cleanEzrtsMediaValue(
    queryParam(sourceUrl, "id") ||
    extractJsonLike(decoded, "id") ||
    extractJsonLike(decoded, "mediaId") ||
    extractAttr(decoded, "data-media-id") ||
    extractAttr(decoded, "ri:media-id") ||
    extractAttr(decoded, "media-id") ||
    extractAttr(decoded, "id") ||
    ""
  );
  const localId = cleanEzrtsMediaValue(
    queryParam(sourceUrl, "localId") ||
    extractJsonLike(decoded, "localId") ||
    extractAttr(decoded, "localId") ||
    extractAttr(decoded, "data-local-id") ||
    ""
  );
  const collection = cleanEzrtsMediaValue(
    queryParam(sourceUrl, "collection") ||
    extractJsonLike(decoded, "collection") ||
    `contentId-${EZRTS_MAPPING_PAGE_ID}`
  );
  const width =
    queryParam(sourceUrl, "width") ||
    extractJsonLike(decoded, "width") ||
    extractAttr(decoded, "width") ||
    extractAttr(decoded, "ac:width") ||
    "";
  const height =
    queryParam(sourceUrl, "height") ||
    extractJsonLike(decoded, "height") ||
    extractAttr(decoded, "height") ||
    extractAttr(decoded, "ac:height") ||
    "";
  const key = id || filename || sourceUrl || `media-${index + 1}`;
  const proxyUrl = ezrtsMediaProxyUrl({
    mediaId: key,
    filename,
    collection,
    sourceUrl
  });

  return {
    id,
    mediaId: id,
    localId,
    collection,
    filename,
    sourceUrl,
    url: proxyUrl,
    width: firstNumber(width),
    height: firstNumber(height),
    title: filename || `EZRTS screenshot ${index + 1}`,
    alt: filename || `EZRTS screenshot ${index + 1}`
  };
}

function ezrtsMediaProxyUrl({ mediaId, filename, collection, sourceUrl, pageId = EZRTS_MAPPING_PAGE_ID }) {
  const params = new URLSearchParams();
  params.set("mediaId", cleanEzrtsMediaValue(mediaId) || cleanEzrtsMediaValue(filename) || "media");
  params.set("pageId", cleanEzrtsMediaValue(pageId) || EZRTS_MAPPING_PAGE_ID);
  const cleanFilename = cleanEzrtsMediaValue(filename);
  const cleanCollection = cleanEzrtsMediaValue(collection);
  const cleanSource = cleanEzrtsMediaValue(sourceUrl);
  if (cleanFilename) params.set("filename", cleanFilename);
  if (cleanCollection) params.set("collection", cleanCollection);
  if (cleanSource.startsWith("https://golfnow.atlassian.net")) params.set("source", cleanSource);
  return `/api/ezrts/media?${params.toString()}`;
}

function cleanEzrtsMediaValue(value) {
  const text = decodeHtmlEntities(String(value || "").trim());
  if (!text || text.toLowerCase() === "null" || text.toLowerCase() === "undefined") return "";
  return sanitizePlainText(text, 260);
}

function dedupeEzrtsMedia(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.id || item.filename || item.sourceUrl || item.url;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractAttr(value, name) {
  const pattern = new RegExp(`${escapeRegex(name)}=["']([^"']+)["']`, "i");
  const match = String(value || "").match(pattern);
  return match ? decodeHtmlEntities(match[1]) : "";
}

function extractJsonLike(value, name) {
  const pattern = new RegExp(`["']${escapeRegex(name)}["']\\s*:\\s*(["'])(.*?)\\1`, "i");
  const match = String(value || "").match(pattern);
  return match ? decodeHtmlEntities(match[2]) : "";
}

function queryParam(value, key) {
  const text = String(value || "");
  if (!text) return "";
  try {
    const parsed = new URL(text);
    const parsedValue = parsed.searchParams.get(key);
    if (parsedValue) return parsedValue;
  } catch {
    // Fall back below for blob URLs and escaped Confluence macro payloads.
  }

  const pattern = new RegExp(`[?&]${escapeRegex(key)}=([^&"'<\\s]+)`, "i");
  const match = text.match(pattern);
  return match ? decodeURIComponent(match[1]) : "";
}

function toTitleCase(value) {
  return String(value || "")
    .split(/\s+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function inferEzrtsStatus(cells) {
  const text = cells.map((cell) => cell.text).join(" ").toLowerCase();
  if (/\berror\b|not being|not mapped|connection error|failed/.test(text)) return "risk";
  if (/\bwip\b|work in progress/.test(text)) return "wip";
  if (/\blinked\b|https?:\/\//.test(text)) return "linked";
  if (/setup checked|\by\s*\/\s*y\b|created/.test(text)) return "ready";
  return "linked";
}

function ezrtsSectionId(heading, index) {
  const lower = String(heading || "").toLowerCase();
  if (lower.includes("automation")) return "automation";
  if (lower.includes("gift") || lower.includes("membership")) return "giftMembership";
  if (lower.includes("manual")) return "manual";
  return `mapping-${index + 1}`;
}

function ezrtsSectionName(heading, id) {
  if (id === "manual") return "G1_001_Stage Manual locations";
  if (id === "automation") return "G1_001_Stage Automation locations";
  if (id === "giftMembership") return "Gift Certificate and Membership Validations from Booking Engine";
  return sanitizePlainText(heading, 140) || "EZRTS mapping";
}

function ezrtsSectionSummary(id) {
  if (id === "manual") return "Manual G1 Stage locations mapped to GNC AWS DEV.";
  if (id === "automation") return "Automation G1 Stage location identifiers and EZL course mappings.";
  if (id === "giftMembership") return "Booking Engine validation rows for gift certificate and membership checks.";
  return "Confluence EZRTS mapping rows.";
}

function extractEzrtsRelatedLinks(html) {
  const links = [];
  String(html || "").replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href, label) => {
    const text = normalizeConfluenceText(label);
    const url = decodeHtmlEntities(href);
    if (/brs|moved/i.test(text) || /11296965553/.test(url)) {
      links.push({
        label: text || "Related Confluence page",
        url: url.startsWith("http") ? url : `https://golfnow.atlassian.net${url.startsWith("/") ? url : `/${url}`}`
      });
    }
    return "";
  });
  return links;
}

function normalizeHeader(value) {
  return normalizeConfluenceText(value).toLowerCase().replace(/\s+/g, " ");
}

function normalizeConfluenceText(html) {
  return decodeHtmlEntities(String(html || "")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/<ac:image\b[\s\S]*?<\/ac:image>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>|<\/li>|<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function decodeHtmlEntities(value) {
  return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code) => {
    const lower = code.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCharCode(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCharCode(parseInt(lower.slice(1), 10));
    return {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: "\"",
      apos: "'",
      nbsp: " "
    }[lower] || entity;
  });
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeSvg(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function numericList(value) {
  return [...new Set(String(value || "").match(/\b\d{4,}\b/g) || [])];
}

function firstNumber(value) {
  return numericList(value)[0] || "";
}

function firstCellLink(cell) {
  return Array.isArray(cell?.links) ? cell.links.find(Boolean) || "" : "";
}

function firstUrl(value) {
  const match = String(value || "").match(/https?:\/\/[^\s)]+/i);
  return match ? match[0] : "";
}

function formatShortDateTime(value) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
      timeZoneName: "short"
    }).format(new Date(value));
  } catch {
    return String(value || "Unknown");
  }
}

function isLiveArtifactPath(pathname) {
  const artifactPath = normalizeLiveArtifactPath(pathname);
  return LIVE_ARTIFACT_EXACT_PATHS.has(artifactPath) || artifactPath.startsWith("/assets/jira-media/");
}

function normalizeLiveArtifactPath(pathname) {
  if (pathname.startsWith("/hq/assets/jira-media/")) {
    return pathname.replace(/^\/hq\/assets\/jira-media\//, "/assets/jira-media/");
  }

  if (pathname.startsWith("/modern/assets/jira-media/")) {
    return pathname.replace(/^\/modern\/assets\/jira-media\//, "/assets/jira-media/");
  }

  return pathname;
}

function liveArtifactOrigin(env) {
  return (env.LIVE_ARTIFACT_ORIGIN || DEFAULT_LIVE_ARTIFACT_ORIGIN).replace(/\/+$/g, "");
}

function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

async function serveFreshAsset(request, env) {
  const url = new URL(request.url);
  const { response, rewrittenPath } = await fetchAssetWithFallbacks(request, env, url);
  const headers = new Headers(response.headers);

  if (shouldBypassAssetCache(url.pathname)) {
    headers.set("cache-control", "no-store, no-cache, must-revalidate, max-age=0");
    headers.set("cdn-cache-control", "no-store");
    headers.set("cloudflare-cdn-cache-control", "no-store");
    headers.set("surrogate-control", "no-store");
    headers.set("pragma", "no-cache");
    headers.set("expires", "0");
    headers.set("x-core-qa-cache-policy", "live-artifact");
  }

  if (rewrittenPath) {
    headers.set("x-core-qa-asset-rewrite", rewrittenPath);
  }

  if (shouldDecorateLegacyHqShell(request, response, url.pathname)) {
    const html = await response.text();
    headers.set("content-type", "text/html; charset=utf-8");
    headers.set("x-core-qa-hq-shell-decorated", "ezrts-link");
    headers.set("x-core-qa-hq-shell-source-path", rewrittenPath || url.pathname);

    return new Response(decorateLegacyHqShell(html, env), {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function fetchAssetWithFallbacks(request, env, url) {
  const candidatePaths = getAssetCandidatePaths(url.pathname);

  for (let index = 0; index < candidatePaths.length; index += 1) {
    const candidateUrl = new URL(url.toString());
    candidateUrl.pathname = candidatePaths[index];
    candidateUrl.search = "";

    const headers = new Headers(request.headers);
    headers.set("cache-control", "no-store, no-cache, must-revalidate, max-age=0");
    headers.set("pragma", "no-cache");

    const response = await env.ASSETS.fetch(new Request(candidateUrl.toString(), {
      method: request.method,
      headers
    }));

    if (response.status !== 404 || index === candidatePaths.length - 1) {
      return {
        response,
        rewrittenPath: candidateUrl.pathname === url.pathname ? "" : `${url.pathname}->${candidateUrl.pathname}`
      };
    }
  }
}

function getAssetCandidatePaths(pathname) {
  const candidates = [pathname];

  if (pathname === "/legacy-hq" || pathname === "/legacy-hq/" || pathname === "/legacy-hq/index.html") {
    candidates.push("/hq/index.html");
  }

  if (pathname === "/hq" || pathname === "/hq/") {
    candidates.push("/hq/index.html");
  }

  if (pathname === "/" || pathname === "") {
    candidates.push("/index.html");
  }

  const replacements = [
    [/^\/modern\/_astro\//, "/_astro/"],
    [/^\/modern\/assets\//, "/assets/"],
    [/^\/hq\/_astro\//, "/_astro/"],
    [/^\/hq\/assets\//, "/assets/"],
    [/^\/modern\/hq\/_astro\//, "/_astro/"],
    [/^\/modern\/hq\/assets\//, "/assets/"],
    [/^\/_astro\//, "/modern/_astro/"],
    [/^\/assets\//, "/modern/assets/"]
  ];

  for (const [pattern, replacement] of replacements) {
    if (pattern.test(pathname)) {
      candidates.push(pathname.replace(pattern, replacement));
    }
  }

  return [...new Set(candidates)];
}

function shouldBypassAssetCache(pathname) {
  return (
    pathname === "/" ||
    pathname === "/legacy-hq" ||
    pathname === "/legacy-hq/" ||
    pathname === "/hq" ||
    pathname === "/hq/" ||
    pathname.endsWith(".html") ||
    pathname.endsWith("/dashboard-data.json") ||
    pathname.endsWith("/boards.json")
  );
}

function shouldDecorateLegacyHqShell(request, response, pathname) {
  if (request.method.toUpperCase() !== "GET" || response.status !== 200) {
    return false;
  }

  const contentType = response.headers.get("content-type") || "";
  return (
    contentType.includes("text/html") &&
    (
      pathname === "/hq" ||
      pathname === "/hq/" ||
      pathname === "/hq/index.html" ||
      pathname === "/legacy-hq" ||
      pathname === "/legacy-hq/" ||
      pathname === "/legacy-hq/index.html"
    )
  );
}

function decorateLegacyHqShell(html, env) {
  const mordernBase = (env.MORDERN_HQ_URL || "https://core-qa-mordern-hq-124.dfkabir253.workers.dev/").replace(/\/+$/g, "");
  const ezrtsUrl = `${mordernBase}/ezrts/`;
  let nextHtml = html;

  if (!nextHtml.includes(`href="${ezrtsUrl}"`)) {
    nextHtml = nextHtml.replace(
      '<a href="#status">Operations status</a>',
      `<a href="#status">Operations status</a> <a href="${ezrtsUrl}">EZRTS</a>`
    );
    nextHtml = nextHtml.replace(
      '<a href="#automation">Runbook</a>',
      `<a href="#automation">Runbook</a> <a href="${ezrtsUrl}">EZRTS mapping</a>`
    );
  }

  return nextHtml;
}

async function handleAsanaStatus(env, url) {
  const config = getAsanaConfig(env);
  const validation = await validateAsanaProject(env, config);
  const jira = getJiraIntakeConfig(env);
  const slack = getSlackConfig(env);
  const workspaceName = validation.workspaceName || config.workspaceName;
  const projectName = validation.projectName || config.projectName;
  const shouldEnsure = url.searchParams.get("ensure") === "1" || url.searchParams.get("ensure") === "true";
  let routing = {
    attempted: false,
    ok: false,
    message: "Asana project schema was not inspected."
  };
  let assignee = {
    name: config.defaultAssigneeName,
    email: config.defaultAssigneeEmail,
    gid: config.defaultAssigneeGid,
    resolved: Boolean(config.defaultAssigneeGid)
  };
  let ticketType = {
    name: config.ticketTypeName,
    gid: "",
    resolved: false,
    attempted: false
  };

  if (config.canCreate && validation.ok) {
    try {
      routing = await ensureAsanaRouting(env, config, { ensure: shouldEnsure });
    } catch (error) {
      routing = {
        attempted: true,
        ok: false,
        message: sanitizePlainText(error?.message || "Asana routing inspection failed.", 260)
      };
    }

    try {
      assignee = await resolveAsanaAssignee(env, config);
    } catch (error) {
      assignee.warning = sanitizePlainText(error?.message || "Default Asana assignee lookup failed.", 260);
    }

    try {
      ticketType = await resolveAsanaTicketType(env, config);
    } catch (error) {
      ticketType = {
        name: config.ticketTypeName,
        gid: "",
        resolved: false,
        attempted: true,
        warning: sanitizePlainText(error?.message || "Asana ticket type lookup failed.", 260)
      };
    }
  }

  const canCreate = config.canCreate && validation.ok;

  return jsonResponse({
    ok: true,
    provider: "Asana API",
    workspaceGid: config.workspaceGid,
    workspaceName,
    projectGid: config.projectGid,
    projectName,
    tokenConfigured: config.tokenConfigured,
    canCreate,
    apiValidated: validation.attempted,
    apiReachable: validation.ok,
    validationMessage: validation.message,
    schemaEnsured: shouldEnsure,
    routing,
    defaultAssignee: assignee,
    ticketType,
    slack: {
      channel: slack.channel,
      channelName: slack.channelName,
      canPost: slack.canPost,
      tokenConfigured: slack.tokenConfigured
    },
    jira: {
      mode: jira.canCreate ? "direct-create" : "manual-handoff",
      siteUrl: jira.siteUrl,
      projectKey: jira.projectKey,
      issueType: jira.issueType,
      canCreate: jira.canCreate
    },
    message: canCreate
      ? `Asana intake is ready for ${projectName}.`
      : validation.message ||
        (config.canCreate
          ? `Asana intake is configured, but HQ could not validate ${config.projectName}.`
          : "Set ASANA_ACCESS_TOKEN, ASANA_WORKSPACE_GID, and ASANA_PROJECT_GID before creating Asana tickets.")
  });
}

async function handleAsanaIntake(request, env, url) {
  const body = await safeJson(request);
  const config = getAsanaConfig(env);
  const intake = sanitizeAsanaIntake(body);
  const dryRun = Boolean(body?.dryRun);

  if (!intake.summary) {
    return jsonResponse({ ok: false, message: "Summary is required before HQ can open an Asana intake ticket." }, 400);
  }

  if (!config.workspaceGid || !config.projectGid) {
    return jsonResponse({
      ok: false,
      message: "Asana workspace or project configuration is missing.",
      workspaceGid: config.workspaceGid,
      projectGid: config.projectGid
    }, 503);
  }

  const jiraHandoff = buildJiraHandoff(env, intake);

  if (dryRun) {
    let previewRouting = null;
    let previewAssignee = null;
    if (config.tokenConfigured) {
      previewRouting = await ensureAsanaRouting(env, config, { ensure: false }).catch(() => null);
      previewAssignee = await resolveAsanaAssignee(env, config).catch(() => null);
    }

    return jsonResponse({
      ok: true,
      mode: "dry-run",
      provider: "Asana API",
      projectName: config.projectName,
      projectGid: config.projectGid,
      message: "Dry run only; no Asana, Slack, or Jira write was performed.",
      preview: {
        asana: buildAsanaTaskPayload(config, intake, jiraHandoff, previewRouting, previewAssignee).data,
        slack: buildAsanaSlackMessage(env, intake, {
          url: "https://app.asana.com/0/" + config.projectGid,
          name: intake.summary
        }, jiraHandoff),
        jira: jiraHandoff
      }
    });
  }

  if (!config.tokenConfigured) {
    return jsonResponse({
      ok: false,
      mode: "missing-token",
      provider: "Asana API",
      projectName: config.projectName,
      message: "ASANA_ACCESS_TOKEN is not configured as a Cloudflare Worker secret."
    }, 503);
  }

  let asanaTask;
  try {
    asanaTask = await createAsanaTask(env, config, intake, jiraHandoff);
  } catch (error) {
    return jsonResponse({
      ok: false,
      provider: "Asana API",
      projectName: config.projectName,
      message: error.message
    }, 502);
  }

  const jiraResult = await createJiraIntakeIfConfigured(env, intake, asanaTask);
  const slackResult = await notifyAsanaIntakeSlack(env, intake, asanaTask, jiraResult.issue || jiraHandoff);
  const warnings = [
    ...(asanaTask.warnings || []),
    jiraResult.warning,
    slackResult.warning
  ].filter(Boolean);

  return jsonResponse({
    ok: true,
    provider: "CORE QA HQ intake",
    message: warnings.length
      ? "Asana ticket was opened. Review warnings before assuming all downstream systems were updated."
      : "Asana ticket opened and downstream notifications completed.",
    asana: asanaTask,
    jira: jiraResult.issue || jiraHandoff,
    slack: slackResult,
    warnings
  });
}

async function handleAsanaOpenTasks(request, env, url) {
  const config = getAsanaConfig(env);
  if (!config.tokenConfigured) {
    return jsonResponse({
      ok: false,
      provider: "Asana API",
      message: "ASANA_ACCESS_TOKEN is not configured as a Cloudflare Worker secret on Legacy HQ.",
      tasks: [],
      count: 0
    }, 503);
  }

  if (!config.projectGid) {
    return jsonResponse({
      ok: false,
      provider: "Asana API",
      message: "ASANA_PROJECT_GID is not configured.",
      tasks: [],
      count: 0
    }, 503);
  }

  try {
    const tasks = await listAsanaOpenProjectTasks(env, config);
    return jsonResponse({
      ok: true,
      provider: "Asana API",
      source: "legacy-hq",
      projectName: config.projectName,
      workspaceName: config.workspaceName,
      count: tasks.length,
      refreshedAt: new Date().toISOString(),
      tasks
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      provider: "Asana API",
      message: sanitizePlainText(error?.message || "Failed to load open Asana tickets.", 320),
      tasks: [],
      count: 0
    }, 502);
  }
}

async function handleAsanaComplete(request, env, url) {
  const config = getAsanaConfig(env);
  if (!config.tokenConfigured) {
    return jsonResponse({
      ok: false,
      provider: "Asana API",
      message: "ASANA_ACCESS_TOKEN is not configured as a Cloudflare Worker secret on Legacy HQ."
    }, 503);
  }

  const body = await safeJson(request);
  const taskGid = sanitizeAsanaGid(body.taskGid || body.gid || body.id || body.taskId || "");
  if (!taskGid) {
    return jsonResponse({
      ok: false,
      message: "A task id is required to complete an Asana ticket."
    }, 400);
  }

  try {
    const completed = await completeAsanaTask(env, config, taskGid);
    return jsonResponse({
      ok: true,
      provider: "Asana API",
      source: "legacy-hq",
      message: `Closed ${completed.name || "Asana ticket"}.`,
      task: completed
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      provider: "Asana API",
      message: sanitizePlainText(error?.message || "Failed to complete Asana ticket.", 320)
    }, 502);
  }
}

async function listAsanaOpenProjectTasks(env, config) {
  const optFields = [
    "gid",
    "name",
    "completed",
    "assignee.name",
    "due_on",
    "due_at",
    "permalink_url",
    "created_at",
    "modified_at",
    "memberships.section.name",
    "memberships.project.name",
    "memberships.project.gid",
    "custom_fields.name",
    "custom_fields.display_value",
    "custom_fields.enum_value.name",
    "custom_fields.text_value",
    "custom_fields.number_value"
  ].join(",");

  const tasks = [];
  let path = `/projects/${config.projectGid}/tasks?completed_since=now&limit=100&opt_fields=${encodeURIComponent(optFields)}`;
  for (let page = 0; page < 10 && path; page += 1) {
    const payload = await asanaFetchJson(env, path);
    for (const task of payload.data || []) {
      if (task?.completed) continue;
      tasks.push(normalizeAsanaKdsTask(task, config));
    }
    path = payload.next_page?.path || "";
  }

  tasks.sort((a, b) => {
    const dueA = a.dueOn || a.dueAt || "";
    const dueB = b.dueOn || b.dueAt || "";
    if (dueA && dueB && dueA !== dueB) return dueA < dueB ? -1 : 1;
    if (dueA && !dueB) return -1;
    if (!dueA && dueB) return 1;
    return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  });

  return tasks;
}

function normalizeAsanaKdsTask(task, config) {
  const customFields = Array.isArray(task?.custom_fields) ? task.custom_fields : [];
  const priority = pickAsanaCustomFieldDisplay(customFields, ["Priority", "priority"]) || "";
  const status = pickAsanaCustomFieldDisplay(customFields, ["Status", "status"]) || "Open";
  const memberships = Array.isArray(task?.memberships) ? task.memberships : [];
  const projectMembership = memberships.find((entry) => {
    const projectGid = sanitizeAsanaGid(entry?.project?.gid || "");
    return projectGid && projectGid === config.projectGid;
  }) || memberships[0] || null;

  return {
    id: sanitizeAsanaGid(task?.gid || ""),
    name: sanitizePlainText(task?.name || "Untitled ticket", 220),
    assignee: sanitizePlainText(task?.assignee?.name || "Unassigned", 120),
    project: sanitizePlainText(projectMembership?.project?.name || config.projectName, 160),
    section: sanitizePlainText(projectMembership?.section?.name || "No section", 120),
    dueOn: sanitizePlainText(task?.due_on || "", 32),
    dueAt: sanitizePlainText(task?.due_at || "", 64),
    priority: sanitizePlainText(priority, 80),
    status: sanitizePlainText(status, 80),
    url: sanitizeUrl(task?.permalink_url || ""),
    createdAt: sanitizePlainText(task?.created_at || "", 64),
    modifiedAt: sanitizePlainText(task?.modified_at || "", 64)
  };
}

function pickAsanaCustomFieldDisplay(fields, names) {
  const wanted = new Set(names.map((name) => normalizeAsanaName(name)));
  for (const field of fields) {
    if (!wanted.has(normalizeAsanaName(field?.name || ""))) continue;
    const display =
      field.display_value ||
      field.enum_value?.name ||
      field.text_value ||
      (field.number_value != null ? String(field.number_value) : "");
    if (display) return String(display);
  }
  return "";
}

async function completeAsanaTask(env, config, taskGid) {
  const optFields = "gid,name,completed,permalink_url,projects.gid,projects.name";
  const existing = await asanaFetchJson(
    env,
    `/tasks/${encodeURIComponent(taskGid)}?opt_fields=${encodeURIComponent(optFields)}`
  );
  const task = existing.data || {};
  const projectGids = (task.projects || []).map((project) => sanitizeAsanaGid(project?.gid || "")).filter(Boolean);
  if (config.projectGid && projectGids.length && !projectGids.includes(config.projectGid)) {
    throw new Error("That ticket is outside the configured HQ Asana project and cannot be closed from KDS.");
  }

  const updated = await asanaFetchJson(env, `/tasks/${encodeURIComponent(taskGid)}`, {
    method: "PUT",
    body: JSON.stringify({ data: { completed: true } })
  });

  return {
    id: sanitizeAsanaGid(updated.data?.gid || taskGid),
    name: sanitizePlainText(updated.data?.name || task.name || "Asana ticket", 220),
    completed: Boolean(updated.data?.completed ?? true),
    url: sanitizeUrl(updated.data?.permalink_url || task.permalink_url || ""),
    project: sanitizePlainText(config.projectName, 160)
  };
}

function getAsanaConfig(env) {
  const workspaceGid = sanitizeExternalId(env.ASANA_WORKSPACE_GID || "");
  const projectGid = sanitizeExternalId(env.ASANA_PROJECT_GID || "");
  const workspaceName = sanitizePlainText(env.ASANA_WORKSPACE_NAME || "versantmedia.com", 120);
  const projectName = sanitizePlainText(env.ASANA_PROJECT_NAME || "GN CORE QA HQ", 160);
  const defaultSectionName = sanitizePlainText(env.ASANA_DEFAULT_SECTION_NAME || "New", 80);
  const defaultStatusName = sanitizePlainText(env.ASANA_DEFAULT_STATUS_NAME || "New", 80);
  const ticketTypeName = sanitizePlainText(env.ASANA_TASK_TYPE_NAME || env.ASANA_CUSTOM_TYPE_NAME || "Ticket", 80);
  const defaultAssigneeName = sanitizePlainText(env.ASANA_DEFAULT_ASSIGNEE_NAME || "Dewan Kabir", 120);
  const defaultAssigneeEmail = sanitizePlainText(env.ASANA_DEFAULT_ASSIGNEE_EMAIL || "dewan.kabir@versantmedia.com", 180);
  const defaultAssigneeGid = sanitizeExternalId(env.ASANA_DEFAULT_ASSIGNEE_GID || "");
  const tokenConfigured = Boolean(env.ASANA_ACCESS_TOKEN);

  return {
    workspaceGid,
    workspaceName,
    projectGid,
    projectName,
    defaultSectionName,
    defaultStatusName,
    ticketTypeName,
    defaultAssigneeName,
    defaultAssigneeEmail,
    defaultAssigneeGid,
    fieldNames: {
      requestType: sanitizePlainText(env.ASANA_REQUEST_TYPE_FIELD_NAME || "Request Type", 80),
      entity: sanitizePlainText(env.ASANA_ENTITY_FIELD_NAME || "Entity", 80),
      environment: sanitizePlainText(env.ASANA_ENVIRONMENT_FIELD_NAME || "Environment", 80),
      status: sanitizePlainText(env.ASANA_STATUS_FIELD_NAME || "Status", 80)
    },
    tokenConfigured,
    canCreate: tokenConfigured && Boolean(workspaceGid) && Boolean(projectGid)
  };
}

async function validateAsanaProject(env, config) {
  if (!config.tokenConfigured || !config.projectGid) {
    return {
      attempted: false,
      ok: false,
      message: "Set ASANA_ACCESS_TOKEN and ASANA_PROJECT_GID before HQ can validate Asana."
    };
  }

  try {
    const response = await fetch(
      `https://app.asana.com/api/1.0/projects/${config.projectGid}?opt_fields=gid,name,workspace.gid,workspace.name`,
      {
        headers: {
          authorization: `Bearer ${env.ASANA_ACCESS_TOKEN}`,
          accept: "application/json"
        }
      }
    );

    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }

    if (!response.ok || payload.errors) {
      const detail = Array.isArray(payload.errors)
        ? payload.errors.map((error) => error.message).filter(Boolean).join("; ")
        : "";
      return {
        attempted: true,
        ok: false,
        status: response.status,
        message: `Asana validation failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}.`
      };
    }

    const project = payload.data || {};
    const workspace = project.workspace || {};
    if (config.workspaceGid && workspace.gid && workspace.gid !== config.workspaceGid) {
      return {
        attempted: true,
        ok: false,
        status: response.status,
        projectName: sanitizePlainText(project.name || config.projectName, 160),
        workspaceName: sanitizePlainText(workspace.name || config.workspaceName, 120),
        message: `Asana project ${config.projectGid} belongs to workspace ${workspace.gid}, not ${config.workspaceGid}.`
      };
    }

    return {
      attempted: true,
      ok: true,
      status: response.status,
      projectName: sanitizePlainText(project.name || config.projectName, 160),
      workspaceName: sanitizePlainText(workspace.name || config.workspaceName, 120),
      message: `Asana project ${project.name || config.projectName} validated.`
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      message: `Asana validation request failed: ${sanitizePlainText(error?.message || "unknown error", 240)}.`
    };
  }
}

async function ensureAsanaRouting(env, config, { ensure = false } = {}) {
  if (!config.tokenConfigured || !config.projectGid) {
    return {
      attempted: false,
      ok: false,
      message: "Asana routing was not inspected because the token or project GID is missing."
    };
  }

  const warnings = [];
  const [sections, projectFieldSettings] = await Promise.all([
    listAsanaProjectSections(env, config),
    listAsanaProjectCustomFieldSettings(env, config)
  ]);
  let section = findAsanaNamedItem(sections, config.defaultSectionName);
  const workspaceFields = ensure ? await listAsanaWorkspaceCustomFields(env, config) : [];
  let statusField = findAsanaStatusField(projectFieldSettings, config.defaultStatusName, config.fieldNames.status);
  const intakeFields = {};

  if (!section && ensure) {
    try {
      section = await createAsanaProjectSection(env, config, config.defaultSectionName);
    } catch (error) {
      warnings.push(`Could not create Asana section ${config.defaultSectionName}: ${sanitizePlainText(error?.message || "unknown error", 220)}`);
    }
  }

  if (!statusField.gid && ensure && !section?.gid) {
    try {
      statusField = await ensureAsanaStatusField(env, config, projectFieldSettings, workspaceFields);
    } catch (error) {
      warnings.push(`Could not ensure Asana ${config.fieldNames.status} field: ${sanitizePlainText(error?.message || "unknown error", 220)}`);
    }
  }

  if (!section) {
    warnings.push(`No Asana project section named ${config.defaultSectionName} was found.`);
  }

  if (!section?.gid && (!statusField.gid || !statusField.optionGid)) {
    warnings.push(`No Asana enum field with a ${config.defaultStatusName} option was found.`);
  }

  for (const definition of getAsanaIntakeFieldDefinitions(config)) {
    const projectField = findAsanaField(projectFieldSettings, definition.name);
    let field = projectField.field || findAsanaField(workspaceFields, definition.name).field;
    let attached = Boolean(projectField.field);
    let created = false;

    if (!field && ensure) {
      field = await createAsanaEnumField(env, config, definition);
      created = true;
    }

    if (field && ensure) {
      field = await ensureAsanaEnumOptions(env, field, definition.options);
      if (!attached) {
        await addAsanaCustomFieldToProject(env, config, field.gid);
        attached = true;
      }
    }

    const options = mapAsanaEnumOptions(field?.enum_options || field?.enumOptions || []);
    const missingOptions = definition.options.filter((option) => !options[normalizeAsanaName(option)]);
    if (field && missingOptions.length) {
      warnings.push(`${definition.name} is missing option(s): ${missingOptions.join(", ")}.`);
    }
    if (!field) {
      warnings.push(`${definition.name} is not attached to the Asana project.`);
    }

    intakeFields[definition.key] = {
      name: definition.name,
      gid: field?.gid || "",
      attached,
      created,
      options: definition.options.map((option) => ({
        name: option,
        gid: options[normalizeAsanaName(option)] || ""
      }))
    };
  }

  const fieldReady = Object.values(intakeFields).every((field) =>
    field.gid && field.attached && field.options.every((option) => option.gid)
  );

  return {
    attempted: true,
    ensured: ensure,
    ok: Boolean(section?.gid || (statusField.gid && statusField.optionGid)) && fieldReady,
    section: section
      ? { gid: section.gid, name: section.name }
      : { gid: "", name: config.defaultSectionName },
    statusField,
    intakeFields,
    warnings,
    message: ensure
      ? "Asana routing schema was ensured for the HQ intake form."
      : "Asana routing schema was inspected for the HQ intake form."
  };
}

function getAsanaIntakeFieldDefinitions(config) {
  return [
    {
      key: "requestType",
      name: config.fieldNames.requestType,
      options: ASANA_REQUEST_TYPE_OPTIONS
    },
    {
      key: "entity",
      name: config.fieldNames.entity,
      options: ASANA_ENTITY_OPTIONS
    },
    {
      key: "environment",
      name: config.fieldNames.environment,
      options: ASANA_ENVIRONMENT_OPTIONS
    }
  ];
}

async function listAsanaProjectSections(env, config) {
  return asanaRequest(env, `/projects/${config.projectGid}/sections?opt_fields=gid,name&limit=100`);
}

async function createAsanaProjectSection(env, config, name) {
  return asanaRequest(env, `/projects/${config.projectGid}/sections`, {
    method: "POST",
    body: JSON.stringify({ data: { name } })
  });
}

async function listAsanaProjectCustomFieldSettings(env, config) {
  return asanaRequest(env, `/projects/${config.projectGid}/custom_field_settings?opt_fields=custom_field.gid,custom_field.name,custom_field.resource_subtype,custom_field.type,custom_field.enum_options.gid,custom_field.enum_options.name,is_important&limit=100`);
}

async function listAsanaWorkspaceCustomFields(env, config) {
  if (!config.workspaceGid) return [];
  return asanaRequest(env, `/workspaces/${config.workspaceGid}/custom_fields?opt_fields=gid,name,resource_subtype,type,enum_options.gid,enum_options.name&limit=100`);
}

async function createAsanaEnumField(env, config, definition) {
  return asanaRequest(env, "/custom_fields", {
    method: "POST",
    body: JSON.stringify({
      data: {
        workspace: config.workspaceGid,
        name: definition.name,
        resource_subtype: "enum",
        enum_options: definition.options.map((option) => ({ name: option }))
      }
    })
  });
}

async function ensureAsanaEnumOptions(env, field, requiredOptions) {
  const existing = mapAsanaEnumOptions(field.enum_options || []);
  const enumOptions = Array.isArray(field.enum_options) ? [...field.enum_options] : [];

  for (const option of requiredOptions) {
    if (existing[normalizeAsanaName(option)]) continue;
    const created = await asanaRequest(env, `/custom_fields/${field.gid}/enum_options`, {
      method: "POST",
      body: JSON.stringify({ data: { name: option } })
    });
    enumOptions.push(created);
    existing[normalizeAsanaName(option)] = created?.gid || "";
  }

  return { ...field, enum_options: enumOptions };
}

async function ensureAsanaStatusField(env, config, projectFieldSettings, workspaceFields) {
  const definition = {
    key: "status",
    name: config.fieldNames.status,
    options: ASANA_STATUS_OPTIONS
  };
  const projectField = findAsanaField(projectFieldSettings, definition.name);
  let field = projectField.field || findAsanaField(workspaceFields, definition.name).field;
  let attached = Boolean(projectField.field);
  let created = false;

  if (!field) {
    field = await createAsanaEnumField(env, config, definition);
    created = true;
  }

  field = await ensureAsanaEnumOptions(env, field, definition.options);

  if (!attached) {
    await addAsanaCustomFieldToProject(env, config, field.gid);
    attached = true;
  }

  const options = mapAsanaEnumOptions(field.enum_options || []);
  return {
    gid: field.gid || "",
    name: field.name || definition.name,
    optionName: config.defaultStatusName,
    optionGid: options[normalizeAsanaName(config.defaultStatusName)] || "",
    attached,
    created
  };
}

async function addAsanaCustomFieldToProject(env, config, fieldGid) {
  await asanaRequest(env, `/projects/${config.projectGid}/addCustomFieldSetting`, {
    method: "POST",
    body: JSON.stringify({
      data: {
        custom_field: fieldGid,
        is_important: true
      }
    })
  });
}

function findAsanaField(collection, name) {
  const target = normalizeAsanaName(name);
  for (const item of collection || []) {
    const field = item?.custom_field || item;
    if (normalizeAsanaName(field?.name) === target) {
      return { field, setting: item?.custom_field ? item : null };
    }
  }
  return { field: null, setting: null };
}

function findAsanaNamedItem(collection, name) {
  const target = normalizeAsanaName(name);
  return (collection || []).find((item) => normalizeAsanaName(item?.name) === target) || null;
}

function findAsanaStatusField(projectFieldSettings, statusName, fieldName = "") {
  const target = normalizeAsanaName(statusName);
  const namedField = fieldName ? findAsanaField(projectFieldSettings, fieldName).field : null;
  if (namedField) {
    const options = mapAsanaEnumOptions(namedField.enum_options || []);
    if (options[target]) {
      return {
        gid: namedField.gid || "",
        name: namedField.name || fieldName,
        optionName: statusName,
        optionGid: options[target],
        attached: true,
        created: false
      };
    }
  }

  for (const item of projectFieldSettings || []) {
    const field = item?.custom_field || item;
    const options = mapAsanaEnumOptions(field?.enum_options || []);
    if (options[target]) {
      return {
        gid: field.gid || "",
        name: field.name || "Status",
        optionName: statusName,
        optionGid: options[target],
        attached: true,
        created: false
      };
    }
  }

  return {
    gid: "",
    name: "",
    optionName: statusName,
    optionGid: "",
    attached: false,
    created: false
  };
}

function mapAsanaEnumOptions(options) {
  return (options || []).reduce((map, option) => {
    const name = normalizeAsanaName(option?.name);
    if (name && option?.gid) map[name] = option.gid;
    return map;
  }, {});
}

function normalizeAsanaName(value) {
  return String(value || "").trim().toLowerCase();
}

async function resolveAsanaTicketType(env, config) {
  const customTypes = await listAsanaCustomTypes(env, config);
  const target = normalizeAsanaName(config.ticketTypeName || "Ticket");
  const type = customTypes.find((item) => normalizeAsanaName(item?.name) === target) || null;
  const detail = type?.gid ? await getAsanaCustomTypeDetail(env, type.gid).catch(() => null) : null;
  const statusOption = findAsanaCustomTypeStatusOption(detail || type, config.defaultStatusName);

  return {
    name: type?.name || config.ticketTypeName || "Ticket",
    gid: type?.gid || "",
    resolved: Boolean(type?.gid),
    statusOptionName: statusOption.name,
    statusOptionGid: statusOption.gid,
    attempted: true,
    warning: type?.gid ? "" : `No Asana custom type named ${config.ticketTypeName || "Ticket"} was found for ${config.projectName}.`
  };
}

async function getAsanaCustomTypeDetail(env, customTypeGid) {
  return asanaRequest(env, `/custom_types/${encodeURIComponent(customTypeGid)}?opt_fields=gid,name,resource_subtype,status_field.gid,status_field.name,status_field.enum_options.gid,status_field.enum_options.name,custom_type_status_options.gid,custom_type_status_options.name,status_options.gid,status_options.name,fields.gid,fields.name,fields.enum_options.gid,fields.enum_options.name`);
}

function findAsanaCustomTypeStatusOption(type, statusName) {
  const target = normalizeAsanaName(statusName || "New");
  const statusField = type?.status_field || {};
  const fields = Array.isArray(type?.fields) ? type.fields : [];
  const namedStatusField = fields.find((field) => normalizeAsanaName(field?.name) === "status") || null;
  const buckets = [
    type?.custom_type_status_options,
    type?.status_options,
    statusField.enum_options,
    namedStatusField?.enum_options
  ];
  const options = buckets.flatMap((bucket) => Array.isArray(bucket) ? bucket : []);
  const option = options.find((item) => normalizeAsanaName(item?.name) === target) || null;

  return {
    name: option?.name || statusName || "New",
    gid: option?.gid || ""
  };
}

async function listAsanaCustomTypes(env, config) {
  if (!config.projectGid) return [];

  const paths = [
    `/custom_types?project=${encodeURIComponent(config.projectGid)}&opt_fields=gid,name,enabled,resource_subtype&limit=100`,
    `/projects/${encodeURIComponent(config.projectGid)}/custom_types?opt_fields=gid,name,enabled,resource_subtype&limit=100`
  ];
  const errors = [];

  for (const path of paths) {
    try {
      return await asanaRequest(env, path);
    } catch (error) {
      errors.push(sanitizePlainText(error?.message || "unknown error", 180));
    }
  }

  throw new Error(`Asana custom type lookup failed: ${errors.join(" | ")}`);
}

async function resolveAsanaAssignee(env, config) {
  if (config.defaultAssigneeGid) {
    return {
      gid: config.defaultAssigneeGid,
      name: config.defaultAssigneeName,
      email: config.defaultAssigneeEmail,
      resolved: true
    };
  }

  const users = await listAsanaWorkspaceUsers(env, config);
  const emailTarget = normalizeAsanaName(config.defaultAssigneeEmail);
  const nameTarget = normalizeAsanaName(config.defaultAssigneeName);
  const user = users.find((item) => normalizeAsanaName(item.email) === emailTarget)
    || users.find((item) => normalizeAsanaName(item.name) === nameTarget);

  return {
    gid: user?.gid || "",
    name: user?.name || config.defaultAssigneeName,
    email: user?.email || config.defaultAssigneeEmail,
    resolved: Boolean(user?.gid),
    warning: user?.gid ? "" : `Could not resolve ${config.defaultAssigneeName} in Asana workspace users.`
  };
}

async function listAsanaWorkspaceUsers(env, config) {
  if (!config.workspaceGid) return [];

  const users = [];
  let path = `/workspaces/${config.workspaceGid}/users?opt_fields=gid,name,email&limit=100`;
  for (let page = 0; page < 8 && path; page += 1) {
    const payload = await asanaFetchJson(env, path);
    users.push(...(payload.data || []));
    path = payload.next_page?.path || "";
  }
  return users;
}

async function asanaRequest(env, path, options = {}) {
  const payload = await asanaFetchJson(env, path, options);
  return payload.data || [];
}

async function asanaFetchJson(env, path, options = {}) {
  const response = await fetch(asanaApiUrl(path), {
    method: options.method || "GET",
    headers: {
      authorization: `Bearer ${env.ASANA_ACCESS_TOKEN}`,
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json; charset=utf-8" } : {})
    },
    body: options.body
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.errors) {
    throw new Error(formatAsanaApiError(response, payload));
  }

  return payload;
}

function asanaApiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("/api/1.0/")) return `https://app.asana.com${path}`;
  return `https://app.asana.com/api/1.0${path.startsWith("/") ? path : `/${path}`}`;
}

function formatAsanaApiError(response, payload) {
  const detail = Array.isArray(payload.errors)
    ? payload.errors.map((error) => error.message).filter(Boolean).join("; ")
    : payload.message || "";
  return `Asana API failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}.`;
}

function sanitizeAsanaIntake(body = {}) {
  const relatedTicket = sanitizePrompt(body.relatedTicket || body.ticket || "", 80).toUpperCase();
  const sourceUrl = sanitizeUrl(body.sourceUrl || body.url || "");
  const requestType = pickAsanaOption(body.requestType, ASANA_REQUEST_TYPE_OPTIONS, "QA support request");
  const entity = pickAsanaOption(body.entity, ASANA_ENTITY_OPTIONS, "GolfNow CORE");
  const environment = pickAsanaOption(body.environment || body.env, ASANA_ENVIRONMENT_OPTIONS, "DEV TN000");
  const priority = sanitizePlainText(body.priority || "Normal", 40);
  const requester = sanitizePlainText(body.requester || "HQ user", 120);
  const summary = sanitizePlainText(body.summary || body.title || "", 180);
  const details = sanitizePlainText(body.details || body.description || "", 4000);

  return {
    summary,
    details,
    requestType,
    entity,
    environment,
    priority,
    requester,
    relatedTicket,
    sourceUrl
  };
}

function pickAsanaOption(value, options, fallback) {
  const normalized = normalizeAsanaName(value);
  return options.find((option) => normalizeAsanaName(option) === normalized) || fallback;
}

function buildAsanaTaskPayload(config, intake, jiraHandoff, routing = null, assignee = null, ticketType = null, options = {}) {
  const customFields = buildAsanaCustomFieldValues(config, intake, routing);
  const assigneeId = assignee?.gid || config.defaultAssigneeGid;
  const data = {
    workspace: config.workspaceGid,
    projects: [config.projectGid],
    name: intake.summary,
    notes: buildAsanaNotes(config, intake, jiraHandoff)
  };

  if (assigneeId) {
    data.assignee = assigneeId;
  }

  if (options.createNativeTicket && ticketType?.gid) {
    data.resource_subtype = "custom";
    data.custom_type = ticketType.gid;
    if (ticketType.statusOptionGid) {
      data.custom_type_status_option = ticketType.statusOptionGid;
    }
  }

  if (Object.keys(customFields).length) {
    data.custom_fields = customFields;
  }

  return {
    data
  };
}

function buildAsanaCustomFieldValues(config, intake, routing) {
  const fields = {};
  if (!routing) return fields;

  if (routing.statusField?.gid && routing.statusField?.optionGid) {
    fields[routing.statusField.gid] = routing.statusField.optionGid;
  }

  for (const definition of getAsanaIntakeFieldDefinitions(config)) {
    const field = routing.intakeFields?.[definition.key];
    const selected = intake[definition.key];
    const option = (field?.options || []).find((item) =>
      normalizeAsanaName(item.name) === normalizeAsanaName(selected)
    );
    if (field?.gid && option?.gid) {
      fields[field.gid] = option.gid;
    }
  }

  return fields;
}

function buildAsanaNotes(config, intake, jiraHandoff) {
  return [
    "CORE QA HQ intake",
    "",
    `Project: ${config.projectName} (${config.projectGid})`,
    `Requester: ${intake.requester}`,
    `Request type: ${intake.requestType}`,
    `Entity: ${intake.entity}`,
    `Environment: ${intake.environment}`,
    `Priority: ${intake.priority}`,
    `Default assignee: ${config.defaultAssigneeName}`,
    `Default section: ${config.defaultSectionName}`,
    intake.relatedTicket ? `Related ticket: ${intake.relatedTicket}` : "",
    intake.sourceUrl ? `Source URL: ${intake.sourceUrl}` : "",
    "",
    "Jira handoff:",
    jiraHandoff.canCreate
      ? "HQ is configured for direct Jira issue creation."
      : "HQ prepared a manual Jira handoff because Jira Worker credentials are not configured.",
    jiraHandoff.url ? `Jira URL: ${jiraHandoff.url}` : "",
    "",
    "Details:",
    intake.details || "No additional details were provided."
  ].filter((line) => line !== "").join("\n");
}

async function createAsanaTask(env, config, intake, jiraHandoff) {
  const routing = await ensureAsanaRouting(env, config, { ensure: true });
  const assignee = await resolveAsanaAssignee(env, config);
  let ticketType = {
    name: config.ticketTypeName || "Ticket",
    gid: "",
    resolved: false,
    attempted: false
  };
  try {
    ticketType = await resolveAsanaTicketType(env, config);
  } catch (error) {
    ticketType = {
      name: config.ticketTypeName || "Ticket",
      gid: "",
      resolved: false,
      attempted: true,
      warning: sanitizePlainText(error?.message || "Asana ticket type lookup failed.", 260)
    };
  }
  let payload = {};
  let createMode = "project-section-fallback";
  let nativeTicketWarning = "";

  const requestPayload = buildAsanaTaskPayload(config, intake, jiraHandoff, routing, assignee);
  payload = await postAsanaTask(env, requestPayload);

  if (ticketType.gid && payload.data?.gid) {
    try {
      await convertAsanaTaskToNativeTicket(env, payload.data.gid, ticketType);
      createMode = "native-ticket-converted";
      nativeTicketWarning = "";
    } catch (error) {
      nativeTicketWarning = `Asana native Ticket conversion failed: ${sanitizePlainText(error?.message || "unknown error", 260)}`;
    }
  }

  const taskGid = payload.data?.gid || "";
  const sectionPlacement = taskGid && routing.section?.gid
    ? await placeAsanaTaskInSection(env, routing.section.gid, taskGid)
    : { ok: false, warning: `Asana ticket could not be placed in ${config.defaultSectionName} because the section was not resolved.` };
  const warnings = [
    ...(routing.warnings || []),
    nativeTicketWarning,
    assignee.warning,
    sectionPlacement.warning
  ].filter(Boolean);

  return {
    gid: payload.data?.gid || "",
    name: payload.data?.name || intake.summary,
    url: payload.data?.permalink_url || `https://app.asana.com/0/${config.projectGid}`,
    projectName: config.projectName,
    workspaceGid: config.workspaceGid,
    projectGid: config.projectGid,
    section: routing.section,
    ticketType: {
      gid: ticketType.gid || "",
      name: ticketType.name || config.ticketTypeName,
      resolved: Boolean(ticketType.gid),
      statusOptionName: ticketType.statusOptionName || config.defaultStatusName,
      statusOptionGid: ticketType.statusOptionGid || "",
      applied: createMode === "native-ticket" || createMode === "native-ticket-converted",
      mode: createMode,
      message: createMode === "native-ticket" || createMode === "native-ticket-converted"
        ? "Created with Asana's native Ticket custom type so the item should appear in the visible New ticket grouping."
        : "Asana rejected native Ticket creation on this route, so HQ created the item normally and placed it in the New project section."
    },
    statusField: routing.statusField,
    defaultAssignee: assignee,
    customFieldsApplied: summarizeAsanaAppliedFields(config, intake, routing),
    warnings
  };
}

async function convertAsanaTaskToNativeTicket(env, taskGid, ticketType) {
  const baseData = {
    resource_subtype: "custom",
    custom_type: ticketType.gid
  };
  const attempts = ticketType.statusOptionGid
    ? [
        { ...baseData, custom_type_status_option: ticketType.statusOptionGid },
        baseData
      ]
    : [baseData];
  const errors = [];

  for (const data of attempts) {
    try {
      return await updateAsanaTask(env, taskGid, { data });
    } catch (error) {
      errors.push(sanitizePlainText(error?.message || "unknown error", 220));
    }
  }

  throw new Error(errors.join(" | "));
}

async function updateAsanaTask(env, taskGid, requestPayload) {
  const response = await fetch(`https://app.asana.com/api/1.0/tasks/${encodeURIComponent(taskGid)}?opt_fields=gid,name,permalink_url,created_at`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${env.ASANA_ACCESS_TOKEN}`,
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(requestPayload)
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok || payload.errors) {
    const detail = Array.isArray(payload.errors)
      ? payload.errors.map((error) => error.message).filter(Boolean).join("; ")
      : "";
    throw new Error(`Asana task update failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}.`);
  }

  return payload;
}

async function postAsanaTask(env, requestPayload) {
  const response = await fetch("https://app.asana.com/api/1.0/tasks?opt_fields=gid,name,permalink_url,created_at", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.ASANA_ACCESS_TOKEN}`,
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(requestPayload)
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok || payload.errors) {
    const detail = Array.isArray(payload.errors)
      ? payload.errors.map((error) => error.message).filter(Boolean).join("; ")
      : "";
    throw new Error(`Asana ticket creation failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}.`);
  }

  return payload;
}

async function placeAsanaTaskInSection(env, sectionGid, taskGid) {
  try {
    await asanaRequest(env, `/sections/${sectionGid}/addTask`, {
      method: "POST",
      body: JSON.stringify({ data: { task: taskGid } })
    });
    return { ok: true, warning: "" };
  } catch (error) {
    return {
      ok: false,
      warning: sanitizePlainText(error?.message || "Asana section placement failed.", 260)
    };
  }
}

function summarizeAsanaAppliedFields(config, intake, routing) {
  const fields = [];
  if (routing?.statusField?.gid && routing?.statusField?.optionGid) {
    fields.push({
      name: routing.statusField.name,
      value: routing.statusField.optionName
    });
  }

  for (const definition of getAsanaIntakeFieldDefinitions(config)) {
    const field = routing?.intakeFields?.[definition.key];
    if (field?.gid) {
      fields.push({
        name: field.name,
        value: intake[definition.key]
      });
    }
  }

  return fields;
}

function getJiraIntakeConfig(env) {
  const siteUrl = sanitizeUrl(env.JIRA_SITE_URL || "https://golfnow.atlassian.net").replace(/\/$/, "");
  const projectKey = sanitizePrompt(env.JIRA_INTAKE_PROJECT_KEY || env.JIRA_PROJECT_KEY || "CORE", 24).toUpperCase();
  const issueType = sanitizePlainText(env.JIRA_INTAKE_ISSUE_TYPE || "Task", 60);
  const email = sanitizePlainText(env.JIRA_EMAIL || "", 160);
  const token = env.JIRA_MCP_TOKEN || env.JIRA_API_TOKEN || "";

  return {
    siteUrl,
    projectKey,
    issueType,
    email,
    token,
    canCreate: Boolean(siteUrl && projectKey && issueType && email && token)
  };
}

function buildJiraHandoff(env, intake) {
  const jira = getJiraIntakeConfig(env);
  const summary = `[HQ Intake] ${intake.summary}`;
  const description = [
    `Asana/HQ intake request from ${intake.requester}.`,
    "",
    `Type: ${intake.requestType}`,
    `Entity: ${intake.entity}`,
    `Environment: ${intake.environment}`,
    `Priority: ${intake.priority}`,
    intake.relatedTicket ? `Related ticket: ${intake.relatedTicket}` : "",
    intake.sourceUrl ? `Source URL: ${intake.sourceUrl}` : "",
    "",
    intake.details || "No additional details were provided."
  ].filter((line) => line !== "").join("\n");

  return {
    mode: jira.canCreate ? "direct-create" : "manual-handoff",
    canCreate: jira.canCreate,
    projectKey: jira.projectKey,
    issueType: jira.issueType,
    summary,
    description,
    url: `${jira.siteUrl}/jira/software/c/projects/${encodeURIComponent(jira.projectKey)}/issues`,
    message: jira.canCreate
      ? "HQ will attempt to create a Jira issue with configured Worker Jira credentials."
      : "Jira Worker credentials are not configured; HQ returns this copy-ready Jira handoff."
  };
}

async function createJiraIntakeIfConfigured(env, intake, asanaTask) {
  const jira = getJiraIntakeConfig(env);

  if (!jira.canCreate) {
    return {
      issue: null,
      warning: ""
    };
  }

  const summary = `[HQ Intake] ${intake.summary}`;
  const lines = [
    `Asana ticket: ${asanaTask.url || asanaTask.name}`,
    `Requester: ${intake.requester}`,
    `Request type: ${intake.requestType}`,
    `Entity: ${intake.entity}`,
    `Environment: ${intake.environment}`,
    `Priority: ${intake.priority}`,
    intake.relatedTicket ? `Related ticket: ${intake.relatedTicket}` : "",
    intake.sourceUrl ? `Source URL: ${intake.sourceUrl}` : "",
    "",
    intake.details || "No additional details were provided."
  ].filter((line) => line !== "");

  try {
    const response = await fetch(`${jira.siteUrl}/rest/api/3/issue`, {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${jira.email}:${jira.token}`)}`,
        accept: "application/json",
        "content-type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        fields: {
          project: { key: jira.projectKey },
          issuetype: { name: jira.issueType },
          summary,
          description: buildJiraAdf(lines),
          labels: ["core-qa-hq", "asana-intake"]
        }
      })
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload.errors) {
      const detail = payload.errorMessages?.join("; ") || Object.values(payload.errors || {}).join("; ") || payload.message || "unknown Jira error";
      return {
        issue: null,
        warning: `Jira direct create failed with HTTP ${response.status}: ${detail}`
      };
    }

    const key = payload.key || "";
    return {
      issue: {
        mode: "direct-create",
        key,
        url: key ? `${jira.siteUrl}/browse/${key}` : `${jira.siteUrl}/jira/software/c/projects/${encodeURIComponent(jira.projectKey)}/issues`,
        projectKey: jira.projectKey,
        issueType: jira.issueType,
        summary
      },
      warning: ""
    };
  } catch (error) {
    return {
      issue: null,
      warning: `Jira direct create failed: ${error.message}`
    };
  }
}

function buildJiraAdf(lines) {
  return {
    type: "doc",
    version: 1,
    content: lines.map((line) => ({
      type: "paragraph",
      content: line
        ? [{ type: "text", text: line }]
        : []
    }))
  };
}

async function notifyAsanaIntakeSlack(env, intake, asanaTask, jiraResult) {
  const config = getSlackConfig(env);

  if (!config.channelConfigured) {
    return {
      ok: false,
      warning: "Slack channel is not configured for Asana intake notifications."
    };
  }

  if (!config.tokenConfigured) {
    return {
      ok: false,
      warning: "SLACK_BOT_TOKEN is not configured, so the Asana intake Slack notification was skipped."
    };
  }

  const slackPayload = {
    channel: config.channel,
    text: buildAsanaSlackMessage(env, intake, asanaTask, jiraResult),
    blocks: buildAsanaSlackCardBlocks(env, intake, asanaTask, jiraResult),
    unfurl_links: false,
    unfurl_media: false
  };
  const { response, payload } = await postSlackMessage(env, slackPayload);

  if (!response.ok || !payload.ok) {
    return {
      ok: false,
      status: response.status,
      slackError: payload.error || "unknown_error",
      warning: formatSlackError(payload.error, response.status)
    };
  }

  const asanaAppPreview = await notifyAsanaSlackAppPreview(env, config, asanaTask);

  return {
    ok: true,
    channel: payload.channel || config.channel,
    ts: payload.ts || "",
    asanaAppPreview,
    warning: asanaAppPreview.warning || ""
  };
}

async function notifyAsanaSlackAppPreview(env, config, asanaTask) {
  const asanaUrl = buildAsanaSlackPreviewUrl(asanaTask);

  if (!asanaUrl) {
    return {
      ok: false,
      mode: "missing-asana-url",
      warning: "Asana app preview was skipped because the created ticket did not include a public Asana URL."
    };
  }

  const previewPayload = {
    channel: config.channel,
    text: asanaUrl,
    unfurl_links: true,
    unfurl_media: true
  };
  const { response, payload } = await postSlackMessage(env, previewPayload);

  if (!response.ok || !payload.ok) {
    return {
      ok: false,
      mode: "raw-link-unfurl-request",
      status: response.status,
      slackError: payload.error || "unknown_error",
      warning: `Asana app preview link could not be posted: ${formatSlackError(payload.error, response.status)}`
    };
  }

  return {
    ok: true,
    mode: "raw-link-unfurl-request",
    url: asanaUrl,
    channel: payload.channel || config.channel,
    ts: payload.ts || "",
    warning: ""
  };
}

function buildAsanaSlackPreviewUrl(asanaTask) {
  const permalink = sanitizeUrl(asanaTask?.url || "");
  if (permalink) return permalink;

  const taskGid = sanitizeAsanaGid(asanaTask?.gid || "");
  const workspaceGid = sanitizeAsanaGid(asanaTask?.workspaceGid || "");
  const projectGid = sanitizeAsanaGid(asanaTask?.projectGid || "");

  if (taskGid && workspaceGid && projectGid) {
    return `https://app.asana.com/1/${workspaceGid}/project/${projectGid}/task/${taskGid}`;
  }

  if (taskGid && projectGid) {
    return `https://app.asana.com/0/${projectGid}/${taskGid}`;
  }

  return "";
}

function sanitizeAsanaGid(value) {
  return String(value || "").trim().replace(/[^\d]/g, "").slice(0, 32);
}

function buildAsanaSlackMessage(env, intake, asanaTask, jiraResult) {
  const mention = sanitizeSlackMessage(env.ASANA_INTAKE_SLACK_MENTION || "Dewan Kabir");
  const asanaLink = asanaTask?.url ? `<${asanaTask.url}|${asanaTask.name || "Asana ticket"}>` : (asanaTask?.name || "Asana ticket");
  const jiraLink = jiraResult?.url ? `<${jiraResult.url}|${jiraResult.key || jiraResult.projectKey || "Jira handoff"}>` : "Jira handoff not configured";
  const related = intake.relatedTicket ? `\n*Related ticket:* ${intake.relatedTicket}` : "";
  const source = intake.sourceUrl ? `\n*Source:* ${intake.sourceUrl}` : "";

  return [
    "*CORE QA HQ intake opened*",
    mention ? `*Notify:* ${mention}` : "",
    `*Summary:* ${intake.summary}`,
    `*Type:* ${intake.requestType}`,
    `*Entity:* ${intake.entity}`,
    `*Environment:* ${intake.environment}`,
    `*Priority:* ${intake.priority}`,
    related.trim(),
    source.trim(),
    `*Asana:* ${asanaLink}`,
    `*Jira:* ${jiraLink}`,
    intake.details ? `*Details:* ${truncateText(intake.details, 650)}` : ""
  ].filter(Boolean).join("\n");
}

function buildAsanaSlackCardBlocks(env, intake, asanaTask, jiraResult) {
  const asanaUrl = sanitizeUrl(asanaTask?.url || "");
  const canonicalAsanaUrl = buildAsanaSlackPreviewUrl(asanaTask) || asanaUrl;
  const jiraUrl = sanitizeUrl(jiraResult?.url || "");
  const assignee = asanaTask?.defaultAssignee?.name || env.ASANA_DEFAULT_ASSIGNEE_NAME || "Dewan Kabir";
  const sourceUrl = sanitizeUrl(intake.sourceUrl || "");
  const hqUrl = sanitizeUrl(env.CLOUDFLARE_HQ_URL || env.MORDERN_HQ_URL || "");
  const fields = [
    buildSlackField("Assignee", assignee),
    buildSlackField("Priority", intake.priority),
    buildSlackField("Request type", intake.requestType),
    buildSlackField("Entity", intake.entity),
    buildSlackField("Environment", intake.environment),
    buildSlackField("Project", asanaTask?.projectName || env.ASANA_PROJECT_NAME || "GN CORE QA HQ")
  ];
  const buttons = [
    canonicalAsanaUrl ? buildSlackButton("View task in Asana", canonicalAsanaUrl, "primary") : null,
    jiraUrl ? buildSlackButton("Open Jira handoff", jiraUrl) : null,
    hqUrl ? buildSlackButton("Open HQ", hqUrl) : null,
    sourceUrl ? buildSlackButton("Source", sourceUrl) : null
  ].filter(Boolean).slice(0, 5);

  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: truncateSlackPlainText("CORE QA HQ intake opened", 150),
        emoji: true
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*${asanaUrl ? buildSlackLink(asanaUrl, asanaTask?.name || intake.summary) : escapeSlackMrkdwn(asanaTask?.name || intake.summary)}*`,
          intake.details ? escapeSlackMrkdwn(truncateText(intake.details, 450)) : "_No details provided._"
        ].join("\n")
      }
    },
    { type: "section", fields },
    intake.relatedTicket
      ? {
          type: "context",
          elements: [{ type: "mrkdwn", text: `Related ticket: *${escapeSlackMrkdwn(intake.relatedTicket)}*` }]
        }
      : null,
    buttons.length ? { type: "actions", elements: buttons } : null,
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Asana app trigger: ${canonicalAsanaUrl ? buildSlackLink(canonicalAsanaUrl, "canonical task link") : "not available"}`
        }
      ]
    }
  ].filter(Boolean);
}

function buildSlackField(label, value) {
  return {
    type: "mrkdwn",
    text: `*${escapeSlackMrkdwn(label)}*\n${escapeSlackMrkdwn(value || "None")}`
  };
}

function buildSlackButton(label, url, style = "") {
  const button = {
    type: "button",
    text: {
      type: "plain_text",
      text: truncateSlackPlainText(label, 75),
      emoji: true
    },
    url
  };

  if (style) {
    button.style = style;
  }

  return button;
}

function buildSlackLink(url, label) {
  const cleanUrl = sanitizeUrl(url);
  const cleanLabel = escapeSlackMrkdwn(label || cleanUrl || "Open link").replace(/\|/g, "-");
  return cleanUrl ? `<${cleanUrl}|${cleanLabel}>` : cleanLabel;
}

function escapeSlackMrkdwn(value) {
  return sanitizeSlackMessage(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncateSlackPlainText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
}

function sanitizeExternalId(value) {
  return String(value || "").trim().replace(/[^\w:-]/g, "").slice(0, 140);
}

function sanitizePlainText(value, maxLength = 1000) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function sanitizeUrl(value) {
  const text = String(value || "").trim().slice(0, 500);
  if (!text) return "";

  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

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
            "You are the CORE QA Headquarters ticket and sprint chat agent for a QA team.",
            "Return only valid JSON. Do not include Markdown.",
            "Write in a warm, useful, conversational tone. Make answers feel like a helpful QA teammate, not a database dump.",
            "Use only the provided dashboard context, exactMatches, release issues, and sprint issues.",
            "If conversationIntent is greeting, help, or thanks, respond naturally and do not summarize the board unless the user asked for board facts.",
            "If exactLookup is present, answer that exact question and do not invent additional matching tickets.",
            "If the user asks about sprint, use sprintContext first. If the user does not mention sprint, use releaseContext first.",
            "Always include useful ticket keys, Jira links, status, priority, assignee, and assigned developer when tickets are relevant.",
            "If the answer is a count, state the exact count and the scope used.",
            "For leadership-style prompts, use a crisp executive summary and keep the ticket list easy to copy.",
            "For followUps, suggest short natural follow-up questions the user can click.",
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
    const warning = context.exactLookup || context.conversationIntent
      ? ""
      : `AI chat response was not usable, so HQ returned a deterministic board-data answer: ${error.message}`;
    return jsonResponse(buildChatPayload({
      dashboard,
      context,
      answer: fallback,
      provider: "Cloudflare Workers AI",
      model: AI_MODEL,
      warning
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
  const { response, source, warning } = await fetchLiveArtifactResponse(new Request(dataUrl.toString(), {
    method: "GET",
    headers: { accept: "application/json" }
  }), env, "/dashboard-data.json", dataUrl);

  if (!response.ok) {
    throw new Error(`Unable to load dashboard-data.json from ${source}: HTTP ${response.status}${warning ? ` (${warning})` : ""}`);
  }

  const dashboard = await response.json();
  dashboard.artifactRuntime = {
    source,
    fallbackWarning: warning || "",
    loadedAt: new Date().toISOString()
  };
  return dashboard;
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
    modelProfile: model === AI_MODEL ? AI_MODEL_PROFILE : "",
    generatedAt: new Date().toISOString(),
    release: dashboard.version || "v3001.124.0",
    scope: context.scope,
    conversationIntent: context.conversationIntent || "",
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

function detectChatConversationIntent(message) {
  const prompt = String(message || "").trim().toLowerCase();
  const compact = prompt.replace(/[\s!.?,;:]+/g, " ").trim();

  if (!compact) {
    return "";
  }

  if (/^(hi|hello|hey|hey there|hiya|yo|good morning|good afternoon|good evening)$/.test(compact)) {
    return "greeting";
  }

  if (/^(thanks|thank you|thx|ok|okay|cool|awesome|got it|perfect)$/.test(compact)) {
    return "thanks";
  }

  if (/\b(what can you do|how do i use|how can i use|help me|help|who are you|what are you)\b/.test(prompt)) {
    return "help";
  }

  return "";
}

function buildAiChatContext(dashboard, stats, message, history) {
  const releaseIssues = Array.isArray(dashboard.issues) ? dashboard.issues : [];
  const sprintIssues = Array.isArray(dashboard.sprintView?.issues) ? dashboard.sprintView.issues : [];
  const conversationIntent = detectChatConversationIntent(message);
  const scopeKind = chooseChatScope(message);
  const scopeIssues = scopeKind === "sprint" && sprintIssues.length ? sprintIssues : releaseIssues;
  const scope = buildChatScope(dashboard, scopeKind, scopeIssues);
  const exactLookup = conversationIntent ? null : buildChatExactLookup(message, scopeIssues, scope, dashboard);
  const relevantIssues = conversationIntent
    ? []
    : exactLookup
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
    task: conversationIntent
      ? "Answer a short conversational CORE QA HQ chat message without forcing a board report."
      : "Answer a conversational CORE QA HQ question about release tickets or sprint tickets.",
    userMessage: message,
    conversationIntent,
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
      "If conversationIntent is greeting/help/thanks, do not invent ticket analysis; explain what the HQ AI can do and invite the next ticket or sprint question.",
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

  const topicLookup = extractTopicLookup(message);

  if (topicLookup) {
    const matches = findTopicMatches(cleanIssues, topicLookup);
    return buildExactLookupResult({
      type: "topic",
      label: `${topicLookup.displayName} related tickets`,
      matches,
      scope,
      reasonForIssue: (issue) => formatTopicMatchReason(issue, topicLookup)
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

function extractTopicLookup(message) {
  const tokens = getChatSearchTokens(message);

  if (!tokens.length) {
    return null;
  }

  if (tokens.length === 1 && tokens[0].length < 4) {
    return null;
  }

  return {
    type: "topic",
    query: tokens.join(" "),
    tokens,
    displayName: formatTopicDisplayName(tokens)
  };
}

function findTopicMatches(issues, topicLookup) {
  const tokens = topicLookup?.tokens || [];
  const normalizedQuery = topicLookup?.query || "";
  const requiredTokenMatches = tokens.length <= 2
    ? tokens.length
    : Math.max(2, Math.ceil(tokens.length * 0.66));

  return (Array.isArray(issues) ? issues : [])
    .map((issue) => {
      const haystack = buildTopicHaystack(issue);
      const tokenMatches = tokens.filter((token) => haystack.includes(token));
      const phraseMatch = normalizedQuery && haystack.includes(normalizedQuery);
      const score = tokenMatches.length + (phraseMatch ? tokens.length + 2 : 0);

      return {
        issue,
        score,
        tokenMatches: tokenMatches.length
      };
    })
    .filter((record) => record.score > 0 && (record.tokenMatches >= requiredTokenMatches || record.score > tokens.length))
    .sort((a, b) => b.score - a.score || sortIssuesForLookup(a.issue, b.issue))
    .map((record) => record.issue);
}

function buildTopicHaystack(issue) {
  return normalizeName([
    issue.key,
    issue.summary,
    issue.description,
    issue.status,
    issue.priority,
    issue.assignee,
    issue.assignedDeveloper,
    issue.type,
    ...(issue.components || []),
    ...(issue.fixVersions || []),
    ...getIssueSprintNames(issue),
    ...(issue.comments || []).map((comment) => comment?.body || comment?.text || "")
  ].filter(Boolean).join(" "));
}

function formatTopicMatchReason(issue, topicLookup) {
  const fields = [];
  const normalizedQuery = topicLookup?.query || "";
  const tokens = topicLookup?.tokens || [];
  const matchesField = (value) => {
    const normalized = normalizeName(value);
    return normalizedQuery && normalized.includes(normalizedQuery)
      || tokens.length && tokens.every((token) => normalized.includes(token));
  };

  if (matchesField(issue.summary)) fields.push("summary");
  if (matchesField(issue.description)) fields.push("description");
  if ((issue.components || []).some(matchesField)) fields.push("components");
  if ((issue.comments || []).some((comment) => matchesField(comment?.body || comment?.text || ""))) fields.push("comments");

  return `${issue.key} matched ${topicLookup.displayName} in ${fields.length ? fields.join(", ") : "ticket text"}.`;
}

function formatTopicDisplayName(tokens) {
  const acronyms = new Set(["api", "qa", "ui", "id", "gn", "ez", "etl", "ssl"]);
  return tokens.map((token) => {
    if (acronyms.has(token)) {
      return token.toUpperCase();
    }

    return token.charAt(0).toUpperCase() + token.slice(1);
  }).join(" ");
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
      ...getIssueSprintNames(issue)
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
  const stopWords = new Set(["about", "above", "active", "after", "again", "against", "all", "any", "are", "assigned", "assignee", "backlog", "before", "board", "can", "component", "components", "could", "count", "current", "developer", "does", "find", "for", "from", "give", "have", "has", "how", "into", "issue", "issues", "item", "items", "jira", "list", "many", "need", "number", "please", "priorities", "priority", "pull", "qa", "related", "release", "show", "sprint", "status", "statuses", "summarize", "summary", "tell", "that", "the", "there", "this", "ticket", "tickets", "what", "when", "where", "which", "with", "work"]);
  return Array.from(new Set(normalizeName(message)
    .split(" ")
    .filter((token) => token.length > 2 && !stopWords.has(token))));
}

function getIssueSprintNames(issue) {
  const names = [
    ...(Array.isArray(issue?.sprintNames) ? issue.sprintNames : []),
    ...(Array.isArray(issue?.sprints) ? issue.sprints.map((sprint) => sprint?.name || sprint?.label || "") : [])
  ];

  return Array.from(new Set(names.filter((name) => typeof name === "string" && name.trim()).map((name) => name.trim())));
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
    sprintNames: getIssueSprintNames(issue),
    parent: issue.parent?.key || "",
    reason
  };
}

function buildDeterministicChatAnswer(context, dashboard) {
  const scope = context.scope;
  const exact = context.exactLookup;
  const sprint = buildChatSprintSummary(context.sprintContext);

  if (context.conversationIntent) {
    return buildConversationalChatAnswer(context, dashboard);
  }

  if (exact) {
    const tickets = exact.matchedIssues || [];
    const count = Number(exact.count || 0);
    const previewLimit = 100;
    const visibleTickets = tickets.slice(0, previewLimit);
    const firstTicket = visibleTickets[0];

    return {
      answer: count === 1 && firstTicket
        ? `I found 1 matching ticket for ${exact.label} in ${scope.label}: ${firstTicket.key} - ${firstTicket.summary}. It is ${firstTicket.priority || "unprioritized"} in ${firstTicket.status || "Unknown"}, assigned to ${firstTicket.assignee || "Unassigned"}, with ${firstTicket.assignedDeveloper || "Unassigned"} as assigned developer.`
        : count
        ? `I found ${count} matching ticket${count === 1 ? "" : "s"} for ${exact.label} in ${scope.label}. The linked table below is filtered directly from the board artifact.`
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

function buildConversationalChatAnswer(context, dashboard) {
  const release = context.releaseContext || {};
  const sprint = context.sprintContext || {};
  const pulledAt = context.scope?.pulledAt || dashboard.pulledAtDisplay || dashboard.pulledAt || "the latest deployed artifact";
  const samples = [
    "How many P0 tickets are in the current release?",
    "Give me a leadership-ready rundown of the main tickets.",
    "Which Sprint 2026.8 tickets are assigned to Nicole?",
    "Show Reservation component tickets with status and priority."
  ];

  if (context.conversationIntent === "thanks") {
    return {
      answer: "You got it. I am here when you need the next ticket, sprint, component, or leadership summary.",
      highlights: [
        `Current release context: ${release.label || "release"} has ${release.mainTickets || 0} main tickets.`,
        `Sprint context: ${sprint.label || "Sprint 2026.8"} has ${sprint.total || 0} work items.`,
        `Latest artifact pull: ${pulledAt}.`
      ],
      tickets: [],
      sprint: buildChatSprintSummary(context.sprintContext),
      followUps: samples,
      sourceNotes: [
        "Source: dashboard-data.json from the deployed HQ Worker assets.",
        "No Jira, Slack, or automation mutation was performed."
      ]
    };
  }

  const answer = context.conversationIntent === "help"
    ? "I can answer questions about release tickets, Sprint 2026.8, priorities, assignees, assigned developers, components, statuses, and leadership-ready summaries from the deployed board artifact."
    : "Hi. I am the CORE QA HQ assistant. Ask me about the active release, Sprint 2026.8, ticket ownership, priorities, components, or anything you need turned into a copy-ready QA summary.";

  return {
    answer,
    highlights: [
      `Release data loaded: ${release.label || dashboard.version || "current release"} with ${release.mainTickets || 0} main tickets and ${release.subtasks || 0} subtasks.`,
      `Sprint data loaded: ${sprint.label || "Sprint view"} with ${sprint.total || 0} work items.`,
      `Latest artifact pull: ${pulledAt}.`
    ],
    tickets: [],
    sprint: buildChatSprintSummary(context.sprintContext),
    followUps: samples,
    sourceNotes: [
      "Source: dashboard-data.json from the deployed HQ Worker assets.",
      "Ask a ticket, priority, assignee, component, status, or sprint question for a linked ticket table.",
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
  const exactAnswerMissesTickets = Boolean(exactTickets?.length)
    && !exactTickets.slice(0, 5).some((ticket) => rawAnswer.toUpperCase().includes(String(ticket.key || "").toUpperCase()));

  return {
    answer: exactAnswerTooThin || exactAnswerMissesTickets ? fallback.answer : asString(answer.answer, fallback.answer),
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
  const value = aiResult?.response
    ?? aiResult?.result
    ?? aiResult?.choices?.[0]?.message?.content
    ?? aiResult?.choices?.[0]?.text
    ?? aiResult;

  if (typeof value === "string") {
    return JSON.parse(extractJsonPayload(value));
  }

  if (value && typeof value === "object") {
    return value;
  }

  throw new Error("Cloudflare Workers AI returned an empty response.");
}

function extractJsonPayload(value) {
  const text = String(value || "").trim();

  if (!text) {
    return text;
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstObject = text.indexOf("{");
  const lastObject = text.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) {
    return text.slice(firstObject, lastObject + 1);
  }

  return text;
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

function buildWorkerStatus(env) {
  return {
    ok: true,
    app: "CORE QA Legacy HQ",
    worker: {
      role: env.WORKER_ROLE || "legacy-hq",
      serviceName: env.WORKER_SERVICE_NAME || "core-qa-headquarters-124",
      displayName: env.WORKER_DISPLAY_NAME || "CORE QA Legacy HQ Worker",
      shell: "legacy",
      sourceOfTruth: "core-qa-headquarters-124"
    },
    release: env.RELEASE_VERSION || "v3001.124.0",
    urls: {
      legacy: env.CLOUDFLARE_HQ_URL || "https://core-qa-headquarters-124.dfkabir253.workers.dev/legacy-hq/",
      currentBoard: env.CLOUDFLARE_BOARD_URL || "https://core-qa-headquarters-124.dfkabir253.workers.dev/",
      mordern: env.MORDERN_HQ_URL || "https://core-qa-mordern-hq-124.dfkabir253.workers.dev/"
    },
    parity: {
      frontend: "Legacy operational HQ and release board",
      backend: "Source-of-truth implementation for HQ APIs consumed by both Legacy HQ and Mordern HQ.",
      mordernWorkerService: env.MORDERN_WORKER_SERVICE || "core-qa-mordern-hq-124"
    },
    artifacts: {
      strategy: "github-raw-master-first",
      origin: liveArtifactOrigin(env),
      fallback: "Worker Static Assets",
      routes: {
        exact: Array.from(LIVE_ARTIFACT_EXACT_PATHS),
        prefixes: LIVE_ARTIFACT_PREFIXES
      }
    },
    routes: WORKER_ROUTES,
    bindings: {
      assets: Boolean(env.ASSETS),
      ai: Boolean(env.AI),
      slackToken: Boolean(env.SLACK_BOT_TOKEN),
      slackSigningSecret: Boolean(env.SLACK_SIGNING_SECRET),
      asanaAccessToken: Boolean(env.ASANA_ACCESS_TOKEN),
      jiraEmail: Boolean(env.JIRA_EMAIL),
      jiraApiToken: Boolean(env.JIRA_API_TOKEN || env.JIRA_MCP_TOKEN)
    }
  };
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
