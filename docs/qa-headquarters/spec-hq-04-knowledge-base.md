# SPEC-HQ-04: Knowledge Base

Status: in progress. Static flow registry, preview cards, ownership, access labels, and freshness metadata are implemented; source ingestion is not connected yet.

## Intent

Turn CORE QA Headquarters into the front door for reusable test-flow knowledge. A user should be able to find the relevant flow, understand who owns it, see whether it is live or draft, and open the source material without hunting through Slack, Notion, Jira, or old release notes.

## Scope

- Add a full-width knowledge-base module to HQ.
- Promote the NY State One Click Cancellation flow as the first live external source.
- Show source, owner, access level, freshness, summary, next action, and topic tags for each flow.
- Distinguish live external links from draft HQ records.
- Keep the UI static while leaving room for later Notion, Confluence, or Markdown ingestion.

## Acceptance Criteria

- The HQ page has a knowledge-base section that is more than a flat link list.
- Each flow has owner, source, freshness, access, summary, and tags.
- The live Notion flow opens from the featured flow and flow card.
- Draft flows communicate their next action instead of pretending to be complete.
- SPEC-HQ-04 is marked active in the HQ checklist.

## Current Validation

- The Astro HQ build succeeds with the expanded knowledge-base registry.
- The generated HQ page contains the featured flow, flow cards, and access/freshness metadata.
- The external Notion link remains a direct link until content ingestion is approved.

## Content Ingestion Plan

1. Define a small `knowledge-base.json` schema for title, owner, source URL, access, freshness, tags, and preview text.
2. Add optional imported content sections for Markdown/Confluence/Notion exports.
3. Add a freshness check so stale flows are flagged before release signoff.
4. Allow restricted records to use the SPEC-HQ-03 access model.
5. Let AI summaries cite these flow records when producing QA guidance.

## Notes

The current implementation intentionally avoids scraping the Notion page. Once the HQ has a proper hosting/auth path, source ingestion should use approved exports or APIs so private content is not exposed accidentally.
