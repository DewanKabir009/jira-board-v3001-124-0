# SPEC-HQ-00 Product Shell

Status: implemented in first static pass.

## Goal

Create the first CORE QA Headquarters surface without breaking the existing release dashboard route.

## Requirements

- Provide a durable HQ route in the Astro app.
- Use a workbench layout appropriate for an internal QA operations tool.
- Include persistent navigation for boards, knowledge base, automation, AI, operations status, and access control.
- Keep the first viewport useful, not a marketing landing page.
- Preserve accessibility basics: skip link, semantic landmarks, visible focus states, responsive layout.

## Implemented Surface

- `/hq/` Astro page.
- Sidebar module navigation.
- Command strip with quick links.
- Status cards.
- Module panels for boards, KB, automation, AI, access control, and specs.
- Responsive desktop/tablet/mobile layout.

## Acceptance

- Existing `/` dashboard route remains unchanged.
- HQ route builds with Astro.
- No horizontal scrolling is required on desktop, tablet, or mobile.
- Locked content pattern is visible for future permission specs.
