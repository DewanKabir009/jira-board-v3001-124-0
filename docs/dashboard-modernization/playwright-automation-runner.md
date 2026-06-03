# Playwright Automation Runner

SPEC-PW status: complete for the 123 board pilot.

## Goal

Give the 123 dashboard a spec-driven path for triggering approved Playwright jobs without running browser automation inside GitHub Pages.

The dashboard remains a command surface. A protected hosted runner owns execution, credentials, browser state, logs, videos, traces, and screenshots.

## Current Scope

- Pilot board: `v3001.123.0`
- Hosted spec path: `/playwright-specs/`
- Runner workflow: `run-playwright-job.yml`
- Evidence path: `/playwright-jobs/<jobId>/`

## Completed Deliverables

- Job request schema.
- Approved script registry.
- Runner endpoint contract.
- Artifact contract.
- Failure and audit behavior.
- Dashboard job queue control.
- Summary polling and artifact links.
- Protected runner workflow and script skeleton.

## Runner Contract

The dashboard submits a small JSON request:

```json
{
  "schemaVersion": "playwright-job/v1",
  "scriptId": "dashboard-regression-smoke",
  "ticketKey": "CORE-14474",
  "release": "v3001.123.0",
  "environment": "dev",
  "repositorySlug": "DewanKabir009/jira-board-v3001-123-0",
  "requestedBy": {
    "displayName": "Dewan Kabir"
  },
  "artifactPlan": {
    "screenshots": true,
    "video": true,
    "trace": true,
    "logs": true
  },
  "jiraCommentMode": "draft"
}
```

The runner accepts only script ids listed in the approved registry. It never accepts arbitrary JavaScript, raw Playwright code, or user-controlled shell commands.

## Required Endpoints

```text
POST /playwright/jobs
GET  /playwright/jobs/{jobId}
GET  /playwright/jobs/{jobId}/events
POST /playwright/jobs/{jobId}/cancel
```

## Artifact Shape

Every job record should expose:

- Job id.
- Script id and label.
- Ticket key.
- Environment.
- Requested user.
- Status: `queued`, `running`, `succeeded`, `failed`, or `cancelled`.
- Current step.
- Started and completed timestamps.
- Failure reason when applicable.
- Links for screenshot, video, trace, logs, and summary JSON.

## Safety Gates

- Cloudflare Access in front of every write endpoint.
- Allowlist of users who can start or cancel jobs.
- Allowlist of scripts and environments.
- No production write scripts in the pilot.
- Per-script timeout and rate limit.
- Durable audit log for every requested job.

## Production Gate

This pilot remains limited to the `v3001.123.0` board. Additional boards should not receive the run console until the approved script registry, Cloudflare Access users, rate limits, and evidence retention rules are reviewed for that board.
