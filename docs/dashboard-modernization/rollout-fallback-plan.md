# Rollout and Fallback Plan

SPEC-11 status: complete.

## Purpose

The modern dashboard now has a clear release path that keeps the current generated board available until the modern preview proves read parity, Jira action parity, checklist comment parity, Slack notification parity, and Pages deploy stability.

## Delivered

- Added a rollout readiness section to the modern preview.
- Kept the current root board as the primary working QA surface during migration.
- Published parallel preview links for the 122 and 123 modern dashboards.
- Added a parity checklist for 122 and 123.
- Added fallback instructions for returning attention to the current static generator output.

## Preview URLs

| Release | Current board | Modern preview |
| --- | --- | --- |
| v3001.122.0 | https://dewankabir009.github.io/jira-board-v3001-122-0/ | https://dewankabir009.github.io/jira-board-v3001-122-0/modern/ |
| v3001.123.0 | https://dewankabir009.github.io/jira-board-v3001-123-0/ | https://dewankabir009.github.io/jira-board-v3001-123-0/modern/ |

## Cutover Gate

- The root `index.html` board remains published and usable.
- The modern preview reads the same `dashboard-data.json` artifact as the current board.
- The SPEC-10 responsive QA harness passes on both 122 and 123.
- Jira issue links, Jira filter links, current-board action links, and board registry links work on both previews.
- Cloudflare bridge login/write paths are verified for assignee updates and checklist comments.
- Slack notifications are verified for data refresh and assignee update workflows.

## Fallback

If a modern preview parity check fails, keep the current root board as the official QA surface and stop promoting `/modern/`. Regenerate the current static board output, publish the root `index.html` and `dashboard-data.json`, and leave `/modern/` as a preview-only artifact until the issue is fixed and the SPEC-10 QA pass is clean again.

## Acceptance

- Current dashboards remain available throughout migration.
- Modern preview uses the same Jira snapshot as the current board.
- Cutover only happens after action paths and read paths are verified.
- Hosted checklist marks SPEC-11 complete by default.
