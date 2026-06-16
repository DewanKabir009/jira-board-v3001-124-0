const MANAGED_SECRET_NAMES = [
  "JIRA_CLOUD_ID",
  "JIRA_EMAIL",
  "JIRA_MCP_TOKEN",
  "SLACK_BOT_TOKEN",
  "SLACK_CHANNEL_ID",
  "SLACK_WEBHOOK_URL",
  "SLACK_CHANNEL",
  "QA_EMAIL_TO",
  "QA_EMAIL_FROM",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USERNAME",
  "SMTP_PASSWORD",
  "SMTP_SECURE",
  "SMTP_REJECT_UNAUTHORIZED",
];

const DEFAULT_MONITORED_BOARDS = [
  {
    release: "v3001.122.0",
    repositorySlug: "DewanKabir009/jira-board-v3001-122-0",
    dashboardUrl: "https://dewankabir009.github.io/jira-board-v3001-122-0/",
    modernUrl: "https://dewankabir009.github.io/jira-board-v3001-122-0/modern/",
  },
  {
    release: "v3001.123.0",
    repositorySlug: "DewanKabir009/jira-board-v3001-123-0",
    dashboardUrl: "https://dewankabir009.github.io/jira-board-v3001-123-0/",
    modernUrl: "https://dewankabir009.github.io/jira-board-v3001-123-0/modern/",
  },
];
const DEFAULT_HEARTBEAT_REPOSITORIES = [
  "DewanKabir009/jira-board-v3001-124-0",
];

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function numericEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function booleanEnv(value, fallback = true) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return !["0", "false", "off", "no"].includes(String(value).trim().toLowerCase());
}

function base64UrlDecode(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function parseJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) {
    throw new Error("Expected a compact JWT.");
  }

  const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
  const signature = base64UrlDecode(parts[2]);
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  return { header, payload, signature, signed };
}

async function verifyRs256Jwt(token, env, options) {
  const jwt = parseJwt(token);
  if (jwt.header.alg !== "RS256") {
    throw new Error("Unsupported JWT algorithm.");
  }

  const jwksResponse = await fetch(options.jwksUrl, {
    headers: { Accept: "application/json" },
  });
  if (!jwksResponse.ok) {
    throw new Error(`Unable to fetch JWKS: HTTP ${jwksResponse.status}`);
  }

  const jwks = await jwksResponse.json();
  const jwk = (jwks.keys || []).find((key) => key.kid === jwt.header.kid);
  if (!jwk) {
    throw new Error("JWT signing key was not found.");
  }

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, jwt.signature, jwt.signed);
  if (!valid) {
    throw new Error("JWT signature is invalid.");
  }

  const now = Math.floor(Date.now() / 1000);
  if (jwt.payload.exp && now > jwt.payload.exp + 60) {
    throw new Error("JWT is expired.");
  }
  if (jwt.payload.nbf && now + 60 < jwt.payload.nbf) {
    throw new Error("JWT is not active yet.");
  }
  if (options.issuer && jwt.payload.iss !== options.issuer) {
    throw new Error("JWT issuer is not allowed.");
  }

  const audiences = Array.isArray(jwt.payload.aud) ? jwt.payload.aud : [jwt.payload.aud];
  if (options.audience && !audiences.includes(options.audience)) {
    throw new Error("JWT audience is not allowed.");
  }

  return jwt.payload;
}

function repositoryAllowed(repository, env) {
  const allowedRepositories = parseList(env.ALLOWED_REPOSITORIES);
  const allowedPrefixes = parseList(env.ALLOWED_REPOSITORY_PREFIXES);

  if (allowedRepositories.includes(repository)) {
    return true;
  }

  return allowedPrefixes.some((prefix) => repository.startsWith(prefix));
}

