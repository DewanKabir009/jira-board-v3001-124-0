const fs = require("fs");
const {
  siteUrl,
  sanitizeChecklistPayload,
  postChecklistComment,
} = require("./jira-checklist-comment.cjs");

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }

  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${String(value).replace(/\r?\n/g, " ")}\n`);
}

function writeSummary(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown.trim()}\n`);
  }
  console.log(markdown);
}

function getTrustedActors() {
  return (process.env.TRUSTED_GITHUB_ACTORS || "DewanKabir009")
    .split(",")
    .map(normalize)
    .filter(Boolean);
}

function getRequest() {
  return {
    issueKey: process.env.INPUT_ISSUE_KEY || process.env.ISSUE_KEY || "",
    payloadText: process.env.CHECKLIST_PAYLOAD || process.env.INPUT_CHECKLIST_PAYLOAD || "",
  };
}

function validateRequest(request) {
  const actor = process.env.GITHUB_ACTOR || "";
  const trustedActors = getTrustedActors();

  if (!trustedActors.includes(normalize(actor))) {
    throw new Error(`GitHub actor ${actor || "unknown"} is not allowed to post Jira comments from this workflow.`);
  }

  if (!process.env.JIRA_MCP_TOKEN) {
    throw new Error("JIRA_MCP_TOKEN is not set.");
  }

  let payload;
  try {
    payload = JSON.parse(request.payloadText || "{}");
  } catch (error) {
    throw new Error(`Checklist payload is not valid JSON: ${error.message}`);
  }

  payload = sanitizeChecklistPayload(payload);

  if (payload.issueKey !== String(request.issueKey || "").trim().toUpperCase()) {
    throw new Error(`Checklist payload issue ${payload.issueKey || "blank"} does not match workflow issue ${request.issueKey}.`);
  }

  return payload;
}

async function main() {
  const request = getRequest();
  const payload = validateRequest(request);
  const result = await postChecklistComment(payload);

  writeOutput("issue_key", request.issueKey);
  writeOutput("comment_id", result.comment?.id || "");
  writeSummary([
    `Posted test checklist comment for ${request.issueKey}.`,
    "",
    `- Comment: ${result.comment?.id || "unknown"}`,
    `- Jira: ${siteUrl}/browse/${request.issueKey}`,
    `- Items: ${result.itemCount}`,
    `- Complete: ${result.completeCount}`,
    `- Images: ${result.imageCount}`,
  ].join("\n"));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
