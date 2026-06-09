const fs = require("fs");
const path = require("path");

const workspace = __dirname;
const version = process.argv[2] || process.env.JIRA_FIX_VERSION || "vNEXT.0";
const sprintName = process.env.JIRA_SPRINT_NAME || "2026.8";
const sprintProjectKey = process.env.JIRA_SPRINT_PROJECT_KEY || "CORE";
const sprintProjectLabel = process.env.JIRA_SPRINT_PROJECT_LABEL || "B2C CORE Platforms";
const sprintBoardName = process.env.JIRA_SPRINT_BOARD_NAME || "GN Core Platform";
const sprintBoardLocationLabel = process.env.JIRA_SPRINT_BOARD_LOCATION_LABEL || "B2C Core Platforms";
const sprintBacklogParityEnabled = process.env.JIRA_SPRINT_BACKLOG_PARITY !== "false";
const siteUrl = process.env.JIRA_SITE_URL || "https://golfnow.atlassian.net";
const dashboardVersion = "v1.11.3";
const dashboardDataSchemaVersion = "dashboard-data/v1";
const dashboardDataFileName = "dashboard-data.json";
const calendarRefreshSeconds = Number(process.env.HQ_CALENDAR_REFRESH_SECONDS || 300);
const calendarLookbackDays = Number(process.env.HQ_CALENDAR_LOOKBACK_DAYS || 45);
const calendarLookaheadDays = Number(process.env.HQ_CALENDAR_LOOKAHEAD_DAYS || 180);
const defaultCalendarUrl =
  "https://golfnow.atlassian.net/wiki/display/GQE/calendar/413a852e-d20c-454c-9808-425e167314f2?calendarName=GN%20Releases";
const calendarSources = parseCalendarSources();
const boardOwner = process.env.BOARD_OWNER || process.env.GITHUB_REPOSITORY_OWNER || "DewanKabir009";
const boardRepositoryName =
  process.env.BOARD_REPOSITORY_NAME ||
  (process.env.GITHUB_REPOSITORY ? process.env.GITHUB_REPOSITORY.split("/").pop() : versionToRepoName(version));
const repositorySlug =
  process.env.BOARD_REPOSITORY_SLUG ||
  process.env.GITHUB_REPOSITORY ||
  `${boardOwner}/${boardRepositoryName}`;
const dashboardUrl =
  process.env.DASHBOARD_URL ||
  `https://${boardOwner.toLowerCase()}.github.io/${boardRepositoryName}/`;
const defaultAssigneeDispatchEndpoint = "https://jira-board-assignee-bridge.dfkabir253.workers.dev/assign";
const assigneeDispatchEndpoint =
  process.env.ASSIGNEE_DISPATCH_ENDPOINT || defaultAssigneeDispatchEndpoint;
const testChecklistCommentEndpoint =
  process.env.TEST_CHECKLIST_COMMENT_ENDPOINT ||
  assigneeDispatchEndpoint.replace(/\/assign$/, "/comment-checklist");
const mediaAssetBasePath = "assets/jira-media";
const issueCommentLimit = 25;
const assigneeOptions = [
  "Dewan Kabir",
  "Nicole Greer",
  "Alex McNay",
  "Anton Yurkevich",
];
const cloudId = process.env.JIRA_CLOUD_ID || "";
const email = process.env.JIRA_EMAIL || "";
const token = process.env.JIRA_MCP_TOKEN;
const authHeader = `Basic ${Buffer.from(`${email}:${token || ""}`).toString("base64")}`;

function versionToRepoName(input) {
  const safeVersion = String(input || "release")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `jira-board-${safeVersion || "release"}`;
}

function parseCalendarSources() {
  if (process.env.HQ_CALENDAR_SOURCES_JSON) {
    try {
      const configuredSources = JSON.parse(process.env.HQ_CALENDAR_SOURCES_JSON);
      if (Array.isArray(configuredSources) && configuredSources.length) {
        return configuredSources.map(normalizeCalendarSource).filter(Boolean).slice(0, 1);
      }
    } catch (error) {
      console.warn(`Unable to parse HQ_CALENDAR_SOURCES_JSON: ${error.message}`);
    }
  }

  const primaryUrl = process.env.HQ_CALENDAR_URL || defaultCalendarUrl;

  return [
    normalizeCalendarSource({
      id: "gn-releases",
      name: process.env.HQ_CALENDAR_NAME || "GN Releases",
      url: primaryUrl,
      description: "Default GN Releases Confluence Team Calendar.",
    }),
  ].filter(Boolean);
}

function normalizeCalendarSource(source, index = 0) {
  if (!source) {
    return null;
  }

  const url = String(source.url || source.href || defaultCalendarUrl);
  const calendarId = source.calendarId || source.subCalendarId || extractCalendarIdFromUrl(url);
  const name = String(source.name || source.calendarName || extractCalendarNameFromUrl(url) || `Calendar ${index + 1}`);

  if (!calendarId) {
    return null;
  }

  return {
    id: String(source.id || name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || `calendar-${index + 1}`,
    name,
    calendarId,
    url,
    description: source.description || "",
  };
}

function extractCalendarIdFromUrl(input) {
  const match = String(input || "").match(/\/calendar\/([a-f0-9-]{20,})/i);
  return match ? match[1] : "";
}

function extractCalendarNameFromUrl(input) {
  try {
    const url = new URL(input);
    return url.searchParams.get("calendarName") || "";
  } catch {
    return "";
  }
}

if (!token) {
  console.error("JIRA_MCP_TOKEN is not set.");
  process.exit(2);
}

if (!cloudId || !email) {
  console.error("JIRA_CLOUD_ID and JIRA_EMAIL must be set.");
  process.exit(2);
}

const fields = [
  "summary",
  "description",
  "status",
  "issuetype",
  "priority",
  "assignee",
  "customfield_10020",
  "customfield_11800",
  "updated",
  "created",
  "fixVersions",
  "components",
  "resolution",
  "parent",
  "attachment",
];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function jiraUrl(key) {
  return `${siteUrl}/browse/${key}`;
}

function jiraCommentUrl(issueKey, commentId) {
  const base = jiraUrl(issueKey);
  return commentId ? `${base}?focusedCommentId=${encodeURIComponent(commentId)}` : base;
}

function formatDate(input) {
  if (!input) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(input));
}

