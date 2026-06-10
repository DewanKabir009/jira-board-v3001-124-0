# SPEC-HQ-10 - Slack Two-Way Bridge

## Goal

Make CORE QA Headquarters communicate with Slack in both directions through the installed `CORE JIRA NOTIFIER AGENT` bot.

## User Outcomes

- HQ can post reviewed messages to `#core-qa-dream-team`.
- Slack users can ask HQ for current release answers through a slash command.
- Slack app mentions can receive a threaded HQ response.
- Slack interactive buttons can be acknowledged by the HQ Worker.
- HQ shows current outbound readiness, inbound readiness, callback URLs, and recent callback activity.

## Routes

| Route | Direction | Purpose |
| --- | --- | --- |
| `GET /api/slack/status` | HQ -> Worker | Reports token, channel, signing-secret, and callback readiness. |
| `GET /api/slack/activity` | HQ -> Worker | Returns recent inbound Slack callbacks kept in Worker memory for the MVP. |
| `POST /api/slack/send` | HQ -> Slack | Posts reviewed HQ messages through Slack Web API. |
| `POST /api/slack/commands` | Slack -> HQ | Handles slash command requests such as `/qa-hq p0 tickets`. |
| `POST /api/slack/events` | Slack -> HQ | Handles Events API URL verification and app mentions. |
| `POST /api/slack/actions` | Slack -> HQ | Handles interactive component callbacks. |

## Security

- Outbound posting requires `SLACK_BOT_TOKEN`.
- Inbound callbacks require `SLACK_SIGNING_SECRET`.
- Slack signatures are checked with the `v0:{timestamp}:{body}` HMAC SHA-256 signing flow.
- Requests older than five minutes are rejected to reduce replay risk.
- Slack responses are draft/read-only against Jira; no Jira write, automation run, or Slack broadcast is performed by AI output without explicit UI action.

## Slack App Configuration

Use the live Cloudflare Worker URLs from `/api/slack/status`:

- Slash command Request URL: `https://core-qa-headquarters-124.dfkabir253.workers.dev/api/slack/commands`
- Event subscriptions Request URL: `https://core-qa-headquarters-124.dfkabir253.workers.dev/api/slack/events`
- Interactivity Request URL: `https://core-qa-headquarters-124.dfkabir253.workers.dev/api/slack/actions`

Recommended scopes:

- `chat:write`
- `commands`
- `app_mentions:read`

Optional later scopes:

- `channels:history` or `groups:history` only if the bot needs to read ordinary channel messages.
- `users:read` only if HQ needs richer Slack user/profile mapping.

## Slash Command Examples

```text
/qa-hq p0 tickets
/qa-hq tickets assigned to Nicole
/qa-hq tickets from Reservation
/qa-hq status
```

## Acceptance Criteria

- `GET /api/slack/status` reports `canPost: true` when `SLACK_BOT_TOKEN` is configured.
- `GET /api/slack/status` reports `canReceive: true` when `SLACK_SIGNING_SECRET` is configured.
- The HQ Operations Status module displays outbound and inbound readiness separately.
- The HQ Operations Status module displays Slack Request URLs for commands, Events API, and interactivity.
- Slash command requests are signature verified before the Worker reads or answers the command.
- Events API URL verification can return the Slack challenge when the signing secret is present.
- App mentions are acknowledged quickly and answered in a thread through the bot token.
- Interactive callbacks are acknowledged and shown in the HQ activity panel.

## Current State

Implemented in code. Live outbound posting is ready because `SLACK_BOT_TOKEN` is configured. Live inbound remains gated until `SLACK_SIGNING_SECRET` is added as a GitHub secret / Worker secret and Slack app Request URLs are configured.

## Next Hardening

- Add Cloudflare KV or D1 for durable Slack activity history across Worker isolates.
- Add an admin-only approval queue for Slack-triggered automation.
- Add Slack user-to-HQ-role mapping after the HQ auth model is implemented.
