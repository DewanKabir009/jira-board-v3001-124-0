# Cutover Readiness Validation

SPEC-12 status: ready.

## Purpose

The modern dashboard can be promoted only after the team has current evidence that read paths, Jira write paths, checklist comments, Slack notifications, and fallback instructions are working for the active release boards.

## Delivered

- Added a cutover validation panel to the modern preview.
- Kept read parity separate from Jira mutation checks.
- Added explicit evidence-required gates for assignee writes, checklist comments, and Slack delivery.
- Linked each gate to the current board, modern preview, Cloudflare bridge status, GitHub Actions workflows, or this runbook.
- Hardened the visual QA surface with custom compact dropdowns, Jira assignee avatars, and refreshed energetic GolfNow-inspired dashboard color tokens.

## Validation Gates

| Gate | Evidence required before signoff |
| --- | --- |
| Read parity snapshot | Modern preview loads the same `dashboard-data.json` snapshot as the current board for 122 and 123. |
| Assignee write | A named test ticket is reassigned from the current board, Jira readback confirms the assignee, and the expected Slack tag is sent. |
| Checklist comment | A checklist comment is posted from a named test ticket and the Jira comment body is confirmed. |
| Slack delivery | `core-qa-dream-team` receives assignee-update and dashboard-refresh notifications from the live workflows. |
| Final cutover signoff | Evidence links are attached here before the modern board is promoted beyond preview. |

## Evidence Log

| Date | Release | Test ticket | Gate | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| Pending | v3001.122.0 | Pending | Assignee write | Pending | Requires named test ticket. |
| Pending | v3001.122.0 | Pending | Checklist comment | Pending | Requires named test ticket. |
| Pending | v3001.123.0 | Pending | Assignee write | Pending | Requires named test ticket. |
| Pending | v3001.123.0 | Pending | Checklist comment | Pending | Requires named test ticket. |
| Pending | Both | Pending | Slack delivery | Pending | Requires workflow run and Slack receipt. |

## Notes

- The current generated board remains the primary QA surface until these gates are complete.
- Hosted Cloudflare bridge status is configuration evidence, not write-path proof by itself.
- Do not use laptop-local bridge endpoints for live cutover validation.
- Historical GitHub Actions emails should be compared with the latest workflow runs before treating the bridge as down.

## Acceptance

- Modern previews display the cutover validation gates.
- Modern preview dropdowns are custom controls, not native browser select menus, and assignee options show Jira avatars when the data artifact includes them.
- Write-path gates remain evidence-required until a named test ticket proves the mutation.
- The checklist website exposes this runbook as SPEC-12.
- Current boards remain available as the fallback path.
