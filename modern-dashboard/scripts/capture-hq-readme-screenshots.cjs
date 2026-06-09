const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const repoRoot = path.resolve(__dirname, "..", "..");
const workspaceRoot = path.resolve(repoRoot, "..");
const outputDir = path.join(repoRoot, "docs", "qa-headquarters", "screenshots");
const port = 4179;
const baseUrl = `http://127.0.0.1:${port}/jira-board-v3001-124-0/modern/hq/`;

const aiSampleResponse = {
  ok: true,
  provider: "Cloudflare Workers AI",
  model: "@cf/meta/llama-3.1-8b-instruct-fast",
  generatedAt: new Date().toISOString(),
  release: "v3001.124.0",
  source: {
    pulledAtDisplay: "Jun 4, 2026, 11:50 AM",
    total: 7,
    mainTickets: 3,
    subtasks: 4
  },
  brief: {
    title: "v3001.124.0 draft QA intelligence brief",
    summary: "The current release board is small but concentrated around high-priority CORE work. QA should focus on parent stories first, verify linked subtasks remain attached to their parent context, and review evidence before sending Jira or Slack updates.",
    topRisks: [
      "P1 work is concentrated in active development and analysis lanes.",
      "Subtasks are attached to larger parent stories, so reviewing subtasks without parent context can hide acceptance criteria.",
      "Only pulled artifact data is available in this draft; live Jira comments and media should be reviewed before external status sharing."
    ],
    qaFocus: [
      "Start with P1 parent tickets and confirm expected behavior from descriptions.",
      "Check assigned developer and assignee alignment before asking for retest.",
      "Use automation evidence for UI flows before posting Jira comments."
    ],
    ticketsToWatch: [
      { key: "CORE-14427", reason: "Large Home Course parent story with linked API and UI work." },
      { key: "CORE-14428", reason: "Product benefit work may affect eligibility validation." },
      { key: "CORE-14506", reason: "Database subtask linked to CORE-14427." }
    ],
    reviewGates: [
      "Human review required before Jira comments.",
      "Human review required before Slack summaries.",
      "Refresh the board if the data artifact is stale."
    ]
  }
};

fs.mkdirSync(outputDir, { recursive: true });

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://127.0.0.1:${port}`);

  if (requestUrl.pathname === "/api/ai/release-summary") {
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
    response.end(JSON.stringify(aiSampleResponse));
    return;
  }

  const pathname = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
  let filePath = pathname.startsWith("_astro/")
    ? path.join(repoRoot, "modern", pathname)
    : path.join(workspaceRoot, pathname);

  if (requestUrl.pathname.endsWith("/")) {
    filePath = path.join(workspaceRoot, pathname, "index.html");
  }

  if (!filePath.startsWith(workspaceRoot) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, { "content-type": contentType(filePath) });
  fs.createReadStream(filePath).pipe(response);
});

server.listen(port, "127.0.0.1", async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(outputDir, "hq-overview-desktop.png"), fullPage: false });

    await captureSection(page, "#boards", "hq-board-registry.png");
    await captureSection(page, "#calendar", "hq-calendar-menu.png");
    await captureSection(page, "#automation", "hq-automation-bench.png");
    await captureSection(page, "#ai", "hq-ai-workers-ai-ready.png");
    await page.locator("#hq-ai-generate").click();
    await page.waitForSelector("#hq-ai-result:not([hidden])");
    await captureSection(page, "#ai", "hq-ai-generated-brief.png");
    await captureSection(page, "#specs", "hq-spec-checklist.png");

    await captureUrl(page, "https://dewankabir009.github.io/jira-board-v3001-122-0/modern/", "release-v3001-122-modern.png");
    await captureUrl(page, "https://dewankabir009.github.io/jira-board-v3001-123-0/modern/", "release-v3001-123-modern.png");
    await captureUrl(page, "https://dewankabir009.github.io/jira-board-v3001-124-0/modern/", "release-v3001-124-modern.png");

    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(outputDir, "hq-mobile-overview.png"), fullPage: false });
  } finally {
    await browser.close();
    server.close();
  }
});

async function captureSection(page, selector, fileName) {
  const locator = page.locator(selector);
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await locator.screenshot({ path: path.join(outputDir, fileName) });
}

async function captureUrl(page, url, fileName) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(outputDir, fileName), fullPage: false });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml"
  };
  return types[ext] || "application/octet-stream";
}
