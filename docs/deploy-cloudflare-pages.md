# Cloudflare Pages deploy

FigDiff has three application surfaces: Electron desktop, Chrome extension, and Figma plugin. The repository also exposes a static Vite web build for the desktop renderer via `pnpm --filter @figdiff/desktop build:web`, which writes `app/desktop/dist/web`.

## Platform decision

- **Cloudflare Pages** is the selected web deploy target. The app emits static Vite assets and does not need a Next.js runtime, server functions, or a Vercel-specific project file.
- **Vercel** is not selected for this rollout because there is no `vercel.json`, Next.js app, or matching reference workflow in this organization.
- **fastlane** is not applicable because this repository has no `ios/`, `android/`, React Native, Flutter, or native mobile release target.

## Required GitHub configuration

Create these repository secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Create this repository variable:

- `CLOUDFLARE_PAGES_PROJECT_NAME`

The token needs permission to deploy the configured Cloudflare Pages project.

## Workflow behavior

`.github/workflows/deploy-web.yml` runs for same-repository pull requests, pushes to `develop`, and manual dispatch. Fork pull requests are skipped. When Cloudflare secrets/variables are not configured, the workflow still runs dependency install + web build checks and explicitly skips the deploy step. The workflow:

1. Installs dependencies with `pnpm install --frozen-lockfile`.
2. Builds `@figdiff/shared`, which is required before the Vite app can resolve `@figdiff/shared`.
3. Builds the static web app with `pnpm --filter @figdiff/desktop build:web`.
4. Deploys `app/desktop/dist/web` using `cloudflare/wrangler-action@v3` only when `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_PAGES_PROJECT_NAME` are configured.
5. Verifies the returned deployment URL responds with HTTP 200 when deploy runs.

## Evidence plan

For each rollout PR, collect:

- GitHub Actions result for `Deploy Web / Cloudflare Pages`.
- The Cloudflare Pages deployment URL from the workflow output.
- The `Verify deployment URL` step showing the deployment URL returned HTTP 200.

## Demo steps

1. Open the Cloudflare Pages deployment URL from the workflow output.
2. Confirm the FigDiff web shell renders.
3. Open browser DevTools Network and reload.
4. Confirm `index.html` returns 200 and static assets load without 404s.
