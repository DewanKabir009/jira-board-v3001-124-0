# Modern Dashboard Astro Shell

SPEC-04 adds the first Astro shell for the modern Jira release dashboard. It is intentionally parallel to the existing generated `index.html` so active boards can keep using the proven static page and Cloudflare bridge while the modern surface reaches parity.

## Local Preview

Copy or symlink a board's `dashboard-data.json` into a local web-accessible path, then run:

```powershell
npm ci
npm run dev
```

By default the shell looks for `../dashboard-data.json` so a GitHub Pages preview can live under `/modern/` while sharing the board's root data artifact.

Override the data path when needed:

```powershell
$env:PUBLIC_DASHBOARD_DATA_URL = "/dashboard-data.json"
npm run dev
```

## Static Build

```powershell
$env:ASTRO_BASE = "/jira-board-v3001-122-0/modern/"
$env:ASTRO_SITE = "https://dewankabir009.github.io/jira-board-v3001-122-0/"
$env:PUBLIC_DASHBOARD_DATA_URL = "../dashboard-data.json"
npm ci
npm run build
```

The output in `dist/` is static and can be uploaded to GitHub Pages when the migration is ready to publish a `/modern/` preview.

## Responsive QA

SPEC-10 adds a repeatable Playwright smoke test for the modern preview. It checks representative focus states, root-level horizontal overflow, clipped controls, and saves desktop, tablet, and mobile screenshots.

```powershell
$env:QA_TARGET_URL = "https://dewankabir009.github.io/jira-board-v3001-122-0/modern/"
$env:QA_SCREENSHOT_DIR = "qa-artifacts/modern-dashboard"
npm run qa:responsive
```

Set `PLAYWRIGHT_MODULE_PATH` when Playwright is supplied by the Codex runtime or another shared toolchain. Set `QA_CHROME_PATH` when the browser binary should come from a local Chrome install.

## Rollout Guardrails

SPEC-11 keeps the generated root dashboard as the working QA surface until the modern preview clears parity checks for 122 and 123. The preview is published under `/modern/`, reads the same `dashboard-data.json`, and includes a rollout readiness section with links back to the current board and fallback runbook.

## Cutover Validation

SPEC-12 adds explicit cutover evidence gates to the modern preview. Read parity can be checked from the published data artifact, while assignee writes, checklist comments, and Slack delivery stay marked as evidence-required until a named test ticket proves the live workflow.

## Visual QA Hardening

The modern preview uses custom compact dropdowns for ticket filters and row count controls instead of native browser select menus. The assignee filter reads `assigneeAvatarUrl` from `dashboard-data.json` and shows Jira profile images when available, with initials as the compact fallback for unassigned or older snapshots.

## Ticket Explorer Island

SPEC-05 adds a React island powered by TanStack Table. The island loads `dashboard-data.json`, then provides search, status, assignee, priority, component, parent, and changed-since-last-pull filters. It also includes saved presets for QA testing, code review, status moves, and unassigned work.

Rows link directly to Jira, while the detail panel keeps a current-board action link available so assignee and checklist workflows can stay on the proven generated dashboard until parity is complete.

Sprint View reads `dashboard-data.json.sprintView`, which is generated from the Jira Agile board named `GN Core Platform` for sprint `2026.8`. The `CORE` project key remains a ticket-key/search constraint, but the sprint ticket list is scoped by the board/space so other CORE sprint work is excluded.

## Checklist Workspace

SPEC-06 adds an editable QA workspace to the selected-ticket detail panel. Imported checklist cases are loaded from `dashboard-data.json`, manual cases can be added, and ticket-level evidence and concerns are saved in browser storage.

The workspace generates a Jira comment preview before submission. Submissions use the existing `testChecklistCommentEndpoint` or the hosted `/comment-checklist` route derived from the Cloudflare bridge endpoint, preserving the current workflow-dispatch posting path.

## HQ Calendar Menu

SPEC-HQ-09 adds the HQ Calendar Menu at `/modern/hq/#calendar`. The page reads `dashboard-data.json.calendarMenu`, then renders the Confluence GN Releases calendar in a calendar grid or upcoming-list view. The grid defaults to the current month with Previous, Today, and Next controls, while the upcoming list groups events into collapsible month sections. The refresh workflow updates the calendar payload every 5 minutes alongside the Jira board data, and the client refreshes the calendar section while the HQ page remains open.

## Migration Rule

Do not replace the current generated board until the Astro shell has parity for ticket scanning, filters, Jira links, assignee writes, checklist comments, media, and release-board navigation.
