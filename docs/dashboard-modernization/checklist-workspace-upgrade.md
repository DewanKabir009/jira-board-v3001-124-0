# Checklist Workspace Upgrade

SPEC-06 status: complete.

## Goal

The checklist workspace makes QA checklist work editable and post-ready inside the Astro preview. It keeps the generated dashboard available as fallback, but it no longer treats checklist data as read-only.

## Implemented

- Added imported checklist state from `dashboard-data.json`.
- Added manual test case creation, editing, completion toggles, and removal.
- Added ticket-level evidence and concerns fields.
- Added browser-local persistence per release, issue key, and checklist source files.
- Added a Jira comment preview that mirrors the table submitted through the existing checklist bridge.
- Added visible draft, ready, submitting, submitted, and failed states.
- Added Cloudflare bridge submission using `testChecklistCommentEndpoint` or the hosted `/comment-checklist` endpoint derived from the assignee bridge.

## Bridge Compatibility

The workspace sends the same payload shape used by the generated dashboard:

- `issueKey`, `issueUrl`, `summary`, `releaseVersion`, `repositorySlug`, and `dashboardUrl`.
- `sourceFiles`.
- `items` with `title`, `done`, `notes`, and `images`.

Ticket-level evidence and concerns are appended as a synthetic checklist row so the current Jira comment helper can render them without a bridge schema change.

## Fallback Rule

If Cloudflare Access requires login or the bridge rejects the request, the workspace shows the failed state and the current generated board remains available through the detail-panel action link.

## Next Dependency

SPEC-07 can now add analytics without changing checklist payload semantics.
