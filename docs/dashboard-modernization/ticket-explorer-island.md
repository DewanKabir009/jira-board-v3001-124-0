# Ticket Explorer Island

SPEC-05 status: complete.

## Goal

The ticket explorer island turns the Astro preview from a card proof-of-concept into a dense working scan view. It is still hosted under `/modern/` so the current generated dashboard remains the production fallback.

## Implemented

- Added React support to the Astro shell with `@astrojs/react`.
- Added a TanStack Table-backed `TicketExplorerIsland` component.
- Added search, status, assignee, priority, component, parent, and changed-since-last-pull filters.
- Added saved presets for all tickets, QA testing, code review, status moves, and unassigned work.
- Added table sorting and pagination with 15, 25, and 50 row page sizes.
- Added a selected-ticket detail panel with Jira, current-board action, checklist count, parent, status, assignee, priority, and description preview.

## Data Source

The island still consumes the SPEC-03 `dashboard-data/v1` artifact. It does not create a new Jira pull path and does not require a server.

## Action Preservation

Rows link directly to Jira. The detail panel also links back to the current generated board so assign and checklist actions remain available through the existing Cloudflare bridge while the modern workflow catches up.

## Next Dependency

SPEC-06 can now move checklist work into this React island without adding more state to the legacy generated HTML.

SPEC-06 is now complete and adds the checklist workspace to the selected-ticket detail panel.
