# SPEC-HQ-02: Cloudflare Hosting

Status: in progress. Config validated, the hosted Jira bridge is reachable as a Cloudflare Access protected Worker, and the 123/124 HQ Static Assets Workers are deployed through local Wrangler OAuth. GitHub Actions deployment still needs a valid `CLOUDFLARE_API_TOKEN` repository secret.

## Intent

Move the CORE QA Headquarters pilot toward Cloudflare Workers Static Assets without breaking the existing GitHub Pages dashboard or the assignee bridge Worker.

## Scope

- Add a dedicated Cloudflare Worker config for the HQ/static dashboard artifact.
- Keep the existing assignee bridge Worker config separate.
- Add a manual deploy workflow for the 123 pilot repository.
- Keep GitHub Pages live as the fallback while Cloudflare routing and access policies are finalized.
- Document the expected production path for a future custom domain.

## Acceptance Criteria

- A deploy config exists that serves the staged 123 dashboard assets from `.cloudflare-hq-assets/`.
- The deploy config does not reuse or overwrite the assignee bridge Worker config.
- GitHub Actions has a manual Cloudflare deploy workflow that requires `CLOUDFLARE_API_TOKEN`.
- The HQ checklist marks Cloudflare hosting as active.
- Local validation confirms the Wrangler config can be parsed before deployment.
- The generated board Wrangler configs include the non-secret Cloudflare account id so deploys do not depend on account auto-discovery.

## Current Validation

- `npx -y wrangler deploy --dry-run -c wrangler.hq.toml` passed for both the 123 pilot and the 124 current board with the account id embedded in `wrangler.hq.toml`.
- `npx -y wrangler deploy -c wrangler.hq.toml` deployed `core-qa-headquarters-123` to `https://core-qa-headquarters-123.dfkabir253.workers.dev` with version `9555cb75-c62f-444e-8390-3e833838010a`.
- `npx -y wrangler deploy -c wrangler.hq.toml` deployed `core-qa-headquarters-124` to `https://core-qa-headquarters-124.dfkabir253.workers.dev` with version `58b151af-9e9c-42cb-a230-bdc52379b658`.
- `GET https://jira-board-assignee-bridge.dfkabir253.workers.dev/status` returns `302 Found` to Cloudflare Access, which confirms the hosted bridge route is reachable and protected rather than offline.
- The 123 deploy path stages assets with `scripts/prepare-cloudflare-hq-assets.cjs` so GitHub Pages can keep repository-prefixed asset URLs while Cloudflare receives root-relative asset URLs.
- Local Wrangler OAuth is valid for direct deploys.
- The manual GitHub deploy workflows for 123 and 124 previously failed at the explicit token gate because `CLOUDFLARE_API_TOKEN` is not present in repository secrets. The workflow should not be rerun until that secret exists.

## Deployment Shape

The 123 pilot will publish static assets through a dedicated Worker:

- Worker name: `core-qa-headquarters-123`.
- Assets directory: `./.cloudflare-hq-assets`.
- Fallback: GitHub Pages remains available at `https://dewankabir009.github.io/jira-board-v3001-123-0/modern/`.

The current 124 board is prepared the same way:

- Worker name: `core-qa-headquarters-124`.
- Assets directory: `./.cloudflare-hq-assets`.
- Fallback: GitHub Pages remains available at `https://dewankabir009.github.io/jira-board-v3001-124-0/modern/`.

The existing bridge Worker remains responsible for Jira assignment and comments. It should not be merged into this hosting Worker until auth, permissions, and API routing are specified in later HQ specs.

## Notes

Custom domain routing and Cloudflare Access policies will be handled after the first static Worker deployment is proven. The immediate remaining requirement is to add a Workers deploy token as `CLOUDFLARE_API_TOKEN` in each board repo so future GitHub Actions deploys can publish without relying on a local Wrangler OAuth session.
