# SPEC-HQ-06: Operational Status

Status: in progress. The HQ route now includes an operational status command panel with service cards, run cadence, the expected five-minute health artifact contract, and a Worker-backed Slack bridge status panel. The live API probe feed is not connected yet.

## Intent

Give CORE QA Headquarters a single place to see whether the systems that power the hub are healthy, stale, auth-gated, or still planned. This should reduce guesswork around Jira pulls, Pages publishes, bridge writes, automation evidence, and future API health probes.

## Scope

- Add a full operational status module to the HQ page.
- Separate known hosted health from future probe-driven health.
- Show service name, state, cadence, source, signal, and next action.
- Show the expected collect, publish, notify, and escalate lifecycle.
- Define the status fields needed from future API automation.
- Keep SPEC-HQ-06 active in the visible HQ checklist.

## Acceptance Criteria

- The HQ navigation lands on a dedicated operations status section.
- Jira data pull, GitHub Pages deployment, Jira write bridge, Playwright evidence publishing, CORE API health probe, and Slack notification pipeline are represented.
- Healthy, auth-gated, and planned states are visually distinct.
- The module explains the five-minute API health cadence without implying the backend is already wired.
- The HQ checklist marks SPEC-HQ-06 as active.
- The route remains responsive on desktop, tablet, and mobile.

## Current Validation

- Jira data pull and GitHub Pages deployment are represented as current hosted signals.
- The Jira write bridge is represented as auth-gated because Cloudflare Access can protect write routes even when the static dashboard renders.
- Playwright evidence publishing is represented from the v3001.123.0 pilot workflow.
- CORE API probes are represented as planned connections. Slack operational notification delivery now has Worker routes for outbound posts and signed inbound callbacks, with live inbound gated by Slack app configuration.

## Health Artifact Contract

The future five-minute runner should publish a compact JSON artifact with:

- Service identifier and display name.
- Environment and source workflow.
- State: healthy, degraded, failed, auth gated, stale, or planned.
- Last checked timestamp.
- Availability result and status code.
- Latency in milliseconds.
- Assertion summary.
- Evidence links for logs, events, screenshots, or API response samples.
- Recommended next action.

## Connection Plan

1. Create the API probe runner after endpoint targets and credentials are approved.
2. Publish the latest health artifact beside the active release dashboard.
3. Load the artifact into the HQ operations module.
4. Highlight stale pulls and failed probes in the dashboard before users need to open GitHub Actions.
5. Route critical failures into the notification pipeline once Slack delivery is connected.

## Notes

This spec intentionally keeps operational status visible before the backend is complete. The dashboard should tell users what is known now, what is gated by auth, and what still needs automation wiring.