function serializeJsonForScript(value) {
  return JSON.stringify(value)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function appendDescriptionText(node, output) {
  if (!node) {
    return;
  }

  if (typeof node === "string") {
    output.push(node);
    return;
  }

  if (Array.isArray(node)) {
    node.forEach((child) => appendDescriptionText(child, output));
    return;
  }

  switch (node.type) {
    case "text":
      output.push(node.text || "");
      break;
    case "hardBreak":
      output.push("\n");
      break;
    case "emoji":
      output.push(node.attrs?.shortName || node.attrs?.text || "");
      break;
    case "mention":
      output.push(node.attrs?.text || node.attrs?.displayName || "");
      break;
    case "inlineCard":
    case "blockCard":
      output.push(node.attrs?.url || "");
      break;
    case "listItem":
      output.push("- ");
      appendDescriptionText(node.content, output);
      output.push("\n");
      break;
    case "paragraph":
    case "heading":
    case "blockquote":
    case "codeBlock":
    case "mediaSingle":
    case "panel":
      appendDescriptionText(node.content, output);
      output.push("\n\n");
      break;
    case "bulletList":
    case "orderedList":
      appendDescriptionText(node.content, output);
      output.push("\n");
      break;
    case "rule":
      output.push("\n---\n");
      break;
    default:
      appendDescriptionText(node.content, output);
      break;
  }
}

function descriptionToText(description) {
  if (!description) {
    return "";
  }

  if (typeof description === "string") {
    return description.trim();
  }

  const output = [];
  appendDescriptionText(description, output);
  return output.join("")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function descriptionExcerpt(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "None";
  }

  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

function slugifyFilename(value) {
  return String(value || "image")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "image";
}

function isImageAttachment(attachment) {
  return /^image\//i.test(attachment?.mimeType || "");
}

function isVideoAttachment(attachment) {
  return /^video\//i.test(attachment?.mimeType || "");
}

function isDescriptionMediaAttachment(attachment) {
  return isImageAttachment(attachment) || isVideoAttachment(attachment);
}

function collectDescriptionMedia(node, output = []) {
  if (!node) {
    return output;
  }

  if (Array.isArray(node)) {
    node.forEach((child) => collectDescriptionMedia(child, output));
    return output;
  }

  if (node.type === "media") {
    output.push(node.attrs || {});
  }

  collectDescriptionMedia(node.content, output);
  return output;
}

function buildAttachmentQueues(attachments) {
  const queues = new Map();

  for (const attachment of attachments || []) {
    if (!isImageAttachment(attachment)) {
      continue;
    }

    const key = String(attachment.filename || "").toLowerCase();
    if (!queues.has(key)) {
      queues.set(key, []);
    }
    queues.get(key).push(attachment);
  }

  return queues;
}

function attachmentForMedia(media, attachmentQueues, fallbackAttachments, index) {
  const altKey = String(media.alt || "").toLowerCase();
  const queue = altKey ? attachmentQueues.get(altKey) : null;
  if (queue?.length) {
    return queue.shift();
  }

  return fallbackAttachments[index] || null;
}

function assetForAttachment(issueKey, attachment) {
  const filename = slugifyFilename(attachment.filename);
  const assetRelativePath = `${mediaAssetBasePath}/${issueKey}/${attachment.id}-${filename}`;

  return {
    id: attachment.id,
    filename: attachment.filename || filename,
    mimeType: attachment.mimeType || "",
    mediaType: isVideoAttachment(attachment) ? "video" : "image",
    contentUrl: attachment.content,
    relativePath: assetRelativePath,
    filePath: path.join(workspace, assetRelativePath),
  };
}

async function downloadMediaAsset(asset) {
  if (!asset?.contentUrl || !asset.filePath) {
    return false;
  }

  if (fs.existsSync(asset.filePath) && fs.statSync(asset.filePath).size > 0) {
    return true;
  }

  fs.mkdirSync(path.dirname(asset.filePath), { recursive: true });
  const response = await fetch(asset.contentUrl, {
    headers: {
      Authorization: authHeader,
      Accept: "*/*",
    },
  });

  if (!response.ok) {
    console.warn(`Could not download Jira description media ${asset.filename}: HTTP ${response.status}`);
    return false;
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(asset.filePath, bytes);
  return true;
}

function buildDescriptionMedia(description, attachments, issueKey) {
  const mediaNodes = collectDescriptionMedia(description);
  const mediaAttachments = (attachments || []).filter(isDescriptionMediaAttachment);
  const attachmentQueues = buildAttachmentQueues(mediaAttachments);
  const usedAttachmentIds = new Set();

  return mediaNodes.map((media, index) => {
    const attachment = attachmentForMedia(media, attachmentQueues, mediaAttachments, index);
    if (!attachment || usedAttachmentIds.has(attachment.id)) {
      return {
        alt: media.alt || "Jira description media",
        width: media.width || null,
        height: media.height || null,
        missing: true,
      };
    }

    usedAttachmentIds.add(attachment.id);
    return {
      ...assetForAttachment(issueKey, attachment),
      alt: media.alt || attachment.filename || "Jira description media",
      width: media.width || null,
      height: media.height || null,
      missing: false,
    };
  });
}

function renderTextMarks(value, marks = []) {
  let output = escapeHtml(value);

  for (const mark of marks) {
    switch (mark.type) {
      case "strong":
        output = `<strong>${output}</strong>`;
        break;
      case "em":
        output = `<em>${output}</em>`;
        break;
      case "strike":
        output = `<s>${output}</s>`;
        break;
      case "code":
        output = `<code>${output}</code>`;
        break;
      case "link": {
        const href = mark.attrs?.href || "";
        if (/^https?:\/\//i.test(href) || href.startsWith("mailto:")) {
          output = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${output}</a>`;
        }
        break;
      }
      default:
        break;
    }
  }

  return output;
}

function renderAdfChildren(node, context) {
  return (node?.content || []).map((child) => renderAdfNode(child, context)).join("");
}

function renderMediaNode(media, context) {
  const asset = context.mediaAssets[context.mediaIndex++] || {};
  const alt = asset.alt || media.attrs?.alt || "Jira description media";

  if (!asset.relativePath || asset.missing) {
    const message = `${escapeHtml(alt)} could not be embedded.`;
    if (context.missingMediaHref) {
      return `<a class="description-media-missing" href="${escapeHtml(context.missingMediaHref)}" target="_blank" rel="noopener">${message} Open in Jira.</a>`;
    }
    return `<div class="description-media-missing">${message}</div>`;
  }

  if (asset.mediaType === "video") {
    return `<figure class="description-media description-video">` +
      `<video src="${escapeHtml(asset.relativePath)}" controls preload="metadata"></video>` +
      `<figcaption>${escapeHtml(alt)}</figcaption>` +
    `</figure>`;
  }

  return `<figure class="description-media">` +
    `<img src="${escapeHtml(asset.relativePath)}" alt="${escapeHtml(alt)}" loading="lazy">` +
    `<figcaption>${escapeHtml(alt)}</figcaption>` +
  `</figure>`;
}

function renderAdfNode(node, context) {
  if (!node) {
    return "";
  }

  if (Array.isArray(node)) {
    return node.map((child) => renderAdfNode(child, context)).join("");
  }

  switch (node.type) {
    case "doc":
      return renderAdfChildren(node, context);
    case "paragraph": {
      const content = renderAdfChildren(node, context);
      return content ? `<p>${content}</p>` : "";
    }
    case "text":
      return renderTextMarks(node.text || "", node.marks || []);
    case "hardBreak":
      return "<br>";
    case "heading": {
      const level = Math.min(5, Math.max(3, Number(node.attrs?.level || 4)));
      return `<h${level}>${renderAdfChildren(node, context)}</h${level}>`;
    }
    case "bulletList":
      return `<ul>${renderAdfChildren(node, context)}</ul>`;
    case "orderedList":
      return `<ol>${renderAdfChildren(node, context)}</ol>`;
    case "listItem":
      return `<li>${renderAdfChildren(node, context)}</li>`;
    case "blockquote":
      return `<blockquote>${renderAdfChildren(node, context)}</blockquote>`;
    case "codeBlock":
      return `<pre><code>${renderAdfChildren(node, context)}</code></pre>`;
    case "rule":
      return "<hr>";
    case "panel":
      return `<div class="description-note">${renderAdfChildren(node, context)}</div>`;
    case "mediaSingle":
    case "mediaGroup":
      return `<div class="description-media-group">${renderAdfChildren(node, context)}</div>`;
    case "media":
      return renderMediaNode(node, context);
    case "inlineCard":
    case "blockCard": {
      const url = node.attrs?.url || "";
      return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>` : "";
    }
    case "mention":
      return escapeHtml(node.attrs?.text || node.attrs?.displayName || "");
    case "emoji":
      return escapeHtml(node.attrs?.shortName || node.attrs?.text || "");
    case "table":
      return `<div class="description-table-wrap"><table>${renderAdfChildren(node, context)}</table></div>`;
    case "tableRow":
      return `<tr>${renderAdfChildren(node, context)}</tr>`;
    case "tableHeader":
      return `<th>${renderAdfChildren(node, context)}</th>`;
    case "tableCell":
      return `<td>${renderAdfChildren(node, context)}</td>`;
    default:
      return renderAdfChildren(node, context);
  }
}

function descriptionToHtml(description, mediaAssets = [], options = {}) {
  if (!description) {
    return "";
  }

  if (typeof description === "string") {
    return description
      .trim()
      .split(/\n{2,}/)
      .map((paragraph) => `<p>${paragraph.split(/\n/).map(escapeHtml).join("<br>")}</p>`)
      .join("");
  }

  return renderAdfNode(description, { mediaAssets, mediaIndex: 0, ...options }).trim();
}

async function buildRichDescription(issueKey, description, attachments) {
  const mediaAssets = buildDescriptionMedia(description, attachments, issueKey);
  const downloaded = await Promise.all(mediaAssets.map(downloadMediaAsset));
  const availableMediaAssets = mediaAssets.map((asset, index) => ({
    ...asset,
    missing: asset.missing || !downloaded[index],
  }));

  return {
    text: descriptionToText(description),
    html: descriptionToHtml(description, availableMediaAssets),
    imageCount: availableMediaAssets.filter((asset) => asset.mediaType !== "video" && !asset.missing && asset.relativePath).length,
    videoCount: availableMediaAssets.filter((asset) => asset.mediaType === "video" && !asset.missing && asset.relativePath).length,
    mediaCount: availableMediaAssets.filter((asset) => !asset.missing && asset.relativePath).length,
  };
}

function adfToSearchText(node, output = []) {
  if (!node) {
    return output;
  }

  if (typeof node === "string") {
    output.push(node);
    return output;
  }

  if (Array.isArray(node)) {
    node.forEach((child) => adfToSearchText(child, output));
    return output;
  }

  if (node.text) {
    output.push(node.text);
  }

  if (node.attrs) {
    ["text", "url", "alt", "displayName"].forEach((key) => {
      if (node.attrs[key]) {
        output.push(node.attrs[key]);
      }
    });
  }

  adfToSearchText(node.content, output);
  return output;
}

function stripRenderedHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMarkdownLine(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isMarkdownAttachment(attachment) {
  return /\.md$/i.test(attachment?.filename || "");
}

function commentReferencesMarkdown(comments, filename) {
  const needle = String(filename || "").toLowerCase();
  return comments.some((comment) => {
    const text = [
      comment.renderedBody || "",
      ...adfToSearchText(comment.body),
    ].join(" ").toLowerCase();
    return text.includes(needle);
  });
}

async function jiraJson(apiPath, options = {}) {
  const response = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3${apiPath}`, {
    ...options,
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Jira API failed: HTTP ${response.status} ${response.statusText}\n${text}`);
  }

  return text ? JSON.parse(text) : null;
}

async function fetchIssueComments(issueKey) {
  const comments = [];
  let startAt = 0;
  let total = 0;

  do {
    const payload = await jiraJson(
      `/issue/${encodeURIComponent(issueKey)}/comment?maxResults=100&startAt=${startAt}&expand=renderedBody`,
    );
    comments.push(...(payload.comments || []));
    total = Number(payload.total || comments.length);
    startAt += Number(payload.maxResults || 100);
  } while (comments.length < total);

  return comments;
}

function sortCommentsByCreated(comments) {
  return [...(comments || [])].sort((left, right) => {
    return new Date(left.created || 0).getTime() - new Date(right.created || 0).getTime();
  });
}

function latestIssueComment(comments) {
  const sortedComments = sortCommentsByCreated(comments);
  return sortedComments[sortedComments.length - 1] || null;
}

async function serializeIssueComments(comments, issueKey, attachments = []) {
  const sortedComments = sortCommentsByCreated(comments);

  return Promise.all(sortedComments.slice(-issueCommentLimit).map(async (comment, index) => {
    const author = comment.author || {};
    const bodyText = descriptionToText(comment.body);
    const commentUrl = jiraCommentUrl(issueKey, comment.id || "");
    const mediaAssets = buildDescriptionMedia(comment.body, attachments, `${issueKey}/comments/${comment.id || index}`);
    const downloaded = await Promise.all(mediaAssets.map(downloadMediaAsset));
    const availableMediaAssets = mediaAssets.map((asset, assetIndex) => ({
      ...asset,
      missing: !downloaded[assetIndex],
    }));
    const bodyHtml = descriptionToHtml(comment.body, availableMediaAssets, { missingMediaHref: commentUrl });

    return {
      id: comment.id || "",
      url: commentUrl,
      author: author.displayName || author.name || "Unknown",
      authorAccountId: author.accountId || "",
      authorAvatarUrl: avatarUrlForJiraUser(author),
      created: comment.created || "",
      createdDisplay: formatDate(comment.created),
      updated: comment.updated || "",
      updatedDisplay: comment.updated && comment.updated !== comment.created ? formatDate(comment.updated) : "",
      hasMedia: mediaAssets.length > 0,
      mediaCount: mediaAssets.length,
      body: bodyText,
      bodyHtml,
    };
  }));
}

async function fetchAttachmentText(attachment) {
  const response = await fetch(attachment.content, {
    headers: {
      Authorization: authHeader,
      Accept: "text/markdown,text/plain,*/*",
    },
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Could not download ${attachment.filename}: HTTP ${response.status} ${response.statusText}\n${text}`);
  }

  return text;
}

function extractMarkdownSection(lines, startIndex) {
  const section = [];

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (/^#{2,6}\s+Test Case\b/i.test(lines[index])) {
      break;
    }
    section.push(lines[index]);
  }

  return section;
}

function extractChecklistChecks(lines) {
  const checkboxChecks = lines
    .map((line) => line.match(/^\s*[-*]\s+\[[ xX]\]\s+(.+)$/))
    .filter(Boolean)
    .map((match) => normalizeMarkdownLine(match[1]))
    .filter(Boolean);

  if (checkboxChecks.length) {
    return checkboxChecks.slice(0, 16);
  }

  const expected = [];
  let inExpected = false;

  for (const line of lines) {
    if (/^\s*\*\*Expected\b/i.test(line)) {
      inExpected = true;
      continue;
    }

    if (inExpected && /^\s*\*\*[^*]+:\*\*/.test(line)) {
      break;
    }

    if (!inExpected) {
      continue;
    }

    const bullet = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/);
    if (bullet) {
      const value = normalizeMarkdownLine(bullet[1]);
      if (value) {
        expected.push(value);
      }
    }
  }

  return expected.slice(0, 12);
}

function extractCaseDescription(lines) {
  const explicit = lines
    .map((line) => line.match(/^\s*\*\*Description:\*\*\s*(.+)$/i))
    .filter(Boolean)
    .map((match) => normalizeMarkdownLine(match[1]))
    .find(Boolean);

  if (explicit) {
    return explicit;
  }

  return lines
    .map(normalizeMarkdownLine)
    .filter((line) => line && !/^#{1,6}\s/.test(line) && !/^\*\*[^*]+:\*\*$/.test(line))
    .slice(0, 3)
    .join(" ")
    .slice(0, 520);
}

function parseTestCasesFromMarkdown(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const testCases = [];
  let category = "";

  lines.forEach((line, index) => {
    const categoryMatch = line.match(/^##\s+(.+)$/);
    if (categoryMatch && !/^##\s+Test Case\b/i.test(line)) {
      category = normalizeMarkdownLine(categoryMatch[1]);
    }

    const headingMatch = line.match(/^#{2,6}\s+Test Case\s+(.+)$/i);
    if (!headingMatch) {
      return;
    }

    const rawHeading = normalizeMarkdownLine(headingMatch[1]);
    const idMatch = rawHeading.match(/^([A-Z]\d+)\s*:\s*(.+)$/i);
    const section = extractMarkdownSection(lines, index);
    const id = idMatch ? idMatch[1].toUpperCase() : `TC${testCases.length + 1}`;
    const title = idMatch ? idMatch[2] : rawHeading;
    const checks = extractChecklistChecks(section);
    const description = extractCaseDescription(section);

    testCases.push({
      id,
      title,
      category,
      blocking: /blocking/i.test(`${rawHeading}\n${section.join("\n")}`),
      description,
      checks,
    });
  });

  return testCases;
}

async function buildTestChecklist(issueKey, isSubtask, attachments, comments = null) {
  if (isSubtask) {
    return null;
  }

  const markdownAttachments = (attachments || []).filter(isMarkdownAttachment);
  if (!markdownAttachments.length) {
    return null;
  }

  const issueComments = comments || await fetchIssueComments(issueKey);
  const referencedAttachments = markdownAttachments.filter((attachment) => (
    commentReferencesMarkdown(issueComments, attachment.filename)
  ));

  if (!referencedAttachments.length) {
    return null;
  }

  const files = [];
  const testCases = [];

  for (const attachment of referencedAttachments) {
    let markdown = "";
    try {
      markdown = await fetchAttachmentText(attachment);
    } catch (error) {
      console.warn(error && error.message ? error.message : String(error));
      continue;
    }
    const parsed = parseTestCasesFromMarkdown(markdown);

    if (!parsed.length) {
      continue;
    }

    files.push({
      id: attachment.id,
      filename: attachment.filename,
      created: attachment.created || "",
      author: attachment.author?.displayName || "",
    });

    parsed.forEach((testCase) => {
      testCases.push({
        ...testCase,
        sourceFile: attachment.filename,
      });
    });
  }

  if (!testCases.length) {
    return null;
  }

  return {
    files,
    commentIds: comments
      .filter((comment) => referencedAttachments.some((attachment) => commentReferencesMarkdown([comment], attachment.filename)))
      .map((comment) => comment.id),
    total: testCases.length,
    testCases,
  };
}

function parseJsonText(text) {
  const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return JSON.parse(normalized);
}

function readDataFromHtml(htmlPath) {
  if (!fs.existsSync(htmlPath)) {
    return null;
  }

  const html = fs.readFileSync(htmlPath, "utf8");
  const start = '<script id="jira-data" type="application/json">';
  const end = "</script>";
  const startIndex = html.indexOf(start);
  if (startIndex === -1) {
    return null;
  }

  const endIndex = html.indexOf(end, startIndex);
  if (endIndex === -1) {
    return null;
  }

  try {
    return parseJsonText(html.slice(startIndex + start.length, endIndex));
  } catch {
    return null;
  }
}

function newerPullData(left, right) {
  if (!left) {
    return right || null;
  }
  if (!right) {
    return left;
  }

  const leftTime = Date.parse(left.pulledAt || "");
  const rightTime = Date.parse(right.pulledAt || "");
  if (Number.isNaN(leftTime)) {
    return right;
  }
  if (Number.isNaN(rightTime)) {
    return left;
  }

  return rightTime > leftTime ? right : left;
}

function escapeJqlString(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function issueKeyList(keys) {
  return keys
    .filter(Boolean)
    .map((key) => `"${escapeJqlString(key)}"`)
    .join(", ");
}

function issueKeySortMap(keys) {
  return new Map((keys || []).map((key, index) => [key, index]));
}

function sortIssuesByKeyOrder(issues, orderedKeys) {
  const order = issueKeySortMap(orderedKeys);
  return [...(issues || [])].sort((left, right) => {
    const leftIndex = order.has(left.key) ? order.get(left.key) : Number.MAX_SAFE_INTEGER;
    const rightIndex = order.has(right.key) ? order.get(right.key) : Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });
}

function rawIssueIsSubtask(issue) {
  return Boolean(issue?.fields?.issuetype?.subtask);
}

function rawIssueParentKey(issue) {
  return issue?.fields?.parent?.key || "";
}

function mergeRawIssues(...issueGroups) {
  const byKey = new Map();

  for (const group of issueGroups) {
    for (const issue of group || []) {
      if (issue?.key && !byKey.has(issue.key)) {
        byKey.set(issue.key, issue);
      }
    }
  }

  return [...byKey.values()];
}

async function fetchIssuesByJql(jql) {
  const endpoint = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search/jql`;
  const issues = [];
  let nextPageToken;

  do {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jql,
        maxResults: 100,
        nextPageToken,
        fields,
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Jira search failed: HTTP ${response.status} ${response.statusText}\n${text}`);
    }

    const payload = JSON.parse(text);
    issues.push(...(payload.issues || []));
    nextPageToken = payload.nextPageToken;
  } while (nextPageToken);

  return { jql, issues };
}

async function fetchIssues() {
  return fetchIssuesByJql(`fixVersion = "${escapeJqlString(version)}" ORDER BY updated DESC`);
}

async function fetchIssuesByKeys(orderedKeys) {
  const issues = [];

  for (let index = 0; index < orderedKeys.length; index += 50) {
    const chunk = orderedKeys.slice(index, index + 50);
    const keys = issueKeyList(chunk);
    if (!keys) {
      continue;
    }

    const result = await fetchIssuesByJql(`key in (${keys})`);
    issues.push(...(result.issues || []));
  }

  return sortIssuesByKeyOrder(mergeRawIssues(issues), orderedKeys);
}

async function fetchAgileJson(apiPath, params = {}) {
  const url = new URL(`https://api.atlassian.com/ex/jira/${cloudId}/rest/agile/1.0${apiPath}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Jira Agile API failed: HTTP ${response.status} ${response.statusText}\n${text}`);
  }

  return text ? JSON.parse(text) : {};
}

async function fetchJiraJsonFromPath(apiPath, params = {}) {
  const url = new URL(`https://api.atlassian.com/ex/jira/${cloudId}${apiPath}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Jira API path failed: HTTP ${response.status} ${response.statusText}\n${text}`);
  }

  return text ? JSON.parse(text) : {};
}

async function fetchAgilePages(apiPath, params = {}, itemKey = "values") {
  const items = [];
  let startAt = 0;
  const maxResults = Number(params.maxResults || 100);

  while (true) {
    const payload = await fetchAgileJson(apiPath, {
      ...params,
      startAt,
      maxResults,
    });
    const pageItems = Array.isArray(payload[itemKey]) ? payload[itemKey] : [];
    items.push(...pageItems);

    const payloadStart = Number(payload.startAt ?? startAt);
    const payloadMax = Number(payload.maxResults ?? maxResults);
    const total = Number(payload.total ?? items.length);

    if (payload.isLast === true || pageItems.length === 0 || payloadStart + payloadMax >= total) {
      break;
    }

    startAt = payloadStart + payloadMax;
  }

  return items;
}

function normalizedText(value) {
  return String(value || "").trim().toLowerCase();
}

function sprintBoardLocation(board) {
  const location = board?.location || {};
  return location.displayName || location.projectName || location.name || location.projectKey || "";
}

function addBacklogIssueKey(keys, seen, value) {
  if (!value) {
    return;
  }

  const key = typeof value === "string"
    ? value
    : value.key || value.issueKey || value.issuekey || value.issue?.key || value.issue?.issueKey || "";

  if (/^[A-Z][A-Z0-9]+-\d+$/.test(String(key)) && !seen.has(String(key))) {
    seen.add(String(key));
    keys.push(String(key));
  }
}

function addBacklogIssueId(ids, seen, value) {
  if (value === undefined || value === null || value === "") {
    return;
  }

  const id = typeof value === "string" || typeof value === "number"
    ? value
    : value.id || value.issueId || value.issueID || value.issue?.id || "";

  if (/^\d+$/.test(String(id)) && !seen.has(String(id))) {
    seen.add(String(id));
    ids.push(String(id));
  }
}

function addBacklogIssueKeysFromValue(keys, seen, value) {
  if (!value) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => addBacklogIssueKeysFromValue(keys, seen, item));
    return;
  }

  if (typeof value === "string") {
    addBacklogIssueKey(keys, seen, value);
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  addBacklogIssueKey(keys, seen, value);
  Object.values(value).forEach((item) => addBacklogIssueKeysFromValue(keys, seen, item));
}

function addBacklogIssueIdsFromValue(ids, seen, value) {
  if (!value) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => addBacklogIssueIdsFromValue(ids, seen, item));
    return;
  }

  if (typeof value === "string" || typeof value === "number") {
    addBacklogIssueId(ids, seen, value);
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  addBacklogIssueId(ids, seen, value);
  Object.values(value).forEach((item) => addBacklogIssueIdsFromValue(ids, seen, item));
}

function extractIssueKeysFromBacklogSprint(sprint) {
  const keys = [];
  const seen = new Set();
  const candidateFields = [
    "issues",
    "issueKeys",
    "issuekeys",
    "issueIds",
    "issuesIds",
    "issueIDs",
    "items",
    "contents",
    "workItems",
    "workItemKeys",
  ];

  for (const field of candidateFields) {
    addBacklogIssueKeysFromValue(keys, seen, sprint?.[field]);
  }

  return keys;
}

function extractIssueIdsFromBacklogSprint(sprint) {
  const ids = [];
  const seen = new Set();
  const candidateFields = [
    "issueIds",
    "issuesIds",
    "issueIDs",
    "issues",
    "items",
    "contents",
    "workItems",
  ];

  for (const field of candidateFields) {
    addBacklogIssueIdsFromValue(ids, seen, sprint?.[field]);
  }

  return ids;
}

function backlogIssueKeyById(payload) {
  const byId = new Map();
  const issues = Array.isArray(payload?.issues) ? payload.issues : [];

  for (const issue of issues) {
    if (issue?.id && issue?.key) {
      byId.set(String(issue.id), issue.key);
    }
  }

  return byId;
}

function backlogIssueKeysFromIds(ids, issueKeyById) {
  const keys = [];
  const seen = new Set();

  for (const id of ids || []) {
    const key = issueKeyById.get(String(id));
    if (key && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }

  return keys;
}

function findBacklogSprintNodes(payload) {
  const matches = [];
  const seen = new Set();
  const targetName = normalizedText(sprintName);

  function visit(value) {
    if (!value || typeof value !== "object") {
      return;
    }

    if (seen.has(value)) {
      return;
    }
    seen.add(value);

    const nodeName = normalizedText(value.name || value.sprintName || value.label || value.title);
    if (nodeName === targetName || nodeName.startsWith(`${targetName} `)) {
      matches.push(value);
    }

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    Object.values(value).forEach(visit);
  }

  visit(payload);
  return matches;
}

async function fetchBacklogSprintIssueKeys(boardId, sprintId) {
  if (!sprintBacklogParityEnabled) {
    return [];
  }

  const params = {
    rapidViewId: boardId,
    selectedProjectKey: sprintProjectKey,
  };
  const endpoints = [
    "/rest/greenhopper/1.0/xboard/plan/backlog/data.json",
    "/rest/greenhopper/1.0/xboard/plan/backlog/data",
  ];
  let payload = null;
  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      payload = await fetchJiraJsonFromPath(endpoint, params);
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!payload) {
    throw lastError || new Error("Jira backlog payload could not be loaded.");
  }

  const issueKeyById = backlogIssueKeyById(payload);
  const sprintCandidates = findBacklogSprintNodes(payload);
  const candidateResults = sprintCandidates
    .filter((candidate) => !sprintId || String(candidate.id || candidate.sprintId || "") === String(sprintId) || normalizedText(candidate.name || candidate.sprintName || candidate.label || candidate.title).startsWith(normalizedText(sprintName)))
    .map((candidate) => ({
      candidate,
      keys: extractIssueKeysFromBacklogSprint(candidate),
      ids: extractIssueIdsFromBacklogSprint(candidate),
    }))
    .map((result) => ({
      ...result,
      keys: result.keys.length ? result.keys : backlogIssueKeysFromIds(result.ids, issueKeyById),
    }))
    .filter((result) => result.keys.length > 0)
    .sort((left, right) => right.keys.length - left.keys.length);
  const selected = candidateResults[0] || null;
  const keys = selected?.keys || [];

  if (!keys.length) {
    const topLevelKeys = Object.keys(payload || {}).slice(0, 20).join(", ");
    throw new Error(`Jira backlog payload did not expose visible issue keys for sprint "${sprintName}". Candidate nodes: ${sprintCandidates.length}. Top-level keys: ${topLevelKeys}`);
  }

  return keys;
}

async function findSprintBoard() {
  if (!sprintBoardName) {
    return null;
  }

  const boards = await fetchAgilePages("/board", {
    name: sprintBoardName,
    type: "scrum",
  });
  const targetName = normalizedText(sprintBoardName);
  const targetLocation = normalizedText(sprintBoardLocationLabel);
  const exactNameMatches = boards.filter((board) => normalizedText(board.name) === targetName);
  const candidates = exactNameMatches.length ? exactNameMatches : boards;

  return candidates.find((board) => normalizedText(sprintBoardLocation(board)).includes(targetLocation)) ||
    candidates.find((board) => board?.location?.projectKey === sprintProjectKey) ||
    candidates[0] ||
    null;
}

async function findBoardSprint(boardId) {
  const sprints = await fetchAgilePages(`/board/${encodeURIComponent(boardId)}/sprint`, {
    state: "active,future,closed",
  });
  const targetName = normalizedText(sprintName);

  return sprints.find((sprint) => normalizedText(sprint.name) === targetName) ||
    sprints.find((sprint) => normalizedText(sprint.name).includes(targetName)) ||
    null;
}

async function fetchSprintIssuesFromBoard() {
  const board = await findSprintBoard();
  if (!board?.id) {
    throw new Error(`Jira sprint board "${sprintBoardName}" was not found.`);
  }

  const sprint = await findBoardSprint(board.id);
  if (!sprint?.id) {
    throw new Error(`Sprint "${sprintName}" was not found on Jira board "${board.name || sprintBoardName}".`);
  }

  const boardJql = sprintProjectKey ? `project = "${escapeJqlString(sprintProjectKey)}"` : "";
  const jql = [
    boardJql,
    `Sprint = "${escapeJqlString(sprintName)}"`,
  ].filter(Boolean).join(" AND ");
  let sprintIssues = [];
  let backlogIssueKeys = [];
  let source = "jira-agile-board";
  let backlogParity = false;
  let backlogWarning = "";

  if (sprintBacklogParityEnabled) {
    try {
      backlogIssueKeys = await fetchBacklogSprintIssueKeys(board.id, sprint.id);
      sprintIssues = (await fetchIssuesByKeys(backlogIssueKeys)).filter((issue) => !rawIssueIsSubtask(issue));
      backlogIssueKeys = sprintIssues.map((issue) => issue.key);
      source = "jira-backlog-sprint";
      backlogParity = true;
    } catch (error) {
      backlogWarning = error.message;
      console.warn(`Unable to pull Sprint View from Jira backlog data for board "${board.name || sprintBoardName}"; falling back to Agile sprint endpoint. ${error.message}`);
    }
  }

  if (!sprintIssues.length) {
    sprintIssues = await fetchAgilePages(`/board/${encodeURIComponent(board.id)}/sprint/${encodeURIComponent(sprint.id)}/issue`, {
      fields: fields.join(","),
      jql: boardJql,
    }, "issues");
  }

  return {
    source,
    boardId: board.id,
    boardName: board.name || sprintBoardName,
    boardUrl: sprintProjectKey ? `${siteUrl}/jira/software/c/projects/${sprintProjectKey}/boards/${board.id}` : "",
    boardLocation: sprintBoardLocation(board),
    sprintId: sprint.id,
    sprintState: sprint.state || "",
    sprintStartDate: sprint.startDate || "",
    sprintEndDate: sprint.endDate || "",
    backlogParity,
    backlogIssueCount: backlogIssueKeys.length,
    backlogWarning,
    jql,
    queryDescription: backlogParity
      ? `Jira backlog sprint "${sprint.name || sprintName}" on board "${board.name || sprintBoardName}"`
      : `Jira board "${board.name || sprintBoardName}" sprint "${sprint.name || sprintName}"`,
    issues: sprintIssues,
  };
}

async function fetchSprintIssues() {
  let sprintResult;

  if (sprintBoardName) {
    try {
      sprintResult = await fetchSprintIssuesFromBoard();
    } catch (error) {
      console.warn(`Unable to pull Sprint View from Jira board "${sprintBoardName}"; falling back to JQL. ${error.message}`);
    }
  }

  if (!sprintResult) {
    const sprintProjectClause = sprintProjectKey ? `project = "${escapeJqlString(sprintProjectKey)}" AND ` : "";
    const sprintJql = `${sprintProjectClause}Sprint = "${escapeJqlString(sprintName)}" ORDER BY updated DESC`;
    sprintResult = {
      source: "jira-jql",
      scopeLabel: sprintProjectLabel || sprintProjectKey || "Jira project fallback",
      jql: sprintJql,
      issues: (await fetchIssuesByJql(sprintJql)).issues || [],
    };
  }

  const sprintIssues = sprintResult.issues || [];
  if (sprintResult.backlogParity) {
    return {
      ...sprintResult,
      issues: sprintIssues,
    };
  }

  const parentKeys = [
    ...new Set([
      ...sprintIssues.filter((issue) => !rawIssueIsSubtask(issue)).map((issue) => issue.key),
      ...sprintIssues.map(rawIssueParentKey),
    ].filter(Boolean))
  ];
  const existingKeys = new Set(sprintIssues.map((issue) => issue.key));
  const extraGroups = [];

  for (let index = 0; index < parentKeys.length; index += 50) {
    const chunk = parentKeys.slice(index, index + 50);
    const keys = issueKeyList(chunk);
    if (!keys) {
      continue;
    }

    const subtaskResult = await fetchIssuesByJql(`parent in (${keys}) ORDER BY updated DESC`);
    extraGroups.push(subtaskResult.issues || []);

    const missingParentKeys = chunk.filter((key) => !existingKeys.has(key));
    const missingKeys = issueKeyList(missingParentKeys);
    if (missingKeys) {
      const parentResult = await fetchIssuesByJql(`key in (${missingKeys}) ORDER BY updated DESC`);
      extraGroups.push(parentResult.issues || []);
    }
  }

  return {
    ...sprintResult,
    issues: mergeRawIssues(sprintIssues, ...extraGroups)
  };
}

function avatarUrlForJiraUser(user) {
  return user?.avatarUrls?.["32x32"] || user?.avatarUrls?.["48x48"] || user?.avatarUrls?.["24x24"] || user?.avatarUrls?.["16x16"] || "";
}

function normalizeJiraUserField(value) {
  const user = Array.isArray(value) ? value.find(Boolean) : value;
  if (!user) {
    return { displayName: "Unassigned", accountId: "", avatarUrl: "" };
  }
  if (typeof user === "string") {
    return { displayName: user || "Unassigned", accountId: "", avatarUrl: "" };
  }
  const displayName = user.displayName || user.name || user.value || user.emailAddress || "Unassigned";
  return {
    displayName,
    accountId: user.accountId || "",
    avatarUrl: avatarUrlForJiraUser(user),
  };
}

function normalizeSprintField(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];

  return values
    .map((item) => {
      if (!item) {
        return null;
      }

      if (typeof item === "string") {
        const id = item.match(/(?:^|,)id=([^,\]]+)/)?.[1] || "";
        const name = item.match(/(?:^|,)name=([^,\]]+)/)?.[1] || item;
        const state = item.match(/(?:^|,)state=([^,\]]+)/)?.[1] || "";
        return {
          id: String(id || ""),
          name: String(name || "").trim(),
          state: String(state || "")
        };
      }

      const id = item.id ?? item.sprintId ?? "";
      const name = item.name ?? item.value ?? item.label ?? "";
      const state = item.state ?? "";
      return {
        id: String(id || ""),
        name: String(name || "").trim(),
        state: String(state || "")
      };
    })
    .filter((item) => item && (item.name || item.id));
}

async function normalizeIssue(issue) {
  const issueFields = issue.fields || {};
  const issueType = issueFields.issuetype || {};
  const parentFields = issueFields.parent?.fields || {};
  const attachments = issueFields.attachment || [];
  const isSubtask = Boolean(issueType.subtask);
  const richDescription = await buildRichDescription(issue.key, issueFields.description, attachments);
  const issueComments = await fetchIssueComments(issue.key);
  const testChecklist = await buildTestChecklist(issue.key, isSubtask, attachments, issueComments);
  const parentDescription = descriptionToText(parentFields.description);
  const assignedDeveloper = normalizeJiraUserField(issueFields.customfield_11800);
  const sprints = normalizeSprintField(issueFields.customfield_10020);
  const serializedComments = await serializeIssueComments(issueComments, issue.key, attachments);
  const latestComment = latestIssueComment(issueComments);

  return {
    key: issue.key,
    url: jiraUrl(issue.key),
    summary: issueFields.summary || "",
    description: richDescription.text,
    descriptionHtml: richDescription.html,
    descriptionImageCount: richDescription.imageCount,
    descriptionVideoCount: richDescription.videoCount,
    descriptionMediaCount: richDescription.mediaCount,
    commentCount: issueComments.length,
    comments: serializedComments,
    lastCommentUrl: latestComment ? jiraCommentUrl(issue.key, latestComment.id || "") : "",
    lastCommentDisplay: latestComment ? formatDate(latestComment.created) : "",
    lastCommentAuthor: latestComment?.author?.displayName || latestComment?.author?.name || "",
    testChecklist,
    type: issueType.name || "",
    isSubtask,
    status: issueFields.status?.name || "",
    priority: issueFields.priority?.name || "None",
    assignee: issueFields.assignee?.displayName || "Unassigned",
    assigneeAccountId: issueFields.assignee?.accountId || "",
    assigneeAvatarUrl: avatarUrlForJiraUser(issueFields.assignee),
    assignedDeveloper: assignedDeveloper.displayName,
    assignedDeveloperAccountId: assignedDeveloper.accountId,
    assignedDeveloperAvatarUrl: assignedDeveloper.avatarUrl,
    updated: issueFields.updated || "",
    updatedDisplay: formatDate(issueFields.updated),
    created: issueFields.created || "",
    createdDisplay: formatDate(issueFields.created),
    components: (issueFields.components || []).map((component) => component.name),
    fixVersions: (issueFields.fixVersions || []).map((fixVersion) => fixVersion.name),
    sprints,
    sprintNames: [...new Set(sprints.map((sprint) => sprint.name).filter(Boolean))],
    resolution: issueFields.resolution?.name || "",
    parent: issueFields.parent ? {
      key: issueFields.parent.key,
      url: jiraUrl(issueFields.parent.key),
      summary: parentFields.summary || "",
      description: parentDescription,
      type: parentFields.issuetype?.name || "Parent",
      status: parentFields.status?.name || "",
      priority: parentFields.priority?.name || "",
    } : null,
  };
}

function normalizeList(values) {
  return [...(values || [])].sort((left, right) => left.localeCompare(right));
}

