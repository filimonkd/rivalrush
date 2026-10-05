# CI/CD

```
branch ─▶ Pull Request ─▶ GitHub Actions
                           ├─ verify: lint · format · typecheck · unit+integration tests · build
                           └─ e2e:    two-browser Playwright match (after verify)
                         ─▶ Vercel preview build (build check only, see below)
   CI green ─▶ merge to main ─▶ GitHub Actions again on main
                             ─▶ Vercel production (web): deploys on every push to main, does NOT wait for CI
                             ─▶ Render production (API): depends on the service's Auto-Deploy setting
```

**Current state (5 Oct 2026):** CI is green on `main`. Branch protection is **not yet
enabled** (owner action), so GitHub currently allows merging before CI finishes; PR #6 was
merged that way, and CI then passed on `main`.

## GitHub Actions (`.github/workflows/ci.yml`)

- Triggers: every pull request and every push to `main`; superseded runs are cancelled.
- `verify`: `npm ci` → `lint` → `format:check` → `typecheck` → `npm test` (includes
  integration tests on an in-memory MongoDB replica set, `MONGOMS_VERSION=8.0.32`, binary
  cached) → `build`.
- `e2e`: builds shared and server, installs Chromium, runs `npm run test:e2e`, uploads the
  Playwright report on failure.
- Any failing step fails the run. Secrets are not needed or used in CI.

## Branch model

`main` (always deployable) + short-lived branches named by purpose: `feature/*`, `fix/*`,
`docs/*`. No develop/release branches.

## Required GitHub settings (manual: needs repository admin)

Settings → Branches → Add rule for `main`:

- Require a pull request before merging (1 approval if you have a reviewer)
- Require status checks to pass: **Lint, typecheck, test, build** and **Two-browser
  end-to-end** (the job names from `ci.yml`); require branches to be up to date
- Block force pushes; block deletions
- Optional: require linear history

Settings → Actions → General: allow GitHub Actions; workflow permissions read-only.

## Deployments

- **Vercel** deploys production on every push to `main`, independently of GitHub Actions.
  Branch protection is what keeps untested code out of `main`, and so out of production.
  Vercel deploys don't interrupt live games (the game server is on Render).
- **Vercel PR previews** prove the web build works. They are not usable as an app: the preview
  environment has no `VITE_API_URL`, and preview domains aren't in `CLIENT_ORIGINS`. Test changes
  locally ([local-development.md](local-development.md)) or after merge.
- **Render**: `render.yaml` sets `autoDeploy: false`. Choose one in Render → service →
  Settings → **Auto-Deploy**:
  - **After CI Checks Pass** (recommended): every green `main` deploys automatically. Every API
    deploy ends live games, so during the beta merge server changes only at quiet hours.
  - **Off**: deploy by hand with **Manual Deploy → Deploy latest commit**, at a time you choose.
- **Which commit is live:** `/health` returns `version`, the first 7 characters of the commit
  Render deployed. Compare it with `main`.
