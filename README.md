# GolfNow CORE Jira Board Template

Central template repo for creating one GitHub Pages Jira dashboard per CORE fixVersion.

This repo owns the shared dashboard code: Jira pulls, HTML generation, GitHub Actions refreshes, Slack/email notification hooks, assignee updates, checklist comment posting, and the Cloudflare Worker bridge source. Release-board repos should contain generated release data; this repo should not.

## What This Template Includes

- Responsive Jira dashboard generator: `pull-jira-release-tickets.cjs`
- GitHub Actions refresh workflow with repeated 5-minute checks inside each scheduled run
- Secured Jira assignee update workflow
- Checklist comment workflow for posting QA checklist results back to Jira
- Slack and email notification script hooks
- Cloudflare Worker bridge source for hosted assignee/checklist dispatch
- Cloudflare Cron refresh monitor that verifies board pull freshness and dispatches recovery runs
- Local bridge fallback scripts for development
- Astro migration shell under `modern-dashboard/` for the future static UI
- Placeholder `index.html` so the template repo can be published safely without live Jira data

## How To Spin Up A New Board

Recommended release-board repo name:

```text
jira-board-v3001-124-0
```

Repository variables required on every generated board:

- `JIRA_FIX_VERSION`: Jira fixVersion, for example `v3001.124.0`
- `ASSIGNEE_DISPATCH_ENDPOINT`: hosted bridge `/assign` endpoint
- `TEST_CHECKLIST_COMMENT_ENDPOINT`: hosted bridge `/comment-checklist` endpoint
- `TRUSTED_GITHUB_ACTORS`: optional comma-separated GitHub actors allowed to trigger Jira writes; defaults to the repo owner

Repository secrets required on every generated board when the Cloudflare secret provider is not configured:

- `JIRA_MCP_TOKEN`
- `JIRA_EMAIL`
- `JIRA_CLOUD_ID`

Preferred managed-secret setup:

- Store shared secrets once in the `jira-board-provisioner` Cloudflare Worker.
- The provisioner sets `SECRET_PROVIDER_ENDPOINT` and `SECRET_PROVIDER_AUDIENCE` on each new board repo.
- GitHub Actions uses GitHub OIDC to prove which repo is calling, then loads the Jira/Slack/email secrets from Cloudflare for that run.
- New board repos do not need copied Jira or Slack GitHub secrets when this is configured.

Optional notification secrets:

- `SLACK_BOT_TOKEN`
- `SLACK_CHANNEL_ID`
- `SLACK_WEBHOOK_URL`
- `QA_EMAIL_TO`
- `QA_EMAIL_FROM`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USERNAME`
- `SMTP_PASSWORD`
- `SMTP_SECURE`
- `SMTP_REJECT_UNAUTHORIZED`

Cloudflare Worker setup for Jira write actions:

- Add the new board repo to `ALLOWED_REPOSITORIES`.
- Keep `ALLOWED_ORIGINS` set to the GitHub Pages owner origin, for example `https://dewankabir009.github.io`.
- Set `DEFAULT_REPOSITORY` only if the bridge should have a default board.
- Set `BOARD_DISPATCH_TOKEN` as a Worker secret with GitHub Actions dispatch permission for the release-board repos.
- If Cloudflare Access protects the Worker, configure `ALLOWED_USER_EMAILS`, `ACCESS_AUD`, `ACCESS_JWKS_URL`, and `ACCESS_ISSUER`.

## Cloudflare Provisioner

The `jira-board-provisioner` Worker is the central automation service for future boards. It can:

- Create a new board repo from this template.
- Set repo variables such as `JIRA_FIX_VERSION`, `DASHBOARD_URL`, bridge endpoints, and the managed secret-provider endpoint.
- Enable GitHub Pages from `master` at `/`.
- Dispatch the first refresh workflow.
- Provide managed secrets to GitHub Actions through GitHub OIDC without storing those secrets in every board repo.
- Monitor active board freshness every 5 minutes and dispatch `refresh-jira-board.yml` when GitHub's schedule does not wake the board up on time.

