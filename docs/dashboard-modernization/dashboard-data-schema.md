# Dashboard Data Schema

SPEC-03 status: complete.

## Artifact

Each generated board now publishes `dashboard-data.json` beside `index.html`. The static page still embeds the same data inside `<script id="jira-data" type="application/json">` so existing GitHub Pages dashboards continue to work without an extra request. Future Astro and React surfaces should load `dashboard-data.json` directly.

## Versioning

The current schema is `dashboard-data/v1`.

Required top-level version fields:

- `schemaVersion`: string, currently `dashboard-data/v1`.
- `schemaVersionNumber`: number, currently `1`.
- `dataArtifact.fileName`: string, currently `dashboard-data.json`.
- `dataArtifact.generatedBy`: string, currently `pull-jira-release-tickets.cjs`.

Schema changes must either keep backward compatibility with `dashboard-data/v1` or publish a new `schemaVersion`.

## Core Fields

- `version`: Jira fixVersion used for the board.
- `dashboardVersion`: generated dashboard runtime version.
- `siteUrl`: Jira site root.
- `jql`: Jira query used by the pull.
- `pulledAt` and `pulledAtDisplay`: current snapshot time.
- `total`: issue count.
- `issues`: normalized issue cards.
- `pullDiff`: latest comparison against the previous snapshot.
- `pullHistory`: retained comparison history.
- `jiraFilterUrl`: direct Jira filter link.
- `repositorySlug` and `dashboardUrl`: GitHub Pages board identity.
- `assigneeDispatchEndpoint`: hosted Cloudflare bridge endpoint.
- `testChecklistCommentEndpoint`: checklist comment bridge endpoint when the board supports checklist comments.
- `assigneeOptions`: supported dashboard assignee choices.

## Issue Card Fields

Each item in `issues` is normalized for static rendering:

- `key`, `url`, `summary`, `type`, `isSubtask`, `status`, `priority`, `assignee`, `resolution`.
- `description`, `descriptionHtml`, `descriptionImageCount`.
- `updated`, `updatedDisplay`, `created`, `createdDisplay`.
- `components`, `fixVersions`.
- `parent` when the issue is a subtask or belongs to a known parent.
- `testChecklist` when the board has parsed Markdown checklist data.

## Description Images

Images referenced by `descriptionHtml` are copied into `assets/jira-media/<issue-key>/...` and referenced by relative URL. Consumers should preserve those relative paths so the same artifact works on GitHub Pages.

## Checklist Data

`testChecklist` is either `null` or an object with:

- `files`: source Markdown attachments used to build checklist cases.
- `commentIds`: Jira comment IDs that referenced those files.
- `total`: test case count.
- `testCases`: normalized checklist cases with `id`, `title`, `category`, `blocking`, `description`, `checks`, and `sourceFile`.

## Pull Diff

`pullDiff` and each `pullHistory` entry use the same shape:

- `previousPulledAt`, `previousPulledAtDisplay`.
- `currentPulledAt`, `currentPulledAtDisplay`.
- `isBaseline`.
- `added`, `removed`, `updated`, `statusChanges`.

`updated` entries contain field-level changes. `statusChanges` repeats status movement in a scan-friendly shape.

## Board Registry Placeholder

SPEC-03 does not introduce the board registry yet. Until SPEC-09, board navigation remains in generated HTML, while `repositorySlug`, `dashboardUrl`, and `version` give future registry tooling enough identity to link the artifact back to its board.
