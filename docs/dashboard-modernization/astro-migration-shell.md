# Astro Migration Shell

SPEC-04 status: complete.

## Goal

The Astro migration shell creates a modern component structure without replacing the current generated dashboard. The active GitHub Pages board still uses `index.html`, while the new shell reads `dashboard-data.json` and can be built as a static artifact for a future `/modern/` preview.

## Files

- `modern-dashboard/package.json`: Astro app manifest and local build scripts.
- `modern-dashboard/astro.config.mjs`: static output configuration with GitHub Pages base-path support.
- `modern-dashboard/src/layouts/DashboardLayout.astro`: shared HTML document wrapper.
- `modern-dashboard/src/pages/index.astro`: entry page for the modern board shell.
- `modern-dashboard/src/components/BoardMeta.astro`: release metadata and board links.
- `modern-dashboard/src/components/FilterBar.astro`: first-pass search, status, assignee, and priority controls.
- `modern-dashboard/src/components/TicketPreviewList.astro`: status lanes and ticket-card surface.
- `modern-dashboard/src/scripts/dashboard-shell.js`: client-side loader for `dashboard-data.json` and preview filtering.
- `modern-dashboard/src/styles/dashboard.css`: restrained operational dashboard styling.
- `.github/workflows/modern-dashboard-build.yml`: manual and pull-request static build validation.

## Hosting Strategy

The shell is designed to build under `/modern/` so it can share the root board artifact:

```text
/index.html
/dashboard-data.json
/modern/
```

The default data URL is `../dashboard-data.json`, which works for a `/modern/` preview. If the Astro app later becomes the root dashboard, set `PUBLIC_DASHBOARD_DATA_URL=dashboard-data.json`.

## Build Workflow

The `Modern Dashboard Static Build` workflow:

- Installs dependencies inside `modern-dashboard/`.
- Builds with `ASTRO_BASE` set to `/<repo>/modern/`.
- Uploads `modern-dashboard/dist` as a static artifact.

The workflow does not deploy over the current GitHub Pages root, so the existing board links and Cloudflare bridge actions keep working while migration continues.

## Compatibility

The shell consumes only the SPEC-03 `dashboard-data/v1` contract. It uses the existing `dashboardUrl`, `jiraFilterUrl`, `assigneeDispatchEndpoint`, issue metadata, and ticket arrays. It does not create a new Jira pull path.

## Fallback Rule

The generated board remains the fallback until parity is proven across:

- Ticket scanning and filtering.
- Jira links and media paths.
- Assignee update dispatch.
- Checklist comment posting.
- Board directory navigation.
- GitHub Pages deployment behavior.

SPEC-05 now adds the first React island inside this shell for dense ticket exploration.