Provisioner file:

```text
workers/board-provisioner-worker.js
wrangler.provisioner.toml
```

Refresh monitor endpoints:

```text
GET  https://jira-board-provisioner.dfkabir253.workers.dev/monitor/status
GET  https://jira-board-provisioner.dfkabir253.workers.dev/monitor/health
POST https://jira-board-provisioner.dfkabir253.workers.dev/monitor/run
```

The monitor treats a board as stale after `REFRESH_MONITOR_STALE_MINUTES` and critical after `REFRESH_MONITOR_CRITICAL_MINUTES`. It checks for active refresh workflow runs and gives successful recovery runs `REFRESH_MONITOR_PUBLISHING_GRACE_MINUTES` to publish through GitHub Pages before dispatching again, so it does not pile up duplicate GitHub Actions runs.

Required provisioner secrets:

```powershell
npx -y wrangler secret put GITHUB_PROVISIONER_TOKEN -c wrangler.provisioner.toml
npx -y wrangler secret put PROVISIONER_ADMIN_TOKEN -c wrangler.provisioner.toml
npx -y wrangler secret put JIRA_CLOUD_ID -c wrangler.provisioner.toml
npx -y wrangler secret put JIRA_EMAIL -c wrangler.provisioner.toml
npx -y wrangler secret put JIRA_MCP_TOKEN -c wrangler.provisioner.toml
```

Optional notification secrets:

```powershell
npx -y wrangler secret put SLACK_BOT_TOKEN -c wrangler.provisioner.toml
npx -y wrangler secret put SLACK_CHANNEL_ID -c wrangler.provisioner.toml
npx -y wrangler secret put QA_EMAIL_TO -c wrangler.provisioner.toml
npx -y wrangler secret put QA_EMAIL_FROM -c wrangler.provisioner.toml
npx -y wrangler secret put SMTP_HOST -c wrangler.provisioner.toml
npx -y wrangler secret put SMTP_PORT -c wrangler.provisioner.toml
npx -y wrangler secret put SMTP_USERNAME -c wrangler.provisioner.toml
npx -y wrangler secret put SMTP_PASSWORD -c wrangler.provisioner.toml
```

Provision a board:

```powershell
$body = @{ fixVersion = "v3001.124.0"; runInitialRefresh = $true } | ConvertTo-Json
Invoke-RestMethod `
  -Method Post `
  -Uri "https://jira-board-provisioner.dfkabir253.workers.dev/provision" `
  -Headers @{ "X-Provisioner-Token" = "<PROVISIONER_ADMIN_TOKEN>" } `
  -Body $body `
  -ContentType "application/json"
