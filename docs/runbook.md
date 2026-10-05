# Operations runbook

Production: Vercel Hobby (web) · Render Free (API, Socket.IO, bot webhook) · MongoDB Atlas M0 ·
Telegram bot `@rivalrushbot`. Architecture and free-tier limits: [deployment.md](deployment.md).

## Daily health check (2 minutes)

1. `curl -s https://<render-service>.onrender.com/health` → `{"status":"ok",…,"database":"up"}`.
2. The uptime pinger (UptimeRobot / cron-job.org) shows the API up.
3. Render → Logs: no repeated `match.record_failed`, `telegram webhook setup failed` or
   bursts of `auth.failed`.
4. Send `/start` to the bot: welcome message with a **Play** button.

## Symptoms

| Symptom                                                            | Check                                                         | Action                                                                                                                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bot doesn't answer `/start`                                        | Render logs for `telegram webhook setup failed`               | Verify `BOT_TOKEN`; redeploy to re-register the webhook. Never run a polling dev server with the production token (it removes the webhook).                                   |
| Invite link opens "bot invalid"                                    | BotFather → Bot Settings → Configure Mini App                 | Enable the **Main Mini App** with the Vercel URL. Check `VITE_BOT_USERNAME` (no `@`) matches the bot, then redeploy Vercel.                                                   |
| "Couldn't sign you in"                                             | Render logs: `auth.failed` and its `why`                      | `bad_signature`: `BOT_TOKEN` is for a different bot. `expired`: the app was open > 1 h or the phone clock is wrong; reopen from the bot. Network error: `VITE_API_URL` wrong. |
| "Your session ended. Close the app and open it again from the bot" | `JWT_SECRET` changed, or the session is older than 7 days     | Expected after rotating `JWT_SECRET`; players just reopen.                                                                                                                    |
| First open takes ~1 min ("Waking up the game server…")             | Pinger status                                                 | Render Free was asleep; make sure the pinger hits `/health` every 5–10 min.                                                                                                   |
| Render suspended the service                                       | Render dashboard: free instance hours                         | Only one free service may be kept awake; stop pinging others.                                                                                                                 |
| "Reconnecting…" never clears                                       | Browser console / CORS                                        | `CLIENT_ORIGINS` must equal the Vercel origin exactly (https, no trailing slash).                                                                                             |
| Players see "This room is gone"                                    | Render → Events: a deploy or restart just happened            | Expected: live rooms are in memory. Players start a new duel. Finished matches are safe.                                                                                      |
| Health 503 / `database: down`                                      | Atlas status, Network Access (`0.0.0.0/0`), user and password | Fix access or credentials in Render's `MONGODB_URI`; redeploy.                                                                                                                |
| Stats missing after games                                          | Render logs: `match.record_failed` with the `sessionId`       | Usually Atlas reachability. The server retries 5 times over ~1 min; after that the result is lost (logged with its sessionId).                                                |
| Invite says "This room expired / has closed"                       | expected                                                      | Rooms expire after 2 h idle or close when everyone leaves. Create a new room.                                                                                                 |

## Procedures

### Deploy

1. Merge a green PR into `main`.
2. Vercel deploys the web app automatically.
3. Render deploys the API (Auto-Deploy "After CI Checks Pass", or Manual Deploy). **This ends
   every live game**, so deploy at a quiet time and warn testers in the beta groups.
4. Run the daily health check above.

### Roll back

- Web: Vercel → Deployments → previous production deployment → **Promote to Production**.
- API: Render → service → Events / Deploys → previous deploy → **Rollback**.
- Database: the schema is additive. Before any change that rewrites documents, take a
  `mongodump` (Atlas M0 has no snapshots).

### Re-register the Telegram webhook

Redeploy (or restart) the Render service: on boot it calls `setWebhook` with
`<RENDER_EXTERNAL_URL>/telegram/webhook` and sets the Play menu button. Logs show
`telegram webhook set`.

### Rotate secrets

| Secret       | Where                                          | Effect of rotating                                                                        |
| ------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `BOT_TOKEN`  | BotFather `/revoke` → Render                   | Update Render, redeploy. The webhook secret is derived from it and updates automatically. |
| `JWT_SECRET` | Render (≥ 32 random chars)                     | Everyone must reopen the app once (open sessions show "Your session ended").              |
| DB password  | Atlas → Database Access → Render `MONGODB_URI` | Redeploy after updating the URI.                                                          |

Never paste these into the web app's (`VITE_*`) variables, CI, chat or logs.

### Check that a match was recorded

Atlas → Browse Collections → `rivalrush.matches` → filter `{ roomId: "<id>" }`. One document
per finished game, with `result.reason` (`cracked`, `both_cracked`, `out_of_guesses`,
`forfeit`, `abandoned`), guesses and scores, and **no secret codes**. The players' `stats` in
`rivalrush.users` should add up to their matches.

## Log events

JSON logs in Render. Useful events: `auth.success` / `auth.failed` (`why`), `room.created`,
`room.joined`, `room.left`, `room.closed`, `room.expired`, `game.started`, `game.ended`,
`game.abandoned`, `player.reconnected`, `match.recorded`, `match.record_retry`,
`match.record_failed`, `socket.connected` / `socket.disconnected`, `bot.started`. Tokens,
`initData`, secrets, guesses and full invite tokens are never logged (redacted as a safety
net too).
