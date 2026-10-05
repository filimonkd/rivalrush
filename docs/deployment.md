# Deployment and operations

**Status: configuration is in the repo; nothing is deployed yet.** The steps below need your
MongoDB Atlas, Render, Vercel and BotFather accounts.

## Environment matrix

|           | Development                              | Staging (recommended)            | Production                                           |
| --------- | ---------------------------------------- | -------------------------------- | ---------------------------------------------------- |
| Web       | `localhost:5173` (+ tunnel for Telegram) | Vercel preview / staging project | Vercel production domain                             |
| API       | `localhost:4000` (+ tunnel)              | Render `rivalrush-api-staging`   | Render `rivalrush-api` (1 instance, paid, always on) |
| Database  | in-memory (or local)                     | Atlas DB `rivalrush_staging`     | Atlas DB `rivalrush` (separate user)                 |
| Bot       | dev bot                                  | staging bot (optional)           | production bot                                       |
| Dev login | on                                       | **off**                          | **off** (server refuses to boot otherwise)           |
| CI        | in-memory MongoDB, no secrets            | —                                | —                                                    |

### Server variables (Render)

| Var                                             | Production value                                              |
| ----------------------------------------------- | ------------------------------------------------------------- |
| `NODE_ENV`                                      | `production`                                                  |
| `MONGODB_URI`                                   | Atlas SRV URI for the prod DB user (**server only**)          |
| `MONGODB_DB_NAME`                               | `rivalrush`                                                   |
| `BOT_TOKEN`                                     | production bot token (**server only**)                        |
| `BOT_USERNAME`                                  | bot username without `@`                                      |
| `BOT_POLLING`                                   | `true`                                                        |
| `WEBAPP_URL`                                    | `https://<vercel domain>`                                     |
| `CLIENT_ORIGINS`                                | `https://<vercel domain>` (exact, comma-separated if several) |
| `JWT_SECRET`                                    | ≥ 32 random chars (blueprint generates one)                   |
| `TRUST_PROXY`                                   | `1`                                                           |
| `DEV_LOGIN_ENABLED`                             | `false`                                                       |
| `DISCONNECT_GRACE_SECONDS` / `ROOM_TTL_MINUTES` | `60` / `120`                                                  |

### Web variables (Vercel), all public

`VITE_API_URL=https://<render service>.onrender.com`, `VITE_BOT_USERNAME=<bot>`. **Never** set
`VITE_DEV_LOGIN` in Vercel, and never put tokens or URIs in `VITE_*`.

## Go-live order

1. **MongoDB Atlas**: create a project and an M0 (or larger) cluster. Create database users
   `rivalrush_prod` and `rivalrush_staging` with readWrite on their own DB only. Network
   access: Render's outbound IPs (Render dashboard → Connect → Outbound IPs) rather than
   `0.0.0.0/0` where your plan allows. Copy the SRV URI. Indexes are created by the server on
   boot (`syncIndexes`): `users.telegramId` unique, `matches.sessionId` unique,
   `matches.players.userId+endedAt`, `rooms.roomId` unique, `rooms.inviteTokenHash` unique,
   TTL on `rooms.purgeAt` (30 days after expiry). Transactions require a replica set; every
   Atlas tier, including M0, provides one.
2. **Render**: New → Blueprint → this repo (`render.yaml`). Fill the `sync: false` variables
   (use a placeholder `WEBAPP_URL` for now). Plan **Starter or higher** (free instances sleep
   and drop live games), **1 instance**, health check `/health`. Render supports WebSockets on
   web services.
3. **Vercel**: New Project → this repo → Root Directory `apps/web` (uses
   `apps/web/vercel.json`: installs at the repo root, builds shared + web, outputs `dist`, SPA
   rewrites). Set `VITE_API_URL` and `VITE_BOT_USERNAME` for Production (and for Preview,
   pointing at staging).
4. Update Render `WEBAPP_URL` and `CLIENT_ORIGINS` to the Vercel production domain and
   redeploy.
5. **BotFather**: enable the Main Mini App with the Vercel URL ([telegram.md](telegram.md)).
6. Smoke test: `curl https://<api>/health` → `{"status":"ok",…,"database":"up"}`, then `/start`
   the bot and run the manual QA plan.

## Pre-production checklist

- [ ] Render: `NODE_ENV=production`, `DEV_LOGIN_ENABLED=false` (boot fails otherwise)
- [ ] `CLIENT_ORIGINS` = exact https Vercel origin(s)
- [ ] `MONGODB_URI` points at the **production** DB; CI and local never use it
- [ ] `BOT_TOKEN` only in Render; not in Vercel or the repo
- [ ] Exactly **one** Render instance, always-on plan
- [ ] `/health` returns 200 with `database: "up"`
- [ ] WebSocket connects from the Mini App (the lobby shows the opponent coming online)
- [ ] No debug endpoints exist (there are none; `/api/auth/dev` is absent in production)

## Monitoring

- Render health check on `/health` (503 when the DB is down) and Render log stream (JSON).
  Useful events: `auth.success`/`auth.failed`, `room.created`, `room.joined`, `room.closed`,
  `room.expired`, `game.started`, `game.ended`, `game.abandoned`, `player.reconnected`,
  `match.recorded`, `match.record_failed`, `socket.connected`/`disconnected`.
- Alert on: health check failures, repeated `match.record_failed`, spikes in `auth.failed`.
- An external uptime pinger on `/health` (e.g. UptimeRobot) is recommended.

## Rollback

- **Web**: Vercel → Deployments → previous production deployment → "Promote to Production".
- **API**: Render → service → Deploys → pick the previous deploy → "Rollback".
- **Database**: the schema is additive (no migrations yet). Before any change that rewrites
  documents, take an Atlas snapshot or `mongodump` and make the code accept both shapes for
  one release.

## ⚠️ Restarts end live games

Live rooms and games are in server memory. **Any deploy, restart or crash ends every game in
progress** (players see "This room is gone" with a Home button). Matches already finished are safe in MongoDB.

- Deploy at low-usage hours; avoid unnecessary restarts.
- Announce deploys in the playtest groups.
- The SIGTERM handler closes sockets and waits for pending match writes (up to 10 s).

## Operations runbook

| Symptom                                        | Check                                                         | Action                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Bot doesn't answer `/start`                    | Render logs for `telegram polling error` / `bot setup failed` | Verify `BOT_TOKEN`; make sure no webhook or second instance is polling the same bot                 |
| Mini App shows "Couldn't sign you in"          | `auth.failed` log `why`                                       | `bad_signature`: wrong `BOT_TOKEN` for this bot. `expired`: device clock or stale launch, so reopen |
| "Reconnecting…" never clears                   | Browser console / CORS                                        | `CLIENT_ORIGINS` must match the Vercel origin exactly                                               |
| Health 503                                     | `database: down`                                              | Atlas status, network access list, credentials                                                      |
| Stats missing after games                      | `match.record_failed`                                         | Atlas reachability; results that failed after all retries are logged with their sessionId           |
| Players see "This room is gone" after a deploy | expected                                                      | Live rooms were in memory; they start a new duel                                                    |