function listsEqual(left, right) {
  const normalizedLeft = normalizeList(left);
  const normalizedRight = normalizeList(right);

  return normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function formatList(values) {
  return normalizeList(values).join(", ") || "None";
}

function compareIssues(previous, current) {
  const changes = [];
  const scalarFields = [
    ["summary", "Summary"],
    ["type", "Type"],
    ["status", "Status"],
    ["priority", "Priority"],
    ["assignee", "Assignee"],
    ["assignedDeveloper", "Assigned Developer"],
    ["resolution", "Resolution"],
    ["updatedDisplay", "Jira updated"],
  ];

  for (const [field, label] of scalarFields) {
    const before = previous[field] || "None";
    const after = current[field] || "None";
    if (before !== after) {
      changes.push({ field, label, before, after });
    }
  }

  if (!listsEqual(previous.components, current.components)) {
    changes.push({
      field: "components",
      label: "Components",
      before: formatList(previous.components),
      after: formatList(current.components),
    });
  }

  if (Object.prototype.hasOwnProperty.call(previous, "description") &&
      (previous.description || "") !== (current.description || "")) {
    changes.push({
      field: "description",
      label: "Description",
      before: descriptionExcerpt(previous.description),
      after: descriptionExcerpt(current.description),
    });
  }

  if ((previous.parent?.key || "") !== (current.parent?.key || "")) {
    changes.push({
      field: "parent",
      label: "Parent",
      before: previous.parent?.key || "None",
      after: current.parent?.key || "None",
    });
  }

  return changes;
}

function issueContext(issue) {
  if (!issue) {
    return {};
  }

  return {
    type: issue.type || "",
    isSubtask: Boolean(issue.isSubtask),
    assignee: issue.assignee || "Unassigned",
    assignedDeveloper: issue.assignedDeveloper || "Unassigned",
    status: issue.status || "",
    parent: issue.parent || null,
  };
}

function enrichPullItem(item, issuesByKey) {
  const issue = issuesByKey.get(item.key);
  return {
    ...item,
    ...issueContext(issue),
  };
}

function enrichPullDiff(diff, issuesByKey) {
  if (!diff) {
    return diff;
  }

  return {
    ...diff,
    added: (diff.added || []).map((issue) => ({
      ...issue,
      ...issueContext(issuesByKey.get(issue.key) || issue),
    })),
    removed: (diff.removed || []).map((issue) => ({
      ...issue,
      ...issueContext(issuesByKey.get(issue.key) || issue),
    })),
    updated: (diff.updated || []).map((item) => enrichPullItem(item, issuesByKey)),
    statusChanges: (diff.statusChanges || []).map((item) => enrichPullItem(item, issuesByKey)),
  };
}

function buildPullDiff(previousData, issues, pulledAt, pulledAtDisplay) {
  const previousIssues = previousData?.issues || [];
  const previousByKey = new Map(previousIssues.map((issue) => [issue.key, issue]));
  const currentByKey = new Map(issues.map((issue) => [issue.key, issue]));
  const added = [];
  const removed = [];
  const updated = [];
  const statusChanges = [];

  for (const issue of issues) {
    const previous = previousByKey.get(issue.key);
    if (!previous) {
      added.push(issue);
      continue;
    }

    const changes = compareIssues(previous, issue);
    if (changes.length) {
      updated.push({
        key: issue.key,
        url: issue.url,
        summary: issue.summary,
        changes,
      });
    }

    if ((previous.status || "") !== (issue.status || "")) {
      statusChanges.push({
        key: issue.key,
        url: issue.url,
        summary: issue.summary,
        before: previous.status || "None",
        after: issue.status || "None",
      });
    }
  }

  for (const issue of previousIssues) {
    if (!currentByKey.has(issue.key)) {
      removed.push(issue);
    }
  }

  return {
    previousPulledAt: previousData?.pulledAt || null,
    previousPulledAtDisplay: previousData?.pulledAtDisplay || null,
    currentPulledAt: pulledAt,
    currentPulledAtDisplay: pulledAtDisplay,
    isBaseline: !previousData?.issues?.length,
    added,
    removed,
    updated,
    statusChanges,
  };
}

function isDescriptionBackfillDiff(entry, previousData) {
  if (previousData?.dashboardVersion === dashboardVersion) {
    return false;
  }

  const updated = entry?.updated || [];
  if (!updated.length ||
      (entry.added || []).length ||
      (entry.removed || []).length ||
      (entry.statusChanges || []).length) {
    return false;
  }

  return updated.every((item) => {
    const changes = item.changes || [];
    return changes.length &&
      changes.every((change) => change.field === "description" && change.before === "None");
  });
}

function buildPullHistory(previousData, currentDiff) {
  const previousHistory = Array.isArray(previousData?.pullHistory)
    ? previousData.pullHistory
    : (previousData?.pullDiff ? [previousData.pullDiff] : []);
  const seen = new Set();
  const history = [];

  for (const entry of [currentDiff, ...previousHistory]) {
    if (!entry?.currentPulledAt || seen.has(entry.currentPulledAt)) {
      continue;
    }
    if (isDescriptionBackfillDiff(entry, previousData)) {
      continue;
    }
    seen.add(entry.currentPulledAt);
    history.push(entry);
  }

  return history.slice(0, 168);
}

function buildSprintView(issues, sprintSource, pulledAt, pulledAtDisplay) {
  const source = typeof sprintSource === "string" ? { jql: sprintSource } : sprintSource || {};
  const mainTotal = issues.filter((issue) => !issue.isSubtask).length;
  const subtaskTotal = issues.length - mainTotal;
  const scopeLabel = source.boardName || source.scopeLabel || sprintProjectLabel;
  const projectSuffix = scopeLabel ? ` - ${scopeLabel}` : "";
  const jql = source.jql || "";

  return {
    name: sprintName,
    label: `Sprint ${sprintName}${projectSuffix}`,
    source: source.source || (source.boardName ? "jira-agile-board" : "jira-jql"),
    scopeLabel,
    projectKey: sprintProjectKey,
    projectLabel: sprintProjectLabel,
    boardName: source.boardName || sprintBoardName,
    boardId: source.boardId || "",
    boardLocation: source.boardLocation || sprintBoardLocationLabel,
    boardUrl: source.boardUrl || "",
    sprintId: source.sprintId || "",
    sprintState: source.sprintState || "",
    sprintStartDate: source.sprintStartDate || "",
    sprintEndDate: source.sprintEndDate || "",
    backlogParity: Boolean(source.backlogParity),
    backlogIssueCount: Number(source.backlogIssueCount || 0),
    backlogWarning: source.backlogWarning || "",
    queryDescription: source.queryDescription || "",
    jql,
    jiraFilterUrl: source.boardUrl || (jql ? `${siteUrl}/issues/?jql=${encodeURIComponent(jql)}` : ""),
    pulledAt,
    pulledAtDisplay,
    total: issues.length,
    mainTotal,
    subtaskTotal,
    issues,
  };
}

function ensureSprintMembership(issue) {
  if (!issue) {
    return issue;
  }

  const sprintNames = [...new Set([...(issue.sprintNames || []), sprintName].filter(Boolean))];
  const sprints = Array.isArray(issue.sprints) ? issue.sprints : [];
  const hasSprintObject = sprints.some((sprint) => sprint?.name === sprintName);

  return {
    ...issue,
    sprints: hasSprintObject ? sprints : [...sprints, { name: sprintName }],
    sprintNames,
  };
}

function addDays(input, days) {
  const date = new Date(input);
  date.setDate(date.getDate() + days);
  return date;
}

function dateOnly(input) {
  return new Date(input).toISOString().slice(0, 10);
}

function calendarBaseUrl() {
  return siteUrl.replace(/\/$/, "");
}

function calendarWindow() {
  const now = new Date();
  const start = addDays(now, -calendarLookbackDays);
  const end = addDays(now, calendarLookaheadDays);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    startDate: dateOnly(start),
    endDate: dateOnly(end),
    startMs: start.getTime(),
    endMs: end.getTime(),
  };
}

function calendarEventEndpoints(source, window) {
  const encodedId = encodeURIComponent(source.calendarId);
  const timezone = encodeURIComponent("America/New_York");
  const base = calendarBaseUrl();
  return [
    `${base}/wiki/rest/calendar-services/1.0/calendar/events.json?subCalendarId=${encodedId}&userTimeZoneId=${timezone}&start=${encodeURIComponent(window.startDate)}&end=${encodeURIComponent(window.endDate)}`,
    `${base}/wiki/rest/calendar-services/1.0/calendar/events.json?subCalendarId=${encodedId}&userTimeZoneId=${timezone}&start=${encodeURIComponent(window.start)}&end=${encodeURIComponent(window.end)}`,
    `${base}/wiki/rest/calendar-services/1.0/calendar/events.json?subCalendarId=${encodedId}&userTimeZoneId=${timezone}&start=${window.startMs}&end=${window.endMs}`,
  ];
}

function calendarIcsEndpoints(source) {
  const encodedId = encodeURIComponent(source.calendarId);
  const base = calendarBaseUrl();
  return [
    `${base}/wiki/rest/calendar-services/1.0/calendar/export/subcalendar/${encodedId}.ics`,
    `${base}/wiki/rest/calendar-services/1.0/calendar/export/subcalendar/private/${encodedId}.ics`,
  ];
}

async function fetchCalendarUrl(url, accept) {
  const response = await fetch(url, {
    headers: {
      Authorization: authHeader,
      Accept: accept,
    },
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }

  return text;
}

async function fetchCalendarSource(source, window) {
  const errors = [];

  for (const endpoint of calendarEventEndpoints(source, window)) {
    try {
      const text = await fetchCalendarUrl(endpoint, "application/json");
      const payload = JSON.parse(text);
      const events = normalizeCalendarEvents(payload, source)
        .filter((event) => eventWithinWindow(event, window))
        .sort(sortCalendarEvents);
      return {
        ...source,
        status: "loaded",
        pulledAt: new Date().toISOString(),
        eventCount: events.length,
        events,
        sourceType: "team-calendar-json",
      };
    } catch (error) {
      errors.push(error.message);
    }
  }

  for (const endpoint of calendarIcsEndpoints(source)) {
    try {
      const text = await fetchCalendarUrl(endpoint, "text/calendar,*/*");
      const events = parseIcsEvents(text, source)
        .filter((event) => eventWithinWindow(event, window))
        .sort(sortCalendarEvents);
      return {
        ...source,
        status: "loaded",
        pulledAt: new Date().toISOString(),
        eventCount: events.length,
        events,
        sourceType: "ics-export",
      };
    } catch (error) {
      errors.push(error.message);
    }
  }

  return {
    ...source,
    status: "error",
    pulledAt: new Date().toISOString(),
    eventCount: 0,
    events: [],
    error: errors.slice(-2).join(" | ") || "Calendar source could not be loaded.",
  };
}

async function buildCalendarData() {
  const window = calendarWindow();
  const pulledAt = new Date().toISOString();
  const sources = await Promise.all(calendarSources.map((source) => fetchCalendarSource(source, window)));
  const duplicateSourceUrls = new Set(calendarSources.map((source) => source.url)).size < calendarSources.length;

  return {
    schemaVersion: "hq-calendar/v1",
    refreshSeconds: calendarRefreshSeconds,
    pulledAt,
    pulledAtDisplay: formatDate(pulledAt),
    window: {
      start: window.start,
      end: window.end,
      startDisplay: formatDate(window.start),
      endDisplay: formatDate(window.end),
    },
    defaultSourceId: sources[0]?.id || "",
    duplicateSourceUrls,
    note: duplicateSourceUrls
      ? "Both configured calendar views currently point at the same Confluence Team Calendar URL."
      : "",
    sources,
  };
}

function normalizeCalendarEvents(payload, source) {
  const events = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.events)
      ? payload.events
      : Array.isArray(payload?.payload?.events)
        ? payload.payload.events
        : Array.isArray(payload?.calendarEvents)
          ? payload.calendarEvents
          : Array.isArray(payload?.results)
            ? payload.results
            : [];

  return events.map((event, index) => normalizeCalendarEvent(event, source, index)).filter(Boolean);
}

function normalizeCalendarEvent(event, source, index) {
  const start = coerceCalendarDate(event.start || event.startDate || event.startTime || event.from || event.date || event.when);
  const end = coerceCalendarDate(event.end || event.endDate || event.endTime || event.to || event.until);
  const title = event.title || event.name || event.what || event.summary || "Untitled release event";

  if (!start && !title) {
    return null;
  }

  return {
    id: String(event.id || event.uid || event.eventId || `${source.id}-${index}`),
    calendarId: source.id,
    calendarName: source.name,
    title: String(title),
    start,
    end,
    startDisplay: start ? formatDate(start) : "",
    endDisplay: end ? formatDate(end) : "",
    allDay: Boolean(event.allDay || event.isAllDay || event.isAllDayEvent),
    type: String(event.eventType || event.type || event.eventTypeName || "Release"),
    location: String(event.location || event.where || ""),
    description: normalizeCalendarDescription(event.description || event.notes || event.comment || ""),
    url: String(event.url || event.href || event.link || source.url),
  };
}

function coerceCalendarDate(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "number") {
    return new Date(value).toISOString();
  }

  if (typeof value === "object") {
    return coerceCalendarDate(value.dateTime || value.date || value.time || value.value);
  }

  const text = String(value).trim();
  if (!text) {
    return "";
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function normalizeCalendarDescription(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function eventWithinWindow(event, window) {
  if (!event.start) {
    return true;
  }

  const start = new Date(event.start).getTime();
  if (Number.isNaN(start)) {
    return true;
  }

  return start >= window.startMs && start <= window.endMs;
}

function sortCalendarEvents(a, b) {
  return new Date(a.start || 0).getTime() - new Date(b.start || 0).getTime();
}

function parseIcsEvents(text, source) {
  if (!String(text || "").includes("BEGIN:VCALENDAR")) {
    throw new Error("ICS export did not return a calendar.");
  }

  const unfolded = String(text)
    .replace(/\r\n[ \t]/g, "")
    .replace(/\n[ \t]/g, "")
    .split(/\r?\n/);
  const events = [];
  let current = null;

  for (const line of unfolded) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }

    if (line === "END:VEVENT") {
      if (current) {
        events.push(current);
      }
      current = null;
      continue;
    }

    if (!current) {
      continue;
    }

    const delimiter = line.indexOf(":");
    if (delimiter < 0) {
      continue;
    }

    const name = line.slice(0, delimiter).split(";")[0].toUpperCase();
    const value = decodeIcsValue(line.slice(delimiter + 1));
    current[name] = value;
  }

  return events.map((event, index) => ({
    id: event.UID || `${source.id}-ics-${index}`,
    calendarId: source.id,
    calendarName: source.name,
    title: event.SUMMARY || "Untitled release event",
    start: parseIcsDate(event.DTSTART),
    end: parseIcsDate(event.DTEND),
    startDisplay: parseIcsDate(event.DTSTART) ? formatDate(parseIcsDate(event.DTSTART)) : "",
    endDisplay: parseIcsDate(event.DTEND) ? formatDate(parseIcsDate(event.DTEND)) : "",
    allDay: /^\d{8}$/.test(event.DTSTART || ""),
    type: event.CATEGORIES || "Release",
    location: event.LOCATION || "",
    description: normalizeCalendarDescription(event.DESCRIPTION || ""),
    url: event.URL || source.url,
  }));
}

