# SPEC-HQ-03: Auth and Permissions

Status: in progress. Static role model and permission-aware UI are implemented; backend enforcement is not connected yet.

## Intent

Give CORE QA Headquarters a clear access model before sensitive modules are connected. Users should understand what they can view, what requires elevated access, and how to request access without losing the surrounding context.

## Scope

- Define the first HQ role set: QA Admin, Automation Owner, QA Engineer, and Stakeholder Viewer.
- Show protected module states in the HQ UI.
- Keep restricted module content visually present but softened until the user has access.
- Provide an access-request path from locked content.
- Document how Cloudflare Access and later in-app RBAC will connect to the static shell.

## Acceptance Criteria

- The HQ page includes a visible role matrix.
- Protected modules show required role, current state, and a short explanation.
- Locked content uses a blurred preview plus a request-access action.
- The active spec checklist marks SPEC-HQ-03 as in progress.
- The implementation does not hard-code real user secrets or expose restricted content.

## Current Validation

- Static HQ page builds with the role matrix and guarded module cards.
- The request-access action is a mail link placeholder until an access workflow endpoint exists.
- Backend authorization remains pending because Cloudflare Access deployment/auth is parked with SPEC-HQ-02.

## Backend Plan

1. Use Cloudflare Access as the front-door identity provider for the HQ domain.
2. Read verified identity headers in a Worker-backed HQ route.
3. Store section permissions in a small role map keyed by normalized email or group.
4. Return a permission manifest to the frontend so UI gating and API gating use the same source.
5. Enforce sensitive actions server-side, especially automation execution, admin edits, and AI prompt/source controls.

## Notes

The static UI is intentionally conservative. It shows the shape of restricted modules and the request path, but the real permission decision must come from Cloudflare Access plus server-side enforcement before private content or write actions are added.
