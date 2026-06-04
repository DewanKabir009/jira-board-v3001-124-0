# CORE QA Headquarters

Status: started. SPEC-HQ-02 is blocked on Cloudflare auth. SPEC-HQ-03, SPEC-HQ-04, and SPEC-HQ-05 are in progress.

## Purpose

CORE QA Headquarters turns the standalone release dashboard into a broader project test bench. The hub should collect release boards, knowledge-base links, approved automation, AI summaries, operations status, and permission-aware sections in one application.

## Initial Scope

- Release-board tabs for v3001.122.0, v3001.123.0, and v3001.124.0.
- Knowledge-base registry with external page links and preview metadata.
- Automation bench registry for Playwright and Python API scripts.
- AI release summary placeholder for the active dashboard.
- Operations status cards fed by future API automation.
- Permission-aware locked section pattern.

## Delivery Model

The first implementation is a static Astro route at `/hq/` so it can live beside the current dashboard without disrupting `/modern/`. SPEC-HQ-02 adds a dedicated Cloudflare Workers Static Assets deployment path for the 123 pilot while keeping GitHub Pages as the fallback during rollout.

## Specs

- SPEC-HQ-00: Product shell.
- SPEC-HQ-01: Board registry.
- SPEC-HQ-02: Cloudflare hosting. Blocked on Cloudflare deploy authentication.
- SPEC-HQ-03: Auth and permissions. In progress.
- SPEC-HQ-04: Knowledge base. In progress.
- SPEC-HQ-05: Automation bench. In progress.
- SPEC-HQ-06: Operational status.
- SPEC-HQ-07: AI release summary.
- SPEC-HQ-08: Admin console.