function decodeIcsValue(value) {
  return String(value || "")
    .replace(/\\n/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function parseIcsDate(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  const dateOnlyMatch = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateOnlyMatch) {
    return `${dateOnlyMatch[1]}-${dateOnlyMatch[2]}-${dateOnlyMatch[3]}T00:00:00.000Z`;
  }

  const dateTimeMatch = text.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (dateTimeMatch) {
    const [, year, month, day, hour, minute, second] = dateTimeMatch;
    return `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
  }

  return coerceCalendarDate(text);
}

function buildJson(issues, jql, previousData, sprintPayload, calendarMenu) {
  const pulledAt = new Date().toISOString();
  const pulledAtDisplay = formatDate(pulledAt);
  const issuesByKey = new Map(issues.map((issue) => [issue.key, issue]));
  const pullDiff = enrichPullDiff(
    buildPullDiff(previousData, issues, pulledAt, pulledAtDisplay),
    issuesByKey,
  );

  return {
    schemaVersion: dashboardDataSchemaVersion,
    version,
    dashboardVersion,
    siteUrl,
    jql,
    pulledAt,
    pulledAtDisplay,
    total: issues.length,
    issues,
    sprintView: sprintPayload ? buildSprintView(sprintPayload.issues || [], sprintPayload, pulledAt, pulledAtDisplay) : null,
    calendarMenu: calendarMenu || null,
    pullDiff,
    pullHistory: buildPullHistory(previousData, pullDiff).map((entry) => enrichPullDiff(entry, issuesByKey)),
  };
}

function buildDashboardData(data) {
  const jiraFilterUrl = `${siteUrl}/issues/?jql=${encodeURIComponent(data.jql)}`;
  return {
    ...data,
    schemaVersion: dashboardDataSchemaVersion,
    schemaVersionNumber: 1,
    dataArtifact: {
      fileName: dashboardDataFileName,
      generatedBy: "pull-jira-release-tickets.cjs",
      schemaVersion: dashboardDataSchemaVersion,
    },
    jiraFilterUrl,
    dashboardVersion,
    repositorySlug,
    dashboardUrl,
    assigneeDispatchEndpoint,
    testChecklistCommentEndpoint,
    assigneeOptions,
  };
}

function renderHtml(data) {
  const readmeUrl = `https://github.com/${repositorySlug}#version-history`;
  const dataJson = serializeJsonForScript(data);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate">
  <meta http-equiv="Pragma" content="no-cache">
  <meta http-equiv="Expires" content="0">
  <link rel="alternate" href="${escapeHtml(data.dataArtifact?.fileName || dashboardDataFileName)}" type="application/json" title="Dashboard data">
  <title>GolfNow CORE Jira Board - ${escapeHtml(version)}</title>
  <style>
    :root {
      color-scheme: light;
      --color-bg-canvas: #f7f9fc;
      --color-bg-panel: #ffffff;
      --color-bg-panel-soft: #fbfcff;
      --color-text-primary: #172033;
      --color-text-muted: #60708d;
      --color-text-subtle: #41506a;
      --color-border-default: #d8dee9;
      --color-border-strong: #cdd7e7;
      --color-accent-primary: #0c66e4;
      --color-accent-primary-hover: #0747a6;
      --color-accent-primary-soft: #eef4ff;
      --color-accent-success: #118d7c;
      --color-accent-success-soft: #e9f7f4;
      --color-accent-warning: #b76e00;
      --color-accent-warning-soft: #fff3d9;
      --color-accent-danger: #c9372c;
      --color-accent-danger-soft: #ffe9e7;
      --status-neutral-bg: #f8fafc;
      --status-neutral-border: #cbd5e1;
      --status-neutral-accent: #64748b;
      --status-neutral-text: #0f172a;
      --status-neutral-chip: #ffffff;
      --status-analysis-bg: #eff6ff;
      --status-analysis-border: #bfdbfe;
      --status-analysis-accent: #2563eb;
      --status-analysis-text: #1e3a8a;
      --status-analysis-chip: #dbeafe;
      --status-dev-bg: #f0f9ff;
      --status-dev-border: #bae6fd;
      --status-dev-accent: #0284c7;
      --status-dev-text: #075985;
      --status-dev-chip: #e0f2fe;
      --status-regression-bg: #ecfeff;
      --status-regression-border: #a5f3fc;
      --status-regression-accent: #0891b2;
      --status-regression-text: #155e75;
      --status-regression-chip: #cffafe;
      --status-qa-bg: #f0fdf4;
      --status-qa-border: #bbf7d0;
      --status-qa-accent: #16a34a;
      --status-qa-text: #166534;
      --status-qa-chip: #dcfce7;
      --status-staging-bg: #fefce8;
      --status-staging-border: #fde68a;
      --status-staging-accent: #ca8a04;
      --status-staging-text: #854d0e;
      --status-staging-chip: #fef3c7;
      --status-prod-bg: #fff7ed;
      --status-prod-border: #fed7aa;
      --status-prod-accent: #ea580c;
      --status-prod-text: #9a3412;
      --status-prod-chip: #ffedd5;
      --status-blocked-bg: #fff1f2;
      --status-blocked-border: #fecdd3;
      --status-blocked-accent: #e11d48;
      --status-blocked-text: #9f1239;
      --status-blocked-chip: #ffe4e6;
      --status-review-bg: #f5f3ff;
      --status-review-border: #ddd6fe;
      --status-review-accent: #7c3aed;
      --status-review-text: #5b21b6;
      --status-review-chip: #ede9fe;
      --status-other-bg: #fdf2f8;
      --status-other-border: #fbcfe8;
      --status-other-accent: #db2777;
      --status-other-text: #9d174d;
      --status-other-chip: #fce7f3;
      --priority-none-bg: #eef2f7;
      --priority-none-text: #41506a;
      --priority-p0-bg: var(--color-accent-danger-soft);
      --priority-p0-text: #b42318;
      --priority-p1-bg: var(--color-accent-warning-soft);
      --priority-p1-text: #854d0e;
      --priority-p2-bg: var(--color-accent-primary-soft);
      --priority-p2-text: #0747a6;
      --priority-p3-bg: var(--color-accent-success-soft);
      --priority-p3-text: #0f766e;
      --bridge-ready-bg: #effcf6;
      --bridge-ready-border: #b9ead2;
      --bridge-ready-dot: #12b76a;
      --bridge-ready-ring: rgba(18, 183, 106, .16);
      --bridge-login-bg: #fffbeb;
      --bridge-login-border: #fde68a;
      --bridge-login-dot: #f59e0b;
      --bridge-login-ring: rgba(245, 158, 11, .16);
      --bridge-offline-bg: #fff3f1;
      --bridge-offline-border: #ffd5d2;
      --bridge-offline-dot: #ef4444;
      --bridge-offline-ring: rgba(239, 68, 68, .14);
      --checklist-empty-bg: #f8fafc;
      --checklist-empty-border: #cbd5e1;
      --checklist-ready-bg: var(--color-accent-success-soft);
      --checklist-ready-text: var(--color-accent-success);
      --checklist-draft-bg: var(--color-accent-warning-soft);
      --checklist-draft-text: var(--color-accent-warning);
      --checklist-submitted-bg: var(--color-accent-primary-soft);
      --checklist-submitted-text: var(--color-accent-primary);
      --board-health-fresh-bg: var(--bridge-ready-bg);
      --board-health-fresh-text: #166534;
      --board-health-stale-bg: var(--bridge-login-bg);
      --board-health-stale-text: #854d0e;
      --board-health-failed-bg: var(--bridge-offline-bg);
      --board-health-failed-text: #9f1239;
      --space-1: 4px;
      --space-2: 6px;
      --space-3: 8px;
      --space-4: 10px;
      --space-5: 12px;
      --space-6: 14px;
      --radius-sm: 6px;
      --radius-md: 8px;
      --radius-lg: 10px;
      --radius-pill: 999px;
      --shadow-panel: 0 18px 45px rgba(23, 32, 51, .11);
      --focus-ring: 0 0 0 3px rgba(12, 102, 228, .22);
      --ink: var(--color-text-primary);
      --muted: var(--color-text-muted);
      --line: var(--color-border-default);
      --paper: var(--color-bg-canvas);
      --panel: var(--color-bg-panel);
      --panel-soft: var(--color-bg-panel-soft);
      --blue: var(--color-accent-primary);
      --blue-soft: var(--color-accent-primary-soft);
      --teal: var(--color-accent-success);
      --teal-soft: var(--color-accent-success-soft);
      --amber: var(--color-accent-warning);
      --amber-soft: var(--color-accent-warning-soft);
      --red: var(--color-accent-danger);
      --red-soft: var(--color-accent-danger-soft);
      --shadow: var(--shadow-panel);
    }

    * {
      box-sizing: border-box;
    }

    html {
      min-width: 0;
    }

    body {
      margin: 0;
      min-width: 320px;
      min-height: 100vh;
      color: var(--ink);
      background: var(--paper);
      font: 13px/1.42 "Segoe UI", Arial, sans-serif;
      letter-spacing: 0;
      overflow-x: hidden;
    }

    body.modal-open {
      overflow: hidden;
    }

    button,
    input,
    select {
      font: inherit;
      letter-spacing: 0;
    }

    :where(a, button, input, select, textarea, [tabindex]):focus-visible {
      outline: 2px solid transparent;
      outline-offset: 2px;
      box-shadow: var(--focus-ring);
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .page {
      width: 100%;
      max-width: 1540px;
      margin: 0 auto;
      padding: clamp(12px, 2vw, 28px);
    }

    .shell {
      width: 100%;
      border: 1px solid rgba(96, 112, 141, .18);
      border-radius: 8px;
      background: rgba(255, 255, 255, .96);
      box-shadow: var(--shadow);
      overflow: hidden;
    }

    header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 20px;
      padding: clamp(18px, 2.3vw, 30px);
      border-bottom: 1px solid var(--line);
      background: linear-gradient(90deg, #fff, #f5f8ff 56%, #f2fbf8);
    }

    h1 {
      margin: 0;
      font-size: clamp(24px, 3.4vw, 34px);
      line-height: 1.08;
      font-weight: 760;
      letter-spacing: 0;
    }

    .subtitle {
      margin-top: 8px;
      color: var(--muted);
      font-size: 14px;
      max-width: 860px;
    }

    .stamp {
      flex: 0 0 auto;
      min-width: min(288px, 100%);
      padding: 12px 14px;
      border: 1px solid #cdd7e7;
      border-radius: 8px;
      background: #fff;
      color: var(--muted);
      line-height: 1.55;
      text-align: right;
    }

    .stamp strong {
      display: block;
      color: var(--ink);
      font-size: 13px;
    }

    .stamp-next,
    .stamp-domain {
      display: block;
    }

    .stamp-next {
      margin-top: 2px;
      color: #334968;
      font-size: 12px;
      font-weight: 720;
    }

    .release-scan {
      display: grid;
      grid-template-columns: minmax(280px, 1.1fr) minmax(240px, .9fr) minmax(220px, .7fr);
      gap: var(--space-6);
      padding: var(--space-6) clamp(18px, 2.3vw, 30px);
      border-bottom: 1px solid var(--line);
      background: #fff;
    }

    .scan-panel {
      display: grid;
      align-content: start;
      gap: var(--space-5);
      min-width: 0;
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-md);
      background: var(--panel-soft);
      padding: var(--space-6);
    }

    .scan-panel.primary {
      background: linear-gradient(135deg, #fff, var(--color-accent-primary-soft));
    }

    .scan-kicker {
      margin: 0;
      color: var(--color-accent-primary);
      font-size: 11px;
      font-weight: 850;
      text-transform: uppercase;
    }

    .scan-title {
      margin: 0;
      color: var(--ink);
      font-size: 20px;
      line-height: 1.15;
    }

    .scan-copy {
      margin: 0;
      color: var(--muted);
      font-size: 13px;
      font-weight: 620;
    }

    .scan-actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
    }

    .scan-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 32px;
      border: 1px solid #cdd7e7;
      border-radius: var(--radius-md);
      background: #fff;
      padding: 6px 10px;
      color: #284263;
      font-size: 12px;
      font-weight: 800;
      text-decoration: none;
    }

    .scan-button.primary {
      border-color: var(--color-accent-primary);
      background: var(--color-accent-primary);
      color: #fff;
    }

    .scan-button:hover,
    .scan-button:focus-visible {
      border-color: var(--color-accent-primary);
      color: var(--color-accent-primary);
      outline: none;
    }

    .scan-button.primary:hover,
    .scan-button.primary:focus-visible {
      background: var(--color-accent-primary-hover);
      color: #fff;
    }

    .release-scan-stats {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-3);
    }

    .scan-stat {
      display: grid;
      gap: 2px;
      min-width: 0;
      border: 1px solid #dce3ef;
      border-radius: var(--radius-md);
      background: #fff;
      padding: var(--space-4);
    }

    .scan-stat strong {
      color: var(--ink);
      font-size: 18px;
      line-height: 1;
    }

    .scan-stat span {
      color: var(--muted);
      font-size: 11px;
      font-weight: 760;
      text-transform: uppercase;
    }

    .scan-list {
      display: grid;
      gap: var(--space-3);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .scan-list li {
      display: grid;
      gap: 2px;
      border-left: 3px solid var(--color-accent-success);
      padding-left: var(--space-4);
      color: #334968;
      font-weight: 700;
    }

    .scan-list span {
      color: var(--muted);
      font-size: 11px;
      font-weight: 680;
    }

    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px clamp(18px, 2.3vw, 30px);
      border-bottom: 1px solid var(--line);
      background: var(--panel-soft);
    }

    .toolbar-group {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .control-button,
    .chip,
    .section-toggle {
      border: 1px solid #cdd7e7;
      border-radius: 8px;
      background: #fff;
      color: #284263;
      cursor: pointer;
      font-weight: 700;
    }

    .control-button {
      min-height: 34px;
      padding: 7px 11px;
    }

    .control-button:hover,
    .chip:hover,
    .section-toggle:hover {
      border-color: #9eb5d5;
      color: var(--blue);
    }

    .control-button[aria-pressed="true"],
    .chip.active {
      border-color: var(--blue);
      background: var(--blue-soft);
      color: #0747a6;
    }

    .filter-state {
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
    }

    .metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 12px;
      padding: 18px clamp(18px, 2.3vw, 30px);
      border-bottom: 1px solid var(--line);
      background: #fff;
    }

    .metric {
      min-width: 0;
      border: 1px solid #dce3ef;
      border-radius: 8px;
      background: #fff;
      padding: 12px 14px;
    }

    .value {
      font-size: 28px;
      font-weight: 780;
      line-height: 1;
    }

    .label {
      margin-top: 5px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
      text-transform: uppercase;
    }

    .metric-detail {
      margin-top: 6px;
      color: #41506a;
      font-size: 11px;
      font-weight: 650;
    }

    .components-panel {
      padding: 16px clamp(18px, 2.3vw, 30px) 18px;
      border-bottom: 1px solid var(--line);
      background: var(--panel-soft);
    }

    .qa-panel {
      background: #fff;
    }

    .priority-panel {
      background: #fff;
    }

    .panel-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
    }

    .panel-title h2 {
      margin: 0;
      font-size: 15px;
      font-weight: 780;
    }

    .title-row,
    .key-row {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }

    .panel-note {
      color: var(--muted);
      font-size: 12px;
      text-align: right;
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-height: 30px;
      padding: 5px 9px;
      max-width: 100%;
    }

    .chip-name {
      overflow-wrap: anywhere;
    }

    .chip-count {
      min-width: 22px;
      border-radius: 999px;
      background: #eef2f7;
      padding: 1px 7px;
      color: #41506a;
      text-align: center;
      font-size: 11px;
    }

    .chip.active .chip-count {
      background: #fff;
      color: #0747a6;
    }

    .priority-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 8px;
    }

    .priority-card {
      min-width: 0;
      border: 1px solid #dce3ef;
      border-radius: 8px;
      background: #fff;
      padding: 9px 10px;
    }

    .priority-card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .priority-total {
      color: var(--ink);
      font-size: 22px;
      font-weight: 780;
      line-height: 1;
    }

    .priority-card-detail {
      margin-top: 6px;
      color: #41506a;
      font-size: 11px;
      font-weight: 650;
    }

    .board {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 365px), 1fr));
      align-items: start;
      gap: 16px;
      padding: 22px clamp(18px, 2.3vw, 30px) 26px;
    }

    .board-column {
      display: grid;
      align-content: start;
      gap: 16px;
      min-width: 0;
    }

    .section {
      min-width: 0;
      border: 1px solid var(--section-border, #dce3ef);
      border-radius: 10px;
      background: var(--section-bg, #fff);
      padding: var(--space-4);
      box-shadow: 0 10px 28px rgba(15, 23, 42, 0.04);
    }

    .section-toggle {
      width: 100%;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
      padding: 9px 10px;
      border-color: var(--section-border, transparent);
      border-top: 3px solid var(--section-accent, var(--blue));
      background: color-mix(in srgb, var(--section-bg, var(--blue-soft)) 84%, #fff);
      color: var(--section-text, #0b3f8a);
      text-align: left;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.82);
    }

    .section .section-toggle:hover {
      border-color: var(--section-accent, #9eb5d5);
      color: var(--section-text, var(--blue));
      background: color-mix(in srgb, var(--section-bg, var(--blue-soft)) 70%, #fff);
    }

    .section-toggle .title {
      overflow-wrap: anywhere;
    }

    .count {
      min-width: 24px;
      border-radius: 999px;
      border: 1px solid var(--section-border, transparent);
      background: var(--section-chip-bg, #fff);
      color: var(--section-text, #0f172a);
      padding: 2px 8px;
      text-align: center;
      font-size: 12px;
    }

    .chevron {
      color: var(--section-accent, #41506a);
      font-size: 12px;
    }

    .section.collapsed .chevron {
      transform: rotate(-90deg);
    }

    .cards {
      display: grid;
      gap: 10px;
    }

    .section.collapsed .cards {
      display: none;
    }

    .ticket,
    .subtask {
      min-width: 0;
      border: 1px solid color-mix(in srgb, var(--section-border, #dce3ef) 68%, #fff);
      border-radius: 8px;
      background: var(--panel);
      padding: 12px;
      break-inside: avoid;
    }

    .ticket.parent-stub {
      border-style: dashed;
      background: #fffdf8;
    }

    .topline {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .key {
      color: var(--blue);
      font-size: 15px;
      font-weight: 800;
      text-decoration: none;
      white-space: nowrap;
    }

    .key:hover {
      text-decoration: underline;
    }

    .copy-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      flex: 0 0 24px;
      border: 1px solid #cdd7e7;
      border-radius: 6px;
      background: #fff;
      color: #41506a;
      cursor: pointer;
      padding: 0;
    }

    .copy-button:hover,
    .copy-button:focus-visible {
      border-color: var(--blue);
      color: var(--blue);
      outline: 0;
    }

    .copy-button.copied {
      border-color: var(--teal);
      background: var(--teal-soft);
      color: var(--teal);
    }

    .copy-button svg {
      width: 14px;
      height: 14px;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
      fill: none;
      pointer-events: none;
    }

    .type {
      border: 1px solid #cfd8e6;
      border-radius: 999px;
      padding: 2px 8px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      text-align: right;
    }

    .summary {
      margin: 8px 0 10px;
      font-size: 13px;
      font-weight: 680;
      overflow-wrap: anywhere;
    }

    .ticket-detail-hierarchy {
      display: grid;
      gap: var(--space-4);
      margin-top: var(--space-4);
    }

    .ticket-detail-group {
      display: grid;
      gap: var(--space-2);
      min-width: 0;
    }

    .ticket-detail-label {
      color: #41506a;
      font-size: 10px;
      font-weight: 850;
      line-height: 1;
      text-transform: uppercase;
    }

    .ticket-detail-group .description-shell,
    .ticket-detail-group .checklist-shell,
    .ticket-detail-group .ticket-actions {
      margin-top: 0;
    }

    .meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 7px 12px;
      color: var(--muted);
      font-size: 11px;
    }

    .meta b {
      display: block;
      color: #41506a;
      font-size: 10px;
      text-transform: uppercase;
    }

    .priority {
      display: inline-block;
      border-radius: 999px;
      padding: 1px 7px;
      background: var(--priority-none-bg);
      color: var(--priority-none-text);
      font-weight: 750;
    }

    .p-p0 {
      background: var(--priority-p0-bg);
      color: var(--priority-p0-text);
    }

    .p-p1 {
      background: var(--priority-p1-bg);
      color: var(--priority-p1-text);
    }

    .p-p2 {
      background: var(--priority-p2-bg);
      color: var(--priority-p2-text);
    }

    .p-p3 {
      background: var(--priority-p3-bg);
      color: var(--priority-p3-text);
    }

    .components-list {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: 3px;
    }

    .component-pill {
      border-radius: 999px;
      background: #eef2f7;
      padding: 2px 7px;
      color: #334968;
      font-size: 11px;
      font-weight: 650;
      overflow-wrap: anywhere;
    }

    .ticket-actions {
      display: grid;
      gap: 6px;
      margin-top: 10px;
    }

    .description-shell {
      margin-top: 10px;
      border-left: 3px solid #c8dcff;
      padding-left: 10px;
    }

    .description-toggle {
      width: 100%;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 8px;
      border: 0;
      border-radius: 6px;
      background: var(--blue-soft);
      padding: 7px 8px;
      color: #0747a6;
      font-size: 11px;
      font-weight: 800;
      text-align: left;
      text-transform: uppercase;
      cursor: pointer;
    }

    .description-toggle:hover {
      color: #05326f;
    }

    .description-toggle .chevron {
      color: #0747a6;
    }

    .description-state {
      border-radius: 999px;
      background: #fff;
      padding: 2px 8px;
      color: #41506a;
      font-size: 11px;
      font-weight: 750;
      text-transform: none;
    }

    .description-panel {
      display: grid;
      gap: 8px;
      max-height: min(72vh, 760px);
      overflow: auto;
      margin-top: 8px;
      border: 1px solid #dce3ef;
      border-radius: 8px;
      background: #fbfcff;
      padding: 10px 11px;
      color: #334968;
      font-size: 12px;
      font-weight: 600;
    }

    .description-panel h3,
    .description-panel h4,
    .description-panel h5 {
      margin: 6px 0 2px;
      color: #172033;
      font-size: 13px;
    }

    .description-panel p {
      margin: 0;
      overflow-wrap: anywhere;
    }

    .description-panel ul,
    .description-panel ol {
      margin: 0;
      padding-left: 18px;
    }

    .description-panel li {
      margin: 3px 0;
    }

    .description-panel blockquote,
    .description-note {
      margin: 0;
      border-left: 3px solid #b8c7dc;
      border-radius: 6px;
      background: #fff;
      padding: 8px 10px;
    }

    .description-panel pre {
      max-width: 100%;
      overflow: auto;
      margin: 0;
      border-radius: 6px;
      background: #172033;
      padding: 10px;
      color: #fff;
      font-size: 11px;
    }

    .description-panel code {
      border-radius: 4px;
      background: #eef2f7;
      padding: 1px 4px;
      color: #172033;
      font-size: 11px;
    }

    .description-panel pre code {
      background: transparent;
      padding: 0;
      color: inherit;
    }

    .description-panel a {
      color: var(--blue);
      font-weight: 750;
    }

    .description-media-group {
      display: grid;
      gap: 10px;
    }

    .description-media {
      margin: 0;
      border: 1px solid #dce3ef;
      border-radius: 8px;
      background: #fff;
      padding: 8px;
    }

    .description-media img,
    .description-media video {
      display: block;
      width: 100%;
      max-height: 560px;
      object-fit: contain;
      border-radius: 6px;
      background: #f7f9fc;
    }

    .description-media video {
      background: #071827;
    }

    .description-media figcaption,
    .description-media-missing {
      margin-top: 6px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    .description-table-wrap {
      max-width: 100%;
      overflow: auto;
    }

    .description-panel table {
      width: 100%;
      border-collapse: collapse;
      background: #fff;
      font-size: 11px;
    }

    .description-panel th,
    .description-panel td {
      border: 1px solid #dce3ef;
      padding: 6px;
      text-align: left;
      vertical-align: top;
    }

    .description-panel th {
      background: #eef4ff;
      color: #172033;
    }

    .description-modal[hidden] {
      display: none;
    }

    .description-modal {
      position: fixed;
      inset: 0;
      z-index: 80;
      display: grid;
      place-items: center;
      padding: 18px;
    }

    .description-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(15, 23, 42, 0.48);
    }

    .description-dialog {
      position: relative;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      width: min(1120px, 100%);
      max-height: min(900px, calc(100vh - 36px));
      overflow: hidden;
      border: 1px solid #cbd7e6;
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 24px 70px rgba(23, 32, 51, 0.28);
    }

    .description-modal-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      align-items: start;
      padding: 16px 18px;
      border-bottom: 1px solid var(--line);
      background: #f8fbff;
    }

    .description-modal-title {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-bottom: 7px;
    }

    .description-modal-title h2 {
      margin: 0;
      color: var(--ink);
      font-size: 18px;
      line-height: 1.25;
    }

    .description-modal-summary {
      margin: 0;
      color: #334968;
      font-size: 13px;
      font-weight: 700;
      line-height: 1.4;
    }

    .description-modal-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
      margin-top: 10px;
    }

    .description-modal-meta span,
    .description-modal-meta a {
      border: 1px solid #dce3ef;
      border-radius: 999px;
      background: #fff;
      padding: 3px 8px;
      color: #41506a;
      font-size: 11px;
      font-weight: 750;
      text-decoration: none;
    }

    .description-close {
      width: 34px;
      height: 34px;
      border-radius: 8px;
      border: 1px solid #cbd7e6;
      background: #fff;
      color: #334968;
      font-size: 20px;
      line-height: 1;
      cursor: pointer;
    }

    .description-close:hover {
      border-color: #9eb1c8;
      color: var(--ink);
    }

    .description-modal-body {
      min-height: 0;
      overflow: auto;
      padding: 18px;
      background: #fff;
    }

    .description-modal-body .description-panel {
      max-height: none;
      margin: 0;
      border: 0;
      background: transparent;
      padding: 0;
      color: #26384f;
      font-size: 14px;
      line-height: 1.5;
    }

    .description-modal-body .description-panel h3,
    .description-modal-body .description-panel h4,
    .description-modal-body .description-panel h5 {
      font-size: 15px;
    }

    .description-modal-body .description-media-group {
      gap: 14px;
    }

    .description-modal-body .description-media {
      padding: 10px;
      background: #f8fafc;
    }

    .description-modal-body .description-media img,
    .description-modal-body .description-media video {
      max-height: min(72vh, 760px);
      border-radius: 6px;
      background: #fff;
    }

    .description-empty {
      color: var(--muted);
      font-style: italic;
    }

    .checklist-shell {
      margin-top: 8px;
    }

    .checklist-toggle {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 8px;
      width: 100%;
      border: 0;
      border-radius: 6px;
      background: var(--teal-soft);
      padding: 7px 8px;
      color: #07584f;
      font-size: 11px;
      font-weight: 800;
      text-align: left;
      text-transform: uppercase;
      cursor: pointer;
    }

    .checklist-toggle:hover {
      color: #053d37;
    }

    .checklist-state {
      border-radius: 999px;
      background: #fff;
      padding: 2px 8px;
      color: #41506a;
      font-size: 11px;
      font-weight: 750;
      text-transform: none;
    }

    .checklist-modal[hidden] {
      display: none;
    }

    .checklist-modal {
      position: fixed;
      inset: 0;
      z-index: 90;
      display: grid;
      place-items: center;
      padding: 18px;
    }

    .checklist-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(15, 23, 42, 0.48);
    }

    .checklist-dialog {
      position: relative;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      width: min(1180px, 100%);
      max-height: min(920px, calc(100vh - 36px));
      overflow: hidden;
      border: 1px solid #b9d5d0;
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 24px 70px rgba(23, 32, 51, 0.28);
    }

    .checklist-modal-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      align-items: start;
      padding: 16px 18px;
      border-bottom: 1px solid var(--line);
      background: #f4fbf9;
    }

    .checklist-modal-title {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-bottom: 7px;
    }

    .checklist-modal-title h2 {
      margin: 0;
      color: var(--ink);
      font-size: 18px;
      line-height: 1.25;
    }

    .checklist-modal-summary {
      margin: 0;
      color: #334968;
      font-size: 13px;
      font-weight: 700;
      line-height: 1.4;
    }

    .checklist-modal-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
      margin-top: 10px;
    }

    .checklist-modal-meta span,
    .checklist-modal-meta a {
      border: 1px solid #dce3ef;
      border-radius: 999px;
      background: #fff;
      padding: 3px 8px;
      color: #41506a;
      font-size: 11px;
      font-weight: 750;
      text-decoration: none;
    }

    .checklist-close {
      width: 34px;
      height: 34px;
      border-radius: 8px;
      border: 1px solid #cbd7e6;
      background: #fff;
      color: #334968;
      font-size: 20px;
      line-height: 1;
      cursor: pointer;
    }

    .checklist-modal-body {
      min-height: 0;
      overflow: auto;
      padding: 18px;
      background: #fff;
    }

    .checklist-toolbar {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 12px;
      align-items: center;
    }

    .checklist-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .checklist-button {
      min-height: 34px;
      border: 1px solid #cdd7e7;
      border-radius: 8px;
      background: #fff;
      padding: 7px 11px;
      color: #284263;
      font-weight: 760;
      cursor: pointer;
    }

    .checklist-button.primary {
      border-color: var(--teal);
      background: var(--teal);
      color: #fff;
    }

    .checklist-button:disabled {
      cursor: not-allowed;
      opacity: .62;
    }

    .checklist-empty {
      border: 1px dashed #b8c7dc;
      border-radius: 8px;
      background: #fbfcff;
      padding: 18px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
      text-align: center;
    }

    .checklist-status {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }

    .checklist-list {
      display: grid;
      gap: 10px;
    }

    .checklist-item {
      display: grid;
      grid-template-columns: 36px minmax(0, 1fr) auto;
      gap: 10px;
      align-items: start;
      border: 1px solid #dce3ef;
      border-left: 4px solid var(--teal);
      border-radius: 8px;
      background: #fbfdfc;
      padding: 10px;
    }

    .checklist-item.is-done {
      border-left-color: #7a869a;
      opacity: .82;
    }

    .checklist-check {
      display: grid;
      place-items: center;
      width: 34px;
      height: 34px;
      border: 1px solid #dce3ef;
      border-radius: 8px;
      background: #fff;
    }

    .checklist-check input {
      width: 17px;
      height: 17px;
      accent-color: var(--teal);
    }

    .checklist-edit-fields {
      display: grid;
      gap: 7px;
      min-width: 0;
    }

    .checklist-title-input,
    .checklist-notes {
      width: 100%;
      min-width: 0;
      border: 1px solid #cdd7e7;
      border-radius: 8px;
      background: #fff;
      color: var(--ink);
      padding: 7px 8px;
      font: inherit;
    }

    .checklist-title-input {
      font-weight: 760;
    }

    .checklist-notes {
      min-height: 56px;
      resize: vertical;
    }

    .checklist-image-add {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: fit-content;
      min-height: 30px;
      border: 1px solid #cdd7e7;
      border-radius: 8px;
      background: #fff;
      padding: 5px 9px;
      color: #284263;
      font-size: 11px;
      font-weight: 760;
      cursor: pointer;
    }

    .checklist-image-add input {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
      pointer-events: none;
    }

    .checklist-images {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 8px;
    }

    .checklist-image {
      overflow: hidden;
      margin: 0;
      border: 1px solid #dce3ef;
      border-radius: 8px;
      background: #fff;
    }

    .checklist-image img {
      display: block;
      width: 100%;
      aspect-ratio: 16 / 10;
      object-fit: cover;
      background: #f7f9fc;
    }

    .checklist-image figcaption {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 6px;
      align-items: center;
      padding: 6px;
      color: #41506a;
      font-size: 11px;
      font-weight: 700;
    }

    .checklist-image-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .checklist-image-remove {
      width: 24px;
      height: 24px;
      border: 1px solid #f0c2bf;
      border-radius: 6px;
      background: #fff;
      color: var(--red);
      cursor: pointer;
      font-weight: 800;
      line-height: 1;
    }

    .checklist-detail {
      color: #41506a;
      font-size: 12px;
      font-weight: 650;
    }

    .checklist-detail summary {
      cursor: pointer;
      color: #07584f;
      font-weight: 800;
    }

    .checklist-detail ul {
      margin: 8px 0 0;
      padding-left: 18px;
    }

    .checklist-remove {
      width: 34px;
      height: 34px;
      border: 1px solid #f0c2bf;
      border-radius: 8px;
      background: #fff;
      color: var(--red);
      cursor: pointer;
      font-weight: 800;
    }

    @media (max-width: 720px) {
      .checklist-item {
        grid-template-columns: 1fr;
      }

      .checklist-check,
      .checklist-remove {
        width: 100%;
      }
    }

    .assign-form {
      display: grid;
      gap: 5px;
      min-width: 0;
    }

    .assign-controls {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto auto;
      align-items: center;
      gap: var(--space-2);
      min-width: 0;
    }

    .assign-select {
      min-width: 0;
      min-height: 30px;
      border: 1px solid #cdd7e7;
      border-radius: 8px;
      background: #fff;
      color: #284263;
      padding: 5px 8px;
      font-size: 11px;
      font-weight: 720;
    }

    .assign-select:focus-visible {
      border-color: var(--blue);
      outline: 2px solid rgba(12, 102, 228, .16);
    }

    .assign-submit,
    .assign-jira-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 28px;
      border: 1px solid #cdd7e7;
      border-radius: 8px;
      background: #fff;
      padding: 5px 9px;
      color: #284263;
      font-size: 11px;
      font-weight: 760;
      text-decoration: none;
    }

    .assign-submit {
      cursor: pointer;
    }

    .assign-submit:disabled {
      cursor: wait;
      opacity: .68;
    }

    .assign-submit:hover,
    .assign-submit:focus-visible,
    .assign-jira-link:hover,
    .assign-jira-link:focus-visible {
      border-color: var(--blue);
      color: var(--blue);
      outline: 0;
    }

    .assign-status {
      min-height: 14px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
    }

    .subtask-shell {
      margin-top: 12px;
      border-left: 3px solid #cde7df;
      padding-left: 10px;
    }

    .subtask-toggle {
      width: 100%;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      border: 0;
      border-radius: 6px;
      background: var(--teal-soft);
      padding: 7px 8px;
      color: #0f6c60;
      font-size: 11px;
      font-weight: 800;
      text-align: left;
      text-transform: uppercase;
      cursor: pointer;
    }

    .subtask-toggle:hover {
      color: #084c44;
    }

    .subtask-toggle .chevron {
      color: #0f6c60;
    }

    .subtask-list {
      display: grid;
      gap: 8px;
    }

    .subtask {
      background: #fbfffd;
      padding: 10px;
    }

    .subtask .key {
      font-size: 13px;
    }

    .subtask .summary {
      margin-bottom: 8px;
      font-size: 12px;
    }

    .subtasks-collapsed {
      margin-top: 8px;
      color: #0f6c60;
      font-size: 12px;
      font-weight: 750;
    }

    .empty {
      grid-column: 1 / -1;
      border: 1px dashed #cdd7e7;
      border-radius: 8px;
      background: #fff;
      padding: 20px;
      color: var(--muted);
      text-align: center;
      font-weight: 700;
    }

    .data-pull,
    .board-directory {
      margin: 0 clamp(18px, 2.3vw, 30px) 12px;
      border: 1px solid #dce3ef;
      border-radius: 8px;
      background: #fff;
      overflow: hidden;
    }

    .board-directory {
      margin-bottom: 24px;
    }

    .data-pull > summary,
    .board-directory > summary {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 12px;
      padding: 13px 14px;
      background: #fbfcff;
      cursor: pointer;
      font-weight: 780;
    }

    .data-pull > summary::-webkit-details-marker,
    .board-directory > summary::-webkit-details-marker {
      display: none;
    }

    .pull-meta {
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
      text-align: right;
    }

    .pull-body,
    .board-directory-body {
      display: grid;
      gap: 14px;
      padding: 14px;
      border-top: 1px solid var(--line);
    }

    .board-directory-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 10px;
    }

    .board-directory-note {
      border-left: 3px solid var(--color-accent-primary);
      border-radius: var(--radius-sm);
      background: var(--color-accent-primary-soft);
      padding: var(--space-4) var(--space-5);
      color: #334968;
      font-size: 12px;
      font-weight: 700;
    }

    .board-directory-link {
      display: grid;
      gap: 6px;
      min-width: 0;
      border: 1px solid #dce3ef;
      border-radius: 8px;
      background: #fbfcff;
      padding: 11px 12px;
      color: #334968;
      text-decoration: none;
    }

    .board-directory-link:hover,
    .board-directory-link:focus-visible {
      border-color: #8db8ff;
      background: #f5f9ff;
      outline: none;
    }

    .board-directory-link b {
      color: var(--blue);
      font-size: 13px;
      font-weight: 850;
    }

    .board-directory-link span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
    }

    .board-directory-link em {
      justify-self: start;
      border-radius: var(--radius-pill);
      background: var(--board-health-fresh-bg);
      padding: 2px 8px;
      color: var(--board-health-fresh-text);
      font-size: 11px;
      font-style: normal;
      font-weight: 780;
    }

    .pull-snapshot,
    .pull-history,
    .pull-entry-body {
      display: grid;
      gap: 12px;
    }

    .pull-section-title {
      margin: 0;
      font-size: 13px;
      font-weight: 800;
    }

    .pull-history-entry {
      border: 1px solid #e1e7f0;
      border-radius: 8px;
      background: #fff;
      overflow: hidden;
    }

    .pull-history-entry > summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      background: #f8fbff;
      cursor: pointer;
      list-style: none;
      font-weight: 780;
    }

    .pull-history-entry > summary::-webkit-details-marker {
      display: none;
    }

    .pull-history-entry > summary::after {
      content: ">";
      color: var(--blue);
      font-weight: 900;
    }

    .pull-history-entry[open] > summary::after {
      content: "v";
    }

    .pull-entry-body {
      padding: 12px;
      border-top: 1px solid var(--line);
    }

    .pull-entry-meta {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }

    .pull-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 10px;
    }

    .pull-stat {
      border: 1px solid #e1e7f0;
      border-radius: 8px;
      background: #fff;
      padding: 10px 12px;
    }

    .pull-stat strong {
      display: block;
      font-size: 20px;
      line-height: 1;
    }

    .pull-stat span {
      display: block;
      margin-top: 5px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 750;
      text-transform: uppercase;
    }

    .pull-stat.is-no-change {
      border-color: #b9ead2;
      background: #effcf6;
    }

    .pull-stat.is-no-change strong {
      color: #057a55;
      font-size: 18px;
    }

    .pull-no-change {
      display: grid;
      gap: 3px;
      border: 1px solid #b9ead2;
      border-radius: 8px;
      background: #effcf6;
      padding: 11px 12px;
    }

    .pull-no-change strong {
      color: #057a55;
      font-size: 14px;
      font-weight: 850;
    }

    .pull-no-change span {
      color: #326152;
      font-size: 12px;
      font-weight: 700;
    }

    .pull-group {
      border-top: 1px solid var(--line);
      padding-top: 12px;
    }

    .pull-group h3 {
      margin: 0 0 8px;
      font-size: 13px;
      font-weight: 800;
    }

    .pull-list {
      display: grid;
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .pull-item {
      border: 1px solid #e1e7f0;
      border-radius: 8px;
      background: #fff;
      padding: 10px;
    }

    .pull-item-title {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 7px;
      font-weight: 750;
    }

    .change-list {
      display: grid;
      gap: 5px;
      margin-top: 8px;
      color: var(--muted);
      font-size: 12px;
    }

    .change-list b {
      color: #334968;
    }

    .parent-context {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: 8px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
    }

    .parent-context b {
      color: #334968;
    }

    .parent-context a {
      color: var(--blue);
      font-weight: 780;
      text-decoration: none;
    }

    .parent-context a:hover {
      text-decoration: underline;
    }

    .no-changes {
      color: var(--muted);
      font-weight: 700;
    }

    .footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      padding: 14px clamp(18px, 2.3vw, 30px) 18px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 12px;
    }

    .footer a {
      color: var(--blue);
      font-weight: 700;
      text-decoration: none;
      white-space: nowrap;
    }

    .footer-links {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: 10px 16px;
    }

    .bridge-tools {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
    }

    .bridge-status {
      display: inline-flex;
      align-items: center;
      gap: var(--space-3);
      min-height: 30px;
      border: 1px solid #d6deea;
      border-radius: 999px;
      background: #fff;
      padding: 5px var(--space-4);
      color: #41506a;
      white-space: nowrap;
    }

    .bridge-login-link {
      display: inline-flex;
      align-items: center;
      min-height: 30px;
      border: 1px solid var(--color-accent-primary);
      border-radius: 8px;
      background: var(--color-accent-primary);
      padding: 6px 12px;
      color: #fff;
      font-size: 12px;
      font-weight: 800;
      text-decoration: none;
      white-space: nowrap;
      box-shadow: 0 8px 18px rgba(12, 102, 228, .16);
    }

    .footer a.bridge-login-link,
    .footer a.bridge-login-link:visited {
      color: #fff;
    }

    .bridge-login-link:hover,
    .bridge-login-link:focus-visible {
      border-color: var(--color-accent-primary-hover);
      background: var(--color-accent-primary-hover);
      color: #fff;
      outline: none;
    }

    .bridge-dot {
      width: 10px;
      height: 10px;
      flex: 0 0 10px;
      border-radius: 999px;
      background: var(--bridge-login-dot);
      box-shadow: 0 0 0 4px var(--bridge-login-ring);
    }

    .bridge-status b {
      color: #334968;
      font-weight: 800;
    }

    .bridge-status small {
      margin-left: 6px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
    }

    .bridge-status.online {
      border-color: var(--bridge-ready-border);
      background: var(--bridge-ready-bg);
    }

    .bridge-status.online .bridge-dot {
      background: var(--bridge-ready-dot);
      box-shadow: 0 0 0 4px var(--bridge-ready-ring);
    }

    .bridge-status.offline {
      border-color: var(--bridge-offline-border);
      background: var(--bridge-offline-bg);
    }

    .bridge-status.offline .bridge-dot {
      background: var(--bridge-offline-dot);
      box-shadow: 0 0 0 4px var(--bridge-offline-ring);
    }

    .bridge-status.protected {
      border-color: var(--bridge-login-border);
      background: var(--bridge-login-bg);
    }

    .bridge-status.protected .bridge-dot {
      background: var(--bridge-login-dot);
      box-shadow: 0 0 0 4px var(--bridge-login-ring);
    }

    @media (max-width: 760px) {
      header,
      .toolbar,
      .release-scan,
      .panel-title,
      .footer {
        flex-direction: column;
        align-items: stretch;
      }

      .release-scan {
        grid-template-columns: 1fr;
      }

      .release-scan-stats {
        grid-template-columns: 1fr;
      }

      .scan-actions {
        display: grid;
        grid-template-columns: 1fr;
      }

      .stamp,
      .panel-note {
        text-align: left;
      }

      .toolbar-group {
        width: 100%;
      }

      .control-button {
        flex: 1 1 150px;
      }

      .meta {
        grid-template-columns: 1fr;
      }

      .assign-controls {
        grid-template-columns: 1fr;
      }

      .data-pull > summary,
      .board-directory > summary {
        grid-template-columns: 1fr;
      }

      .pull-meta {
        text-align: left;
      }

      .footer-links {
        justify-content: flex-start;
      }

      .bridge-status {
        width: 100%;
        justify-content: flex-start;
        white-space: normal;
      }

      .description-modal {
        padding: 10px;
      }

      .description-dialog {
        max-height: calc(100vh - 20px);
      }

      .description-modal-header {
        padding: 12px;
      }

      .description-modal-body {
        padding: 12px;
      }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="shell">
      <header>
        <div>
          <h1>GolfNow CORE Jira Board</h1>
          <div class="subtitle">Latest Jira snapshot for fixVersion ${escapeHtml(version)}, grouped by workflow status and ordered by most recent Jira update.</div>
        </div>
        <div class="stamp">
          <strong>Pulled from Jira</strong>
          <span id="pulled-at"></span> ET
          <span class="stamp-next">Next Refresh on: <span id="next-refresh-at"></span> ET</span>
          <span class="stamp-domain">${escapeHtml(siteUrl.replace("https://", ""))}</span>
        </div>
      </header>

      <section class="release-scan" aria-labelledby="release-scan-title">
        <article class="scan-panel primary">
          <p class="scan-kicker">Release scan</p>
          <h2 class="scan-title" id="release-scan-title">${escapeHtml(version)} QA command center</h2>
          <p class="scan-copy">Changed tickets, QA-ready work, and ticket-local actions are grouped around the current Jira snapshot.</p>
          <div class="scan-actions">
            <a class="scan-button primary" href="#data-pull">Latest changes</a>
            <a class="scan-button" href="#qa-chips">QA filters</a>
            <a class="scan-button" href="#board-directory">Release boards</a>
          </div>
        </article>
        <aside class="scan-panel" aria-label="Release scan metrics">
          <p class="scan-kicker">Snapshot focus</p>
          <div class="release-scan-stats" id="release-scan-stats"></div>
        </aside>
        <aside class="scan-panel" aria-label="Ticket detail order">
          <p class="scan-kicker">Ticket flow</p>
          <ul class="scan-list">
            <li>Changes<span>Latest Jira pull delta</span></li>
            <li>Filters<span>Assignee, component, and priority scan</span></li>
            <li>Actions<span>Description, checklist, assignee, and Jira links</span></li>
          </ul>
        </aside>
      </section>

      <section class="toolbar" aria-label="Board controls">
        <div class="toolbar-group">
          <button class="control-button" id="toggle-subtasks" type="button" aria-pressed="false">Expand all subtasks</button>
          <button class="control-button" id="expand-all" type="button">Expand all sections</button>
          <button class="control-button" id="collapse-all" type="button">Collapse all sections</button>
        </div>
        <div class="filter-state" id="filter-state">Showing all components</div>
      </section>

      <section class="metrics" id="metrics" aria-label="Board metrics"></section>

      <section class="components-panel priority-panel" aria-label="Priority summary">
        <div class="panel-title">
          <div class="title-row">
            <h2>Priority</h2>
          </div>
          <div class="panel-note">Counts include main tickets and subtasks.</div>
        </div>
        <div class="priority-summary" id="priority-summary"></div>
      </section>

      <section class="components-panel" aria-label="Components">
        <div class="panel-title">
          <div class="title-row">
            <h2>Components</h2>
            <button class="copy-button" id="copy-components" type="button" aria-label="Copy component list" title="Copy component list"></button>
          </div>
          <div class="panel-note">Auto-built from the current Jira ticket components.</div>
        </div>
        <div class="chips" id="component-chips"></div>
      </section>

      <section class="components-panel qa-panel" aria-label="QA filters">
        <div class="panel-title">
          <div class="title-row">
            <h2>QA</h2>
          </div>
          <div class="panel-note">Filter tickets by current assignee.</div>
        </div>
        <div class="chips" id="qa-chips"></div>
      </section>

      <section class="board" id="board" aria-label="Jira tickets by status"></section>

      <details class="data-pull" id="data-pull">
        <summary>
          <span>Data Pull</span>
          <span class="pull-meta" id="pull-meta"></span>
        </summary>
        <div class="pull-body" id="pull-body"></div>
      </details>

      <details class="board-directory" id="board-directory">
        <summary>
          <span>Release Boards</span>
          <span class="pull-meta">2 active boards</span>
        </summary>
        <div class="board-directory-body">
          <div class="board-directory-note">Active release boards stay here while the historical and future board registry is prepared.</div>
          <div class="board-directory-list">
            <a class="board-directory-link" href="https://dewankabir009.github.io/jira-board-v3001-122-0/" target="_blank" rel="noopener">
              <b>v3001.122.0 board</b>
              <span>Current 122 release dashboard</span>
              <em>Active</em>
            </a>
            <a class="board-directory-link" href="https://dewankabir009.github.io/jira-board-v3001-123-0/" target="_blank" rel="noopener">
              <b>v3001.123.0 board</b>
              <span>Current 123 release dashboard</span>
              <em>Active</em>
            </a>
          </div>
        </div>
      </details>

      <div class="footer">
        <span id="source-line"></span>
        <span class="footer-links">
          <span class="bridge-tools">
            <span class="bridge-status" id="bridge-status" role="status" aria-live="polite">
              <span class="bridge-dot" aria-hidden="true"></span>
              <span><b>Assignee Bridge Status</b><small id="bridge-status-text">Checking</small></span>
            </span>
          <a class="bridge-login-link" id="bridge-login-link" href="${escapeHtml(assigneeDispatchEndpoint.replace(/\/assign$/, "/status"))}" target="_blank" rel="noopener" title="Open Cloudflare Access login to re-enable assign and checklist comments">Login / re-enable bridge</a>
          </span>
          <a href="${escapeHtml(data.dataArtifact?.fileName || dashboardDataFileName)}">Data artifact</a>
          <a href="modern/">Astro preview</a>
          <a href="${escapeHtml(readmeUrl)}">Dashboard ${escapeHtml(dashboardVersion)} notes</a>
          <a href="${escapeHtml(data.jiraFilterUrl)}">Open Jira filter</a>
        </span>
      </div>
    </section>
  </main>

  <div class="description-modal" id="description-modal" hidden>
    <div class="description-backdrop" data-description-close></div>
    <section class="description-dialog" role="dialog" aria-modal="true" aria-labelledby="description-modal-title">
      <header class="description-modal-header">
        <div>
          <div class="description-modal-title" id="description-modal-title"></div>
          <p class="description-modal-summary" id="description-modal-summary"></p>
          <div class="description-modal-meta" id="description-modal-meta"></div>
        </div>
        <button class="description-close" type="button" data-description-close aria-label="Close description">x</button>
      </header>
      <div class="description-modal-body">
        <div class="description-panel" id="description-modal-content"></div>
      </div>
    </section>
  </div>

  <div class="checklist-modal" id="checklist-modal" hidden>
    <div class="checklist-backdrop" data-checklist-close></div>
    <section class="checklist-dialog" role="dialog" aria-modal="true" aria-labelledby="checklist-modal-title">
      <header class="checklist-modal-header">
        <div>
          <div class="checklist-modal-title" id="checklist-modal-title"></div>
          <p class="checklist-modal-summary" id="checklist-modal-summary"></p>
          <div class="checklist-modal-meta" id="checklist-modal-meta"></div>
        </div>
        <button class="checklist-close" type="button" data-checklist-close aria-label="Close checklist">x</button>
      </header>
      <div class="checklist-modal-body">
        <div class="checklist-toolbar">
          <span class="checklist-status" id="checklist-progress"></span>
          <div class="checklist-actions">
            <button class="checklist-button" id="checklist-add" type="button">Add test case</button>
            <button class="checklist-button primary" id="checklist-post" type="button">Post checklist as Comment</button>
          </div>
        </div>
        <div class="checklist-list" id="checklist-modal-content"></div>
        <p class="checklist-status" id="checklist-post-status" role="status" aria-live="polite"></p>
      </div>
    </section>
  </div>

  <script id="jira-data" type="application/json">${dataJson}</script>
  <script>
    (function () {
      "use strict";

      var data = JSON.parse(document.getElementById("jira-data").textContent);
      var dataArtifactUrl = data.dataArtifact && data.dataArtifact.fileName ? data.dataArtifact.fileName : "dashboard-data.json";
      var state = {
        activeComponent: "all",
        activeQa: "all",
        collapsedStatuses: new Set(),
        expandedSubtasks: new Set(),
        activeDescriptionKey: null,
        activeChecklistKey: null,
        activeChecklistItems: []
      };
      var githubRepo = data.repositorySlug || ${JSON.stringify(repositorySlug)};
      var dashboardUrl = data.dashboardUrl || ${JSON.stringify(dashboardUrl)};
      var assigneeDispatchEndpoint = data.assigneeDispatchEndpoint || ${JSON.stringify(assigneeDispatchEndpoint)};
      var testChecklistCommentEndpoint = data.testChecklistCommentEndpoint || ${JSON.stringify(testChecklistCommentEndpoint)};
      var assigneeNames = data.assigneeOptions || [
        "Dewan Kabir",
        "Nicole Greer",
        "Alex McNay",
        "Anton Yurkevich"
      ];
      var qaNames = assigneeNames;
      var statusOrder = [
        "Blocked",
        "Analysis",
        "Pre Planning",
        "Code Review",
        "Pending Deployment (DEV)",
        "Pending Deployment (STG)",
        "Pending Deployment (PROD)",
        "QA Testing (DEV)",
        "QA Testing (STG)",
        "Closed"
      ];
      var priorityOrder = ["P0", "P1", "P2", "P3", "None"];
      var priorityLabels = {
        None: "No Priority"
      };

      function text(value) {
        return String(value == null ? "" : value);
      }

      function escape(value) {
        return text(value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }

      function priorityKey(priority) {
        var value = text(priority).trim();
        if (!value || value.toLowerCase() === "none" || value.toLowerCase() === "no priority") {
          return "None";
        }
        var normalized = value.toUpperCase();
        return priorityOrder.indexOf(normalized) === -1 ? value : normalized;
      }

      function priorityLabel(priority) {
        var key = priorityKey(priority);
        return priorityLabels[key] || key;
      }

      function priorityClass(priority) {
        return "p-" + priorityKey(priority).toLowerCase().replace(/[^a-z0-9]+/g, "-");
      }

      function copyIcon() {
        return "<svg viewBox=\\"0 0 24 24\\" aria-hidden=\\"true\\"><rect x=\\"9\\" y=\\"9\\" width=\\"13\\" height=\\"13\\" rx=\\"2\\" ry=\\"2\\"></rect><path d=\\"M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1\\"></path></svg>";
      }

      function renderKeyLink(issue) {
        return "<span class=\\"key-row\\">" +
          "<a class=\\"key\\" href=\\"" + escape(issue.url) + "\\">" + escape(issue.key) + "</a>" +
          "<button class=\\"copy-button\\" type=\\"button\\" data-copy-link=\\"" + escape(issue.url) + "\\" aria-label=\\"Copy " + escape(issue.key) + " link\\" title=\\"Copy " + escape(issue.key) + " link\\">" + copyIcon() + "</button>" +
        "</span>";
      }

      function optionSelected(left, right) {
        return text(left).toLowerCase() === text(right).toLowerCase() ? " selected" : "";
      }

      function getActionsWorkflowUrl() {
        return "https://github.com/" + encodeURIComponent(githubRepo).replace("%2F", "/") +
          "/actions/workflows/update-jira-assignee.yml";
      }

      function getAssigneeStatusEndpoint() {
        return assigneeDispatchEndpoint.replace(/\\/assign$/, "/status");
      }

      function getBridgeLoginUrl() {
        return getAssigneeStatusEndpoint();
      }

      function formatEasternTimestamp(date) {
        return new Intl.DateTimeFormat("en-US", {
          timeZone: "America/New_York",
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit"
        }).format(date);
      }

      function getNextRefreshDate() {
        var now = new Date();
        var next = new Date(now.getTime());
        next.setSeconds(0, 0);
        if (next <= now) {
          next.setMinutes(next.getMinutes() + 1);
        }

        var remainder = next.getMinutes() % 5;
        if (remainder !== 0) {
          next.setMinutes(next.getMinutes() + (5 - remainder));
        }

        return next;
      }

      function renderNextRefresh() {
        var target = document.getElementById("next-refresh-at");
        if (target) {
          target.textContent = formatEasternTimestamp(getNextRefreshDate());
        }
      }

      function cacheBustedUrl(paramName) {
        var url = new URL(window.location.href);
        url.searchParams.set(paramName, String(Date.now()));
        return url.toString();
      }

      function readPulledAtFromHtml(html) {
        var start = '<script id="jira-data" type="application/json">';
        var end = "<\\/script>";
        var startIndex = html.indexOf(start);
        if (startIndex === -1) {
          return "";
        }

        var endIndex = html.indexOf(end, startIndex);
        if (endIndex === -1) {
          return "";
        }

        try {
          return JSON.parse(html.slice(startIndex + start.length, endIndex)).pulledAt || "";
        } catch (error) {
          return "";
        }
      }

      function checkForFreshDeployment() {
        if (!/^https?:$/.test(window.location.protocol) || !window.fetch || !data.pulledAt) {
          return;
        }

        fetch(cacheBustedUrl("freshnessCheck"), { cache: "no-store" })
          .then(function (response) {
            if (!response.ok) {
              throw new Error("Freshness check failed.");
            }
            return response.text();
          })
          .then(function (html) {
            var latestPulledAt = readPulledAtFromHtml(html);
            var currentTime = Date.parse(data.pulledAt || "");
            var latestTime = Date.parse(latestPulledAt || "");
            if (!Number.isNaN(currentTime) && !Number.isNaN(latestTime) && latestTime > currentTime) {
              window.location.replace(cacheBustedUrl("fresh"));
            }
          })
          .catch(function () {
            // Keep the dashboard usable even if GitHub Pages is briefly slow.
          });
      }

      function setBridgeStatus(mode, message) {
        var badge = document.getElementById("bridge-status");
        var textNode = document.getElementById("bridge-status-text");
        if (!badge || !textNode) {
          return;
        }

        badge.classList.remove("online", "offline", "protected");
        if (mode) {
          badge.classList.add(mode);
        }
        textNode.textContent = message;
        badge.title = "Assignee Bridge Status: " + message;
      }

      function isHostedBridgeEndpoint() {
        return /jira-board-assignee-bridge\\.dfkabir253\\.workers\\.dev/i.test(assigneeDispatchEndpoint);
      }

      function configureBridgeLoginLink() {
        var loginLink = document.getElementById("bridge-login-link");
        if (loginLink) {
          loginLink.href = getBridgeLoginUrl();
        }
      }

      function checkBridgeStatus() {
        setBridgeStatus("", "Checking");
        fetch(getAssigneeStatusEndpoint(), { method: "GET", cache: "no-store", credentials: "include" })
          .then(function (response) {
            return response.json().catch(function () {
              return { ok: false, message: "Unreadable bridge response." };
            }).then(function (payload) {
              if (!response.ok || !payload.ok) {
                throw new Error(payload.message || payload.error || "Bridge is not ready.");
              }
              return payload;
            });
          })
          .then(function () {
            setBridgeStatus("online", "Ready");
          })
          .catch(function () {
            if (isHostedBridgeEndpoint()) {
              setBridgeStatus("protected", "Login required");
              return;
            }
            setBridgeStatus("offline", "Offline");
          });
      }

      function fallbackCopyText(value) {
        var textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        textarea.style.top = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }

      function copyText(value) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          return navigator.clipboard.writeText(value).catch(function () {
            fallbackCopyText(value);
          });
        }

        fallbackCopyText(value);
        return Promise.resolve();
      }

      function markCopied(button) {
        button.classList.add("copied");
        window.setTimeout(function () {
          button.classList.remove("copied");
        }, 1200);
      }

      function issueComponents(issue) {
        return Array.isArray(issue.components) ? issue.components : [];
      }

      function hasComponent(issue, component) {
        if (component === "all") {
          return true;
        }

        return issueComponents(issue).indexOf(component) !== -1;
      }

      function hasQa(issue, qaName) {
        return qaName === "all" || issue.assignee === qaName;
      }

      function issueMatchesFilters(issue) {
        return hasComponent(issue, state.activeComponent) && hasQa(issue, state.activeQa);
      }

      function sortByUpdatedDesc(left, right) {
        return new Date(right.updated || 0) - new Date(left.updated || 0);
      }

      function getPriorityRank(priority) {
        var index = priorityOrder.indexOf(priorityKey(priority));
        return index === -1 ? priorityOrder.length : index;
      }

      function sortCardsByPriority(left, right) {
        return getPriorityRank(left.issue.priority) - getPriorityRank(right.issue.priority) ||
          sortByUpdatedDesc(left.issue, right.issue);
      }

      function getStatusRank(status) {
        var index = statusOrder.indexOf(status);
        return index === -1 ? statusOrder.length : index;
      }

      function getComponentCounts() {
        var counts = new Map();

        data.issues.forEach(function (issue) {
          issueComponents(issue).forEach(function (component) {
            counts.set(component, (counts.get(component) || 0) + 1);
          });
        });

        return Array.from(counts.entries()).sort(function (left, right) {
          return right[1] - left[1] || left[0].localeCompare(right[0]);
        });
      }

      function getQaCounts() {
        return qaNames.map(function (qaName) {
          var count = data.issues.filter(function (issue) {
            return issue.assignee === qaName;
          }).length;
          return [qaName, count];
        });
      }

      function getPriorityCounts() {
        return priorityOrder.map(function (priority) {
          var issues = data.issues.filter(function (issue) {
            return priorityKey(issue.priority) === priority;
          });
          var subtasks = issues.filter(function (issue) {
            return issue.isSubtask;
          }).length;

          return {
            priority: priority,
            label: priorityLabel(priority),
            total: issues.length,
            main: issues.length - subtasks,
            subtasks: subtasks
          };
        });
      }

      function getIssueModel() {
        var issueByKey = new Map();
        var subtasksByParent = new Map();
        var primaryIssues = [];
        var orphanSubtasks = [];

        data.issues.forEach(function (issue) {
          issueByKey.set(issue.key, issue);
        });

        data.issues.forEach(function (issue) {
          if (!issue.isSubtask) {
            primaryIssues.push(issue);
            return;
          }

          if (issue.parent && issueByKey.has(issue.parent.key)) {
            if (!subtasksByParent.has(issue.parent.key)) {
              subtasksByParent.set(issue.parent.key, []);
            }
            subtasksByParent.get(issue.parent.key).push(issue);
          } else {
            orphanSubtasks.push(issue);
          }
        });

        subtasksByParent.forEach(function (items) {
          items.sort(sortByUpdatedDesc);
        });

        var cards = primaryIssues.map(function (issue) {
          return {
            issue: issue,
            subtasks: subtasksByParent.get(issue.key) || [],
            isParentStub: false
          };
        });

        var orphanGroups = new Map();
        orphanSubtasks.forEach(function (issue) {
          var parentKey = issue.parent ? issue.parent.key : "No parent";
          var groupKey = parentKey + "|" + issue.status;

          if (!orphanGroups.has(groupKey)) {
            orphanGroups.set(groupKey, {
              issue: {
                key: parentKey,
                url: issue.parent ? issue.parent.url : data.jiraFilterUrl,
                summary: issue.parent && issue.parent.summary ? issue.parent.summary : "Subtasks without a parent in this release",
                type: issue.parent && issue.parent.type ? issue.parent.type : "Parent",
                status: issue.status,
                priority: issue.parent && issue.parent.priority ? issue.parent.priority : "None",
                assignee: "Parent outside this release",
                assignedDeveloper: "Parent outside this release",
                updated: issue.updated,
                updatedDisplay: issue.updatedDisplay,
                components: [],
                description: issue.parent && issue.parent.description ? issue.parent.description : "",
                descriptionHtml: "",
                descriptionImageCount: 0,
                descriptionVideoCount: 0,
                descriptionMediaCount: 0,
                commentCount: 0,
                comments: [],
                isSubtask: false
              },
              subtasks: [],
              isParentStub: true
            });
          }

          orphanGroups.get(groupKey).subtasks.push(issue);
        });

        orphanGroups.forEach(function (card) {
          card.subtasks.sort(sortByUpdatedDesc);
          cards.push(card);
        });

        cards.sort(function (left, right) {
          var rank = getStatusRank(left.issue.status) - getStatusRank(right.issue.status);
          return rank || sortCardsByPriority(left, right);
        });

        return cards;
      }

      function cardMatchesFilters(card) {
        return issueMatchesFilters(card.issue) ||
          card.subtasks.some(function (subtask) {
            return issueMatchesFilters(subtask);
          });
      }

      function visibleSubtasksForCard(card) {
        return card.subtasks.filter(issueMatchesFilters);
      }

      function getVisibleSubtaskCards() {
        return getIssueModel().filter(cardMatchesFilters).filter(function (card) {
          return card.subtasks.some(function (subtask) {
            return issueMatchesFilters(subtask);
          });
        });
      }

      function buildMetrics(cards) {
        var visibleIssues = [];
        cards.forEach(function (card) {
          visibleIssues.push(card.issue);
          card.subtasks.forEach(function (subtask) {
            visibleIssues.push(subtask);
          });
        });

        var subtaskCount = data.issues.filter(function (issue) { return issue.isSubtask; }).length;
        var mainCount = data.issues.filter(function (issue) { return !issue.isSubtask; }).length;
        function statusSplit(status) {
          var matching = data.issues.filter(function (issue) { return issue.status === status; });
          var subtasks = matching.filter(function (issue) { return issue.isSubtask; }).length;
          return {
            total: matching.length,
            main: matching.length - subtasks,
            subtasks: subtasks
          };
        }
        function splitDetail(split) {
          return split.main + " main / " + split.subtasks + " subtasks";
        }
        var qaSplit = statusSplit("QA Testing (DEV)");
        var pendingDevSplit = statusSplit("Pending Deployment (DEV)");
        var highPriorityCount = data.issues.filter(function (issue) {
          var priority = priorityKey(issue.priority);
          return priority === "P0" || priority === "P1";
        }).length;

        var metrics = [
          { value: data.total, label: "Tracked tickets", detail: mainCount + " main / " + subtaskCount + " subtasks" },
          { value: qaSplit.total, label: "QA Testing (DEV)", detail: splitDetail(qaSplit) },
          { value: pendingDevSplit.total, label: "Pending Deployment (DEV)", detail: splitDetail(pendingDevSplit) },
          { value: highPriorityCount, label: "P0/P1 priority items" },
          { value: subtaskCount, label: "Subtasks linked" }
        ];

        document.getElementById("metrics").innerHTML = metrics.map(function (metric) {
          return "<div class=\\"metric\\"><div class=\\"value\\">" + escape(metric.value) + "</div><div class=\\"label\\">" + escape(metric.label) + "</div>" + (metric.detail ? "<div class=\\"metric-detail\\">" + escape(metric.detail) + "</div>" : "") + "</div>";
        }).join("");
      }

      function renderReleaseScan() {
        var diff = data.pullDiff || {};
        var lists = getDiffLists(diff);
        var changedCount = lists.added.length + lists.updated.length + lists.statusChanges.length + lists.removed.length;
        var latestChangeValue = diff.isBaseline ? "Baseline" : (changedCount || "No Change");
        var qaReadyCount = data.issues.filter(function (issue) {
          return text(issue.status).toLowerCase().indexOf("qa testing") >= 0;
        }).length;
        var checklistCount = data.issues.filter(function (issue) {
          return !issue.isSubtask &&
            issue.testChecklist &&
            Array.isArray(issue.testChecklist.testCases) &&
            issue.testChecklist.testCases.length;
        }).length;
        var highPriorityCount = data.issues.filter(function (issue) {
          var priority = priorityKey(issue.priority);
          return priority === "P0" || priority === "P1";
        }).length;
        var unassignedCount = data.issues.filter(function (issue) {
          return !issue.isSubtask && text(issue.assignee).toLowerCase() === "unassigned";
        }).length;
        var stats = [
          { value: latestChangeValue, label: "Latest changes" },
          { value: qaReadyCount, label: "QA testing" },
          { value: checklistCount, label: "Checklists" },
          { value: highPriorityCount, label: "P0/P1" },
          { value: unassignedCount, label: "Unassigned" },
          { value: data.total, label: "Tracked" }
        ];

        document.getElementById("release-scan-stats").innerHTML = stats.map(function (stat) {
          return "<div class=\\"scan-stat\\"><strong>" + escape(stat.value) + "</strong><span>" + escape(stat.label) + "</span></div>";
        }).join("");
      }

      function renderPrioritySummary() {
        document.getElementById("priority-summary").innerHTML = getPriorityCounts().map(function (entry) {
          return "<div class=\\"priority-card\\">" +
            "<div class=\\"priority-card-top\\">" +
              "<span class=\\"priority " + escape(priorityClass(entry.priority)) + "\\">" + escape(entry.label) + "</span>" +
              "<span class=\\"priority-total\\">" + escape(entry.total) + "</span>" +
            "</div>" +
            "<div class=\\"priority-card-detail\\">" + escape(entry.main + " main / " + entry.subtasks + " subtasks") + "</div>" +
          "</div>";
        }).join("");
      }

      function renderComponentChips() {
        var chips = [
          "<button class=\\"chip " + (state.activeComponent === "all" ? "active" : "") + "\\" type=\\"button\\" data-component=\\"all\\"><span class=\\"chip-name\\">All components</span><span class=\\"chip-count\\">" + data.total + "</span></button>"
        ];

        getComponentCounts().forEach(function (entry) {
          var component = entry[0];
          var count = entry[1];
          chips.push(
            "<button class=\\"chip " + (state.activeComponent === component ? "active" : "") + "\\" type=\\"button\\" data-component=\\"" + escape(component) + "\\">" +
              "<span class=\\"chip-name\\">" + escape(component) + "</span>" +
              "<span class=\\"chip-count\\">" + escape(count) + "</span>" +
            "</button>"
          );
        });

        document.getElementById("component-chips").innerHTML = chips.join("");
      }

      function renderQaChips() {
        var chips = [
          "<button class=\\"chip " + (state.activeQa === "all" ? "active" : "") + "\\" type=\\"button\\" data-qa=\\"all\\"><span class=\\"chip-name\\">All QAs</span><span class=\\"chip-count\\">" + data.total + "</span></button>"
        ];

        getQaCounts().forEach(function (entry) {
          var qaName = entry[0];
          var count = entry[1];
          chips.push(
            "<button class=\\"chip " + (state.activeQa === qaName ? "active" : "") + "\\" type=\\"button\\" data-qa=\\"" + escape(qaName) + "\\">" +
              "<span class=\\"chip-name\\">" + escape(qaName) + "</span>" +
              "<span class=\\"chip-count\\">" + escape(count) + "</span>" +
            "</button>"
          );
        });

        document.getElementById("qa-chips").innerHTML = chips.join("");
      }

      function renderComponents(components) {
        if (!components || !components.length) {
          return "<span class=\\"component-pill\\">None</span>";
        }

        return components.map(function (component) {
          return "<span class=\\"component-pill\\">" + escape(component) + "</span>";
        }).join("");
      }

      function renderDescriptionText(value) {
        var description = text(value).trim();
        if (!description) {
          return "<p class=\\"description-empty\\">No description provided.</p>";
        }

        return description.split(/\\n{2,}/).map(function (paragraph) {
          return "<p>" + paragraph.split(/\\n/).map(escape).join("<br>") + "</p>";
        }).join("");
      }

      function hasDescription(issue) {
        return text(issue.description).trim().length > 0 ||
          text(issue.descriptionHtml).trim().length > 0 ||
          Number(issue.descriptionMediaCount || issue.descriptionImageCount || 0) > 0;
      }

      function renderDescriptionContent(issue) {
        if (text(issue.descriptionHtml).trim()) {
          return issue.descriptionHtml;
        }

        return renderDescriptionText(issue.description);
      }

      function renderDescription(issue) {
        var hasIssueDescription = hasDescription(issue);
        var imageCount = Number(issue.descriptionImageCount || 0);
        var videoCount = Number(issue.descriptionVideoCount || 0);
        var mediaCount = Number(issue.descriptionMediaCount || imageCount + videoCount);
        var stateLabel = !hasIssueDescription
          ? "Empty"
          : (mediaCount ? mediaCount + " media" : "View");

        return "<div class=\\"description-shell" + (hasIssueDescription ? "" : " is-empty") + "\\">" +
          "<button class=\\"description-toggle\\" type=\\"button\\" aria-haspopup=\\"dialog\\" data-description-for=\\"" + escape(issue.key) + "\\">" +
            "<span>Description</span>" +
            "<span class=\\"description-state\\">" + escape(stateLabel) + "</span>" +
            "<span class=\\"chevron\\">></span>" +
          "</button>" +
        "</div>";
      }

      function hasSourceTestChecklist(issue) {
        return Boolean(issue && issue.testChecklist &&
          Array.isArray(issue.testChecklist.testCases) &&
          issue.testChecklist.testCases.length);
      }

      function canUseChecklist(issue) {
        return Boolean(issue && !issue.isSubtask);
      }

      function getChecklistFiles(issue) {
        return issue && issue.testChecklist && Array.isArray(issue.testChecklist.files)
          ? issue.testChecklist.files
          : [];
      }

      function renderTestChecklist(issue) {
        if (!canUseChecklist(issue)) {
          return "";
        }

        var items = loadChecklistItems(issue);
        var fileCount = getChecklistFiles(issue).length;
        var label = items.length || hasSourceTestChecklist(issue) ? "Test Checklist" : "Add Testing Checklist";
        var stateLabel = items.length
          ? items.length + " test case" + (items.length === 1 ? "" : "s")
          : "Empty";

        return "<div class=\\"checklist-shell\\">" +
          "<button class=\\"checklist-toggle\\" type=\\"button\\" aria-haspopup=\\"dialog\\" data-checklist-for=\\"" + escape(issue.key) + "\\">" +
            "<span>" + escape(label) + "</span>" +
            "<span class=\\"checklist-state\\">" + escape(stateLabel) + "</span>" +
            "<span class=\\"chevron\\">></span>" +
          "</button>" +
          "<span class=\\"sr-only\\">" + escape(fileCount + " Markdown file" + (fileCount === 1 ? "" : "s")) + "</span>" +
        "</div>";
      }

      function findChecklistIssue(issueKey) {
        var cards = getIssueModel();
        for (var index = 0; index < cards.length; index += 1) {
          if (cards[index].issue.key === issueKey && canUseChecklist(cards[index].issue)) {
            return cards[index].issue;
          }
        }

        return data.issues.find(function (issue) {
          return issue.key === issueKey && canUseChecklist(issue);
        });
      }

      function checklistStorageKey(issue) {
        var files = getChecklistFiles(issue).map(function (file) {
          return file.id || file.filename;
        }).join("|") || "manual";
        return "jira-test-checklist-v1:" + data.version + ":" + issue.key + ":" + files;
      }

      function baseChecklistItems(issue) {
        var testCases = issue && issue.testChecklist && Array.isArray(issue.testChecklist.testCases)
          ? issue.testChecklist.testCases
          : [];

        return testCases.map(function (testCase, index) {
          var displayTitle = (testCase.id ? testCase.id + ": " : "") + (testCase.title || "Untitled test case");

          return {
            id: (testCase.sourceFile || "source") + "::" + (testCase.id || "TC") + "::" + index,
            sourceId: testCase.id || "",
            sourceFile: testCase.sourceFile || "",
            category: testCase.category || "",
            blocking: Boolean(testCase.blocking),
            title: displayTitle,
            done: false,
            notes: "",
            images: [],
            description: testCase.description || "",
            checks: Array.isArray(testCase.checks) ? testCase.checks : []
          };
        });
      }

      function loadChecklistItems(issue) {
        var baseItems = baseChecklistItems(issue);
        var saved = null;

        try {
          saved = JSON.parse(localStorage.getItem(checklistStorageKey(issue)) || "null");
        } catch (error) {
          saved = null;
        }

        if (!saved || !Array.isArray(saved.items)) {
          return baseItems;
        }

        var deletedSourceIds = new Set(Array.isArray(saved.deletedSourceIds) ? saved.deletedSourceIds : []);
        var savedById = new Map(saved.items.map(function (item) {
          return [item.id, item];
        }));
        var merged = baseItems.filter(function (item) {
          return !deletedSourceIds.has(item.id);
        }).map(function (item) {
          var savedItem = savedById.get(item.id);
          if (!savedItem) {
            return item;
          }
          return {
            ...item,
            title: text(savedItem.title) || item.title,
            done: Boolean(savedItem.done),
            notes: text(savedItem.notes),
            images: Array.isArray(savedItem.images) ? savedItem.images : []
          };
        });

        saved.items.forEach(function (item) {
          if (item.manual && !merged.some(function (candidate) { return candidate.id === item.id; })) {
            merged.push({
              id: item.id,
              manual: true,
              sourceId: "",
              sourceFile: "Manual",
              category: "Manual",
              blocking: false,
              title: text(item.title) || "New test case",
              done: Boolean(item.done),
              notes: text(item.notes),
              images: Array.isArray(item.images) ? item.images : [],
              description: "",
              checks: []
            });
          }
        });

        return merged;
      }

      function saveChecklistItems(issue) {
        if (!issue) {
          return;
        }

        try {
          var activeIds = new Set(state.activeChecklistItems.map(function (item) {
            return item.id;
          }));
          var deletedSourceIds = baseChecklistItems(issue)
            .filter(function (item) { return !activeIds.has(item.id); })
            .map(function (item) { return item.id; });

          localStorage.setItem(checklistStorageKey(issue), JSON.stringify({
            savedAt: new Date().toISOString(),
            deletedSourceIds: deletedSourceIds,
            items: state.activeChecklistItems.map(function (item) {
              return {
                id: item.id,
                manual: Boolean(item.manual),
                title: item.title,
                done: Boolean(item.done),
                notes: item.notes || "",
                images: Array.isArray(item.images) ? item.images : []
              };
            })
          }));
        } catch (error) {
          console.warn("Could not save checklist locally.", error);
        }
      }

      function updateChecklistProgress() {
        var total = state.activeChecklistItems.length;
        var done = state.activeChecklistItems.filter(function (item) {
          return item.done;
        }).length;
        var progress = document.getElementById("checklist-progress");
        if (progress) {
          progress.textContent = done + " of " + total + " complete";
        }
        var postButton = document.getElementById("checklist-post");
        if (postButton) {
          postButton.disabled = total === 0;
        }
      }

      function renderChecklistDetail(item) {
        var parts = [];
        if (item.category) {
          parts.push("<p><b>Category:</b> " + escape(item.category) + "</p>");
        }
        if (item.blocking) {
          parts.push("<p><b>Blocking:</b> Yes</p>");
        }
        if (item.description) {
          parts.push("<p>" + escape(item.description) + "</p>");
        }
        if (item.checks && item.checks.length) {
          parts.push("<ul>" + item.checks.map(function (check) {
            return "<li>" + escape(check) + "</li>";
          }).join("") + "</ul>");
        }

        if (!parts.length) {
          return "";
        }

        return "<details class=\\"checklist-detail\\">" +
          "<summary>Details" + (item.checks && item.checks.length ? " / " + item.checks.length + " checks" : "") + "</summary>" +
          parts.join("") +
        "</details>";
      }

      function renderChecklistImages(item) {
        var images = Array.isArray(item.images) ? item.images : [];
        if (!images.length) {
          return "";
        }

        return "<div class=\\"checklist-images\\">" + images.map(function (image) {
          return "<figure class=\\"checklist-image\\">" +
            "<img src=\\"" + escape(image.dataUrl || "") + "\\" alt=\\"" + escape(image.name || "Checklist image") + "\\">" +
            "<figcaption>" +
              "<span class=\\"checklist-image-name\\">" + escape(image.name || "Checklist image") + "</span>" +
              "<button class=\\"checklist-image-remove\\" type=\\"button\\" data-checklist-image-remove=\\"" + escape(item.id) + "\\" data-image-id=\\"" + escape(image.id) + "\\" aria-label=\\"Remove image\\">x</button>" +
            "</figcaption>" +
          "</figure>";
        }).join("") + "</div>";
      }

      function renderChecklistItems() {
        var content = document.getElementById("checklist-modal-content");
        if (!content) {
          return;
        }

        if (!state.activeChecklistItems.length) {
          content.innerHTML = "<div class=\\"checklist-empty\\">No test cases yet. Use Add test case to start a manual checklist.</div>";
          updateChecklistProgress();
          return;
        }

        content.innerHTML = state.activeChecklistItems.map(function (item) {
          return "<article class=\\"checklist-item" + (item.done ? " is-done" : "") + "\\" data-checklist-item=\\"" + escape(item.id) + "\\">" +
            "<label class=\\"checklist-check\\">" +
              "<input type=\\"checkbox\\" data-checklist-done=\\"" + escape(item.id) + "\\"" + (item.done ? " checked" : "") + " aria-label=\\"Mark test case complete\\">" +
            "</label>" +
            "<div class=\\"checklist-edit-fields\\">" +
              "<input class=\\"checklist-title-input\\" data-checklist-title=\\"" + escape(item.id) + "\\" value=\\"" + escape(item.title) + "\\" spellcheck=\\"true\\" lang=\\"en\\" aria-label=\\"Test case title\\">" +
              "<textarea class=\\"checklist-notes\\" data-checklist-notes=\\"" + escape(item.id) + "\\" placeholder=\\"Notes\\" spellcheck=\\"true\\" aria-label=\\"Test case notes\\">" + escape(item.notes || "") + "</textarea>" +
              renderChecklistDetail(item) +
              renderChecklistImages(item) +
              "<label class=\\"checklist-image-add\\"><input type=\\"file\\" accept=\\"image/*\\" multiple data-checklist-images=\\"" + escape(item.id) + "\\"><span>Attach images</span></label>" +
            "</div>" +
            "<button class=\\"checklist-remove\\" type=\\"button\\" data-checklist-remove=\\"" + escape(item.id) + "\\" aria-label=\\"Remove test case\\">x</button>" +
          "</article>";
        }).join("");
        updateChecklistProgress();
      }

      function openChecklistModal(issueKey) {
        var issue = findChecklistIssue(issueKey);
        if (!issue) {
          return;
        }

        state.activeChecklistKey = issue.key;
        state.activeChecklistItems = loadChecklistItems(issue);
        document.getElementById("checklist-post-status").textContent = "";
        document.getElementById("checklist-modal-title").innerHTML =
          renderKeyLink(issue) + "<h2>Test Checklist</h2>";
        document.getElementById("checklist-modal-summary").textContent = issue.summary || "";
        document.getElementById("checklist-modal-meta").innerHTML =
          "<span>" + escape(issue.type || "Ticket") + "</span>" +
          "<span>Status: " + escape(issue.status || "No status") + "</span>" +
          "<span>Priority: " + escape(priorityLabel(issue.priority)) + "</span>" +
          "<span>Source: " + escape(getChecklistFiles(issue).map(function (file) { return file.filename; }).join(", ") || "Manual checklist") + "</span>" +
          "<a href=\\"" + escape(issue.url) + "\\" target=\\"_blank\\" rel=\\"noopener\\">Open Jira</a>";
        renderChecklistItems();
        document.getElementById("checklist-modal").hidden = false;
        document.body.classList.add("modal-open");
        var closeButton = document.querySelector("[data-checklist-close].checklist-close");
        if (closeButton) {
          closeButton.focus();
        }
      }

      function closeChecklistModal() {
        state.activeChecklistKey = null;
        state.activeChecklistItems = [];
        document.getElementById("checklist-modal").hidden = true;
        document.getElementById("checklist-modal-content").innerHTML = "";
        document.body.classList.remove("modal-open");
        renderAll();
      }

      function getActiveChecklistIssue() {
        return state.activeChecklistKey ? findChecklistIssue(state.activeChecklistKey) : null;
      }

      function findChecklistItem(itemId) {
        return state.activeChecklistItems.find(function (item) {
          return item.id === itemId;
        });
      }

      function refreshChecklistToggle(issue) {
        if (!issue) {
          return;
        }

        Array.prototype.slice.call(document.querySelectorAll(".checklist-toggle")).forEach(function (button) {
          if (button.getAttribute("data-checklist-for") !== issue.key) {
            return;
          }
          var shell = button.closest(".checklist-shell");
          if (shell) {
            shell.outerHTML = renderTestChecklist(issue);
          }
        });
      }

      function countChecklistImages(items) {
        return (items || []).reduce(function (total, item) {
          return total + (Array.isArray(item.images) ? item.images.length : 0);
        }, 0);
      }

      function makeManualChecklistItem() {
        return {
          id: "manual::" + Date.now() + "::" + Math.random().toString(36).slice(2, 8),
          manual: true,
          sourceId: "",
          sourceFile: "Manual",
          category: "Manual",
          blocking: false,
          title: "New test case",
          done: false,
          notes: "",
          images: [],
          description: "",
          checks: []
        };
      }

      function readFileAsDataUrl(file) {
        return new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onload = function () { resolve(reader.result); };
          reader.onerror = function () { reject(reader.error || new Error("Could not read image.")); };
          reader.readAsDataURL(file);
        });
      }

      function loadImageForChecklist(dataUrl) {
        return new Promise(function (resolve, reject) {
          var image = new Image();
          image.onload = function () { resolve(image); };
          image.onerror = function () { reject(new Error("Could not load image.")); };
          image.src = dataUrl;
        });
      }

      function imageOutputSize(width, height) {
        var maxEdge = 1400;
        var ratio = Math.min(1, maxEdge / Math.max(width, height));
        return {
          width: Math.max(1, Math.round(width * ratio)),
          height: Math.max(1, Math.round(height * ratio))
        };
      }

      function compressChecklistImage(file) {
        return readFileAsDataUrl(file).then(function (dataUrl) {
          return loadImageForChecklist(dataUrl).then(function (image) {
            var size = imageOutputSize(image.naturalWidth || image.width, image.naturalHeight || image.height);
            var canvas = document.createElement("canvas");
            canvas.width = size.width;
            canvas.height = size.height;
            var context = canvas.getContext("2d");
            context.fillStyle = "#fff";
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            var output = canvas.toDataURL("image/jpeg", 0.82);
            return {
              id: "image::" + Date.now() + "::" + Math.random().toString(36).slice(2, 8),
              name: file.name || "checklist-image.jpg",
              mimeType: "image/jpeg",
              dataUrl: output,
              width: size.width,
              height: size.height,
              size: output.length
            };
          });
        });
      }

      function attachImagesToChecklistItem(itemId, files) {
        var issue = getActiveChecklistIssue();
        var item = findChecklistItem(itemId);
        var status = document.getElementById("checklist-post-status");
        var selectedFiles = Array.prototype.slice.call(files || []).filter(function (file) {
          return file && /^image\\//i.test(file.type || "");
        });

        if (!item || !selectedFiles.length) {
          return Promise.resolve();
        }

        var existingForItem = Array.isArray(item.images) ? item.images.length : 0;
        var existingTotal = countChecklistImages(state.activeChecklistItems);
        var roomForItem = Math.max(0, 4 - existingForItem);
        var roomForChecklist = Math.max(0, 16 - existingTotal);
        var accepted = selectedFiles.slice(0, Math.min(roomForItem, roomForChecklist));

        if (!accepted.length) {
          if (status) {
            status.textContent = "Image limit reached. Use up to 4 images per item and 16 per checklist.";
          }
          return Promise.resolve();
        }

        if (status) {
          status.textContent = "Preparing " + accepted.length + " image" + (accepted.length === 1 ? "" : "s") + "...";
        }

        return Promise.all(accepted.map(compressChecklistImage)).then(function (images) {
          item.images = (Array.isArray(item.images) ? item.images : []).concat(images);
          saveChecklistItems(issue);
          renderChecklistItems();
          refreshChecklistToggle(issue);
          if (status) {
            status.textContent = "Attached " + images.length + " image" + (images.length === 1 ? "" : "s") + ".";
          }
        }).catch(function (error) {
          if (status) {
            status.textContent = "Could not attach one of the selected images.";
          }
          console.error(error);
        });
      }

      function buildChecklistPostPayload(issue) {
        return {
          issueKey: issue.key,
          issueUrl: issue.url,
          summary: issue.summary,
          releaseVersion: data.version,
          repositorySlug: githubRepo,
          dashboardUrl: window.location.href,
          sourceFiles: getChecklistFiles(issue).map(function (file) {
            return file.filename;
          }),
          items: state.activeChecklistItems.map(function (item) {
            return {
              title: item.title,
              done: Boolean(item.done),
              notes: item.notes || "",
              images: Array.isArray(item.images) ? item.images : []
            };
          })
        };
      }

      function postActiveChecklist() {
        var issue = getActiveChecklistIssue();
        var status = document.getElementById("checklist-post-status");
        var button = document.getElementById("checklist-post");
        if (!issue) {
          return;
        }

        if (!state.activeChecklistItems.length) {
          status.textContent = "Add at least one test case before posting.";
          return;
        }

        var imageCount = countChecklistImages(state.activeChecklistItems);
        var confirmMessage = "Post this checklist as a Jira comment on " + issue.key + "?";
        if (imageCount) {
          confirmMessage = "Post this checklist with " + imageCount + " image" + (imageCount === 1 ? "" : "s") + " as a Jira comment on " + issue.key + "?";
        }

        if (!window.confirm(confirmMessage)) {
          return;
        }

        saveChecklistItems(issue);
        status.textContent = imageCount ? "Posting checklist and images..." : "Posting checklist...";
        button.disabled = true;

        fetch(testChecklistCommentEndpoint, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          credentials: "include",
          body: JSON.stringify(buildChecklistPostPayload(issue))
        })
          .then(function (response) {
            return response.json().catch(function () {
              return { ok: false, error: "The checklist bridge returned an unreadable response." };
            }).then(function (payload) {
              if (!response.ok || !payload.ok) {
                throw new Error(payload.error || "The checklist bridge rejected the request.");
              }
              return payload;
            });
          })
          .then(function () {
            status.textContent = "Jira comment request accepted.";
          })
          .catch(function (error) {
            status.textContent = "Bridge could not post the Jira comment. Use Login / re-enable bridge, then retry.";
            if (isHostedBridgeEndpoint()) {
              setBridgeStatus("protected", "Login required");
            }
            console.error(error);
          })
          .finally(function () {
            button.disabled = false;
          });
      }

      function findDescriptionIssue(issueKey) {
        var cards = getIssueModel();
        for (var index = 0; index < cards.length; index += 1) {
          if (cards[index].issue.key === issueKey) {
            return cards[index].issue;
          }

          var subtask = cards[index].subtasks.find(function (item) {
            return item.key === issueKey;
          });
          if (subtask) {
            return subtask;
          }
        }

        return data.issues.find(function (issue) {
          return issue.key === issueKey;
        });
      }

      function openDescriptionModal(issueKey) {
        var issue = findDescriptionIssue(issueKey);
        if (!issue) {
          return;
        }

        state.activeDescriptionKey = issue.key;
        document.getElementById("description-modal-title").innerHTML =
          renderKeyLink(issue) + "<h2>Description</h2>";
        document.getElementById("description-modal-summary").textContent = issue.summary || "";
        document.getElementById("description-modal-meta").innerHTML =
          "<span>" + escape(issue.type || "Ticket") + "</span>" +
          "<span>Status: " + escape(issue.status || "No status") + "</span>" +
          "<span>Priority: " + escape(priorityLabel(issue.priority)) + "</span>" +
          "<span>Updated: " + escape(issue.updatedDisplay || "Unknown") + "</span>" +
          "<span>Media: " + escape(Number(issue.descriptionMediaCount || issue.descriptionImageCount || 0)) + "</span>" +
          "<a href=\\"" + escape(issue.url) + "\\" target=\\"_blank\\" rel=\\"noopener\\">Open Jira</a>";
        document.getElementById("description-modal-content").innerHTML = renderDescriptionContent(issue);
        document.getElementById("description-modal").hidden = false;
        document.body.classList.add("modal-open");
        var closeButton = document.querySelector("[data-description-close].description-close");
        if (closeButton) {
          closeButton.focus();
        }
      }

      function closeDescriptionModal() {
        state.activeDescriptionKey = null;
        document.getElementById("description-modal").hidden = true;
        document.getElementById("description-modal-content").innerHTML = "";
        document.body.classList.remove("modal-open");
      }

      function renderMeta(issue, includeStatus) {
        var status = includeStatus ? "<div><b>Status</b>" + escape(issue.status) + "</div>" : "";
        return "<div class=\\"meta\\">" +
          "<div><b>Assignee</b>" + escape(issue.assignee) + "</div>" +
          "<div><b>Assigned Developer</b>" + escape(issue.assignedDeveloper || "Unassigned") + "</div>" +
          "<div><b>Priority</b><span class=\\"priority " + escape(priorityClass(issue.priority)) + "\\">" + escape(issue.priority) + "</span></div>" +
          status +
          "<div><b>Updated</b>" + escape(issue.updatedDisplay) + "</div>" +
          "<div><b>Components</b><div class=\\"components-list\\">" + renderComponents(issueComponents(issue)) + "</div></div>" +
        "</div>";
      }

      function renderIssueActions(issue) {
        var selectId = "assign-" + escape(issue.key);
        var actionsUrl = getActionsWorkflowUrl();
        var options = [
          "<option value=\\"\\">Assignee</option>"
        ].concat(assigneeNames.map(function (name) {
          return "<option value=\\"" + escape(name) + "\\"" + optionSelected(name, issue.assignee) + ">" + escape(name) + "</option>";
        })).join("");

        return "<div class=\\"ticket-actions\\">" +
          "<form class=\\"assign-form\\" data-assign-form data-issue-key=\\"" + escape(issue.key) + "\\" data-issue-summary=\\"" + escape(issue.summary) + "\\" data-current-assignee=\\"" + escape(issue.assignee) + "\\">" +
            "<label class=\\"sr-only\\" for=\\"" + selectId + "\\">Assignee for " + escape(issue.key) + "</label>" +
            "<div class=\\"assign-controls\\">" +
              "<select class=\\"assign-select\\" id=\\"" + selectId + "\\" name=\\"assignee\\" aria-label=\\"Assignee for " + escape(issue.key) + "\\">" + options + "</select>" +
              "<button class=\\"assign-submit\\" type=\\"submit\\">Submit</button>" +
              "<a class=\\"assign-jira-link\\" href=\\"" + escape(actionsUrl) + "\\" target=\\"_blank\\" rel=\\"noopener\\">Actions</a>" +
              "<a class=\\"assign-jira-link\\" href=\\"" + escape(issue.url) + "\\" target=\\"_blank\\" rel=\\"noopener\\">Jira</a>" +
            "</div>" +
            "<span class=\\"assign-status\\" role=\\"status\\"></span>" +
          "</form>" +
        "</div>";
      }

      function renderTicketDetailGroup(label, body, className) {
        if (!body) {
          return "";
        }

        return "<section class=\\"ticket-detail-group " + escape(className || "") + "\\">" +
          "<div class=\\"ticket-detail-label\\">" + escape(label) + "</div>" +
          body +
        "</section>";
      }

      function renderSubtask(subtask) {
        return "<article class=\\"subtask\\">" +
          "<div class=\\"topline\\">" +
            renderKeyLink(subtask) +
            "<span class=\\"type\\">" + escape(subtask.type) + "</span>" +
          "</div>" +
          "<p class=\\"summary\\">" + escape(subtask.summary) + "</p>" +
          "<div class=\\"ticket-detail-hierarchy\\">" +
            renderTicketDetailGroup("Description", renderDescription(subtask), "detail-description") +
            renderTicketDetailGroup("Fields", renderMeta(subtask, true), "detail-fields") +
            renderTicketDetailGroup("Actions", renderIssueActions(subtask), "detail-actions") +
          "</div>" +
        "</article>";
      }

      function renderCard(card) {
        var issue = card.issue;
        var visibleSubtasks = visibleSubtasksForCard(card);
        var className = "ticket" + (card.isParentStub ? " parent-stub" : "");
        var subtaskBlock = "";

        if (visibleSubtasks.length) {
          var expanded = state.expandedSubtasks.has(issue.key);
          subtaskBlock =
            "<div class=\\"subtask-shell\\">" +
              "<button class=\\"subtask-toggle\\" type=\\"button\\" aria-expanded=\\"" + expanded + "\\" data-subtasks-for=\\"" + escape(issue.key) + "\\">" +
                "<span>Subtasks</span>" +
                "<span class=\\"count\\">" + visibleSubtasks.length + "</span>" +
                "<span class=\\"chevron\\">" + (expanded ? "v" : ">") + "</span>" +
              "</button>" +
              (expanded
                ? "<div class=\\"subtask-list\\">" + visibleSubtasks.map(renderSubtask).join("") + "</div>"
                : "<div class=\\"subtasks-collapsed\\">Main ticket only. Expand to review linked subtasks.</div>") +
            "</div>";
        }

        return "<article class=\\"" + className + "\\">" +
          "<div class=\\"topline\\">" +
            renderKeyLink(issue) +
            "<span class=\\"type\\">" + escape(issue.type) + "</span>" +
          "</div>" +
          "<p class=\\"summary\\">" + escape(issue.summary) + "</p>" +
          "<div class=\\"ticket-detail-hierarchy\\">" +
            renderTicketDetailGroup("Description", renderDescription(issue), "detail-description") +
            renderTicketDetailGroup("Checklist", renderTestChecklist(issue), "detail-checklist") +
            renderTicketDetailGroup("Fields", renderMeta(issue, false), "detail-fields") +
            renderTicketDetailGroup("Actions", renderIssueActions(issue), "detail-actions") +
          "</div>" +
          subtaskBlock +
        "</article>";
      }

      function groupCards(cards) {
        var groups = new Map();

        cards.forEach(function (card) {
          var status = card.issue.status || "No status";
          if (!groups.has(status)) {
            groups.set(status, []);
          }
          groups.get(status).push(card);
        });

        groups.forEach(function (statusCards) {
          statusCards.sort(sortCardsByPriority);
        });

        return Array.from(groups.entries()).sort(function (left, right) {
          return getStatusRank(left[0]) - getStatusRank(right[0]) || left[0].localeCompare(right[0]);
        });
      }

      function getBoardColumnCount(board) {
        var width = board.clientWidth || window.innerWidth;
        if (width < 760) {
          return 1;
        }
        if (width < 1120) {
          return 2;
        }
        return 3;
      }

      function estimateCardWeight(card) {
        var weight = 2.8;
        var summaryLength = text(card.issue.summary).length;
        weight += Math.min(1.3, summaryLength / 90);
        weight += issueComponents(card.issue).length * 0.25;

        if (card.subtasks.length) {
          weight += 0.9;
          if (state.expandedSubtasks.has(card.issue.key)) {
            weight += card.subtasks.reduce(function (total, subtask) {
              return total + 1.8 + Math.min(1.1, text(subtask.summary).length / 100) + issueComponents(subtask).length * 0.18;
            }, 0);
          }
        }

        return weight;
      }

      function estimateSectionWeight(status, statusCards) {
        if (state.collapsedStatuses.has(status)) {
          return 1.2;
        }

        return 1.4 + statusCards.reduce(function (total, card) {
          return total + estimateCardWeight(card);
        }, 0);
      }

      function dashboardToken(name, fallback) {
        var value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return value || fallback;
      }

      function sectionThemeFromTokens(prefix, fallback) {
        return {
          bg: dashboardToken(prefix + "-bg", fallback.bg),
          border: dashboardToken(prefix + "-border", fallback.border),
          accent: dashboardToken(prefix + "-accent", fallback.accent),
          text: dashboardToken(prefix + "-text", fallback.text),
          chip: dashboardToken(prefix + "-chip", fallback.chip)
        };
      }

      var sectionThemeTokens = [
        sectionThemeFromTokens("--status-neutral", { bg: "#f8fafc", border: "#cbd5e1", accent: "#64748b", text: "#0f172a", chip: "#ffffff" }),
        sectionThemeFromTokens("--status-analysis", { bg: "#eff6ff", border: "#bfdbfe", accent: "#2563eb", text: "#1e3a8a", chip: "#dbeafe" }),
        sectionThemeFromTokens("--status-dev", { bg: "#f0f9ff", border: "#bae6fd", accent: "#0284c7", text: "#075985", chip: "#e0f2fe" }),
        sectionThemeFromTokens("--status-regression", { bg: "#ecfeff", border: "#a5f3fc", accent: "#0891b2", text: "#155e75", chip: "#cffafe" }),
        sectionThemeFromTokens("--status-qa", { bg: "#f0fdf4", border: "#bbf7d0", accent: "#16a34a", text: "#166534", chip: "#dcfce7" }),
        sectionThemeFromTokens("--status-staging", { bg: "#fefce8", border: "#fde68a", accent: "#ca8a04", text: "#854d0e", chip: "#fef3c7" }),
        sectionThemeFromTokens("--status-prod", { bg: "#fff7ed", border: "#fed7aa", accent: "#ea580c", text: "#9a3412", chip: "#ffedd5" }),
        sectionThemeFromTokens("--status-blocked", { bg: "#fff1f2", border: "#fecdd3", accent: "#e11d48", text: "#9f1239", chip: "#ffe4e6" }),
        sectionThemeFromTokens("--status-review", { bg: "#f5f3ff", border: "#ddd6fe", accent: "#7c3aed", text: "#5b21b6", chip: "#ede9fe" }),
        sectionThemeFromTokens("--status-other", { bg: "#fdf2f8", border: "#fbcfe8", accent: "#db2777", text: "#9d174d", chip: "#fce7f3" })
      ];

      function getSectionTheme(status) {
        var normalized = text(status).toLowerCase();

        if (normalized.indexOf("blocked") >= 0) {
          return sectionThemeTokens[7];
        }
        if (normalized.indexOf("analysis") >= 0) {
          return sectionThemeTokens[1];
        }
        if (normalized.indexOf("pre planning") >= 0) {
          return sectionThemeTokens[0];
        }
        if (normalized.indexOf("code review") >= 0) {
          return sectionThemeTokens[8];
        }
        if (normalized.indexOf("pending deployment") >= 0 && normalized.indexOf("dev") >= 0) {
          return sectionThemeTokens[2];
        }
        if (normalized.indexOf("pending deployment") >= 0 && normalized.indexOf("stg") >= 0) {
          return sectionThemeTokens[5];
        }
        if (normalized.indexOf("pending deployment") >= 0 && normalized.indexOf("prod") >= 0) {
          return sectionThemeTokens[6];
        }
        if (normalized.indexOf("qa testing") >= 0) {
          return sectionThemeTokens[4];
        }
        if (normalized.indexOf("regression") >= 0) {
          return sectionThemeTokens[3];
        }

        var hash = 0;
        for (var index = 0; index < normalized.length; index += 1) {
          hash = ((hash << 5) - hash) + normalized.charCodeAt(index);
          hash |= 0;
        }
        return sectionThemeTokens[Math.abs(hash) % sectionThemeTokens.length];
      }

      function renderSectionThemeStyle(status) {
        var theme = getSectionTheme(status);
        return [
          "--section-bg:" + theme.bg,
          "--section-border:" + theme.border,
          "--section-accent:" + theme.accent,
          "--section-text:" + theme.text,
          "--section-chip-bg:" + theme.chip,
        ].join(";");
      }

      function renderSection(status, statusCards) {
        var issueCount = statusCards.reduce(function (total, card) {
          return total + 1 + visibleSubtasksForCard(card).length;
        }, 0);
        var collapsed = state.collapsedStatuses.has(status);
        var sectionStyle = renderSectionThemeStyle(status);

        return "<section class=\\"section " + (collapsed ? "collapsed" : "") + "\\" data-status=\\"" + escape(status) + "\\" style=\\"" + sectionStyle + "\\">" +
          "<button class=\\"section-toggle\\" type=\\"button\\" aria-expanded=\\"" + (!collapsed) + "\\" data-status=\\"" + escape(status) + "\\">" +
            "<span class=\\"title\\">" + escape(status) + "</span>" +
            "<span class=\\"count\\">" + issueCount + "</span>" +
            "<span class=\\"chevron\\">v</span>" +
          "</button>" +
          "<div class=\\"cards\\">" + statusCards.map(renderCard).join("") + "</div>" +
        "</section>";
      }

      function renderBoard() {
        var cards = getIssueModel().filter(cardMatchesFilters);
        var board = document.getElementById("board");
        var groups = groupCards(cards);

        buildMetrics(cards);
        renderPrioritySummary();
        renderComponentChips();
        renderQaChips();

        if (!groups.length) {
          board.innerHTML = "<div class=\\"empty\\">No tickets match the selected filters.</div>";
          return;
        }

        var columns = Array.from({ length: getBoardColumnCount(board) }, function () {
          return { weight: 0, sections: [] };
        });

        groups.forEach(function (entry) {
          var status = entry[0];
          var statusCards = entry[1];
          var target = columns.reduce(function (best, column) {
            return column.weight < best.weight ? column : best;
          }, columns[0]);

          target.sections.push(renderSection(status, statusCards));
          target.weight += estimateSectionWeight(status, statusCards);
        });

        board.innerHTML = columns.map(function (column) {
          return "<div class=\\"board-column\\">" + column.sections.join("") + "</div>";
        }).join("");
      }

      function renderFilterState() {
        var filters = [];
        if (state.activeComponent !== "all") {
          filters.push("Component: " + state.activeComponent);
        }
        if (state.activeQa !== "all") {
          filters.push("QA: " + state.activeQa);
        }

        document.getElementById("filter-state").textContent = filters.length
          ? "Filtered by " + filters.join(" / ")
          : "Showing all tickets";
      }

      function renderParentContext(issue) {
        if (!issue.isSubtask || !issue.parent) {
          return "";
        }

        return "<div class=\\"parent-context\\">" +
          "<b>Parent:</b>" +
          "<a href=\\"" + escape(issue.parent.url) + "\\">" + escape(issue.parent.key) + "</a>" +
          "<span>" + escape(issue.parent.summary || "") + "</span>" +
        "</div>";
      }

      function renderPullIssue(issue) {
        return "<span class=\\"pull-item-title\\">" +
          renderKeyLink(issue) +
          "<span>" + escape(issue.summary || "") + "</span>" +
        "</span>" +
        renderParentContext(issue);
      }

      function renderChange(change) {
        return "<div><b>" + escape(change.label) + ":</b> " +
          "<span>" + escape(change.before) + "</span> -> " +
          "<span>" + escape(change.after) + "</span></div>";
      }

      function renderPullGroup(title, items, renderer) {
        if (!items.length) {
          return "";
        }

        return "<section class=\\"pull-group\\">" +
          "<h3>" + escape(title) + "</h3>" +
          "<ul class=\\"pull-list\\">" + items.map(function (item) {
            return "<li class=\\"pull-item\\">" + renderer(item) + "</li>";
          }).join("") + "</ul>" +
        "</section>";
      }

      function getDiffLists(diff) {
        return {
          added: diff.added || [],
          removed: diff.removed || [],
          updated: diff.updated || [],
          statusChanges: diff.statusChanges || []
        };
      }

      function pullHasChanges(diff) {
        var lists = getDiffLists(diff || {});
        return lists.added.length || lists.removed.length || lists.updated.length || lists.statusChanges.length;
      }

      function plural(count, singular, pluralText) {
        return count === 1 ? singular : (pluralText || singular + "s");
      }

      function renderPullStats(diff) {
        var lists = getDiffLists(diff || {});
        var stats = [
          { value: lists.added.length, label: "Added" },
          { value: lists.updated.length, label: "Updated" },
          { value: lists.statusChanges.length, label: "Status moves" },
          { value: lists.removed.length, label: "Removed" }
        ];

        if (!diff.isBaseline && !pullHasChanges(diff)) {
          stats.unshift({ value: "No Change", label: "Since previous pull", className: " is-no-change" });
        }

        return stats.map(function (stat) {
          return "<div class=\\"pull-stat" + (stat.className || "") + "\\"><strong>" + escape(stat.value) + "</strong><span>" + escape(stat.label) + "</span></div>";
        }).join("");
      }

      function renderPullTiming(diff) {
        var previous = diff.previousPulledAtDisplay || "No previous pull";
        var current = diff.currentPulledAtDisplay || data.pulledAtDisplay;

        return "<div class=\\"change-list\\">" +
          "<div><b>Previous pull:</b> " + escape(previous) + "</div>" +
          "<div><b>Most recent pull:</b> " + escape(current) + " ET</div>" +
        "</div>";
      }

      function renderDiffDetails(diff) {
        var lists = getDiffLists(diff || {});
        var hasChanges = pullHasChanges(diff);
        var baselineNote = diff.isBaseline
          ? "<div class=\\"no-changes\\">Baseline pull captured. Future pulls will compare against this snapshot.</div>"
          : "";
        var emptyNote = !diff.isBaseline && !hasChanges
          ? "<div class=\\"pull-no-change\\"><strong>No Change</strong><span>Latest Jira pull completed. Ticket fields match the previous snapshot.</span></div>"
          : "";

        return baselineNote +
          emptyNote +
          renderPullGroup("Added tickets", lists.added, function (issue) {
            return renderPullIssue(issue) +
              "<div class=\\"change-list\\"><div><b>Status:</b> " + escape(issue.status) + "</div><div><b>Updated:</b> " + escape(issue.updatedDisplay) + "</div></div>";
          }) +
          renderPullGroup("Updated tickets", lists.updated, function (item) {
            return renderPullIssue(item) +
              "<div class=\\"change-list\\">" + (item.changes || []).map(renderChange).join("") + "</div>";
          }) +
          renderPullGroup("Status changes", lists.statusChanges, function (item) {
            return renderPullIssue(item) +
              "<div class=\\"change-list\\"><div><b>Status:</b> " + escape(item.before) + " -> " + escape(item.after) + "</div></div>";
          }) +
          renderPullGroup("Removed tickets", lists.removed, function (issue) {
            return renderPullIssue(issue) +
              "<div class=\\"change-list\\"><div><b>Last known status:</b> " + escape(issue.status) + "</div></div>";
          });
      }

      function renderPullComparison(diff) {
        return "<section class=\\"pull-snapshot\\">" +
          "<h3 class=\\"pull-section-title\\">Latest comparison</h3>" +
          renderPullTiming(diff) +
          "<div class=\\"pull-stats\\">" + renderPullStats(diff) + "</div>" +
          renderDiffDetails(diff) +
        "</section>";
      }

      function renderHistorySummary(diff) {
        var lists = getDiffLists(diff || {});
        var parts = [];

        if (lists.added.length) {
          parts.push(lists.added.length + " " + plural(lists.added.length, "added ticket"));
        }
        if (lists.updated.length) {
          parts.push(lists.updated.length + " " + plural(lists.updated.length, "updated ticket"));
        }
        if (lists.statusChanges.length) {
          parts.push(lists.statusChanges.length + " " + plural(lists.statusChanges.length, "status move"));
        }
        if (lists.removed.length) {
          parts.push(lists.removed.length + " " + plural(lists.removed.length, "removed ticket"));
        }

        return parts.length ? parts.join(", ") : "No Change";
      }

      function renderHistoryEntry(diff, index) {
        var current = diff.currentPulledAtDisplay || data.pulledAtDisplay;
        return "<details class=\\"pull-history-entry\\"" + (index === 0 ? " open" : "") + ">" +
          "<summary><span>" + escape(current) + " ET</span><span class=\\"pull-entry-meta\\">" + escape(renderHistorySummary(diff)) + "</span></summary>" +
          "<div class=\\"pull-entry-body\\">" +
            renderPullTiming(diff) +
            "<div class=\\"pull-stats\\">" + renderPullStats(diff) + "</div>" +
            renderDiffDetails(diff) +
          "</div>" +
        "</details>";
      }

      function renderPullHistory(history, latestDiff) {
        var latestId = latestDiff.currentPulledAt || "";
        var changedHistory = history.filter(function (entry) {
          return pullHasChanges(entry) && entry.currentPulledAt !== latestId;
        });

        if (!changedHistory.length) {
          return "";
        }

        return "<section class=\\"pull-history\\">" +
          "<h3 class=\\"pull-section-title\\">Retained change history</h3>" +
          changedHistory.map(renderHistoryEntry).join("") +
        "</section>";
      }

      function renderDataPull() {
        var history = Array.isArray(data.pullHistory) ? data.pullHistory : [];
        var diff = data.pullDiff || history[0] || {};
        var current = diff.currentPulledAtDisplay || data.pulledAtDisplay;

        if (!history.length && data.pullDiff) {
          history = [data.pullDiff];
        }

        document.getElementById("pull-meta").textContent = "Latest pull: " + current + " ET";
        document.getElementById("pull-body").innerHTML =
          renderPullComparison(diff) +
          renderPullHistory(history, diff);
      }

      function renderAll() {
        renderReleaseScan();
        renderFilterState();
        renderBoard();
        renderDataPull();
        document.getElementById("pulled-at").textContent = data.pulledAtDisplay;
        renderNextRefresh();
        document.getElementById("source-line").textContent = "Source: live Jira JQL " + data.jql + ". Components, descriptions, embedded images, Markdown test checklists, and subtasks are generated from the current ticket snapshot.";
        document.getElementById("copy-components").innerHTML = copyIcon();
        var toggle = document.getElementById("toggle-subtasks");
        var cardsWithSubtasks = getVisibleSubtaskCards();
        var allSubtasksExpanded = cardsWithSubtasks.length > 0 && cardsWithSubtasks.every(function (card) {
          return state.expandedSubtasks.has(card.issue.key);
        });
        toggle.setAttribute("aria-pressed", allSubtasksExpanded ? "true" : "false");
        toggle.textContent = allSubtasksExpanded ? "Collapse all subtasks" : "Expand all subtasks";
      }

      document.getElementById("component-chips").addEventListener("click", function (event) {
        var chip = event.target.closest("[data-component]");
        if (!chip) {
          return;
        }

        state.activeComponent = chip.getAttribute("data-component");
        renderAll();
      });

      document.getElementById("qa-chips").addEventListener("click", function (event) {
        var chip = event.target.closest("[data-qa]");
        if (!chip) {
          return;
        }

        state.activeQa = chip.getAttribute("data-qa");
        renderAll();
      });

      document.getElementById("copy-components").addEventListener("click", function (event) {
        var components = getComponentCounts().map(function (entry) {
          return "- " + entry[0];
        });

        copyText(components.join("\\n")).then(function () {
          markCopied(event.currentTarget);
        });
      });

      document.getElementById("data-pull").addEventListener("click", function (event) {
        var copyButton = event.target.closest("[data-copy-link]");
        if (!copyButton) {
          return;
        }

        copyText(copyButton.getAttribute("data-copy-link")).then(function () {
          markCopied(copyButton);
        });
      });

      document.getElementById("board").addEventListener("submit", function (event) {
        var form = event.target.closest("[data-assign-form]");
        if (!form) {
          return;
        }

        event.preventDefault();
        var select = form.querySelector("[name='assignee']");
        var submit = form.querySelector(".assign-submit");
        var status = form.querySelector(".assign-status");
        var requestedAssignee = select ? select.value : "";
        var issueKey = form.getAttribute("data-issue-key");

        if (!requestedAssignee) {
          status.textContent = "Choose an assignee.";
          return;
        }

        status.textContent = "Starting secure workflow...";
        if (submit) {
          submit.disabled = true;
        }

        fetch(assigneeDispatchEndpoint, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          credentials: "include",
          body: JSON.stringify({
            issueKey: issueKey,
            assigneeDisplayName: requestedAssignee,
            releaseVersion: data.version,
            repositorySlug: githubRepo,
            dashboardUrl: dashboardUrl,
            requestedAt: new Date().toISOString()
          })
        })
          .then(function (response) {
            return response.json().catch(function () {
              return { ok: false, error: "The dispatch bridge returned an unreadable response." };
            }).then(function (payload) {
              if (!response.ok || !payload.ok) {
                throw new Error(payload.error || "The dispatch bridge rejected the request.");
              }
              return payload;
            });
          })
          .then(function () {
            status.textContent = "Workflow started. Jira will refresh shortly.";
          })
          .catch(function (error) {
            status.textContent = "Hosted bridge unavailable. Use Login / re-enable bridge, then retry.";
            if (isHostedBridgeEndpoint()) {
              setBridgeStatus("protected", "Login required");
            }
            console.error(error);
          })
          .finally(function () {
            if (submit) {
              submit.disabled = false;
            }
          });
      });

      document.getElementById("board").addEventListener("click", function (event) {
        var copyButton = event.target.closest("[data-copy-link]");
        if (copyButton) {
          copyText(copyButton.getAttribute("data-copy-link")).then(function () {
            markCopied(copyButton);
          });
          return;
        }

        var subtaskToggle = event.target.closest(".subtask-toggle");
        if (subtaskToggle) {
          var issueKey = subtaskToggle.getAttribute("data-subtasks-for");
          if (state.expandedSubtasks.has(issueKey)) {
            state.expandedSubtasks.delete(issueKey);
          } else {
            state.expandedSubtasks.add(issueKey);
          }
          renderAll();
          return;
        }

        var descriptionToggle = event.target.closest(".description-toggle");
        if (descriptionToggle) {
          openDescriptionModal(descriptionToggle.getAttribute("data-description-for"));
          return;
        }

        var checklistToggle = event.target.closest(".checklist-toggle");
        if (checklistToggle) {
          openChecklistModal(checklistToggle.getAttribute("data-checklist-for"));
          return;
        }

        var toggle = event.target.closest(".section-toggle");
        if (!toggle) {
          return;
        }

        var status = toggle.getAttribute("data-status");
        if (state.collapsedStatuses.has(status)) {
          state.collapsedStatuses.delete(status);
        } else {
          state.collapsedStatuses.add(status);
        }
        renderAll();
      });

      document.getElementById("description-modal").addEventListener("click", function (event) {
        var closeTarget = event.target.closest("[data-description-close]");
        if (closeTarget) {
          closeDescriptionModal();
          return;
        }

        var copyButton = event.target.closest("[data-copy-link]");
        if (copyButton) {
          copyText(copyButton.getAttribute("data-copy-link")).then(function () {
            markCopied(copyButton);
          });
        }
      });

      document.getElementById("checklist-modal").addEventListener("click", function (event) {
        var closeTarget = event.target.closest("[data-checklist-close]");
        if (closeTarget) {
          closeChecklistModal();
          return;
        }

        var removeButton = event.target.closest("[data-checklist-remove]");
        if (removeButton) {
          var issue = getActiveChecklistIssue();
          var itemId = removeButton.getAttribute("data-checklist-remove");
          state.activeChecklistItems = state.activeChecklistItems.filter(function (item) {
            return item.id !== itemId;
          });
          saveChecklistItems(issue);
          renderChecklistItems();
          refreshChecklistToggle(issue);
          return;
        }

        var removeImageButton = event.target.closest("[data-checklist-image-remove]");
        if (removeImageButton) {
          var imageIssue = getActiveChecklistIssue();
          var imageItem = findChecklistItem(removeImageButton.getAttribute("data-checklist-image-remove"));
          var imageId = removeImageButton.getAttribute("data-image-id");
          if (imageItem && Array.isArray(imageItem.images)) {
            imageItem.images = imageItem.images.filter(function (image) {
              return image.id !== imageId;
            });
            saveChecklistItems(imageIssue);
            renderChecklistItems();
            refreshChecklistToggle(imageIssue);
          }
          return;
        }

        var copyButton = event.target.closest("[data-copy-link]");
        if (copyButton) {
          copyText(copyButton.getAttribute("data-copy-link")).then(function () {
            markCopied(copyButton);
          });
        }
      });

      document.getElementById("checklist-modal").addEventListener("input", function (event) {
        var titleInput = event.target.closest("[data-checklist-title]");
        var notesInput = event.target.closest("[data-checklist-notes]");
        var issue = getActiveChecklistIssue();
        var item = null;

        if (titleInput) {
          item = findChecklistItem(titleInput.getAttribute("data-checklist-title"));
          if (item) {
            item.title = titleInput.value;
            saveChecklistItems(issue);
          }
          return;
        }

        if (notesInput) {
          item = findChecklistItem(notesInput.getAttribute("data-checklist-notes"));
          if (item) {
            item.notes = notesInput.value;
            saveChecklistItems(issue);
          }
        }
      });

      document.getElementById("checklist-modal").addEventListener("change", function (event) {
        var doneInput = event.target.closest("[data-checklist-done]");
        var imageInput = event.target.closest("[data-checklist-images]");
        var issue = getActiveChecklistIssue();
        var item = doneInput ? findChecklistItem(doneInput.getAttribute("data-checklist-done")) : null;

        if (imageInput) {
          attachImagesToChecklistItem(imageInput.getAttribute("data-checklist-images"), imageInput.files).then(function () {
            imageInput.value = "";
          });
          return;
        }

        if (!item) {
          return;
        }

        item.done = doneInput.checked;
        saveChecklistItems(issue);
        var row = doneInput.closest(".checklist-item");
        if (row) {
          row.classList.toggle("is-done", item.done);
        }
        updateChecklistProgress();
      });

      document.getElementById("checklist-add").addEventListener("click", function () {
        var issue = getActiveChecklistIssue();
        state.activeChecklistItems.push(makeManualChecklistItem());
        saveChecklistItems(issue);
        renderChecklistItems();
        refreshChecklistToggle(issue);
      });

      document.getElementById("checklist-post").addEventListener("click", postActiveChecklist);

      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && !document.getElementById("description-modal").hidden) {
          closeDescriptionModal();
        }
        if (event.key === "Escape" && !document.getElementById("checklist-modal").hidden) {
          closeChecklistModal();
        }
      });

      document.getElementById("toggle-subtasks").addEventListener("click", function () {
        var cards = getVisibleSubtaskCards();
        var allExpanded = cards.length > 0 && cards.every(function (card) {
          return state.expandedSubtasks.has(card.issue.key);
        });

        if (allExpanded) {
          cards.forEach(function (card) {
            state.expandedSubtasks.delete(card.issue.key);
          });
        } else {
          cards.forEach(function (card) {
            state.expandedSubtasks.add(card.issue.key);
          });
        }
        renderAll();
      });

      document.getElementById("expand-all").addEventListener("click", function () {
        state.collapsedStatuses.clear();
        renderAll();
      });

      document.getElementById("collapse-all").addEventListener("click", function () {
        groupCards(getIssueModel().filter(cardMatchesFilters)).forEach(function (entry) {
          state.collapsedStatuses.add(entry[0]);
        });
        renderAll();
      });

      var resizeTimer;
      window.addEventListener("resize", function () {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(renderAll, 120);
      });

      renderAll();
      configureBridgeLoginLink();
      checkBridgeStatus();
      window.setTimeout(checkForFreshDeployment, 5000);
      window.setInterval(renderNextRefresh, 30000);
      window.setInterval(checkForFreshDeployment, 60000);
      window.setInterval(checkBridgeStatus, 30000);
    })();
  </script>
</body>
</html>
`;
}

async function main() {
  const safeVersion = version.replace(/[^a-zA-Z0-9._-]/g, "_");
  const jsonPath = path.join(workspace, `jira-${safeVersion}-tickets.json`);
  const dashboardDataPath = path.join(workspace, dashboardDataFileName);
  const htmlPath = path.join(workspace, "jira-board-latest.html");
  const indexPath = path.join(workspace, "index.html");
  let previousData = null;

  const previousJsonData = fs.existsSync(jsonPath)
    ? parseJsonText(fs.readFileSync(jsonPath, "utf8"))
    : null;
  const previousDashboardData = fs.existsSync(dashboardDataPath)
    ? parseJsonText(fs.readFileSync(dashboardDataPath, "utf8"))
    : null;
  const previousHtmlData = readDataFromHtml(indexPath);
  previousData = newerPullData(newerPullData(previousJsonData, previousDashboardData), previousHtmlData);

  const calendarMenuPromise = buildCalendarData();
  const { jql, issues: rawIssues } = await fetchIssues();
  const sprintResult = await fetchSprintIssues();
  const normalizedByKey = new Map();

  for (const issue of mergeRawIssues(rawIssues, sprintResult.issues)) {
    normalizedByKey.set(issue.key, await normalizeIssue(issue));
  }

  const sprintIssueKeys = new Set((sprintResult.issues || []).map((issue) => issue.key));
  for (const [key, issue] of normalizedByKey) {
    if (sprintIssueKeys.has(key)) {
      normalizedByKey.set(key, ensureSprintMembership(issue));
    }
  }

  const issues = rawIssues.map((issue) => normalizedByKey.get(issue.key)).filter(Boolean);
  const sprintIssues = (sprintResult.issues || []).map((issue) => normalizedByKey.get(issue.key)).filter(Boolean);
  const calendarMenu = await calendarMenuPromise;
  const json = buildJson(issues, jql, previousData, {
    ...sprintResult,
    issues: sprintIssues
  }, calendarMenu);
  const dashboardData = buildDashboardData(json);

  fs.writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`);
  fs.writeFileSync(dashboardDataPath, `${JSON.stringify(dashboardData, null, 2)}\n`);
  fs.writeFileSync(htmlPath, renderHtml(dashboardData));

  console.log(JSON.stringify({
    version,
    total: issues.length,
    sprint: sprintName,
    sprintProject: sprintProjectKey,
    sprintBoard: sprintResult.boardName || "",
    sprintBoardId: sprintResult.boardId || "",
    sprintSource: sprintResult.source || "",
    sprintBacklogParity: Boolean(sprintResult.backlogParity),
    sprintBacklogIssueCount: Number(sprintResult.backlogIssueCount || 0),
    sprintTotal: sprintIssues.length,
    calendarSources: calendarMenu.sources.length,
    calendarEvents: calendarMenu.sources.reduce((total, source) => total + Number(source.eventCount || 0), 0),
    jsonPath,
    dashboardDataPath,
    htmlPath,
    jiraFilterUrl: `${siteUrl}/issues/?jql=${encodeURIComponent(jql)}`,
  }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
