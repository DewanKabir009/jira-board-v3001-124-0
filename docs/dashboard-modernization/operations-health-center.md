# Operations Health Center

SPEC-08 status: complete.

## Purpose

The modern dashboard now separates operational signals that used to look like one failure: Jira data freshness, GitHub Pages publishing, Cloudflare bridge auth, workflow run history, and Slack notification delivery.

## Implemented Surface

- Jira data pull card showing the latest loaded snapshot time and data artifact link.
- GitHub Pages preview card with live board and deployment links.
- Jira write bridge card that treats the hosted Worker as `Cloudflare Login`, not offline, and points to the Worker `/status` login path.
- Workflow runs card linking directly to refresh and all Actions history.
- Slack notifications card linking to the notification workflow.
- A plain note reminding users that failed workflow emails can be historical and should be compared against the latest pull and workflow history.

## Data Contract

SPEC-08 uses the existing `dashboard-data/v1` artifact and derives links from:

- `repositorySlug`
- `dashboardUrl`
- `dataArtifact.fileName`
- `pulledAt`, `pulledAtDisplay`, and `pullDiff.currentPulledAtDisplay`
- `assigneeDispatchEndpoint`
- `testChecklistCommentEndpoint`

The UI does not fall back to localhost. If a board is accidentally configured with a local endpoint, it is shown as a dangerous local-endpoint state.

## Acceptance

- Users can tell whether data refresh and Jira write paths are separate.
- Historical failed workflow emails are not mistaken for current outages.
- The bridge status never falls back to localhost.
- The 122 and 123 Astro preview builds include the operations health center.

## Next Dependency

SPEC-09 can promote board links into a durable multi-board registry now that per-board health links are visible in the preview.
