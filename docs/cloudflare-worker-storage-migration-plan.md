# Cloudflare Worker + Storage Migration Plan

Goal: move release Jira dashboards from GitHub Pages publishing to Cloudflare-hosted live boards with a 5-minute Jira refresh loop.

## Target Architecture

- Cloudflare Worker serves the dashboard HTML and JSON data.
- Cloudflare Cron Trigger runs every 5 minutes.
- Jira data is pulled from the Worker using Cloudflare-held secrets.
- Latest board snapshot is stored in Cloudflare KV.
- Large Jira media, if needed, is stored in R2.
- Slack notifications are sent by the Worker only when ticket data changes.
- Email notifications can be added later through a company-approved SMTP provider or Cloudflare Email Sending.
- GitHub remains the source-code/template repo, but not the live hosting or refresh engine.

## Why This Replaces GitHub Pages

GitHub Pages works for static publishing, but our board has become an operational status app:

- Frequent 5-minute refreshes
- Jira secrets
- Slack notifications
- Assignee updates
- Checklist posting
- Future email notifications
- Need for lower deployment latency

Cloudflare Worker + storage removes GitHub Pages deploy delay and reduces dependence on GitHub Actions for each refresh.

## Proposed URLs

Before custom domain:

```text
https://jira-board-v3001-122-0.dfkabir253.workers.dev
https://jira-board-v3001-123-0.dfkabir253.workers.dev
```

With a custom domain:

```text
https://v3001-122.coreqaboard.com
https://v3001-123.coreqaboard.com
```

Alternative single-domain route model:

```text
https://coreqaboard.com/v3001.122.0
https://coreqaboard.com/v3001.123.0
```

Preferred long-term route model: single Worker with paths by fixVersion. It is easier to manage than one Worker per board.

## Storage Model

KV namespace:

```text
JIRA_BOARD_STORE
```

Suggested KV keys:

```text
boards/v3001.122.0/latest.json
boards/v3001.122.0/latest.html
boards/v3001.122.0/history.json
boards/v3001.122.0/last-diff.json
boards/v3001.122.0/config.json
```

R2 bucket, optional:

```text
jira-board-assets
```

Suggested R2 keys:

```text
jira-media/v3001.122.0/CORE-14398/attachment-id.png
```

## Worker Routes

```text
GET /                         default board or board selector
GET /:fixVersion              dashboard HTML
GET /:fixVersion/data.json    latest board JSON
GET /:fixVersion/status       pull status and last refresh metadata
POST /:fixVersion/refresh     manual refresh, admin-only
POST /:fixVersion/assign      secured assignee update
POST /:fixVersion/comment-checklist secured checklist comment posting
```

## Cron Refresh Flow

Every 5 minutes:

1. Load board configs from KV.
2. For each active fixVersion, pull Jira issues by JQL.
3. Normalize ticket, subtask, description, priority, component, QA, and checklist fields.
4. Compare against previous `latest.json`.
5. If ticket data changed:
   - write new `latest.json`
   - write new `latest.html`
   - append retained diff history
   - send Slack notification
   - later send email notification
6. If no ticket data changed:
   - update pull timestamp/status metadata
   - avoid noisy Slack unless we explicitly enable no-change pings

## Secrets Needed In Cloudflare

Already seeded in the current provisioner:

- `GITHUB_PROVISIONER_TOKEN`
- `PROVISIONER_ADMIN_TOKEN`
- `JIRA_CLOUD_ID`
- `JIRA_EMAIL`
- `JIRA_MCP_TOKEN`
- `SLACK_BOT_TOKEN`
- `SLACK_CHANNEL_ID`

Still needed for email later:

- `QA_EMAIL_TO`
- `QA_EMAIL_FROM`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USERNAME`
- `SMTP_PASSWORD`
- `SMTP_SECURE`
- `SMTP_REJECT_UNAUTHORIZED`

## Tomorrow Setup Checklist

1. Decide whether to buy/use a custom domain.
2. If using a custom domain, add it to Cloudflare and point DNS to Cloudflare.
3. Create KV namespace `JIRA_BOARD_STORE`.
4. Decide whether Jira images should be cached in R2 or proxied from Jira.
5. Build `jira-board-live-worker` using the existing dashboard generator logic.
6. Bind KV and optional R2 in `wrangler.live.toml`.
7. Move the HTML render path from file output to Worker response/KV output.
8. Move Jira pull logic from GitHub Actions into Worker cron.
9. Move Slack notification sending into Worker cron.
10. Deploy to `*.workers.dev`.
11. Test v3001.122.0 and v3001.123.0 side by side with GitHub Pages.
12. Flip the shared links to Cloudflare once the Worker refreshes reliably.

## Migration Phases

### Phase 1: Mirror Mode

Cloudflare pulls Jira every 5 minutes and serves the board, while GitHub Pages remains available as fallback.

Success criteria:

- Cloudflare page loads.
- Latest pull timestamp updates every 5 minutes.
- Status moves show in the correct column.
- Slack notification fires only on real data changes.
- Data Pull retained history stays intact.

### Phase 2: Primary Hosting

Cloudflare URL becomes the shared URL. GitHub Pages remains as backup.

Success criteria:

- Users can view dashboards without GitHub Pages.
- Assignee/checklist actions still work.
- Bridge status is no longer confusing or laptop-dependent.

### Phase 3: GitHub Actions Reduction

GitHub Actions becomes optional for code deployment only, not board refresh.

Success criteria:

- Scheduled Jira pulls run completely in Cloudflare.
- New boards can be created from the template and activated in Cloudflare config.
- No per-refresh Git commits are required.

## Open Decisions

- Domain name.
- One Worker per board vs one Worker with path-based boards. Recommendation: one Worker with path-based boards.
- KV-only HTML/data storage vs Worker-rendered HTML on each request. Recommendation: KV stores latest JSON and latest HTML.
- Whether to cache Jira images in R2. Recommendation: use R2 if images need to display reliably for all viewers.
- Whether no-change refreshes should notify Slack/email. Recommendation: show no-change on dashboard only; notify Slack only on real changes.

## First Implementation Target

Build a live Worker for `v3001.122.0` first, then add `v3001.123.0` after the refresh loop and storage model are stable.
