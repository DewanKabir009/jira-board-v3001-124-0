# Multi-board Registry

SPEC-09 status: complete.

## Purpose

The modern dashboard now reads board links from a shared `boards.json` registry instead of hardcoded navigation. This gives current, past, and future boards one maintainable directory surface.

## Implemented Surface

- `boards.json` registry with release, URL, status, owner, notes, modern preview URL, and repository slug.
- 122 and 123 seeded as the first registry entries.
- Astro layout exposes `data-board-registry-url`.
- React board directory component loads the registry and highlights the current release.
- Spin-up hook notes explain that new board creation should append the new release before the first Pages publish.

## Data Contract

The registry schema is `board-registry/v1`.

Required board fields:

- `release`
- `url`
- `status`
- `owner`
- `notes`

Recommended board fields:

- `fixVersion`
- `modernUrl`
- `repositorySlug`

## Acceptance

- 122 and 123 appear as first registry entries.
- Future boards can be added without editing each generated page manually.
- The shared template owns the default directory structure.
- The 122 and 123 Astro preview builds include the board directory.

## Next Dependency

SPEC-10 can now add repeatable accessibility and responsive QA checks against the dashboard shell, registry, operations center, analytics band, explorer, and checklist workspace.
