# Release Analytics Band

SPEC-07 status: complete.

## Purpose

The modern dashboard now gives QA a compact analytics band before the ticket explorer. It summarizes release ownership, status movement, priority mix, and component concentration without requiring users to open each ticket card.

## Implemented Surface

- Release totals for main tickets, subtasks, and the latest changed-ticket count.
- Assignee load chart from the current `issues` array.
- Status movement history from `pullHistory`, falling back to the latest `pullDiff`.
- Priority distribution chart from current Jira priority values.
- Component concentration chart that includes tickets with no component as an explicit bucket.
- Plain HTML tables under every visual chart so the data remains readable without canvas rendering.

## Data Contract

SPEC-07 uses the existing `dashboard-data/v1` artifact. It does not create a new Jira pull path and does not mutate Jira.

Required existing fields:

- `issues[].assignee`
- `issues[].priority`
- `issues[].components`
- `issues[].isSubtask`
- `pullDiff.added`, `pullDiff.updated`, `pullDiff.removed`, and `pullDiff.statusChanges`
- `pullHistory[]` with the same pull-diff fields when retained history is available

## Acceptance

- Charts answer release questions without crowding ticket controls.
- Chart colors reuse dashboard design tokens.
- Every chart includes a readable table representation.
- The analytics band is present in the 122 and 123 Astro preview builds.

## Next Dependency

SPEC-08 can now add operations health separately from release analytics, keeping Jira data freshness, bridge auth, and workflow status clearly separated.
