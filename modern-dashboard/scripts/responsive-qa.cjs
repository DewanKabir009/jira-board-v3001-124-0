const fs = require("fs");
const path = require("path");

function loadPlaywright() {
  const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
  if (modulePath) {
    return require(modulePath);
  }

  return require("playwright");
}

const { chromium } = loadPlaywright();

const targetUrl = process.env.QA_TARGET_URL || "http://127.0.0.1:4321/";
const screenshotRoot = process.env.QA_SCREENSHOT_DIR || path.join(process.cwd(), "qa-artifacts", "modern-dashboard");
const chromePath = process.env.QA_CHROME_PATH || undefined;
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(screenshotRoot, runId);

const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 820, height: 1100 },
  { name: "mobile", width: 390, height: 900 }
];

const focusSelectors = [
  ".skip-link",
  ".button-link.primary",
  ".board-card-links a",
  ".preset-button",
  ".explorer-filters input",
  ".custom-select-trigger",
  ".summary-button",
  ".row-actions button",
  ".workspace-actions button",
  ".comment-preview summary"
];

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

async function visibleLocator(page, selector) {
  const locator = page.locator(selector).first();
  if (await locator.count() === 0) {
    return null;
  }

  if (!(await locator.isVisible().catch(() => false))) {
    return null;
  }

  if (await locator.isDisabled().catch(() => false)) {
    return null;
  }

  return locator;
}

async function focusCheck(page, selector) {
  const locator = await visibleLocator(page, selector);
  if (!locator) {
    return { selector, skipped: true };
  }

  await locator.focus();
  return locator.evaluate((element, checkedSelector) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const outlineVisible = style.outlineStyle !== "none" && style.outlineWidth !== "0px";
    const shadowVisible = style.boxShadow !== "none";

    return {
      selector: checkedSelector,
      label: element.getAttribute("aria-label") || element.textContent?.trim() || element.getAttribute("placeholder") || element.tagName,
      outlineVisible,
      shadowVisible,
      rect: {
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
  }, selector);
}

async function collectTabStops(page) {
  await page.keyboard.press("Home").catch(() => {});
  await page.keyboard.press("Tab");

  const stops = [];
  for (let index = 0; index < 18; index += 1) {
    const stop = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) {
        return null;
      }

      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName.toLowerCase(),
        label: element.getAttribute("aria-label") || element.textContent?.trim() || element.getAttribute("placeholder") || "",
        visible: rect.width > 0 && rect.height > 0
      };
    });

    if (stop) {
      stops.push(stop);
    }

    await page.keyboard.press("Tab");
  }

  return stops;
}

async function responsiveCheck(page) {
  return page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const rootOverflow = document.documentElement.scrollWidth > viewportWidth + 1;
    const checked = [...document.querySelectorAll("a[href], button:not([disabled]), input, select, textarea, summary")]
      .filter((element) => !element.closest(".ticket-table-wrap"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const textClipped = element.scrollWidth > element.clientWidth + 2 && style.whiteSpace === "nowrap";
        const horizontalClip = rect.left < -1 || rect.right > viewportWidth + 1;

        return {
          label: element.getAttribute("aria-label") || element.textContent?.trim() || element.getAttribute("placeholder") || element.tagName,
          selector: element.tagName.toLowerCase(),
          textClipped,
          horizontalClip,
          width: Math.round(rect.width)
        };
      });

    return {
      rootOverflow,
      clippedControls: checked.filter((item) => item.textClipped || item.horizontalClip)
    };
  });
}

async function saveScreenshot(page, name, locatorSelector = null) {
  const filePath = path.join(runDir, `${name}.png`);
  if (!locatorSelector) {
    await page.screenshot({ path: filePath, fullPage: true });
    return filePath;
  }

  const locator = await visibleLocator(page, locatorSelector);
  if (!locator) {
    return null;
  }

  await locator.screenshot({ path: filePath });
  return filePath;
}

(async () => {
  ensureDir(runDir);

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath
  });

  const page = await browser.newPage();
  const failures = [];
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failures.push(`${response.status()} ${response.url()}`);
    }
  });

  const results = [];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(targetUrl, { waitUntil: "networkidle" });
    await page.waitForSelector(".explorer-panel", { timeout: 20000 });

    const screenshots = [
      await saveScreenshot(page, `${viewport.name}-dashboard`),
      await saveScreenshot(page, `${viewport.name}-filters`, ".explorer-filters"),
      await saveScreenshot(page, `${viewport.name}-detail-panel`, ".ticket-detail-panel")
    ];

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    screenshots.push(await saveScreenshot(page, `${viewport.name}-bottom-controls`));

    const responsive = await responsiveCheck(page);
    const focus = [];
    for (const selector of focusSelectors) {
      focus.push(await focusCheck(page, selector));
    }
    const failedFocus = focus.filter((item) => !item.skipped && !item.outlineVisible && !item.shadowVisible);
    const tabStops = await collectTabStops(page);

    results.push({
      viewport,
      screenshots: screenshots.filter(Boolean).map((filePath) => path.relative(process.cwd(), filePath)),
      responsive,
      focus,
      tabStops
    });

    if (responsive.rootOverflow) {
      failures.push(`${viewport.name}: page has horizontal overflow`);
    }

    for (const control of responsive.clippedControls) {
      failures.push(`${viewport.name}: clipped control ${control.label}`);
    }

    for (const item of failedFocus) {
      failures.push(`${viewport.name}: focus style missing for ${item.selector}`);
    }
  }

  await browser.close();

  const report = {
    ok: failures.length === 0,
    targetUrl,
    runDir,
    failures,
    results
  };

  fs.writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) {
    process.exit(1);
  }
})().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
