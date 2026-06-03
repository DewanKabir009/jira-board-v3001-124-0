# SPEC-HQ-02: Cloudflare Hosting

Status: in progress. Config validated; deployment is waiting on valid Cloudflare authentication.

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

## Current Validation

- `npx -y wrangler deploy --dry-run -c wrangler.hq.toml` passed for the 123 pilot.
- The 123 deploy path stages assets with `scripts/prepare-cloudflare-hq-assets.cjs` so GitHub Pages can keep repository-prefixed asset URLs while Cloudflare receives root-relative asset URLs.
- The local deploy attempt reached Cloudflare but failed with authentication error `10000`, so the next deploy needs either refreshed Wrangler login credentials or a `CLOUDFLARE_API_TOKEN` secret with Workers deploy permissions.

## Deployment Shape

The 123 pilot will publish static assets through a dedicated Worker:

- Worker name: `core-qa-headquarters-123`.
- Assets directory: `./.cloudflare-hq-assets`.
- Fallback: GitHub Pages remains available at `https://dewankabir009.github.io/jira-board-v3001-123-0/modern/`.

The existing bridge Worker remains responsible for Jira assignment and comments. It should not be merged into this hosting Worker until auth, permissions, and API routing are specified in later HQ specs.

## Notes

Custom domain routing and Cloudflare Access policies will be handled after the first static Worker deployment is proven.
