# SPEC-HQ-07: AI Release Summary

Status: in progress. HQ now has a Cloudflare Workers AI-backed release intelligence module with source mapping, draft output types, risk signals, review gates, and a first live `/api/ai/release-summary` endpoint for the .124 Cloudflare HQ Worker.

## Intent

Give CORE QA Headquarters a governed AI briefing surface for the active release board. The feature should help QA understand release risk, focus areas, blockers, and useful Jira-ready summaries without auto-posting or mutating project data.

## Scope

- Expand the AI placeholder into a release intelligence workbench.
- Map input sources from dashboard artifacts, Jira detail/context, automation evidence, knowledge-base entries, and operations health.
- Define draft output types for risk briefs, QA focus plans, Jira-ready notes, and executive rollups.
- Add a Cloudflare Worker route that reads the deployed `dashboard-data.json` asset and calls Cloudflare Workers AI.
- Render the returned structured JSON inside the HQ AI section with a visible user prompt composer and copy support.
- Support direct board-data ticket lookups for questions such as "What tickets are assigned to Dewan?" before calling the model.
- Keep `dashboard-data.json` in the Cloudflare HQ asset bundle during deploy preparation.
- Surface risk signals that explain what the AI summary should watch.
- Keep all generated output draft-only until a user reviews and approves it.
- Keep the module aligned with SPEC-HQ-03 roles while the first Worker API endpoint is hardened.

## Acceptance Criteria

- The HQ page has a full AI release intelligence module.
- The module lists source coverage and data freshness expectations.
- The module shows draft output types, risk signals, and review gates.
- The `.124` Cloudflare HQ Worker exposes `POST /api/ai/release-summary`.
- The dashboard can accept a user prompt, generate a draft release brief, and copy the result from the AI section.
- The dashboard can answer assignee/developer ticket lookup prompts from the current board artifact without forcing them into the release-brief shape.
- The Cloudflare HQ asset-prep script copies the current board artifact into `.cloudflare-hq-assets/dashboard-data.json`.
- The governance contract blocks automatic Jira, Slack, or automation mutations.
- SPEC-HQ-07 is marked active in the visible HQ checklist.
- No secrets, prompt internals, or private credentials are exposed in the static page.

## Current Validation

- Static Astro build should pass for the template, .123 mirror, and .124 board.
- Generated HQ pages should contain SPEC-HQ-07 and the release intelligence workbench copy.
- The `.124` Worker deploy should pass with an `[ai]` binding named `AI` and a Worker-first `/api/*` route.
- The API should return structured JSON with a deterministic draft fallback if model output cannot be parsed.
- Direct ticket lookup prompts should return deterministic board data even if Workers AI is unavailable.

## AI Endpoint Contract

- Endpoint: `POST /api/ai/release-summary`.
- Status endpoint: `GET /api/ai/status`.
- Provider: Cloudflare Workers AI.
- Current model: `@cf/meta/llama-3.1-8b-instruct-fast`.
- Inputs: board artifact URL, selected release, scope, enabled sources, prompt template, user prompt, and requested output type.
- Response: summary, cited sources, confidence level, data age, proposed actions, and blocked/gated actions.
- Lookup mode: `promptTemplate: "ticket_lookup"` or an assignee/developer question returns matching tickets from `dashboard-data.json` with `answerType: "assignee_lookup"`.
- Role gate: QA Engineer can request drafts, QA Admin controls prompts/settings, and automation actions stay server-gated.

## Notes

Keep AI outputs explainable, cited, and draft-only until authentication, logging, prompt configuration, and approval workflow are connected.