function json(status, payload, headers = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function readBearerToken(request) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function authorizeAdmin(request, env) {
  if (env.PROVISIONER_ADMIN_TOKEN) {
    const headerToken = request.headers.get("X-Provisioner-Token") || readBearerToken(request);
    if (headerToken && headerToken === env.PROVISIONER_ADMIN_TOKEN) {
      return { ok: true, actor: "admin-token" };
    }
  }

  if (env.ACCESS_AUD && env.ACCESS_JWKS_URL) {
    const accessToken = request.headers.get("Cf-Access-Jwt-Assertion") || "";
    if (accessToken) {
      const payload = await verifyRs256Jwt(accessToken, env, {
        audience: env.ACCESS_AUD,
        issuer: env.ACCESS_ISSUER || "",
        jwksUrl: env.ACCESS_JWKS_URL,
      });
      const email = String(payload.email || "").toLowerCase();
      const allowedEmails = parseList(env.PROVISIONER_ADMIN_EMAILS || env.ALLOWED_USER_EMAILS).map((item) => item.toLowerCase());
      if (allowedEmails.includes(email)) {
        return { ok: true, actor: email };
      }
    }
  }

  return { ok: false, status: 401, message: "Provisioner admin authorization is required." };
}

async function authorizeGithubActions(request, env) {
  const token = readBearerToken(request);
  if (!token) {
    return { ok: false, status: 401, message: "GitHub OIDC bearer token is required." };
  }

  const payload = await verifyRs256Jwt(token, env, {
    audience: env.GITHUB_OIDC_AUDIENCE || "jira-board-provisioner",
    issuer: env.GITHUB_OIDC_ISSUER || "https://token.actions.githubusercontent.com",
    jwksUrl: env.GITHUB_OIDC_JWKS_URL || "https://token.actions.githubusercontent.com/.well-known/jwks",
  });

  const repository = String(payload.repository || "");
  if (!repository || !repositoryAllowed(repository, env)) {
    return { ok: false, status: 403, message: `Repository ${repository || "unknown"} is not allowed to read managed secrets.` };
  }

  return { ok: true, repository, actor: payload.actor || "" };
}

async function githubFetch(env, path, options = {}) {
  if (!env.GITHUB_PROVISIONER_TOKEN) {
    throw new Error("GITHUB_PROVISIONER_TOKEN is not configured.");
  }

  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_PROVISIONER_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "jira-board-provisioner-worker",
      "X-GitHub-Api-Version": env.GITHUB_API_VERSION || "2022-11-28",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (error) {
    payload = { raw: text };
  }

  if (!response.ok) {
    const message = payload?.message || payload?.raw || `GitHub API failed with HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function normalizeFixVersion(value) {
  const version = String(value || "").trim();
  if (!/^v\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("fixVersion must look like v3001.124.0.");
  }
  return version;
}

function repoNameFromVersion(version) {
  return `jira-board-${version.toLowerCase().replace(/^v/, "v").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

async function ensureRepository(env, repoName, visibility) {
  const owner = env.TARGET_OWNER || env.TEMPLATE_OWNER;
  const templateOwner = env.TEMPLATE_OWNER;
  const templateRepo = env.TEMPLATE_REPOSITORY || "jira-board-template";

  try {
    return await githubFetch(env, `/repos/${owner}/${repoName}`);
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }
  }

  const created = await githubFetch(env, `/repos/${templateOwner}/${templateRepo}/generate`, {
    method: "POST",
    body: JSON.stringify({
      owner,
      name: repoName,
      private: visibility !== "public",
      include_all_branches: false,
    }),
  });

  return created;
}

async function setVariable(env, owner, repoName, name, value) {
  try {
    await githubFetch(env, `/repos/${owner}/${repoName}/actions/variables/${encodeURIComponent(name)}`, {
      method: "PATCH",
      body: JSON.stringify({ name, value }),
    });
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }
    await githubFetch(env, `/repos/${owner}/${repoName}/actions/variables`, {
      method: "POST",
      body: JSON.stringify({ name, value }),
    });
  }
}

async function enablePages(env, owner, repoName) {
  try {
    await githubFetch(env, `/repos/${owner}/${repoName}/pages`, {
      method: "POST",
      body: JSON.stringify({
        source: {
          branch: env.DEFAULT_BRANCH || "master",
          path: "/",
        },
      }),
    });
    return "created";
  } catch (error) {
    if (error.status === 409 || error.status === 422) {
      return "already-enabled";
    }
    throw error;
  }
}

async function dispatchRefresh(env, owner, repoName) {
  await githubFetch(env, `/repos/${owner}/${repoName}/actions/workflows/refresh-jira-board.yml/dispatches`, {
    method: "POST",
    body: JSON.stringify({
      ref: env.DEFAULT_BRANCH || "master",
      inputs: {},
    }),
  });
}

function dashboardUrl(env, owner, repoName) {
  return `https://${owner.toLowerCase()}.github.io/${repoName}/`;
}

function normalizeBoard(input) {
  const repositorySlug = String(input.repositorySlug || input.repository || "").trim();
  const dashboardUrlValue = String(input.dashboardUrl || input.url || "").trim().replace(/\/?$/, "/");
  if (!repositorySlug || !dashboardUrlValue) {
    return null;
  }

  return {
    release: String(input.release || input.fixVersion || repositorySlug.split("/").pop() || "").trim(),
    repositorySlug,
    dashboardUrl: dashboardUrlValue,
    modernUrl: String(input.modernUrl || `${dashboardUrlValue}modern/`).trim(),
    dataUrl: String(input.dataUrl || input.dashboardDataUrl || `${dashboardUrlValue}dashboard-data.json`).trim(),
    workflow: String(input.workflow || "refresh-jira-board.yml").trim(),
    branch: String(input.branch || "").trim(),
  };
}

function releaseFromRepositorySlug(repositorySlug) {
  const repoName = String(repositorySlug || "").split("/").pop() || "";
  const releaseMatch = repoName.match(/v(\d+)-(\d+)-(\d+)/i);
  if (!releaseMatch) {
    return repoName || repositorySlug;
  }

  return `v${releaseMatch[1]}.${releaseMatch[2]}.${releaseMatch[3]}`;
}

function boardFromRepositorySlug(repositorySlug, env) {
  const [owner, repoName] = String(repositorySlug || "").split("/");
  if (!owner || !repoName) {
    return null;
  }

  const dashboardUrlValue = `https://${owner.toLowerCase()}.github.io/${repoName}/`;
  return normalizeBoard({
    release: releaseFromRepositorySlug(repositorySlug),
    repositorySlug,
    dashboardUrl: dashboardUrlValue,
    modernUrl: env.REFRESH_HEARTBEAT_MODERN_URL || `${dashboardUrlValue}modern/`,
    workflow: env.REFRESH_HEARTBEAT_WORKFLOW || "refresh-jira-board.yml",
    branch: env.REFRESH_HEARTBEAT_BRANCH || env.DEFAULT_BRANCH || "master",
  });
}

function parseConfiguredBoards(env) {
  if (!env.MONITORED_BOARDS) {
    return [];
  }

  const parsed = JSON.parse(env.MONITORED_BOARDS);
  if (!Array.isArray(parsed)) {
    throw new Error("MONITORED_BOARDS must be a JSON array.");
  }

  return parsed.map(normalizeBoard).filter(Boolean);
}

async function loadRegistryBoards(env) {
  const registryUrl = env.BOARD_REGISTRY_URL || env.MONITORED_BOARD_REGISTRY_URL;
  if (!registryUrl) {
    return [];
  }

  const response = await fetch(registryUrl, {
    cf: { cacheTtl: 60, cacheEverything: true },
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Board registry fetch failed with HTTP ${response.status}.`);
  }

  const registry = await response.json();
  return (registry.boards || [])
    .filter((board) => String(board.status || "active").toLowerCase() !== "archived")
    .map(normalizeBoard)
    .filter(Boolean);
}

async function getMonitorBoards(env) {
  const configured = parseConfiguredBoards(env);
  if (configured.length) {
    return configured;
  }

  try {
    const registryBoards = await loadRegistryBoards(env);
    if (registryBoards.length) {
      return registryBoards;
    }
  } catch (error) {
    console.warn(`Board registry unavailable; using fallback monitor list. ${error.message}`);
  }

  return DEFAULT_MONITORED_BOARDS.map(normalizeBoard).filter(Boolean);
}

function getHeartbeatBoards(env) {
  const configuredRepositories = parseList(env.REFRESH_HEARTBEAT_REPOSITORIES || env.REFRESH_HEARTBEAT_REPOSITORY);
  const repositories = configuredRepositories.length ? configuredRepositories : DEFAULT_HEARTBEAT_REPOSITORIES;
  return repositories
    .map((repositorySlug) => boardFromRepositorySlug(repositorySlug, env))
    .filter(Boolean);
}

function extractPulledAt(data) {
  const candidates = [
    data?.pulledAt,
    data?.pullDiff?.currentPulledAt,
    data?.pullDiff?.currentPulledAtIso,
    data?.generatedAt,
  ];

  for (const candidate of candidates) {
    const parsed = Date.parse(candidate);
    if (Number.isFinite(parsed)) {
      return new Date(parsed);
    }
  }

  return null;
}

async function readBoardSnapshot(board) {
  const startedAt = Date.now();
  const response = await fetch(`${board.dataUrl}${board.dataUrl.includes("?") ? "&" : "?"}monitor=${startedAt}`, {
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
    },
  });
  const responseMs = Date.now() - startedAt;
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`Dashboard data did not parse as JSON: ${error.message}`);
  }

  if (!response.ok) {
    throw new Error(`Dashboard data fetch failed with HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const pulledAt = extractPulledAt(data || {});
  return {
    pulledAt,
    pulledAtDisplay: data?.pulledAtDisplay || data?.pullDiff?.currentPulledAtDisplay || "",
    version: data?.version || board.release,
    total: Number(data?.total || 0),
    dashboardVersion: data?.dashboardVersion || "",
    responseMs,
  };
}

async function listRefreshRuns(env, board) {
  const branch = encodeURIComponent(board.branch || env.DEFAULT_BRANCH || "master");
  const workflow = encodeURIComponent(board.workflow || "refresh-jira-board.yml");
  const path = `/repos/${board.repositorySlug}/actions/workflows/${workflow}/runs?branch=${branch}&per_page=12`;
  const payload = await githubFetch(env, path);
  return Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : [];
}

function activeRefreshRuns(runs) {
  const activeStatuses = new Set(["queued", "requested", "waiting", "pending", "in_progress"]);
  return runs.filter((run) => activeStatuses.has(String(run.status || "").toLowerCase()));
}

function recentSuccessfulRefresh(runs, graceMinutes) {
  const cutoff = Date.now() - graceMinutes * 60000;
  return runs.find((run) => {
    const updatedAt = Date.parse(run.updated_at || run.created_at);
    return (
      Number.isFinite(updatedAt) &&
      updatedAt >= cutoff &&
      String(run.status || "").toLowerCase() === "completed" &&
      String(run.conclusion || "").toLowerCase() === "success"
    );
  });
}

async function dispatchRefreshForBoard(env, board, reason) {
  const workflow = encodeURIComponent(board.workflow || "refresh-jira-board.yml");
  await githubFetch(env, `/repos/${board.repositorySlug}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    body: JSON.stringify({
      ref: board.branch || env.DEFAULT_BRANCH || "master",
      inputs: {},
    }),
  });

  return {
    started: true,
    reason,
    workflow: board.workflow || "refresh-jira-board.yml",
    branch: board.branch || env.DEFAULT_BRANCH || "master",
    dispatchedAt: new Date().toISOString(),
  };
}

function summarizeWorkflowRun(run) {
  if (!run) {
    return null;
  }

  return {
    id: run.id,
    status: run.status,
    conclusion: run.conclusion,
    event: run.event,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    htmlUrl: run.html_url,
  };
}

function heartbeatSettings(env) {
  return {
    enabled: booleanEnv(env.REFRESH_HEARTBEAT_ENABLED, true),
    minimumGapSeconds: numericEnv(env.REFRESH_HEARTBEAT_MINIMUM_GAP_SECONDS, 240),
  };
}

async function inspectHeartbeatBoard(env, board, options = {}) {
  const settings = heartbeatSettings(env);
  const result = {
    ok: false,
    release: board.release,
    repositorySlug: board.repositorySlug,
    workflow: board.workflow || env.REFRESH_HEARTBEAT_WORKFLOW || "refresh-jira-board.yml",
    branch: board.branch || env.REFRESH_HEARTBEAT_BRANCH || env.DEFAULT_BRANCH || "master",
    checkedAt: new Date().toISOString(),
    minimumGapSeconds: settings.minimumGapSeconds,
    state: "unknown",
  };

  if (!settings.enabled) {
    result.ok = true;
    result.state = "disabled";
    result.message = "Cloudflare refresh heartbeat is disabled by REFRESH_HEARTBEAT_ENABLED.";
    return result;
  }

  let runs = [];
  try {
    runs = await listRefreshRuns(env, board);
  } catch (error) {
    result.state = "workflow-list-failed";
    result.error = error.message;
    return result;
  }

  const activeRuns = activeRefreshRuns(runs);
  result.activeRefreshRuns = activeRuns.map(summarizeWorkflowRun);
  result.latestWorkflowRun = summarizeWorkflowRun(runs[0]);

  if (activeRuns.length) {
    result.ok = true;
    result.state = "active-refresh-present";
    result.message = "A refresh workflow is already queued or running; this Cloudflare tick skipped dispatch.";
    return result;
  }

  const latestStartedAt = Date.parse(runs[0]?.created_at || "");
  if (Number.isFinite(latestStartedAt)) {
    result.secondsSinceLatestRunStarted = Math.max(0, Math.round((Date.now() - latestStartedAt) / 1000));
    if (result.secondsSinceLatestRunStarted < settings.minimumGapSeconds) {
      result.ok = true;
      result.state = "recent-refresh-present";
      result.message = "A refresh workflow was dispatched recently; this Cloudflare tick skipped a duplicate.";
      return result;
    }
  }

  if (options.dispatch === false) {
    result.ok = true;
    result.state = "ready-to-dispatch";
    result.message = "No active or recent refresh run was found.";
    return result;
  }

  try {
    result.dispatch = await dispatchRefreshForBoard(env, board, options.source || "cloudflare-heartbeat");
    result.ok = true;
    result.state = "dispatched";
    result.message = "Cloudflare Cron dispatched the refresh workflow.";
  } catch (error) {
    result.state = "dispatch-failed";
    result.error = error.message;
  }

  return result;
}

function buildHeartbeatSummary(results, options = {}) {
  const dispatched = results.filter((result) => result.state === "dispatched");
  const active = results.filter((result) => result.state === "active-refresh-present");
  const recent = results.filter((result) => result.state === "recent-refresh-present");
  const failed = results.filter((result) => !result.ok);

  return {
    ok: failed.length === 0,
    service: "jira-board-refresh-heartbeat",
    source: options.source || "manual",
    checkedAt: new Date().toISOString(),
    cadence: "Cloudflare Cron */5 * * * *",
    githubScheduleDependency: false,
    counts: {
      total: results.length,
      dispatched: dispatched.length,
      skippedActive: active.length,
      skippedRecent: recent.length,
      failed: failed.length,
    },
    boards: results,
  };
}

function heartbeatAlertText(summary) {
  const lines = [
    `Jira board refresh heartbeat: ${summary.counts.dispatched}/${summary.counts.total} dispatched`,
    `Checked: ${summary.checkedAt}`,
  ];

  for (const board of summary.boards.filter((item) => !item.ok)) {
    lines.push(`- ${board.release}: ${board.state}, ${board.error || board.message || "unknown error"}`);
    if (board.latestWorkflowRun?.htmlUrl) {
      lines.push(`  Latest workflow: ${board.latestWorkflowRun.htmlUrl}`);
    }
  }

  return lines.join("\n");
}

async function sendHeartbeatSlackAlert(env, summary) {
  if (summary.ok) {
    return false;
  }

  const text = heartbeatAlertText(summary);
  const botToken = env.SLACK_BOT_TOKEN;
  const channelId = refreshMonitorSlackChannel(env);
  if (botToken && channelId) {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: channelId,
        text,
        unfurl_links: false,
        unfurl_media: false,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      throw new Error(`Slack heartbeat alert failed: ${payload.error || response.status}`);
    }
    return true;
  }

  if (env.SLACK_WEBHOOK_URL) {
    const response = await fetch(env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      throw new Error(`Slack heartbeat webhook failed with HTTP ${response.status}.`);
    }
    return true;
  }

  console.warn("Heartbeat alert skipped; Slack credentials are not configured.");
  return false;
}

function monitorThresholds(env) {
  return {
    staleMinutes: numericEnv(env.REFRESH_MONITOR_STALE_MINUTES, 20),
    criticalMinutes: numericEnv(env.REFRESH_MONITOR_CRITICAL_MINUTES, 40),
    publishingGraceMinutes: numericEnv(env.REFRESH_MONITOR_PUBLISHING_GRACE_MINUTES, 10),
  };
}

async function inspectMonitoredBoard(env, board, options = {}) {
  const thresholds = monitorThresholds(env);
  const result = {
    release: board.release,
    repositorySlug: board.repositorySlug,
    dashboardUrl: board.dashboardUrl,
    modernUrl: board.modernUrl,
    dataUrl: board.dataUrl,
    workflow: board.workflow,
    checkedAt: new Date().toISOString(),
    thresholds,
    ok: false,
    state: "unknown",
  };

  try {
    const snapshot = await readBoardSnapshot(board);
    result.version = snapshot.version;
    result.total = snapshot.total;
    result.dashboardVersion = snapshot.dashboardVersion;
    result.pulledAt = snapshot.pulledAt ? snapshot.pulledAt.toISOString() : null;
    result.pulledAtDisplay = snapshot.pulledAtDisplay;
    result.responseMs = snapshot.responseMs;
    result.ageMinutes = snapshot.pulledAt
      ? Math.max(0, Math.round((Date.now() - snapshot.pulledAt.getTime()) / 60000))
      : null;
  } catch (error) {
    result.error = error.message;
    result.ageMinutes = null;
  }

  let runs = [];
  try {
    runs = await listRefreshRuns(env, board);
    const activeRuns = activeRefreshRuns(runs);
    result.activeRefreshRuns = activeRuns.map((run) => ({
      id: run.id,
      status: run.status,
      conclusion: run.conclusion,
      event: run.event,
      createdAt: run.created_at,
      htmlUrl: run.html_url,
    }));
    const latest = runs[0];
    if (latest) {
      result.latestWorkflowRun = {
        id: latest.id,
        status: latest.status,
        conclusion: latest.conclusion,
        event: latest.event,
        createdAt: latest.created_at,
        updatedAt: latest.updated_at,
        htmlUrl: latest.html_url,
      };
    }
  } catch (error) {
    result.workflowError = error.message;
  }

  const hasActiveRun = (result.activeRefreshRuns || []).length > 0;
  const hasSnapshot = typeof result.ageMinutes === "number";
  const stale = !hasSnapshot || result.ageMinutes > thresholds.staleMinutes;
  const critical = !hasSnapshot || result.ageMinutes > thresholds.criticalMinutes;

  if (!stale) {
    result.ok = true;
    result.state = "fresh";
    return result;
  }

  if (hasActiveRun) {
    result.ok = false;
    result.state = critical ? "recovering-critical" : "recovering";
    result.message = "Dashboard data is stale, but a refresh workflow is already active.";
    return result;
  }

  const recentSuccess = recentSuccessfulRefresh(runs, thresholds.publishingGraceMinutes);
  if (recentSuccess) {
    result.ok = false;
    result.state = "publishing";
    result.message = "Dashboard data is stale, but a successful refresh just ran; waiting for GitHub Pages to publish the new JSON.";
    result.recentSuccessfulRefresh = {
      id: recentSuccess.id,
      event: recentSuccess.event,
      updatedAt: recentSuccess.updated_at,
      htmlUrl: recentSuccess.html_url,
    };
    return result;
  }

  result.ok = false;
  result.state = critical ? "critical" : "stale";

  if (options.dispatch !== false && !result.workflowError) {
    try {
      result.dispatch = await dispatchRefreshForBoard(env, board, result.state);
      result.state = critical ? "critical-dispatched" : "stale-dispatched";
      result.message = "Dashboard data was stale and a refresh workflow was dispatched.";
    } catch (error) {
      result.dispatch = {
        started: false,
        error: error.message,
      };
      result.message = "Dashboard data is stale and the monitor could not dispatch a refresh.";
    }
  }

  return result;
}

function buildMonitorSummary(results, options = {}) {
  const staleBoards = results.filter((result) => result.state !== "fresh");
  const criticalBoards = results.filter((result) => result.state.includes("critical"));
  const dispatchedBoards = results.filter((result) => result.dispatch?.started);
  const dispatchFailures = results.filter((result) => result.dispatch && !result.dispatch.started);

  return {
    ok: staleBoards.length === 0,
    service: "jira-board-refresh-monitor",
    source: options.source || "manual",
    checkedAt: new Date().toISOString(),
    counts: {
      total: results.length,
      fresh: results.length - staleBoards.length,
      stale: staleBoards.length,
      critical: criticalBoards.length,
      dispatched: dispatchedBoards.length,
      dispatchFailures: dispatchFailures.length,
    },
    boards: results,
  };
}

function monitorAlertText(summary) {
  const alertBoards = summary.boards.filter((board) => board.dispatch?.started || board.dispatch?.error || board.state.includes("critical"));
  const lines = [
    `Jira board refresh monitor: ${summary.counts.fresh}/${summary.counts.total} boards fresh`,
    `Checked: ${summary.checkedAt}`,
  ];

  for (const board of alertBoards) {
    const age = typeof board.ageMinutes === "number" ? `${board.ageMinutes} min old` : "unknown age";
    const action = board.dispatch?.started
      ? "refresh dispatched"
      : board.dispatch?.error
        ? `dispatch failed: ${board.dispatch.error}`
        : board.message || board.state;
    lines.push(`- ${board.release}: ${board.state}, ${age}, ${action}`);
    if (board.latestWorkflowRun?.htmlUrl) {
      lines.push(`  Workflow: ${board.latestWorkflowRun.htmlUrl}`);
    }
    lines.push(`  Board: ${board.modernUrl || board.dashboardUrl}`);
  }

  return lines.join("\n");
}

async function sendMonitorSlackAlert(env, summary) {
  const shouldNotify = summary.boards.some((board) => board.dispatch?.started || board.dispatch?.error || board.state.includes("critical"));
  if (!shouldNotify) {
    return false;
  }

  const text = monitorAlertText(summary);
  const botToken = env.SLACK_BOT_TOKEN;
  const channelId = refreshMonitorSlackChannel(env);
  if (botToken && channelId) {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: channelId,
        text,
        unfurl_links: false,
        unfurl_media: false,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      throw new Error(`Slack monitor alert failed: ${payload.error || response.status}`);
    }
    return true;
  }

  if (env.SLACK_WEBHOOK_URL) {
    const response = await fetch(env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      throw new Error(`Slack monitor webhook failed with HTTP ${response.status}.`);
    }
    return true;
  }

  console.warn("Monitor alert skipped; Slack credentials are not configured.");
  return false;
}

function refreshMonitorSlackChannel(env) {
  return env.REFRESH_MONITOR_SLACK_CHANNEL_ID
    || env.REFRESH_MONITOR_SLACK_CHANNEL
    || env.SLACK_CHANNEL_ID
    || env.SLACK_CHANNEL;
}

async function runRefreshMonitor(env, options = {}) {
  const boards = await getMonitorBoards(env);
  const results = [];
  for (const board of boards) {
    results.push(await inspectMonitoredBoard(env, board, options));
  }

  const summary = buildMonitorSummary(results, options);
  if (options.alert !== false) {
    try {
      summary.alertSent = await sendMonitorSlackAlert(env, summary);
    } catch (error) {
      summary.alertSent = false;
      summary.alertError = error.message;
      console.error(error);
    }
  }

  return summary;
}

async function runRefreshHeartbeat(env, options = {}) {
  const boards = getHeartbeatBoards(env);
  const results = [];
  for (const board of boards) {
    results.push(await inspectHeartbeatBoard(env, board, options));
  }

  const summary = buildHeartbeatSummary(results, options);
  if (options.alert !== false) {
    try {
      summary.alertSent = await sendHeartbeatSlackAlert(env, summary);
    } catch (error) {
      summary.alertSent = false;
      summary.alertError = error.message;
      console.error(error);
    }
  }

  return summary;
}

async function handleProvision(request, env) {
  const auth = await authorizeAdmin(request, env);
  if (!auth.ok) {
    return json(auth.status, { ok: false, message: auth.message });
  }

  const input = await request.json().catch(() => ({}));
  const fixVersion = normalizeFixVersion(input.fixVersion || input.version);
  const repoName = String(input.repoName || repoNameFromVersion(fixVersion)).trim();
  const visibility = String(input.visibility || env.DEFAULT_VISIBILITY || "public").toLowerCase();
  const owner = env.TARGET_OWNER || env.TEMPLATE_OWNER;
  const repositorySlug = `${owner}/${repoName}`;
  const dashboard = dashboardUrl(env, owner, repoName);

  if (!repoName || !/^[-a-zA-Z0-9_.]+$/.test(repoName)) {
    return json(400, { ok: false, message: "Repository name contains unsupported characters." });
  }

  const repo = await ensureRepository(env, repoName, visibility);
  const variables = {
    JIRA_FIX_VERSION: fixVersion,
    BOARD_REPOSITORY_SLUG: repositorySlug,
    BOARD_REPOSITORY_NAME: repoName,
    BOARD_OWNER: owner,
    DASHBOARD_URL: dashboard,
    SECRET_PROVIDER_ENDPOINT: env.SECRET_PROVIDER_ENDPOINT || `${new URL(request.url).origin}/actions-secrets`,
    SECRET_PROVIDER_AUDIENCE: env.GITHUB_OIDC_AUDIENCE || "jira-board-provisioner",
    ASSIGNEE_DISPATCH_ENDPOINT: env.ASSIGNEE_DISPATCH_ENDPOINT || "",
    TEST_CHECKLIST_COMMENT_ENDPOINT: env.TEST_CHECKLIST_COMMENT_ENDPOINT || "",
    TRUSTED_GITHUB_ACTORS: env.TRUSTED_GITHUB_ACTORS || owner,
  };

  for (const [name, value] of Object.entries(variables)) {
    if (value) {
      await setVariable(env, owner, repoName, name, value);
    }
  }

  const pages = await enablePages(env, owner, repoName);
  let refresh = "not-requested";
  if (input.runInitialRefresh !== false) {
    await dispatchRefresh(env, owner, repoName);
    refresh = "dispatched";
  }

  return json(201, {
    ok: true,
    actor: auth.actor,
    repository: repo?.html_url || `https://github.com/${repositorySlug}`,
    repositorySlug,
    fixVersion,
    dashboardUrl: dashboard,
    pages,
    refresh,
    actionsUrl: `https://github.com/${repositorySlug}/actions/workflows/refresh-jira-board.yml`,
  });
}

async function handleActionsSecrets(request, env) {
  const auth = await authorizeGithubActions(request, env);
  if (!auth.ok) {
    return json(auth.status, { ok: false, message: auth.message });
  }

  const secrets = {};
  for (const name of MANAGED_SECRET_NAMES) {
    if (env[name]) {
      secrets[name] = env[name];
    }
  }

  return json(200, {
    ok: true,
    repository: auth.repository,
    secrets,
  });
}

async function handleMonitorStatus(env) {
  const summary = await runRefreshMonitor(env, {
    source: "status",
    dispatch: false,
    alert: false,
  });
  return json(summary.ok ? 200 : 503, summary);
}

async function handleMonitorRun(request, env) {
  const auth = await authorizeAdmin(request, env);
  if (!auth.ok) {
    return json(auth.status, { ok: false, message: auth.message });
  }

  const summary = await runRefreshMonitor(env, {
    source: "manual",
    dispatch: true,
    alert: true,
  });
  summary.actor = auth.actor;
  return json(summary.ok ? 200 : 202, summary);
}

async function handleHeartbeatStatus(env) {
  const summary = await runRefreshHeartbeat(env, {
    source: "status",
    dispatch: false,
    alert: false,
  });
  return json(summary.ok ? 200 : 503, summary);
}

async function handleHeartbeatRun(request, env) {
  const auth = await authorizeAdmin(request, env);
  if (!auth.ok) {
    return json(auth.status, { ok: false, message: auth.message });
  }

  const summary = await runRefreshHeartbeat(env, {
    source: "manual",
    dispatch: true,
    alert: true,
  });
  summary.actor = auth.actor;
  return json(summary.ok ? 200 : 202, summary);
}

async function handleMonitorHealth(env) {
  const summary = await runRefreshMonitor(env, {
    source: "health",
    dispatch: false,
    alert: false,
  });
  return json(summary.ok ? 200 : 503, {
    ok: summary.ok,
    service: summary.service,
    checkedAt: summary.checkedAt,
    counts: summary.counts,
    staleBoards: summary.boards
      .filter((board) => board.state !== "fresh")
      .map((board) => ({
        release: board.release,
        state: board.state,
        ageMinutes: board.ageMinutes,
        pulledAt: board.pulledAt,
        latestWorkflowRun: board.latestWorkflowRun,
      })),
  });
}

function missingSecrets(env) {
  return ["GITHUB_PROVISIONER_TOKEN", "JIRA_CLOUD_ID", "JIRA_EMAIL", "JIRA_MCP_TOKEN"].filter((name) => !env[name]);
}

async function handleStatus(env) {
  const missing = missingSecrets(env);
  return json(missing.length ? 503 : 200, {
    ok: missing.length === 0,
    service: "jira-board-provisioner",
    template: `${env.TEMPLATE_OWNER}/${env.TEMPLATE_REPOSITORY || "jira-board-template"}`,
    targetOwner: env.TARGET_OWNER || env.TEMPLATE_OWNER,
    oidcAudience: env.GITHUB_OIDC_AUDIENCE || "jira-board-provisioner",
    missingSecrets: missing,
    monitor: {
      boards: (await getMonitorBoards(env)).map((board) => ({
        release: board.release,
        repositorySlug: board.repositorySlug,
        dataUrl: board.dataUrl,
      })),
      staleMinutes: monitorThresholds(env).staleMinutes,
      criticalMinutes: monitorThresholds(env).criticalMinutes,
    },
    heartbeat: {
      cadence: "Cloudflare Cron */5 * * * *",
      githubScheduleDependency: false,
      settings: heartbeatSettings(env),
      boards: getHeartbeatBoards(env).map((board) => ({
        release: board.release,
        repositorySlug: board.repositorySlug,
        workflow: board.workflow,
        branch: board.branch,
      })),
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/status") {
        return handleStatus(env);
      }

      if (request.method === "GET" && url.pathname === "/monitor/status") {
        return await handleMonitorStatus(env);
      }

      if (request.method === "GET" && url.pathname === "/monitor/health") {
        return await handleMonitorHealth(env);
      }

      if (request.method === "POST" && url.pathname === "/monitor/run") {
        return await handleMonitorRun(request, env);
      }

      if (request.method === "GET" && url.pathname === "/heartbeat/status") {
        return await handleHeartbeatStatus(env);
      }

      if (request.method === "POST" && url.pathname === "/heartbeat/run") {
        return await handleHeartbeatRun(request, env);
      }

      if (request.method === "POST" && url.pathname === "/provision") {
        return await handleProvision(request, env);
      }

      if (request.method === "GET" && url.pathname === "/actions-secrets") {
        return await handleActionsSecrets(request, env);
      }

      return json(404, { ok: false, message: "Unknown provisioner route." });
    } catch (error) {
      return json(error.status || 500, {
        ok: false,
        message: error instanceof Error ? error.message : "Provisioner request failed.",
      });
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runRefreshHeartbeat(env, {
        source: `cron:${event.cron}`,
        dispatch: true,
        alert: true,
      }).then(async (heartbeatSummary) => {
        const monitorSummary = await runRefreshMonitor(env, {
          source: `post-heartbeat:${event.cron}`,
          dispatch: false,
          alert: false,
        });
        console.log(JSON.stringify({
          service: heartbeatSummary.service,
          checkedAt: heartbeatSummary.checkedAt,
          counts: heartbeatSummary.counts,
          alertSent: heartbeatSummary.alertSent,
          monitor: {
            service: monitorSummary.service,
            counts: monitorSummary.counts,
          },
        }));
      }),
    );
  },
};
