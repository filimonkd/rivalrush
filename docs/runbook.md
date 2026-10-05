# Operations runbook

Production: Vercel Hobby (web) · Render Free (API, Socket.IO, bot webhook) · MongoDB Atlas M0 ·
Telegram bot `@rivalrushbot`. Architecture and free-tier limits: [deployment.md](deployment.md).

## Daily health check (5 minutes, every morning)

1. Open `https://<render-service>.onrender.com/health` → `"status":"ok"`, `"database":"up"`.
   `version` is the deployed commit (first 7 characters): it should match the latest commit on
   `main` that you meant to deploy.
2. UptimeRobot: no downtime overnight. If there was, check Render → **Events** for a restart or
   a failed deploy at that time.
3. Render → **Logs**, last 24 h. Search for each of these; any hit needs a look:
   - `match.record_failed` (a result was not saved)
   - `"level":50` (errors), `unhandled request error`, `room hook failed`, `room timer failed`
   - `telegram webhook setup failed`
   - many `auth.failed` in a short time (wrong token, or someone probing)
4. Send `/start` to the bot: welcome message with a **Play** button.

## Closed beta: daily routine

Plan, metrics and queries: [beta-plan.md](beta-plan.md).

**Morning (5 min):** the health check above. Note any overnight incident in the daily log.

**During the day:** watch the beta group. Answer every report within a few hours, even if only
"got it, looking". Turn each report into a GitHub issue (**Beta bug report** template) with a
severity.

**Evening (15 min):**

