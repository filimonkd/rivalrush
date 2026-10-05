# Deployment and operations

**Status: configuration is in the repo; nothing is deployed yet.** Everything below runs on
**free tiers only**: MongoDB Atlas M0, Render Free, Vercel Hobby, a free uptime pinger and
Telegram (free). You need accounts there; no payment details are required by this setup.

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

|           | Development                              | Preview / staging                                                      | Production                                                       |
| --------- | ---------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Web       | `localhost:5173` (+ tunnel for Telegram) | Vercel preview deployments (free)                                      | Vercel production domain                                         |
| API       | `localhost:4000` (+ tunnel)              | your machine + tunnel, or a 2nd Render Free service **not** kept awake | Render Free `rivalrush-api` (1 instance, kept awake by a pinger) |
| Database  | in-memory (or local)                     | Atlas DB `rivalrush_staging` (same free M0 cluster)                    | Atlas DB `rivalrush` (separate DB user)                          |
| Bot       | dev bot (polling)                        | dev bot                                                                | production bot (webhook)                                         |
| Dev login | on                                       | **off**                                                                | **off** (server refuses to boot otherwise)                       |
| CI        | in-memory MongoDB, no secrets            | —                                                                      | —                                                                |

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

## Go-live order (all free)

1. **MongoDB Atlas**: create a free **M0** cluster. Database Access: create users
   `rivalrush_prod` (readWrite on `rivalrush`) and `rivalrush_staging` (readWrite on
   `rivalrush_staging`) with long random passwords. Network Access: add `0.0.0.0/0` (Render
   Free has no fixed outbound IPs). Copy the SRV URI. Indexes are created by the server on
   boot (`syncIndexes`): `users.telegramId` unique, `matches.sessionId` unique,
   `matches.players.userId+endedAt`, `rooms.roomId` unique, `rooms.inviteTokenHash` unique,
   TTL on `rooms.purgeAt` (30 days after expiry).
2. **Render**: New → Blueprint → this repo (`render.yaml`, `plan: free`). Fill the
   `sync: false` variables (use a placeholder `WEBAPP_URL` for now). Note the service URL,
   e.g. `https://rivalrush-api.onrender.com`.
3. **Vercel** (Hobby): New Project → this repo → Root Directory `apps/web` (uses
   `apps/web/vercel.json`: installs at the repo root, builds shared + web, outputs `dist`, SPA
   rewrites). Set `VITE_API_URL` and `VITE_BOT_USERNAME` for Production.
4. Update Render `WEBAPP_URL` and `CLIENT_ORIGINS` to the Vercel production domain and
   redeploy. On boot the server registers the Telegram webhook
   (`<RENDER_EXTERNAL_URL>/telegram/webhook`) and the Play menu button.
5. **BotFather**: enable the Main Mini App with the Vercel URL ([telegram.md](telegram.md)).
6. **Keep-warm pinger** (free): UptimeRobot → New monitor → HTTP(s) →
   `https://<api>.onrender.com/health`, interval 5 min (or cron-job.org, every 10 min). This
   also gives you free downtime alerts by email.
7. Smoke test: `curl https://<api>/health` → `{"status":"ok",…,"database":"up"}`, then `/start`
   the bot and run the manual QA plan.

## Pre-production checklist

- [ ] Render: `NODE_ENV=production`, `DEV_LOGIN_ENABLED=false` (boot fails otherwise)
- [ ] `CLIENT_ORIGINS` = exact https Vercel origin(s)
- [ ] `MONGODB_URI` points at the **production** DB; CI and local never use it
- [ ] `BOT_TOKEN` only in Render; not in Vercel or the repo
- [ ] Exactly **one** Render instance (Free plan), and the uptime pinger is running
- [ ] `/health` returns 200 with `database: "up"`
- [ ] WebSocket connects from the Mini App (the lobby shows the opponent coming online)
- [ ] No debug endpoints exist (there are none; `/api/auth/dev` is absent in production)

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

| Symptom                                        | Check                                           | Action                                                                                                            |
| ---------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Bot doesn't answer `/start`                    | Render logs for `telegram webhook setup failed` | Verify `BOT_TOKEN`; redeploy to re-register the webhook; don't run a polling dev server with the production token |
| First open takes ~1 min                        | Pinger status                                   | The free instance was asleep; check the pinger is active and hitting `/health`                                    |
| Render suspended the service                   | Render dashboard: free hours used               | Only one free service may be kept awake; stop pinging any others                                                  |
| Mini App shows "Couldn't sign you in"          | `auth.failed` log `why`                         | `bad_signature`: wrong `BOT_TOKEN` for this bot. `expired`: device clock or stale launch, so reopen               |
| "Reconnecting…" never clears                   | Browser console / CORS                          | `CLIENT_ORIGINS` must match the Vercel origin exactly                                                             |
| Health 503                                     | `database: down`                                | Atlas status, network access list, credentials                                                                    |
| Stats missing after games                      | `match.record_failed`                           | Atlas reachability; results that failed after all retries are logged with their sessionId                         |
| Players see "This room is gone" after a deploy | expected                                        | Live rooms were in memory; they start a new duel                                                                  |
