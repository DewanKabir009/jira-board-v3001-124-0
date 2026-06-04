# SPEC-HQ-07: AI Release Summary

Status: in progress. HQ now has an AI-ready release intelligence module with source mapping, draft output types, risk signals, and review gates. The Worker AI endpoint is not connected yet.

## Intent

Give CORE QA Headquarters a governed AI briefing surface for the active release board. The feature should help QA understand release risk, focus areas, blockers, and useful Jira-ready summaries without auto-posting or mutating project data.

## Scope

- Expand the AI placeholder into a release intelligence workbench.
- Map input sources from dashboard artifacts, Jira detail/context, automation evidence, knowledge-base entries, and operations health.
- Define draft output types for risk briefs, QA focus plans, Jira-ready notes, and executive rollups.
- Surface risk signals that explain what the AI summary should watch.
- Keep all generated output draft-only until a user reviews and approves it.
- Connect the module to SPEC-HQ-03 roles and a future Worker API endpoint.

## Acceptance Criteria

- The HQ page has a full AI release intelligence module.
- The module lists source coverage and data freshness expectations.
- The module shows draft output types, risk signals, and review gates.
- The governance contract blocks automatic Jira, Slack, or automation mutations.
- SPEC-HQ-07 is marked active in the visible HQ checklist.
- No secrets, prompt internals, or private credentials are exposed in the static page.

## Current Validation

- Static Astro build should pass for the template, .123 mirror, and .124 board.
- Generated HQ pages should contain SPEC-HQ-07 and the release intelligence workbench copy.
- Worker AI execution remains planned; AI-generated content is not live yet.

## AI Endpoint Contract

- Endpoint: `POST /api/ai/release-summary`.
- Inputs: board artifact URL, selected release, scope, enabled sources, and requested output type.
- Response: summary, cited sources, confidence level, data age, proposed actions, and blocked/gated actions.
- Role gate: QA Engineer can request drafts, QA Admin controls prompts/settings, and automation actions stay server-gated.

## Notes

Keep AI outputs explainable, cited, and draft-only until authentication, logging, prompt configuration, and approval workflow are connected.
