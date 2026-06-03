# Accessibility and Responsive QA

SPEC-10 status: complete.

## Purpose

The modern dashboard now has a repeatable QA pass for keyboard focus, responsive overflow, and review screenshots before UI changes are published to active release boards.

## Delivered

- Added explicit focus-visible treatment for links, buttons, inputs, selects, textareas, and disclosure summaries.
- Added a skip link into the Astro layout so keyboard users can jump directly to the ticket explorer.
- Added pressed-state semantics for saved views, sort-state semantics for ticket table headers, and accessible labels for ticket detail actions.
- Added current-board language to the release board registry.
- Added `npm run qa:responsive`, a Playwright smoke test that captures desktop, tablet, and mobile screenshots plus a JSON report.

## QA Command

Run the script against a local or hosted preview:

```powershell
$env:QA_TARGET_URL = "https://dewankabir009.github.io/jira-board-v3001-122-0/modern/"
$env:QA_SCREENSHOT_DIR = "qa-artifacts/modern-dashboard"
npm run qa:responsive
```

If Playwright is provided outside this project, set `PLAYWRIGHT_MODULE_PATH`. If the browser binary is not managed by Playwright, set `QA_CHROME_PATH`.

## Acceptance

- Mobile and desktop smoke tests fail if the page creates root-level horizontal overflow.
- Focus checks fail if representative action controls do not expose visible focus treatment.
- Screenshots are saved for dashboard, filters, selected-ticket detail, and bottom controls at desktop, tablet, and mobile sizes.

## Next Dependency

SPEC-11 can use these QA artifacts as the release gate for the rollout and fallback plan.
