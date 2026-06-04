# SPEC-HQ-02: Cloudflare Hosting

Status: in progress. Config validated and the hosted Jira bridge is reachable as a Cloudflare Access protected Worker. Cloudflare Static Assets deployment is still waiting on a valid deploy token or refreshed local Wrangler OAuth.

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

- `npx -y wrangler deploy --dry-run -c wrangler.hq.toml` passed for both the 123 pilot and the 124 current board when `CLOUDFLARE_ACCOUNT_ID=b2642b2648a8f477ae5b541efebfcc72` was provided.
- `GET https://jira-board-assignee-bridge.dfkabir253.workers.dev/status` returns `302 Found` to Cloudflare Access, which confirms the hosted bridge route is reachable and protected rather than offline.
- The 123 deploy path stages assets with `scripts/prepare-cloudflare-hq-assets.cjs` so GitHub Pages can keep repository-prefixed asset URLs while Cloudflare receives root-relative asset URLs.
- Local `wrangler deploy` reaches the Cloudflare API but fails with authentication error `10000` because the local Wrangler OAuth session is expired or insufficient.
- The manual GitHub deploy workflows for 123 and 124 were triggered and both failed at the explicit token gate because `CLOUDFLARE_API_TOKEN` is not present in repository secrets.

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

Custom domain routing and Cloudflare Access policies will be handled after the first static Worker deployment is proven. The immediate remaining requirement is to add a Workers deploy token as `CLOUDFLARE_API_TOKEN` in each board repo or complete a fresh local `wrangler login` session before running `npx -y wrangler deploy -c wrangler.hq.toml`.
