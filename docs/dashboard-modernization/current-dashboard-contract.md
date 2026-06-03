# Current Dashboard Contract

SPEC-00 status: complete.

This document captures the behavior that the modern dashboard migration must preserve before new UI architecture is introduced. The shared template remains the canonical source for generated board behavior, while the public spec site carries a review copy for the migration checklist.

## Repositories And Roles

- `jira-board-template` is the shared source of truth. It owns the Jira pull script, generated HTML contract, GitHub Actions workflows, bridge helper scripts, Slack notification scripts, and future board defaults.
- `jira-board-v3001-122-0` is an active public GitHub Pages board for fixVersion `v3001.122.0`. It receives generated `index.html` refreshes and hosts the public modernization checklist mirror at `/modern-dashboard-specs/`.
- `jira-board-v3001-123-0` is an active public GitHub Pages board for fixVersion `v3001.123.0`. It receives the same shared-template behavior as 122.
- `completion-targets-repo` is the private source workspace for the modernization checklist site and spec documents. It does not rely on private GitHub Pages hosting.

## Generated Artifacts

Each board generation is static-first and writes these files:

- `jira-${safeVersion}-tickets.json`: normalized Jira snapshot plus pull diff metadata.
- `jira-board-latest.html`: full generated dashboard HTML for the latest pull.
- `index.html`: published GitHub Pages dashboard, usually copied from `jira-board-latest.html` by a workflow or script.
- `assets/jira-media/`: downloaded Jira description images that can be rendered inside the static board.

The published page embeds the board snapshot in:

```html
<script id="jira-data" type="application/json">...</script>
```

The browser runtime reads this block and does not require a server-side application to render the dashboard.

## Board Data Shape

The top-level generated JSON contract currently includes:

- `version`: Jira fixVersion used for the board.
- `dashboardVersion`: generator/dashboard release label, currently `v1.10.6`.
- `siteUrl`: Jira site URL.
- `jql`: source Jira query.
- `pulledAt` and `pulledAtDisplay`: latest snapshot timestamp.
- `total`: issue count.
- `issues`: normalized Jira issue list.
- `pullDiff`: comparison against the previous snapshot.
- `pullHistory`: recent pull diff history.

The HTML render step augments that snapshot with:

- `jiraFilterUrl`: link to the source Jira filter.
- `repositorySlug`: GitHub repository slug for the board.
- `dashboardUrl`: GitHub Pages URL for the board.
- `assigneeDispatchEndpoint`: hosted bridge endpoint for assignee changes.
- `testChecklistCommentEndpoint`: hosted bridge endpoint for checklist comments.
- `assigneeOptions`: supported assignee names shown in each ticket card.

## Issue Data Shape

Each normalized issue currently provides:

- `key`, `url`, and `summary`.
- `description`, `descriptionHtml`, and `descriptionImageCount`.
- `testChecklist`: parsed checklist metadata for parent tickets when referenced Markdown attachments exist.
- `type` and `isSubtask`.
- `status`, `priority`, `assignee`, and `resolution`.
- `updated`, `updatedDisplay`, `created`, and `createdDisplay`.
- `components` and `fixVersions`.
- `parent`: parent key, URL, summary, text description, type, status, and priority when the issue is a subtask or has parent context.

The modern dashboard must either preserve these fields or introduce a versioned replacement before consuming them in Astro or React components.

## Current Read Path

1. `refresh-jira-board.yml` runs manually or on the schedule.
2. The workflow loads managed secrets from Cloudflare when `SECRET_PROVIDER_ENDPOINT` is configured, with repository secrets as fallback.
3. The workflow validates `JIRA_FIX_VERSION`, `JIRA_CLOUD_ID`, `JIRA_EMAIL`, and `JIRA_MCP_TOKEN`.
4. `scripts/refresh-jira-board-action.cjs` runs the generator for the configured fixVersion.
5. The workflow commits `index.html` and `assets/jira-media` when generated output changes.
6. `scripts/send-refresh-notifications.cjs` sends Slack and email notifications only when the Jira board diff has meaningful changes.

Scheduled template refreshes are guarded with `if: vars.JIRA_FIX_VERSION != ''` so the template repository does not fail when it is not configured as a live board.

## Current Write Paths

### Assignee Update

1. The dashboard posts to `assigneeDispatchEndpoint` with `credentials: "include"`.
2. The hosted Cloudflare Worker validates access and dispatches `update-jira-assignee.yml`.
3. The workflow runs `scripts/update-jira-assignee.cjs`.
4. The script resolves the assignable Jira account, updates the Jira assignee, regenerates the dashboard, and reports whether the board changed.
5. The workflow rebases with autostash before committing and retries pushes up to three times.
6. `scripts/send-assignee-notification.cjs` sends Slack notification to the configured QA channel and mentions Nicole Greer, Anton Yurkevich, or Alex McNay when the new assignee matches those names.

### Checklist Comment

1. The dashboard posts checklist payloads to `testChecklistCommentEndpoint` with `credentials: "include"`.
2. The hosted Cloudflare Worker validates access and dispatches `post-test-checklist-comment.yml`.
3. The workflow runs `scripts/post-test-checklist-comment.cjs`.
4. The script posts the structured Jira checklist comment using the Jira token available to the workflow.

## Authentication And Secrets

- Dashboard reads do not require Cloudflare login because GitHub Pages serves static HTML.
- Browser write actions require a valid Cloudflare Access session for the Worker domain.
- Jira writes require GitHub Actions secrets or managed Cloudflare-provided secrets.
- The browser login button points at the Worker `/status` route so the user can refresh the Cloudflare Access cookie when assignee or checklist writes are gated.
- The hosted bridge is the default path. New boards must not default to laptop-local bridge URLs.

## Board Directory Contract

The current generated dashboard includes a collapsible `Boards` section directly under `Data Pull`. It currently links to:

- `v3001.122.0 board`: `https://dewankabir009.github.io/jira-board-v3001-122-0/`
- `v3001.123.0 board`: `https://dewankabir009.github.io/jira-board-v3001-123-0/`

The future registry work should replace this hardcoded list with a static board registry file that can include past, current, and future boards.

## Migration Invariants

- Keep the 122 and 123 dashboards live during migration.
- Keep GitHub Pages static hosting.
- Keep hosted Cloudflare bridge writes for assignee updates and checklist comments.
- Keep Jira refreshes independent from Cloudflare browser login.
- Keep Slack notifications for board changes and assignee changes.
- Preserve current issue fields until a new versioned data contract exists.
- Apply behavior changes in the shared template first, then regenerate active boards when needed.

## SPEC-00 Acceptance

- The repositories and generated files that own dashboard behavior are identified.
- The generated board-level and issue-level data shapes are documented.
- The refresh, assignee, checklist comment, bridge login, Slack notification, and Pages publish paths are represented.
- Future specs can reference this contract instead of rediscovering the current infrastructure.
