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

| Piece     | Free tier                   | What to know                                                                                                                                                                                                                      |
| --------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API       | Render **Free** web service | Sleeps after ~15 min without inbound requests; the first request then waits ~1 min. **A sleep or restart ends live games** (they are in memory). Render may restart free services at any time. WebSockets and health checks work. |
| Keep-warm | UptimeRobot / cron-job.org  | A ping to `/health` every 5–10 min keeps the API awake. One always-awake service ≈ 720–744 h/month, inside Render's 750 free hours. **Don't keep a second service awake** or the hours run out and Render suspends free services. |
| Bot       | Telegram (webhook mode)     | Telegram POSTs each message to the API, so `/start` works even if the API was asleep (Telegram retries until it answers).                                                                                                         |
| Web       | Vercel **Hobby**            | Free static hosting + preview deployments. Hobby is for non-commercial use: move to a paid plan before you monetise.                                                                                                              |
| Database  | Atlas **M0**                | Free forever, 512 MB (plenty for users + match history), replica set (transactions work). Render Free has no static outbound IPs, so the access list must allow `0.0.0.0/0`: use a strong, unique DB password.                    |
| CI        | GitHub Actions              | Unlimited minutes on public repos; ~2,000 min/month on private repos (one CI run ≈ 4 billed minutes).                                                                                                                             |

The web app shows "Waking up the game server…" if sign-in takes longer than 4 s, so a cold
start looks intentional rather than broken.

## Environment matrix

There is **no staging environment**: changes are tested locally and in CI, then go to
production. The "Staging (optional)" column describes how to add one later at no cost; none of
it exists today.

|           | Development                              | Staging (optional, not set up)                                         | Production (live)                                                |
| --------- | ---------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Web       | `localhost:5173` (+ tunnel for Telegram) | a second Vercel project or preview with its own `VITE_API_URL`         | Vercel production domain                                         |
| API       | `localhost:4000` (+ tunnel)              | your machine + tunnel, or a 2nd Render Free service **not** kept awake | Render Free `rivalrush-api` (1 instance, kept awake by a pinger) |
| Database  | in-memory (or local)                     | Atlas DB `rivalrush_staging` (same free M0 cluster)                    | Atlas DB `rivalrush`                                             |
| Bot       | dev bot (polling)                        | dev bot                                                                | `@rivalrushbot` (webhook)                                        |
| Dev login | on                                       | **off**                                                                | **off** (server refuses to boot otherwise)                       |
| CI        | in-memory MongoDB, no secrets            | —                                                                      | —                                                                |

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
   TTL on `rooms.purgeAt` (30 days after expiry).
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
