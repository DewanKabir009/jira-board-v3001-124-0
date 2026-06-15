# Hosted Refresh Monitor And Heartbeat

## Goal

Keep every active Jira release board honest about its `dashboard-data.json` freshness without depending on GitHub's native scheduled workflow as the system clock.

The board refresh workflow remains the source of truth for Jira pulls, commits, and publishing. The Cloudflare provisioner Worker now owns the five-minute heartbeat and dispatches the GitHub workflow through `workflow_dispatch`.

## Runtime Contract

- Cloudflare Cron runs `jira-board-provisioner` every 5 minutes.
- The heartbeat checks the configured active board repos for queued or running `refresh-jira-board.yml` runs.
- If no run is active and no run was started inside `REFRESH_HEARTBEAT_MINIMUM_GAP_SECONDS`, the Worker dispatches `refresh-jira-board.yml` on `master`.
- The GitHub `schedule` event is intentionally removed from release-board refresh workflows; GitHub Actions executes the refresh but does not own the cadence.
- The Worker reads active boards from `BOARD_REGISTRY_URL`; if that registry is unavailable, it falls back to the 122 and 123 boards.
- For each board, it fetches `dashboard-data.json` without cache and reads `pulledAt`.
- If `pulledAt` is older than `REFRESH_MONITOR_STALE_MINUTES`, the board is stale.
- If `pulledAt` is older than `REFRESH_MONITOR_CRITICAL_MINUTES`, the board is critical.
- Before dispatching anything, the Worker checks the board repo for queued or active `refresh-jira-board.yml` runs.
- If the board is stale and no refresh run is active, the Worker dispatches `refresh-jira-board.yml` on `master`.
- If a successful refresh just completed, the Worker waits through `REFRESH_MONITOR_PUBLISHING_GRACE_MINUTES` before dispatching again so GitHub Pages has time to serve the new JSON.
- Slack is notified only when the monitor dispatches a recovery run, sees a critical board, or cannot dispatch a required recovery run.

## Endpoints

```text
GET  /monitor/status
GET  /monitor/health
POST /monitor/run
GET  /heartbeat/status
POST /heartbeat/run
```

`/monitor/status` returns the full board-by-board freshness report.

`/monitor/health` returns a compact health response and uses HTTP 503 when any board is stale.

`/monitor/run` requires provisioner admin auth and performs the same recovery pass as the cron event.

`/heartbeat/status` reports whether the Cloudflare dispatcher would run or skip each configured active board.

`/heartbeat/run` requires provisioner admin auth and manually dispatches the same heartbeat path.

## Configuration

The provisioner config owns the schedule and thresholds:

```toml
[triggers]
crons = ["*/5 * * * *"]

[vars]
BOARD_REGISTRY_URL = "https://raw.githubusercontent.com/DewanKabir009/jira-board-template/master/boards.json"
REFRESH_MONITOR_STALE_MINUTES = "20"
REFRESH_MONITOR_CRITICAL_MINUTES = "40"
REFRESH_MONITOR_PUBLISHING_GRACE_MINUTES = "10"
REFRESH_HEARTBEAT_ENABLED = "true"
REFRESH_HEARTBEAT_REPOSITORIES = "DewanKabir009/jira-board-v3001-124-0"
REFRESH_HEARTBEAT_WORKFLOW = "refresh-jira-board.yml"
REFRESH_HEARTBEAT_BRANCH = "master"
REFRESH_HEARTBEAT_MINIMUM_GAP_SECONDS = "240"
```

Required existing secret:

```text
GITHUB_PROVISIONER_TOKEN
```

Optional notification secrets:

```text
SLACK_BOT_TOKEN
SLACK_CHANNEL_ID
SLACK_WEBHOOK_URL
```

## Operator Checks

Live status:

```powershell
Invoke-RestMethod "https://jira-board-provisioner.dfkabir253.workers.dev/monitor/status"
```

Heartbeat dispatcher status:

```powershell
Invoke-RestMethod "https://jira-board-provisioner.dfkabir253.workers.dev/heartbeat/status"
```

Compact health:

```powershell
Invoke-RestMethod "https://jira-board-provisioner.dfkabir253.workers.dev/monitor/health"
```

Manual recovery run:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "https://jira-board-provisioner.dfkabir253.workers.dev/monitor/run" `
  -Headers @{ "X-Provisioner-Token" = "<PROVISIONER_ADMIN_TOKEN>" }
```
