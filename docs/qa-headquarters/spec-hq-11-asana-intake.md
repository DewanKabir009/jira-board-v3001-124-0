# SPEC-HQ-11: Asana Intake

## Goal

Let a QA user open a work request from CORE QA Headquarters without leaving the HQ page. The first implementation creates an Asana task in the `GN CORE QA HQ` project, posts a Slack notification through the existing CORE JIRA NOTIFIER AGENT route when available, and returns Jira direct-create or manual-handoff status.

## Source Of Truth

- HQ UI route: `/hq/#automation`
- Worker status route: `GET /api/asana/status`
- Worker schema repair route: `GET /api/asana/status?ensure=1`
- Worker intake route: `POST /api/asana/intake`
- Asana workspace: `versantmedia.com` / `1211388543961903`
- Asana project: `GN CORE QA HQ` / `1215683271714250`
- Asana default placement: project section `New`; also sets `Status = New` when Asana exposes or allows that enum field.
- Asana default assignee: `Dewan Kabir`

## User Flow

1. User opens the Automation Bench section in HQ.
2. HQ checks `/api/asana/status` and enables the submit button only when the Worker can create Asana tasks.
3. User enters summary, request type, entity, environment, priority, optional related ticket, optional source URL, and details.
4. HQ posts the request to `/api/asana/intake`.
5. Worker creates the Asana task in the `New` section, assigns it to `Dewan Kabir`, and maps request type/entity/environment into matching Asana enum fields.
6. Worker attempts Slack notification through the configured Slack bot.
7. Worker creates a Jira issue when Jira credentials are configured; otherwise it returns a copy-ready Jira handoff payload.
8. HQ shows links to the created Asana task and Jira issue or Jira handoff.

## Configuration

Worker vars:

- `ASANA_WORKSPACE_NAME`
- `ASANA_WORKSPACE_GID`
- `ASANA_PROJECT_NAME`
- `ASANA_PROJECT_GID`
- `ASANA_INTAKE_SLACK_MENTION`
- `ASANA_DEFAULT_SECTION_NAME`
- `ASANA_DEFAULT_STATUS_NAME`
- `ASANA_DEFAULT_ASSIGNEE_NAME`
- `ASANA_DEFAULT_ASSIGNEE_EMAIL`
- `ASANA_REQUEST_TYPE_FIELD_NAME`
- `ASANA_ENTITY_FIELD_NAME`
- `ASANA_ENVIRONMENT_FIELD_NAME`
- `ASANA_STATUS_FIELD_NAME`
- `JIRA_INTAKE_PROJECT_KEY`
- `JIRA_INTAKE_ISSUE_TYPE`

Asana enum field options:

- `Status`: `New`, `In progress`, `Pending`, `Closed`
- `Request Type`: `QA support request`, `Automation request`, `Release risk follow-up`, `Test data request`, `Access request`
- `Entity`: `GolfNow CORE`, `GolfNow Web`, `G1 - Pure`, `EZL -Pure`, `EZRTS`, `Other`
- `Environment`: `DEV TN000`, `DEV TN001`, `STG TN000`, `STG TN001`, `EZL QA`, `EZL STAGE`

Worker secrets:

- `ASANA_ACCESS_TOKEN`
- `SLACK_BOT_TOKEN`
- `SLACK_CHANNEL_ID` or `SLACK_DEFAULT_CHANNEL_ID` when channel-name fallback is not enough
- `JIRA_SITE_URL`, `JIRA_EMAIL`, and `JIRA_MCP_TOKEN` or `JIRA_API_TOKEN` only if HQ should create Jira issues directly

## Safety

- `GET /api/asana/status` is read-only.
- `GET /api/asana/status?ensure=1` is an explicit schema repair path that creates or attaches missing HQ intake enum fields without creating a task.
- `POST /api/asana/intake` supports `dryRun: true` so deployment tests can validate routing without creating Asana, Slack, or Jira records.
- AI endpoints do not call the Asana intake route.
- The browser shows downstream warnings instead of hiding partial failures.

## Done Criteria

- HQ shows an Asana intake card in the Automation Bench.
- The card clearly points at `GN CORE QA HQ`.
- The submit button remains disabled until `/api/asana/status` returns `canCreate: true`.
- A successful request returns an Asana task link.
- A successful request lands under the `New` Asana placement and assigns the task to Dewan Kabir.
- Asana shows request type, entity, and environment values that match the HQ intake form.
- Slack and Jira follow-up states are shown explicitly.
- README and spec checklist include SPEC-HQ-11.
