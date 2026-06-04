# SPEC-HQ-05: Automation Bench

Status: in progress. The HQ automation bench now models the approved Playwright pilot registry, run lifecycle, evidence outputs, and guardrails. The shared HQ runner backend is not connected yet.

## Intent

Give CORE QA Headquarters one place to discover approved automation, understand who can run it, see what inputs are required, and know where results appear. This is the bridge between the existing release-board Playwright pilot and the wider QA HeadQuarters application.

## Scope

- Promote the automation module from a small placeholder list into a full HQ run surface.
- Mirror the existing v3001.123.0 Playwright pilot contract into the HQ UI.
- Show approved scripts, planned scripts, required parameters, environments, cadence, evidence outputs, workflow source, and permission role.
- Show the expected automation lifecycle from request validation through dashboard notification.
- Link to the latest published pilot job and the GitHub Actions run that created it.
- Document the guardrails required before this becomes a shared production runner.

## Acceptance Criteria

- The HQ page includes a full-width automation bench.
- Ready and planned scripts are visually distinct.
- Each script shows kind, board, environment, cadence, permission, workflow, required parameters, and evidence outputs.
- The latest known Playwright job is linked from the HQ page.
- The lifecycle makes failure/result notification part of the contract.
- SPEC-HQ-05 is marked active in the HQ checklist.

## Current Validation

- The HQ implementation uses the existing v3001.123.0 `run-playwright-job.yml` pilot as the current source of truth.
- The latest linked pilot job is `core-14440-mpr4ewar-54d72b25`, which completed and published evidence.
- The HQ surface keeps run controls descriptive until Cloudflare hosting, Access identity, and server-side permission enforcement are connected.

## Runner Connection Plan

1. Move the script registry into a shared HQ-owned JSON source.
2. Add board-specific install state so users can see whether a script is available on `.123`, `.124`, or the future central runner.
3. Use SPEC-HQ-03 permissions to show run controls only to Automation Owners.
4. Dispatch approved jobs through a Worker-backed endpoint instead of exposing raw workflow payloads in the browser.
5. Poll the job summary and events feed so the dashboard shows running, complete, and failed states immediately.
6. Keep screenshot, video, logs, events, trace, and summary JSON available through the modal result viewer.

## Notes

The current HQ page intentionally does not create a second automation backend. It documents and surfaces the pilot runner contract first, then leaves a clean path to centralize the run endpoint once the Cloudflare/auth work is unblocked.
