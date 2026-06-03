# Dashboard Design Tokens

SPEC-01 status: complete.

The dashboard now exposes a shared CSS custom property contract for current generated HTML and future Astro/React components. The legacy aliases remain in place so existing CSS keeps working while new UI uses the semantic names.

## Core Tokens

| Purpose | Tokens |
| --- | --- |
| Canvas and panels | `--color-bg-canvas`, `--color-bg-panel`, `--color-bg-panel-soft` |
| Text | `--color-text-primary`, `--color-text-muted`, `--color-text-subtle` |
| Borders | `--color-border-default`, `--color-border-strong` |
| Brand/action | `--color-accent-primary`, `--color-accent-primary-hover`, `--color-accent-primary-soft` |
| Success/warning/danger | `--color-accent-success`, `--color-accent-warning`, `--color-accent-danger` plus matching `-soft` tokens |
| Spacing | `--space-1` through `--space-6` |
| Radius | `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-pill` |
| Elevation and focus | `--shadow-panel`, `--focus-ring` |

## Status Tokens

Status sections are driven by these token groups:

- `--status-neutral-*`
- `--status-analysis-*`
- `--status-dev-*`
- `--status-regression-*`
- `--status-qa-*`
- `--status-staging-*`
- `--status-prod-*`
- `--status-blocked-*`
- `--status-review-*`
- `--status-other-*`

Each status group provides `-bg`, `-border`, `-accent`, `-text`, and `-chip`. The generated dashboard reads these values with `dashboardToken()` before rendering inline section styles, so the same status palette can be reused by future components without duplicating color literals.

## Priority Tokens

Priority chips use:

- `--priority-none-bg` and `--priority-none-text`
- `--priority-p0-bg` and `--priority-p0-text`
- `--priority-p1-bg` and `--priority-p1-text`
- `--priority-p2-bg` and `--priority-p2-text`
- `--priority-p3-bg` and `--priority-p3-text`

The text colors were selected to keep chip text readable at the current compact 11px-12px dashboard scale.

## Bridge, Checklist, And Board Health Tokens

Bridge state uses:

- `--bridge-ready-*`
- `--bridge-login-*`
- `--bridge-offline-*`

Checklist state uses:

- `--checklist-empty-*`
- `--checklist-ready-*`
- `--checklist-draft-*`
- `--checklist-submitted-*`

Board health uses:

- `--board-health-fresh-*`
- `--board-health-stale-*`
- `--board-health-failed-*`

These names are intentionally separate from raw colors so `SPEC-08` can add an operations health center without inventing a second status vocabulary.

## Compatibility Aliases

Existing dashboard CSS still references `--ink`, `--muted`, `--line`, `--paper`, `--panel`, `--panel-soft`, `--blue`, `--blue-soft`, `--teal`, `--teal-soft`, `--amber`, `--amber-soft`, `--red`, `--red-soft`, and `--shadow`. Those aliases now point to the semantic tokens above.

## Contrast Checks

Current compact chip pairs meet or exceed 4.5:1 contrast:

| Pair | Ratio |
| --- | ---: |
| Priority P0 text on P0 background | 5.65 |
| Priority P1 text on P1 background | 6.22 |
| Priority P2 text on P2 background | 7.73 |
| Priority P3 text on P3 background | 4.97 |
| Status QA text on QA background | 6.81 |
| Status DEV text on DEV background | 7.09 |
| Status staging text on staging background | 6.62 |

The shared focus ring is also tokenized through `--focus-ring` and applies to links, buttons, inputs, selects, textareas, and focusable custom elements.
