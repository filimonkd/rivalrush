# CI/CD

```
feature/* branch ─▶ Pull Request ─▶ GitHub Actions
                                     ├─ verify: lint · format · typecheck · unit+integration tests · build
                                     └─ e2e:    two-browser Playwright match (after verify)
                                   ─▶ Vercel preview deployment (PRs)
   all green + review ─▶ merge to main ─▶ Vercel production (web)
                                       ─▶ Render production (API, after CI checks pass)
```

## GitHub Actions (`.github/workflows/ci.yml`)

- Triggers: every pull request and every push to `main`; superseded runs are cancelled.
- `verify`: `npm ci` → `lint` → `format:check` → `typecheck` → `npm test` (includes
  integration tests on an in-memory MongoDB replica set, `MONGOMS_VERSION=8.0.32`, binary
  cached) → `build`.
- `e2e`: builds shared and server, installs Chromium, runs `npm run test:e2e`, uploads the
  Playwright report on failure.
- Any failing step fails the run. Secrets are not needed or used in CI.

## Branch model

`main` (always deployable) + short-lived `feature/*` branches (e.g. `feature/telegram-auth`).
No develop/release branches.

## Required GitHub settings (manual: needs repository admin)

Settings → Branches → Add rule for `main`:

- Require a pull request before merging (1 approval if you have a reviewer)
- Require status checks to pass: **Lint, typecheck, test, build** and **Two-browser
  end-to-end** (the job names from `ci.yml`); require branches to be up to date
- Block force pushes; block deletions
- Optional: require linear history

Settings → Actions → General: allow GitHub Actions; workflow permissions read-only.

## Deployments

- **Vercel** builds previews for PRs and production for `main` automatically once the project
  is linked (see [deployment.md](deployment.md)). Enable "Ignored Build Step" only if you want
  to skip unrelated changes.
- **Render**: `autoDeploy: false` in `render.yaml`. In the dashboard set Auto-Deploy to
  **"After CI Checks Pass"** for `main`, so failing code never deploys. Alternatively, trigger
  the service's deploy hook from a protected workflow.
