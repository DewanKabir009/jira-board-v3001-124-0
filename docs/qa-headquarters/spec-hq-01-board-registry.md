# SPEC-HQ-01 Board Registry

Status: implemented in first static pass.

## Goal

Give the HQ app a release-board command center for current, past, and upcoming CORE dashboards.

## Requirements

- Show v3001.122.0, v3001.123.0, and v3001.124.0 as board slots.
- Mark v3001.123.0 as the current pilot.
- Provide links to the modern board and legacy board where applicable.
- Include a current-board preview panel.
- Keep the board registry extensible for future generated releases.

## Implemented Surface

- `.122`, `.123`, and `.124` release shortcuts.
- Release cards with state, repository, and summary.
- Embedded preview for the v3001.123.0 modern board.
- Board registry entries added for the planned v3001.124.0 release slot.

## Acceptance

- Users can navigate from HQ to .122 and .123 dashboards.
- Users can see .124 as a planned release slot.
- Current board preview loads independently of the existing release dashboard page.
