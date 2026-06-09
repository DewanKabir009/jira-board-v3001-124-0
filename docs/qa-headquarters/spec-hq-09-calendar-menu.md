# SPEC-HQ-09 - Calendar Menu

Status: implemented for the .124 HQ pilot.

## Intent

Add a Calendar Menu tab to CORE QA Headquarters so release calendar dates are visible beside the active board, automation bench, operations status, and AI summary.

## Scope

- Add a sidebar Calendar Menu entry in HQ.
- Add a Calendar Menu module with two internal views: Calendar and Upcoming.
- Show the active GN Releases calendar only for the first implementation.
- Add Previous, Today, and Next month navigation to the Calendar view.
- Group Upcoming events into collapsible month sections.
- Pull Confluence Team Calendar data during the same 5-minute refresh workflow that updates Jira board data.
- Store normalized calendar events in `dashboard-data.json.calendarMenu`.
- Keep Jira refreshes publishing even when Confluence calendar access fails, with a readable dashboard warning.

## Source

Default calendar:

`https://golfnow.atlassian.net/wiki/display/GQE/calendar/413a852e-d20c-454c-9808-425e167314f2?calendarName=GN%20Releases`

The first HQ version now shows a single active calendar because only GN Releases is currently needed. Future source expansion can use `HQ_CALENDAR_SOURCES_JSON`, but the current data pull and UI use the first configured source only.

## Data Contract

`dashboard-data.json.calendarMenu` contains:

- `schemaVersion`: `hq-calendar/v1`.
- `refreshSeconds`: default `300`.
- `pulledAt` and `pulledAtDisplay`.
- `window`: date range pulled from Confluence.
- `defaultSourceId`.
- `duplicateSourceUrls` retained for schema compatibility.
- `sources[]` with the active source metadata, status, event count, events, and any error message.

Each normalized event contains:

- `id`
- `calendarId`
- `calendarName`
- `title`
- `start`
- `end`
- `startDisplay`
- `endDisplay`
- `allDay`
- `type`
- `location`
- `description`
- `url`

## Acceptance

- The HQ sidebar includes Calendar Menu.
- The Calendar Menu entry is the last item in the HQ sidebar.
- The default Calendar Menu state loads GN Releases.
- Users can switch between Calendar and Upcoming views.
- The Calendar grid opens on the current month and provides Previous, Today, and Next controls.
- Upcoming events are grouped under collapsible month headings.
- The calendar section refreshes while the HQ page remains open.
- The 5-minute workflow refresh updates `calendarMenu` alongside Jira data.
- Calendar errors are visible in the HQ page and GitHub Actions summary without blocking the Jira board publish.
