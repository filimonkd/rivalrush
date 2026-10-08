# Deployment and operations

**Status: deployed.** Production runs on **free tiers only**: Vercel Hobby (web), Render Free
(API + Socket.IO + bot webhook), MongoDB Atlas M0 (database) and Telegram (bot
`@rivalrushbot` with the Main Mini App enabled). The product owner signed in, invited a
second account and played a full duel in real Telegram on 5 Oct 2026. What has and has not
been verified in production is tracked in [status.md](status.md) and
[testing.md](testing.md#production-manual-qa). Day-2 operations: [runbook.md](runbook.md).

> Free-tier numbers (sleep after ~15 min idle, ~1 min wake-up, 750 free instance hours a
> month on Render; 512 MB storage on Atlas M0) are from the providers' published terms at the
> time of writing. Check the providers' current pages; they change.

## What "free" means for RivalRush

| Piece     | Free tier                                | What to know                                                                                                                                                                                                                      |
| --------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API       | `localhost:4000` (+ tunnel)              | 2nd Render Free service `rivalrush-api-staging` (`render.staging.yaml`), **not** kept awake                                                                                                                                       | Render Free `rivalrush-api` (1 instance, kept awake by a pinger) |
| Keep-warm | UptimeRobot / cron-job.org               | A ping to `/health` every 5–10 min keeps the API awake. One always-awake service ≈ 720–744 h/month, inside Render's 750 free hours. **Don't keep a second service awake** or the hours run out and Render suspends free services. |
| Bot       | dev bot (polling)                        | staging bot (webhook), its own token                                                                                                                                                                                              | `@rivalrushbot` (webhook)                                        |
| Web       | `localhost:5173` (+ tunnel for Telegram) | a 2nd Vercel project (Root `apps/web`) with the staging `VITE_*` values                                                                                                                                                           | Vercel production domain                                         |
| Database  | in-memory (or local)                     | Atlas DB `rivalrush_staging` (same free M0 cluster; the server refuses a non-staging name)                                                                                                                                        | Atlas DB `rivalrush`                                             |
| CI        | GitHub Actions                           | Unlimited minutes on public repos; ~2,000 min/month on private repos (one CI run ≈ 4 billed minutes).                                                                                                                             |

The web app shows "Waking up the game server…" if sign-in takes longer than 4 s, so a cold
start looks intentional rather than broken.

## Environment matrix

Duels are tested locally and in CI, then go to production. **Staging** exists for Telegram
multi-phone QA of unreleased games (today Defuser). It was **set up on 8 Oct 2026** by the product
owner, following [Staging](#staging-optional-telegram-qa-of-unreleased-games) below: bot
`@RivalRushStagingbot`, Render service `rivalrush-api-staging`, a separate Vercel project and the
`rivalrush_staging` database user.
Nothing in staging ever reaches the live service.

|           | Development                                      | Staging (set up 8 Oct 2026)                                                                 | Production (live)                                                                                                                            |
| --------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Web       | `localhost:5173` (+ tunnel for Telegram)         | a 2nd Vercel project (Root `apps/web`) with the staging `VITE_*` values                     | Vercel production domain                                                                                                                     |
| API       | `localhost:4000` (+ tunnel)                      | 2nd Render Free service `rivalrush-api-staging` (`render.staging.yaml`), **not** kept awake | Render Free `rivalrush-api` (1 instance, kept awake by a pinger)                                                                             |
| Database  | in-memory (or local)                             | Atlas DB `rivalrush_staging` (same free M0 cluster; the server refuses a non-staging name)  | Atlas DB `rivalrush`                                                                                                                         |
| Bot       | dev bot (polling)                                | staging bot (webhook), its own token                                                        | `@rivalrushbot` (webhook)                                                                                                                    |
| Dev login | on                                               | **off** (server refuses to boot otherwise)                                                  | **off** (server refuses to boot otherwise)                                                                                                   |
| Defuser   | `DEFUSER_ENABLED=true` when needed (not on Home) | `DEPLOY_ENV=staging` + `DEFUSER_ENABLED=true`: "Staging preview" card on Home               | Off unless you set `DEFUSER_ENABLED=true` in the Render dashboard: then released to everyone ([how](#releasing-defuser-on-the-live-service)) |
| CI        | in-memory MongoDB, no secrets                    | —                                                                                           | —                                                                                                                                            |

Vercel PR previews only check that the web app builds; they can't reach the API (see
[ci-cd.md](ci-cd.md#deployments)).

### Server variables (Render)

| Var                                             | Production value                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| `NODE_ENV`                                      | `production`                                                                 |
| `MONGODB_URI`                                   | Atlas SRV URI for the prod DB user (**server only**)                         |
| `MONGODB_DB_NAME`                               | `rivalrush`                                                                  |
| `BOT_TOKEN`                                     | production bot token (**server only**)                                       |
| `BOT_USERNAME`                                  | bot username without `@`                                                     |
| `BOT_MODE`                                      | `webhook` (set by the blueprint)                                             |
| `PUBLIC_URL`                                    | optional: defaults to `RENDER_EXTERNAL_URL`, which Render sets automatically |
| `WEBAPP_URL`                                    | `https://<vercel domain>`                                                    |
| `CLIENT_ORIGINS`                                | `https://<vercel domain>` (exact, comma-separated if several)                |
| `JWT_SECRET`                                    | ≥ 32 random chars (blueprint generates one)                                  |
| `TRUST_PROXY`                                   | `1`                                                                          |
| `DEV_LOGIN_ENABLED`                             | `false`                                                                      |
| `DISCONNECT_GRACE_SECONDS` / `ROOM_TTL_MINUTES` | `60` / `120`                                                                 |

### Web variables (Vercel), all public

`VITE_API_URL=https://<render service>.onrender.com`, `VITE_BOT_USERNAME=<bot>`. **Never** set
`VITE_DEV_LOGIN` in Vercel, and never put tokens or URIs in `VITE_*`.

## Go-live order (all free; done once)

1. **MongoDB Atlas**: create a free **M0** cluster. Database Access: create users
   `rivalrush_prod` (readWrite on `rivalrush`) and `rivalrush_staging` (readWrite on
   `rivalrush_staging`) with long random passwords. Network Access: add `0.0.0.0/0` (Render
   Free has no fixed outbound IPs). Copy the SRV URI. (The staging user is optional; see the
   matrix above.) Indexes are created by the server on
   boot (`syncIndexes`): `users.telegramId` unique, `matches.sessionId` unique,
   `matches.players.userId+endedAt`, `rooms.roomId` unique, `rooms.inviteTokenHash` unique,
   TTL on `rooms.purgeAt` (30 days after expiry), `game_starts.sessionId` unique.
2. **Render**: New → Blueprint → this repo (`render.yaml`, `plan: free`). Fill the
   `sync: false` variables (use a placeholder `WEBAPP_URL` for now). Note the service URL,
   e.g. `https://rivalrush-api.onrender.com`. If you created the service by hand instead of
   from the blueprint, set Build Command to
   `npm ci --include=dev && npm run build:shared && npm run build -w @rivalrush/server` and
   Start Command to `node apps/server/dist/index.js` (without `--include=dev` the build
   fails with "Could not find a declaration file for module 'express'").
3. **Vercel** (Hobby): New Project → this repo → Root Directory `apps/web` (uses
   `apps/web/vercel.json`: installs at the repo root, builds shared + web, outputs `dist`, SPA
   rewrites). Set `VITE_API_URL` and `VITE_BOT_USERNAME` for Production.
4. Update Render `WEBAPP_URL` and `CLIENT_ORIGINS` to the Vercel production domain and
   redeploy. On boot the server registers the Telegram webhook
   (`<RENDER_EXTERNAL_URL>/telegram/webhook`) and the Play menu button.
5. **BotFather**: `/mybots` → bot → Bot Settings → Configure Mini App → **Enable Mini App**
   with the Vercel production URL ([telegram.md](telegram.md)). Without this, invite links
   (`t.me/<bot>?startapp=…`) open with "bot invalid" even though the Play button works.
6. **Keep-warm pinger** (free): UptimeRobot → New monitor → HTTP(s) →
   `https://<api>.onrender.com/health`, interval 5 min (or cron-job.org, every 10 min). This
   also gives you free downtime alerts by email.
7. Smoke test: `curl https://<api>/health` → `{"status":"ok",…,"database":"up"}`, then `/start`
   the bot and run the manual QA plan.

## Staging (optional): Telegram QA of unreleased games

Staging is a second, free deployment where testers play an unreleased game (today **Defuser**)
inside Telegram on their own phones ([defuser-qa.md](defuser-qa.md)). It is **not** a preview of
the live service and shares nothing secret with it.

**What makes it safe** (enforced by the server, tested in `env.test.ts`):

- `NODE_ENV=production`: every production check applies (≥ 32-char `JWT_SECRET`, exact https
  `CLIENT_ORIGINS`, `BOT_TOKEN` and `MONGODB_URI` required, no dev login, no fixed seed).
- `DEPLOY_ENV=staging` is refused unless `NODE_ENV=production`, and staging refuses to boot
  unless `MONGODB_DB_NAME` names a staging database (contains `staging`), so a copied live config
  cannot write to live data.
- On staging, `/api/games` lists Defuser as `preview` and Home shows a "Staging preview" card for
  it. On the live service Defuser is a separate switch you set by hand
  ([below](#releasing-defuser-on-the-live-service)); `render.yaml` never mentions
  `DEFUSER_ENABLED` or `DEPLOY_ENV` (a test fails if it does).

**Set it up** (all free; you do this, with your accounts; nothing here is automated):

1. **Atlas**: the `rivalrush_staging` user (readWrite on `rivalrush_staging` only) from step 1 of
   the go-live order. Copy its SRV URI. Never reuse the `rivalrush_prod` user.
2. **BotFather**: `/newbot` → a **staging** bot (e.g. `RivalRushStagingBot`). Keep its token for
   Render only. Never use the live bot's token on staging.
3. **Render**: New → Blueprint → this repo, Blueprint path `render.staging.yaml` (or New → Web
   Service with the same build/start commands and variables). Fill the `sync: false` values:
   `BOT_TOKEN` and `BOT_USERNAME` (staging bot), `MONGODB_URI` (staging user), and a placeholder
   `WEBAPP_URL`/`CLIENT_ORIGINS` for now. Note the URL, e.g.
   `https://rivalrush-api-staging.onrender.com`.
4. **Vercel**: Add New → Project → this repo again, Root Directory `apps/web`, a name such as
   `rivalrush-staging`. Production environment variables: `VITE_API_URL` = the staging Render
   URL, `VITE_BOT_USERNAME` = the staging bot. Never set `VITE_DEV_LOGIN`.
5. Set Render staging `WEBAPP_URL` and `CLIENT_ORIGINS` to the staging Vercel URL (exactly, https)
   and deploy. The server registers the staging bot's webhook and Play button on boot.
6. **BotFather** → staging bot → Bot Settings → Configure Mini App → enable with the staging
   Vercel URL (needed for `startapp` invite links).
7. Smoke test: `curl https://<staging api>/health` shows `database: "up"`; `/start` the staging bot,
   open the app: Home shows the "Staging preview" Defuser card. Then run
   [defuser-qa.md](defuser-qa.md).

**Do not** add staging to the uptime pinger: it sleeps when idle and only uses free instance hours
while testers play (a sleep or deploy ends live games there too). Deploy staging by hand
(`autoDeploy: false`). To retire it: suspend or delete the Render service and the Vercel project,
delete the staging bot with `/deletebot`, and drop the `rivalrush_staging` database and user.
Staging and the closed beta are independent: staging never changes the live service, the live bot
or the live database.

## Releasing Defuser on the live service

Defuser ships in the live code but stays off until you switch it on. The switch is the
`DEFUSER_ENABLED` environment variable on the **live** Render service, set in the dashboard (never
in `render.yaml`, so a blueprint sync cannot change it).

**Turn it on** (product owner's decision, 8 Oct 2026):

1. The live service runs a commit that includes the release change (`prod:check --commit`).
2. Pick a quiet moment and tell players: saving an environment variable restarts the service,
   which ends games in progress ([runbook](runbook.md#closed-beta-daily-routine)).
3. Render → the live API service → **Environment** → add `DEFUSER_ENABLED` = `true` → **Save**.
   Render restarts the service. The boot log says `Defuser is LIVE: offered to everyone on Home`.
4. Run `prod:check` (all ✅), then open `@rivalrushbot` → **Play**: Home shows the **Defuser**
   card ("Live now · New · Co-op") and no "Coming soon" tile. Play one team game on two phones.

**Turn it off:** set `DEFUSER_ENABLED` to `false` (or delete it) and save. After the restart Home
shows the "Coming soon" tile again and new Defuser rooms are refused (`GAME_NOT_AVAILABLE`); games
already played stay in history and stats.

What stays refused on the live service whatever the switch says: `DEFUSER_FIXED_SEED`, dev login,
and a staging configuration.

## Production checklist

- [x] Render: `NODE_ENV=production`, `DEV_LOGIN_ENABLED=false` (the server refuses to boot otherwise, and it boots)
- [x] `CLIENT_ORIGINS` = exact https Vercel origin(s) (sign-in from the Mini App works, so CORS accepts it)
- [x] `MONGODB_URI` is set on Render only; CI and local development never use it (CI uses an in-memory database)
- [x] `BOT_TOKEN` only in Render; not in Vercel or the repo (the web build only reads `VITE_API_URL`, `VITE_BOT_USERNAME`, `VITE_DEV_LOGIN`)
- [ ] Exactly **one** Render instance (Free plan), and the uptime pinger is running
- [ ] `/health` returns 200 with `database: "up"`, and `version` matches the latest deployed `main` commit
- [ ] Render Auto-Deploy set deliberately (After CI Checks Pass, or Off with manual deploys)
- [ ] GitHub branch protection on `main` ([ci-cd.md](ci-cd.md))
- [x] WebSocket connects from the Mini App (live games work in production)
- [x] No debug endpoints exist (there are none; `/api/auth/dev` is absent in production)

## Monitoring

- Render health check on `/health` (503 when the DB is down) and Render log stream (JSON).
  Useful events: `auth.success`/`auth.failed`, `room.created`, `room.joined`, `room.closed`,
  `room.expired`, `game.started`, `game.ended`, `game.abandoned`, `player.reconnected`,
  `match.recorded`, `match.record_failed`, `socket.connected`/`disconnected`.
- Alert on: health check failures, repeated `match.record_failed`, spikes in `auth.failed`.
- The keep-warm pinger (UptimeRobot / cron-job.org) doubles as free downtime alerting.
- After a deploy: `npm run prod:check` (read-only: health, deployed commit, CORS, dev login
  off, webhook, Socket.IO, web app → API), see [beta-launch-checklist.md](beta-launch-checklist.md).
- Beta metrics: `npm run beta:report` with a read-only Atlas user
  ([beta-plan.md](beta-plan.md#the-beta-report-one-command)). Game starts are stored in
  `game_starts` (one small document per game, no names).

## Rollback

- **Web**: Vercel → Deployments → previous production deployment → "Promote to Production".
- **API**: Render → service → Deploys → pick the previous deploy → "Rollback".
- **Database**: the schema is additive (no migrations yet). Before any change that rewrites
  documents, take an Atlas snapshot or `mongodump` and make the code accept both shapes for
  one release.

## ⚠️ Sleeps and restarts end live games

Live rooms and games are in server memory. **Any deploy, restart, crash or free-tier sleep
ends every game in progress** (players see "This room is gone" with a Home button). Matches already finished are safe in MongoDB.

- Deploy at low-usage hours; avoid unnecessary restarts.
- Announce deploys in the playtest groups.
- Keep the pinger running so the free instance never sleeps between games.
- The SIGTERM handler closes sockets and waits for pending match writes (up to 10 s).
- If free-tier sleeps or restarts hurt the beta, the next step is still free: an always-on
  small VM (e.g. Oracle Cloud Always Free) running the same `node apps/server/dist/index.js`.

## Operations runbook

Moved to [runbook.md](runbook.md).