1. Count today's `game.started` in the Render logs; run the queries in
   [beta-plan.md](beta-plan.md#queries).
2. Fill in the daily log row, including whether you posted a reminder and any deploys.
3. Triage new issues: Blocker → fix now; Major → this week if safe; Minor → polish week.
4. Decide whether a deploy is needed tomorrow (see the deploy rule below).

**Deploy rule during the beta:** deploy only to fix a Blocker (or a Major with a safe, tested
fix). Every API deploy ends all live games. Deploy at the quietest hour, post a heads-up 10
minutes before, run the health check after, and note it in the daily log.

> Heads-up message: "Quick update in 10 minutes: games in progress will end, so finish your
> current game or start a new one after. Your stats are safe."

## Incident response

Every incident: **confirm → mitigate → tell testers → write it down.** Post a short note in the
beta group when testers are affected, and again when it is fixed. Add one line to the daily
log (what, when, how long, games lost).

### Backend unavailable

- **Signs:** UptimeRobot alert; the app stays on "Waking up the game server…" or says "Can't
  reach the server"; the bot doesn't answer `/start`.
- **Confirm:** open `/health`. Check Render → **Events** (failed deploy? crash? restart loop?)
  and the dashboard banner (suspended for free-hour limits?).
- **Mitigate:**
  - It was asleep: confirm the UptimeRobot monitor is active and pointing at `/health`.
  - It started failing after a deploy: **Rollback** to the previous deploy, then debug.
  - Crash loop with no deploy: read the last log lines before the crash. A `Refusing to start in
production` or `Invalid environment` line names the bad variable.
  - Suspended (free hours used up): only one service may be kept awake. Stop pinging others. It
    resumes next month or with a paid plan, which is a cost decision for the owner.
- **Tell testers:** "RivalRush is down right now, we're on it. Games in progress were lost; your
  stats are safe."
- **After:** live games were lost. Note the duration and count of `game.started` without a
  matching result.

### MongoDB unavailable

- **Signs:** `/health` returns 503 with `"database":"down"`; new players get "Couldn't sign you
  in"; `match.record_retry` / `match.record_failed` in the logs.
- **What still works:** players who are already in the app can keep playing live games (they
  are in memory). Results retry for about a minute, then are lost (each logged with its
  `sessionId`).
- **Confirm:** [Atlas status](https://status.mongodb.com), then your cluster in Atlas
  (running? paused?), **Network Access** (`0.0.0.0/0` still there?), **Database Access** (user
  and password unchanged?), storage (M0 is 512 MB).
- **Mitigate:** fix the cause. If you changed the password or URI, update `MONGODB_URI` on
  Render and redeploy.
- **Tell testers:** "Sign-in is failing for new sessions; keep playing if you're in a game, but
  some results may not be saved."
- **After:** list `match.record_failed` `sessionId`s. Those matches are missing from history and
  stats. Tell the affected players; don't hand-edit stats for them.

### WebSocket problems

- **Signs:** "Reconnecting… your game is safe" doesn't clear; the opponent looks offline; moves
  don't show up.
- **Confirm:** is `/health` OK? One player or everyone?
  - **One player:** usually their network (VPN, captive Wi-Fi, very weak signal). Ask them to
    switch between Wi-Fi and mobile data and reopen the app from the bot.
  - **Everyone:** look for a recent change. `CLIENT_ORIGINS` must equal the Vercel origin
    exactly. `VITE_API_URL` must be the Render URL. Many `socket.auth_failed` lines mean
    `JWT_SECRET` changed: players just reopen the app.
- **Mitigate:** fix the variable and redeploy, or roll back the last deploy (web on Vercel, API on
  Render).
- **Tell testers:** "Live updates are failing; we're fixing it. Close and reopen the app from the
  bot once we post that it's fixed."

### Invite failures

- **"bot invalid"** when tapping an invite: BotFather → `/mybots` → bot → Bot Settings →
  Configure Mini App → Main Mini App must be enabled with the Vercel URL. Check
  `VITE_BOT_USERNAME` (no `@`) matches the bot exactly.
- **"Can't join this room"**: check which message. "Someone already took this seat",
  "has closed" and "expired" are expected: the host creates a new room. If many valid links
  fail, check Render → Events for a restart (rooms are in memory, so a restart ends all rooms).
- **Link opens the chat instead of the game** (old Telegram app): ask the tester to update
  Telegram. Workaround: change `startapp=` to `start=` in the link; the bot then replies with a
  **Join game** button.
- **Collect:** the time, the message shown, and whether the room's host was still in the lobby.
  Logs: look for `room.joined` around that time.

### Reconnect failures

- **"This room is gone" for everyone:** a deploy or restart happened (Render → Events).
  Expected; the games are lost and the players start new duels.
- **Unexpected "Dropped out" loss:** the player was offline for more than 60 s, often a locked
  phone or Telegram killed in the background. Ask how long they were away. Logs:
  `player.reconnected` vs `game.abandoned` for that time.
- **"Your Telegram session is too old":** the app was reloaded after more than 1 hour open.
  Reopening from the bot fixes it (known limitation).
- **Stuck on "Reconnecting…"**: see WebSocket problems.
- **Collect:** device, OS, Telegram version, network, how long they were away, and screenshots.
  A pattern on one platform is a Major bug: open an issue.

### Incorrect game result

Treat as a **Blocker**: a game people can't trust is worse than one that is down.

1. **Collect** from both players: the result screen (it shows both codes) and both guess
   lists ("Your guesses" / "Their guesses"), plus the time.
2. **Check the record:** Atlas → `matches` → filter by time
   (`{ endedAt: { $gte: ISODate('…'), $lte: ISODate('…') } }`) and the players' names. Compare
   `moves` (guess, bulls, cows, timedOut) and `result` with the screenshots. Secret codes are
   never stored, so use the codes shown on the result screen.
3. **Recompute by hand:** for each guess, bulls = right digit in the right place, cows = right
   digit elsewhere, against the other player's revealed code. Remember the rules: timeouts use up
   a turn, the second player gets one last chance after the first player cracks, both out of
   guesses is a draw.
4. **Decide:**
   - The record and the hand count disagree: it's a server rules bug. Write a failing test from
     the exact moves first, fix it, then deploy (quiet hour, with notice).
   - The record is right but the screen showed something else: it's a display bug. Fix in the
     web app (Vercel deploys don't end live games).
   - Both agree with the rules: explain the rule to the testers. Note it for the how-to-play
     screen.
5. **Stats:** don't hand-edit during the beta unless a result is confirmed wrong. If one must
   be corrected, export the match document first, then adjust both players' `stats` together and
   log what you changed and why.
6. **Tell testers** what happened and what changed.

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
