# Dashboard Information Architecture

SPEC-02 status: complete.

## Intent

The generated Jira board is now arranged around release scanning instead of long page reading. The first viewport surfaces the active release, latest pull changes, QA-ready work, checklist coverage, high-priority items, unassigned tickets, and direct anchors into the filters, data pull, and release board navigator.

## First Viewport

- Header remains the durable board identity, pull timestamp, next refresh, and source domain.
- Release scan sits directly under the header and contains the active version, latest-change entry point, QA filters entry point, release board entry point, and compact snapshot metrics.
- Board controls and filters remain immediately below the scan area so existing keyboard and click workflows stay stable.

## Ticket Hierarchy

Every ticket now groups local detail surfaces in this order:

- Description, including embedded image count and modal access.
- Checklist, when the generated board supports testing checklist data.
- Fields, including assignee, priority, updated timestamp, status where applicable, and components.
- Actions, including assignee update, workflow action link, and Jira link.

Subtasks use the same hierarchy minus unsupported main-ticket-only surfaces.

## Release Navigator

The board directory is promoted into the release board navigator. It keeps the current 122 and 123 board links visible near the data pull metadata without taking over the primary ticket workflow. Future historical and upcoming release boards should extend this navigator rather than adding one-off footer links.

## Invariants

- Assignee controls stay inside the ticket they affect.
- Data pull history remains collapsible and visible after the board.
- The board navigator remains collapsible until the release registry is introduced.
- The 122, 123, and shared template repos must share the same IA class names where supported.