```

Generated board URL pattern:

```text
https://dewankabir009.github.io/jira-board-v3001-124-0/
```

## Modern Dashboard Shell

SPEC-04 introduces a parallel Astro app in `modern-dashboard/`. It reads the published `dashboard-data.json` artifact and can build a static GitHub Pages-compatible bundle without replacing the current generated board.

The current `index.html` generator remains the production path until the modern dashboard reaches parity for ticket scanning, filters, media, Jira links, assignee writes, checklist comment posting, and board navigation.

Manual build:

```powershell
Set-Location modern-dashboard
$env:ASTRO_BASE = "/jira-board-v3001-124-0/modern/"
$env:ASTRO_SITE = "https://dewankabir009.github.io/jira-board-v3001-124-0/"
$env:PUBLIC_DASHBOARD_DATA_URL = "../dashboard-data.json"
npm ci
npm run build
```

The `Modern Dashboard Static Build` workflow validates this shell on demand and on pull requests that touch `modern-dashboard/`. It uploads the static output as an artifact instead of deploying it over the live board.

## Local First Pull

```powershell
$env:JIRA_FIX_VERSION = "v3001.124.0"
$env:BOARD_OWNER = "DewanKabir009"
$env:BOARD_REPOSITORY_NAME = "jira-board-v3001-124-0"
$env:BOARD_REPOSITORY_SLUG = "DewanKabir009/jira-board-v3001-124-0"
$env:DASHBOARD_URL = "https://dewankabir009.github.io/jira-board-v3001-124-0/"
node pull-jira-release-tickets.cjs $env:JIRA_FIX_VERSION
Copy-Item -Path jira-board-latest.html -Destination index.html
```

## Template Update Rule

Design and functionality updates should land here first. Then apply the same scoped change to active release-board repos, currently `jira-board-v3001-122-0` and `jira-board-v3001-123-0`. New release-board repos created after the template update inherit the latest behavior from day one.

Generated data that does not belong in this template:

- `jira-v*-tickets.json`
- `jira-board-latest.html`
- Jira media under `assets/jira-media`
- Release-specific screenshots
- Release-specific logs

## Current Template Capabilities

- Responsive layout across desktop and smaller screens
- Collapsible status sections
- Expandable/collapsible subtasks
- Component filters with copyable component list
- QA filters
- Priority summary section
- Priority-based ticket sorting inside status sections
- Ticket description modal with embedded Jira images
- Data Pull diff summary with retained change history
- Copy actions for ticket links
- Secured assignee picker
- Markdown-backed test checklist modals
- Checklist Jira comment posting with inline image support when Jira token access is available
- Slack notification formatting for added, updated, moved, and removed tickets
- Email notification hook for future SMTP or email-service wiring
- Cloudflare-hosted bridge support
- Cloudflare-hosted refresh monitor with 5-minute cron checks and recovery dispatch
- Astro static shell scaffold for the modern dashboard migration
- React and TanStack Table ticket explorer inside the Astro preview
- Checklist workspace with editable QA cases, evidence, concerns, preview, and Cloudflare bridge submission
- Release analytics band with assignee load, pull movement history, priority mix, and component concentration
- Operations health center for data pull freshness, Pages deploy links, bridge auth, Actions history, and Slack workflow checks
- Multi-board registry through `boards.json` for current and future release-board navigation
- Accessibility and responsive QA harness for focus visibility, overflow checks, and screenshot review artifacts
- Rollout readiness and fallback plan for keeping the current board available during modern preview migration
- Cutover readiness validation for assignee writes, checklist comments, Slack delivery, and final signoff evidence
- Custom compact dropdown controls with Jira assignee avatar support in the modern preview
- 123-only Playwright automation playbook with runner contract, job schema, approved script registry links, and dashboard job queue controls

## Version History

### v1.10.20

- Completed the 123-board Playwright automation spec set from PW-01 through PW-06.
- Added the dashboard-side Run Playwright console and job summary polling hooks.
- Documented the protected runner, evidence publishing, and production gates for the 123 pilot.

### v1.10.19

- Started the 123-board Playwright automation specs.
- Added the PW-01 runner contract documentation.
- Added dashboard playbook links for the hosted 123 Playwright spec artifacts.

### v1.10.17

- Added Cloudflare Cron refresh monitor support to the provisioner Worker.
- Added `/monitor/status`, `/monitor/health`, and admin-protected `/monitor/run` endpoints.
- Added a publishing grace state so recovery dispatches do not repeat while GitHub Pages is still serving older JSON.
- Documented the hosted watchdog in `docs/dashboard-modernization/hosted-refresh-monitor.md`.

### v1.10.16

- Replaced native browser filters in the Astro preview with compact custom dropdown controls.
- Added Jira assignee avatar fields to the data pull and avatar-aware assignee filtering in the preview.
- Refreshed the dashboard color tokens with an energetic GolfNow-inspired palette across electric blue, fairway green, cool sky, bright lime, amber, rose, and violet accents.

### v1.10.15

- Added the SPEC-12 cutover readiness validation panel.
- Added evidence-required gates for assignee writes, checklist comments, Slack delivery, and final cutover signoff.
- Documented the validation runbook so configured Cloudflare bridge status is not confused with mutation proof.

### v1.10.14

- Added the SPEC-11 rollout and fallback plan.
- Added a rollout readiness section to the Astro preview.
- Documented the 122 and 123 preview URLs, cutover gates, and static-generator fallback path.

### v1.10.13

- Added the SPEC-10 accessibility and responsive QA pass.
- Added visible focus treatment, a keyboard skip link, active preset semantics, ticket-table sort semantics, and current-board registry language.
- Added `npm run qa:responsive` for Playwright screenshots, focus smoke checks, and mobile overflow checks.

### v1.10.12

- Added the SPEC-09 multi-board registry.
- Added `boards.json` with 122 and 123 as the first release-board entries.
- Added a data-driven board directory and board spin-up hook notes to the Astro preview.

### v1.10.11

- Added the SPEC-08 operations health center to the Astro preview.
- Separated Jira data pull freshness, GitHub Pages publishing, Cloudflare bridge auth, workflow history, and Slack notification links.
- Flagged localhost bridge endpoints as bad live-board configuration instead of falling back to laptop-local writes.

### v1.10.10

- Added the SPEC-07 release analytics band to the Astro preview.
- Added tokenized semantic charts for assignee load, status movement history, priority mix, and component concentration.
- Kept every analytics chart backed by a readable HTML table fallback.

### v1.10.9

- Added the SPEC-06 checklist workspace inside the Astro preview.
- Added imported and manual checklist state, ticket-level evidence and concerns, Jira comment preview, and draft/ready/submitted/failed states.
- Preserved checklist comment posting through the hosted Cloudflare bridge.

### v1.10.8

- Added the SPEC-05 ticket explorer island to the Astro preview.
- Added dense table scanning with sorting, pagination, filters, saved presets, and selected-ticket details.
- Kept Jira links and current-board action links available from the preview rows and detail panel.

### v1.10.7

- Added the SPEC-04 Astro migration shell under `modern-dashboard/`.
- Added a manual static build workflow that produces a GitHub Pages-compatible artifact without replacing the live generated board.
- Started initial layout, metadata, filters, status lanes, and ticket-card components backed by `dashboard-data.json`.

### v1.10.6

- Changed hosted bridge health failures caused by Cloudflare Access from `Offline` to `Cloudflare Login`.
- Added an amber protected status style so generated boards distinguish an auth gate from an actual bridge outage.
- Kept the Cloudflare Worker as the default assignee and checklist bridge endpoint.

### v1.10.5

- Changed the default assignee bridge endpoint from local `127.0.0.1` to the hosted Cloudflare Worker.
- Ensured newly generated boards use the Cloudflare bridge by default unless explicitly overridden.
- Kept assignee and checklist actions off laptop-local resources for generated live boards.

### v1.10.4

- Added shadcn-inspired muted background colors for each workflow status section.
- Matched section headers, count pills, borders, and card outlines to the section palette.
- Kept the colors subtle so ticket cards remain readable and scannable.

### v1.10.3

- Added `jira-board-provisioner`, a Cloudflare Worker for creating release-board repos from this template.
- Added Cloudflare-managed secret loading for GitHub Actions using GitHub OIDC.
- Added `scripts/load-managed-secrets.cjs` so future boards can run without copied Jira/Slack repo secrets.

### v1.10.2

- Centralized the dashboard code into a reusable template repo.
- Removed hardcoded `v3001.122.0` board identity from the generator, workflows, notification scripts, bridge server, and Worker defaults.
- Added repo-aware dashboard URL, repository slug, and GitHub Pages metadata.
- Kept the latest active-board functionality as the template baseline.

### v1.10.1

- Added Cloudflare Access JWT validation to the hosted bridge.
- Updated dashboard bridge calls to avoid CORS preflight by posting JSON as `text/plain;charset=UTF-8`.

### v1.10.0

- Added hosted Cloudflare Worker bridge support so assignee updates are no longer tied to a local laptop bridge.
- Added bridge status indicator in the dashboard footer.

### v1.9.x

- Added ticket description modals with Jira description text and embedded image support.
- Added priority summary cards and priority-based ticket ordering.
- Added Slack notification cleanup for human-readable status moves and ticket updates.

### v1.8.x

- Added QA filters, component filters, copy icons, subtask controls, and the Data Pull retained history section.
