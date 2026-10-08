# Testing and QA

## Automated

| Suite                        | Location                                                                                                                                                    | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared schemas               | `packages/shared/test`                                                                                                                                      | Invite `start_param` round trip and rejection of junk; settings ranges; action schemas reject extra fields (no fake winner)                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Scoring                      | `apps/server/test/unit/ctc-rules.test.ts`                                                                                                                   | Bulls/cows incl. the worked example, exact match, permutations, repeated guess digits; generated secrets are valid and can lead with 0                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Game rules                   | `.../ctc-game.test.ts`                                                                                                                                      | Setup, invalid/duplicate secret, auto secrets on timeout, alternation, invalid/duplicate guess, timeouts burn turns, equalizer win/draw/timeout, out-of-guesses draw, forfeit, abandon, finished rejects all, immutability, **60 random full games with no secret leak in any view**                                                                                                                                                                                                                                                                                                   |
| Telegram auth                | `.../telegram-auth.test.ts`                                                                                                                                 | Valid data; independent re-implementation of the algorithm; tampered; wrong bot; stale; future; malformed; duplicate fields                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Config                       | `.../env.test.ts`                                                                                                                                           | Production refuses dev login, weak secrets, missing DB/bot token, wildcard/http CORS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| RoomManager                  | `.../room-manager.test.ts`                                                                                                                                  | Create, join, full, invalid/expired/closed invite, duplicate join, one active room per user, host-only start, host hand-off, idempotent start/secret, stale versions, disconnect grace, reconnect, multi-tab presence, leave = forfeit, monotonic versions                                                                                                                                                                                                                                                                                                                             |
| Bot                          | `.../bot.test.ts`                                                                                                                                           | /start, deep-link /start, /help, token never in errors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| REST integration             | `apps/server/test/integration/api.test.ts`                                                                                                                  | Real MongoDB replica set: auth flow, acquisition flag, room flow, persisted metadata hashes the invite, old invites, validation, 413, CORS + helmet, transactional idempotent stats + streaks, profile, logs contain no launch data                                                                                                                                                                                                                                                                                                                                                    |
| Socket integration           | `.../socket.test.ts`                                                                                                                                        | Bad/forged tokens rejected, non-members blocked, a full match (secrets, stale/duplicate actions, equalizer draw, recorded stats, rematch with swapped start), **no opponent secret in any snapshot before the end**, no secrets in logs, offline → resync → resume, leave = forfeit, throttling                                                                                                                                                                                                                                                                                        |
| Race conditions              | `.../races.test.ts`                                                                                                                                         | The 10 numbered concurrency cases below, each with its deterministic outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Rematch                      | `.../rematch.test.ts`                                                                                                                                       | Rematch after a win, an out-of-guesses draw, a last-chance win, a last-chance draw and a forfeit: same room and players, new session, start swaps, nothing from the old game in the new views, stats counted once; alternation over several rematches; repeated votes; declined by leaving; newcomer sees nothing of the old match; offline while waiting; never returning = abandoned; vote racing a leave                                                                                                                                                                            |
| Timers                       | `.../timers.test.ts`                                                                                                                                        | Deadlines from the server clock, timeout burns the turn and gives the next player a full turn, pushed to clients, a guess cancels the old deadline, late wake-up applies one timeout, clients cannot move timers, setup auto-secret at exactly 60 s, reconnect during the countdown / after a timeout / 1 ms before it, turn deadline vs reconnect grace at the same instant                                                                                                                                                                                                           |
| Reliability                  | `apps/server/test/integration/reliability.test.ts`                                                                                                          | Real Socket.IO + MongoDB: duplicate action re-sent after reconnecting is applied once; stale client after reconnecting gets the authoritative snapshot; action racing a resync; non-members refused; forfeit → rematch → abandonment → rematch → leave produces three match records whose totals equal each player's stats and profile; replays of a recorded session change nothing; no endpoint writes stats                                                                                                                                                                         |
| Color Cipher rules           | `.../cc-rules.test.ts`, `.../cc-game.test.ts`                                                                                                               | The 16 duplicate-color examples from [color-cipher.md](color-cipher.md), a brute-force check against an independent scorer, pattern validation (length, palette, repeats), setup and auto-patterns, alternation, invalid/duplicate guesses, timeouts, every ending incl. equalizer, forfeit/abandon, anti-cheat (no client feedback or results), **60 random full games with no pattern leak**                                                                                                                                                                                         |
| Color Cipher on the platform | `.../cc-room.test.ts`, `apps/server/test/integration/color-cipher.test.ts`, `apps/web/e2e/color-cipher.spec.ts`                                             | RoomManager, invites, timers, presence, reconnect, rematch with swap and recording, unchanged; over real Socket.IO + MongoDB: full match, stale/duplicate actions, forged feedback refused, patterns never in API responses or logs, resync, history `gameType`, old Crack the Code records still valid; two-browser UI match                                                                                                                                                                                                                                                          |
| Web logic                    | `apps/web/test`                                                                                                                                             | Snapshot ordering (late replies after reconnect or rematch never win), event → toast mapping, server-time countdowns, invite links                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| How to play (all games)      | `apps/web/test/howto.test.tsx`, `apps/web/e2e/match.spec.ts`, `apps/web/e2e/color-cipher.spec.ts`, `apps/web/e2e/defuser.spec.ts`                           | Every game's steps forward, back, skip and done; seen is remembered per game (the old Defuser key still counts); the room's own numbers (digits, seconds, guesses); the duel examples are the documented, server-tested ones (5831/5813 → 2 bulls 2 cows; two Rubies vs four → 2 Exact 0 Close); opens by itself once per game in the lobby; offered on the create screens and the Defuser result                                                                                                                                                                                      |
| Joining a room               | `apps/web/test/room-connect.test.ts`                                                                                                                        | A tap while the new socket opens waits for it; entering a room twice while connecting (Join page, then room page) never sends a second CONNECT (that left a ghost server socket and dropped the connection right after it opened); a first connection reads Connecting…, a dropped one Reconnecting…                                                                                                                                                                                                                                                                                   |
| Defuser web UI               | `apps/web/test/defuser`                                                                                                                                     | jsdom + Testing Library on real role-view fixtures (`fixtures.json`, built by the server plug-in; `defuser-web-fixtures.test.ts` fails if they drift): role rendering, briefing, Fuse/Glyph/Valve intents (hold-to-commit with fake timers), faults, server-driven timer and timeout, promotion and roster notices, redistributed sheets, rejoin, results and debrief; security (planted hidden fields never render, no server/generator/solver imports); wording and next-Operator helpers                                                                                            |
| Defuser backend              | `.../defuser-registry.test.ts`, `.../defuser-backend.test.ts`, `.../defuser-backend-security.test.ts`, `apps/server/test/integration/defuser-match.test.ts` | Gating and fixed seed; a Defuser match over real sockets and REST (roles, promotion, rejoin, actions, exact deadlines); serialized payloads of every role over every channel; MongoDB stats and history (CI)                                                                                                                                                                                                                                                                                                                                                                           |
| Beta metrics                 | `apps/server/test/unit/game-starts.test.ts`, `.../beta-report-format.test.ts`, `apps/server/test/integration/beta-report.test.ts`                           | One `game_starts` record per started game (rematch flagged, replays not doubled, metadata only, failed writes logged not thrown); every beta metric over a hand-built week on real MongoDB, days and window in a chosen time zone (incl. DST), outsiders from a tester list, the report writes nothing and prints no names                                                                                                                                                                                                                                                             |
| Beta decision                | `apps/server/test/unit/beta-decision.test.ts`                                                                                                               | The survey CSV (quotes, line breaks, BOM, CRLF; Google Forms and Tally layouts; missing questions named; no names or written answers returned); each row of the beta plan's decision table: a strong week points to Game #2, any polish trigger wins and is named, middling play-again needs survey friction, a week people don't return to (or nobody invites anyone) points to postponing, missing inputs stay unknown and are listed, late-week play is not judged before day 7                                                                                                     |
| Production check             | `apps/server/test/unit/prod-check.test.ts`, `apps/server/test/integration/prod-check.test.ts`                                                               | A correctly configured deployment (real server: dev login off, bot webhook on, one web origin; a stand-in web app) passes every check; each misconfiguration is named with its fix (DB down, old commit, missing headers, CORS too wide or missing the app, dev login on, open API, bot off, Socket.IO unreachable, bundle pointing elsewhere, wrong Telegram webhook); recent webhook errors warn; the bot token never appears in the output                                                                                                                                          |
| **E2E**                      | `apps/web/e2e/match.spec.ts`                                                                                                                                | Two Chromium browsers (mobile viewport) play the whole loop against the built server and the production web build: invite → join → ready → start → secrets → turns → duplicate guess → last chance draw → result with revealed codes → rematch (start swaps) → offline/online → app reopen lands back in game → give up → profile stats. **Scans every WebSocket frame for leaked opponent secrets.** Bogus invite → "Can't join this room". Second test: rematch declined by leaving → the host is back in the lobby with the same invite → a newcomer joins and starts a clean game. |
| **Defuser E2E**              | `apps/web/e2e/defuser.spec.ts`                                                                                                                              | Dev/test server with `DEFUSER_ENABLED` and the seed pinned in `e2e/defuser-seed.json` (`defuser-e2e-seed.test.ts` guards it). Three browsers: hidden from Home, create by URL, invite, briefing roles, role-specific screens, a fault everywhere, Operator reload, all three panels incl. hold-to-commit, no secret in any live Socket.IO frame, DEFUSED, debrief, rematch with the predicted Operator, co-op history. Two browsers: three-fault detonation, role swap on rematch, Leave ends the game                                                                                 |

Run: `npm test` (all unit + integration) and `npm run build -w @rivalrush/server && npm run test:e2e`.

Integration tests use `mongodb-memory-server` (one-node replica set, so transactions work).
Set `MONGODB_TEST_URI` to point at an existing replica set instead, or `MONGOMS_SYSTEM_BINARY`
for a local `mongod`. Automated tests never touch staging or production databases.

## Race conditions and their deterministic outcomes

Every room change runs under that room's lock and first applies any deadline that is already
due. The order the server processes inputs in is the authoritative order. Tests:
`apps/server/test/unit/races.test.ts` (numbered like this table).

| #   | Case                                         | Deterministic outcome                                                                                                                   |
| --- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Two guesses arrive at the same time          | The first one processed is applied. The others get `STALE_GAME_VERSION` (version moved) or `NOT_YOUR_TURN`. Exactly one move.           |
| 2   | Guess arrives exactly at the turn deadline   | The timeout wins (deadline is inclusive): the turn is burned, the guess gets `STALE_GAME_VERSION`. 1 ms earlier, the guess counts.      |
| 3   | Secret arrives exactly at the setup deadline | The server-generated secret wins; the late secret gets `GAME_ALREADY_STARTED`.                                                          |
| 4   | Same guess sent twice (re-tap, new actionId) | Applied once. The retry is `STALE_GAME_VERSION`; with a fresh version it is `NOT_YOUR_TURN`, and later `DUPLICATE_GUESS`.               |
| 5   | Same actionId delivered twice                | Applied once; both replies succeed with the same board.                                                                                 |
| 6   | Duplicate rematch requests                   | Repeated votes are no-ops; the agreeing vote starts exactly one new game; a late duplicate gets `REMATCH_UNAVAILABLE`.                  |
| 7   | Reconnect exactly as the turn times out      | The timeout is applied first, then the player is marked online with a fresh snapshot showing the burned turn and the new deadline.      |
| 8   | Disconnect while the game is finishing       | One result only; no grace timer starts for a finished game.                                                                             |
| 9   | Host leaves while another player joins       | Join first: the joiner becomes host of an open lobby. Leave first: the empty room closes and the joiner gets `ROOM_CLOSED`. Never both. |
| 9b  | Two players join the last seat at once       | One joins; the other gets `ROOM_FULL`.                                                                                                  |
| 10a | "Ready" and "Start" at the same time         | Start succeeds only if Ready was processed first; otherwise `NOT_READY` and the room is READY.                                          |
| 10b | Both players give up at once                 | The first forfeit decides (that player loses); the other gets `GAME_FINISHED`. One record.                                              |
| 10c | Guess racing the opponent leaving            | The game ends exactly once, as a forfeit win for the player who stayed.                                                                 |

Also covered: a rematch vote racing the opponent leaving never starts a one-player game
(`rematch.test.ts`); a turn deadline and a reconnect-grace expiry due at the same instant →
the game deadline goes first (`timers.test.ts`); a game action racing a resync → both are
answered and the client keeps the higher version (`reliability.test.ts` + web logic test).

## Defuser: Telegram multi-phone QA (staging)

A 38-row script for real phones in real Telegram against the **staging** deployment lives in
[defuser-qa.md](defuser-qa.md). Run 1 (8 Oct 2026): one 2-player game on staging; most rows not yet run.

## Production manual QA

Two Telegram accounts (A and B), ideally on two real phones (one iOS, one Android), against
production (`@rivalrushbot`, Vercel + Render + Atlas). Record the date and devices for each run.

Status: ✅ passed · ❌ failed · 🟡 not yet run. A ✅ means a person saw it work in real Telegram.

**Run 1, 5 Oct 2026, product owner.** Devices not recorded. Result reported: "everything is
working, I played a duel and Crack the Code works fine". The rows marked ✅ below are the ones
that report covers.

**Run 2, 5 Oct 2026, product owner, two phones (after the hardening PR was merged).** Vercel
had deployed the new web app; that Render was running the same commit is not recorded (check
`/health` → `version`). Followed the
two-phone script (rules and timers, rematch, reconnect, give up / decline, profile, invites,
UI). Result reported: "all tests passed". Rows 36 (room idle > 2 h) and 37 (old link after a
restart) were optional in that script and are left 🟡 until confirmed.

| #   | Area      | Step                                          | Expected                                                                 | Status |
| --- | --------- | --------------------------------------------- | ------------------------------------------------------------------------ | ------ |
| 1   | Auth      | A sends `/start` to the bot                   | Welcome text + **Play** button; chat menu button says Play               | ✅     |
| 2   | Auth      | Tap Play                                      | Mini App opens full height, no login screen                              | ✅     |
| 3   | Auth      | Automatic sign-in                             | Home says "Hey, <first name>"                                            | ✅     |
| 4   | Room      | Start a duel → settings → Create room         | Lobby: host seat + "Waiting for opponent"                                | ✅     |
| 5   | Invite    | Send invite                                   | Telegram chat picker opens with the link and text                        | ✅     |
| 6   | Invite    | B taps the link                               | App opens on "A challenged you"                                          | ✅     |
| 7   | Room      | B taps Join game                              | A gets a buzz and a "B joined" toast                                     | ✅     |
| 8   | Room      | B taps I'm ready; A taps Start                | Both see "Hide your code" with a 60 s timer                              | ✅     |
| 9   | Game      | Secret setup                                  | Used digits disabled; Lock it in; the other side sees "locked in"        | ✅     |
| 10  | Game      | Valid guess                                   | Only the player on turn sees the keypad; pegs match a hand-checked count | ✅     |
| 11  | Game      | Invalid guess (incomplete)                    | Cannot be submitted; the field shakes                                    | ✅     |
| 12  | Game      | Duplicate guess                               | "You already tried that one"                                             | ✅     |
| 13  | Game      | Let a turn run out                            | "Time's up — turn skipped"; the other player's turn; guesses left drop   | ✅     |
| 14  | Game      | Let setup run out without locking             | "Time ran out — we picked a code for you"                                | ✅     |
| 15  | Game      | Play to a result                              | Result sheet for both; both codes revealed                               | ✅     |
| 15b | Game      | Win and loss on the two phones                | Second player cracks → "You won! 🏆" / "You lost"                        | ✅     |
| 16  | Game      | Last chance                                   | First player cracks → other sees "Last chance — crack it to tie!"        | ✅     |
| 17  | Game      | Draw                                          | Both crack via last chance → "It's a draw 🤝"                            | ✅     |
| 18  | Game      | Forfeit                                       | Give up → confirm → "You lost" / "You won! 🏆 · Gave up"                 | ✅     |
| 19  | Reconnect | Background Telegram 20 s mid-game, return     | Board is current, no forfeit                                             | ✅     |
| 20  | Reconnect | Airplane mode 20 s, then back                 | "Reconnecting…" banner, then clears; opponent saw "Lost connection"      | ✅     |
| 21  | Reconnect | Close the Mini App fully, reopen from the bot | Lands back in the game with the same code and board                      | ✅     |
| 22  | Reconnect | Airplane mode > 60 s                          | Opponent wins with "Dropped out"                                         | ✅     |
| 23  | Rematch   | After a win: both tap Rematch                 | New game; the other player goes first                                    | ✅     |
| 24  | Rematch   | After a draw / loss: rematch again            | Starting player keeps alternating                                        | ✅     |
| 25  | Rematch   | A taps Rematch, B taps Leave                  | A is back in the lobby with the invite; B on Home                        | ✅     |
| 26  | Profile   | Open Profile on both phones after a few games | W/L/D, win rate, streak and recent games match what happened             | ✅     |
| 27  | Profile   | All games                                     | History lists every game once, newest first                              | ✅     |
| 28  | UI        | Light Telegram theme                          | Readable; colors follow the theme                                        | ✅     |
| 29  | UI        | Dark Telegram theme                           | Same                                                                     | ✅     |
| 30  | UI        | Safe areas (notch / home indicator)           | Nothing hidden under system bars; result sheet buttons reachable         | ✅     |
| 31  | UI        | Haptics                                       | Buzz on join, your turn, win/loss, wrong input                           | ✅     |
| 32  | UI        | Telegram Back button                          | Goes to Home without leaving the game; Home shows "Back to the game"     | ✅     |
| 33  | UI        | Error messages                                | Plain-language toasts, no codes or stack traces                          | ✅     |
| 34  | Invites   | A third account opens a link to a full room   | "Someone already took this seat."                                        | ✅     |
| 35  | Invites   | Link to a room everyone left                  | "This room has closed. Ask your friend for a new invite."                | ✅     |
| 36  | Invites   | Link to a room idle > 2 h                     | "This room expired. Ask your friend for a new invite."                   | 🟡     |
| 37  | Invites   | Old link after a server restart               | A clear "closed"/"doesn't work anymore" message, no crash                | 🟡     |

### Production health checks (run from your own computer)

The build sandbox cannot reach the production hosts, so these are for you to run. The quickest
is `npm run prod:check -w @rivalrush/server -- --api <API URL> --web <web URL> [--commit <sha>]`
([what each line checks](beta-launch-checklist.md#a-deploy-what-the-beta-runs-on-fri-9-oct));
by hand:

```bash
curl -s https://<render-service>.onrender.com/health      # {"status":"ok",…,"database":"up"}
curl -sI https://<vercel-domain>/ | head -1                # HTTP/2 200
```

In Atlas → Browse Collections → `rivalrush.matches`: one document per finished game; no
`secret` fields. In Render → Logs: search for `match.recorded` after a game and make sure
no 4-digit secret codes or `initData` appear.

## Color Cipher: production manual QA

Two Telegram accounts on two phones, after the Color Cipher release. **Run 1, 5 Oct 2026, product
owner: all passed** (details in the release record below).

| #   | Area               | Step                                                         | Expected                                                                 | Status |
| --- | ------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------ | ------ |
| C1  | Home               | Open the app                                                 | Crack the Code and Color Cipher both "Live now"; Defuser "Coming soon"   | ✅     |
| C2  | Create             | Color Cipher → Start a duel                                  | "4 tiles · 6 colors · repeats allowed"; turn time and guesses selectable | ✅     |
| C3  | Invite             | Send invite; B taps it                                       | "A challenged you to Color Cipher" with 4×6, turn time, guesses          | ✅     |
| C4  | Lobby              | B joins, ready; A starts                                     | Lobby shows "Color Cipher"; both reach "Hide your pattern"               | ✅     |
| C5  | Setup              | Pick tiles incl. a repeated color; Undo; Lock it in          | Pattern locks; the other side sees "is locked in"                        | ✅     |
| C6  | Setup              | One player waits out 60 s                                    | "Time ran out — we picked one for you"                                   | ✅     |
| C7  | Guessing           | Guess a pattern                                              | Row shows the tiles, diamonds and "x exact / y close"                    | ✅     |
| C8  | Feedback           | Hand-check 3 guesses against the revealed pattern at the end | Counts match the rules in color-cipher.md (repeats included)             | ✅     |
| C9  | Invalid            | Try to submit fewer than 4 tiles                             | Guess button disabled; tiles shake                                       | ✅     |
| C10 | Duplicate          | Repeat an earlier guess                                      | "You already tried that pattern"; turn not used                          | ✅     |
| C11 | Timer              | Let a turn run out                                           | "Time's up — turn skipped"; guesses left drop                            | ✅     |
| C12 | Win                | Second player cracks                                         | "You won! 🏆 · Pattern cracked" / "You lost"; both patterns shown        | ✅     |
| C13 | Last chance + draw | First player cracks; second cracks on the last chance        | "Last chance" banner, then "It's a draw 🤝"                              | ✅     |
| C14 | Give up            | Give up mid-game                                             | Loss for the giver, "Gave up"                                            | ✅     |
| C15 | Reconnect          | Airplane mode 20 s; background 20 s; close and reopen        | Game resumes with the same pattern and board                             | ✅     |
| C16 | Abandon            | Airplane mode > 60 s                                         | Opponent wins, "Dropped out"                                             | ✅     |
| C17 | Rematch            | Both tap Rematch                                             | New Color Cipher game, new patterns, other player first                  | ✅     |
| C18 | Stats              | Profile after a few games of each                            | One combined W/L/D record; history lists each game with its name         | ✅     |
| C19 | Themes             | Light and dark Telegram theme                                | Tiles, symbols and diamonds readable in both                             | ✅     |
| C20 | Regression         | Play one full Crack the Code match and a rematch             | Unchanged from before the release                                        | ✅     |

## Color Cipher release verification (production)

Release: PR #9 merged to `main` as commit `a5d0781` on 5 Oct 2026. CI on `main` for that
commit: ✅ passed (lint, typecheck, 232 unit/integration tests, build, 4 two-browser E2E).
Everything below needs real Telegram and the production hosts, which the build agent cannot
reach. Status: ✅ PASS · ❌ FAIL (add an issue link) · 🟡 NOT RUN.

**Run record:** 5 Oct 2026 · production (`@rivalrushbot`, Vercel + Render + Atlas) · tester:
the product owner, two Telegram accounts on two phones · result reported: **"all the tests
passed"** (every item below). Device models, OS and Telegram versions were not recorded.

Before this run, the first attempt to create a Color Cipher room failed. That matches the web app
being updated (Vercel deploys automatically) while Render still ran the previous server, which
listed Color Cipher as "coming soon"; the fix is Render → Manual Deploy → Deploy latest commit.
The run below was done after that. Lesson: with `autoDeploy: false`, every server release needs a
manual Render deploy and a `/health` version check before testing.

### Deployment

| #   | Check                      | How                                                               | Expected                                                                                                | Status |
| --- | -------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------ |
| D1  | Render runs the release    | Open `https://<render-service>.onrender.com/health`               | `version` = `a5d0781` (or a later `main` commit). If not, Render → Manual Deploy → Deploy latest commit | ✅     |
| D2  | API healthy                | Same response                                                     | HTTP 200, `"status":"ok"`                                                                               | ✅     |
| D3  | Database healthy           | Same response                                                     | `"database":"up"`                                                                                       | ✅     |
| D4  | Web live                   | Vercel → Deployments: production = `a5d0781`; open the Vercel URL | Loads ("Open in Telegram" page outside Telegram)                                                        | ✅     |
| D5  | Web talks to the right API | Sign in inside Telegram                                           | Home loads with your name (wrong `VITE_API_URL` = "Can't reach the server")                             | ✅     |
| D6  | Socket.IO works            | Lobby with two phones                                             | "B joined" toast appears without refreshing                                                             | ✅     |
| D7  | Telegram Mini App opens    | `/start` → Play                                                   | Home shows **both** games as Live now                                                                   | ✅     |

### Color Cipher checklist

Run C1–C20 in [the section above](#color-cipher-production-manual-qa) and fill its Status column.

### Duplicate-color scoring in a real game

Player B hides **Ruby Ruby Leaf Sky** (● ● ◆ ★). Player A makes these guesses on their turns
(B can guess anything in between). Then a second game where B hides **Sun Sun Sun Plum**
(■ ■ ■ ✚).

| #   | B's pattern        | A guesses           | Expected          | Why                                                              | Status |
| --- | ------------------ | ------------------- | ----------------- | ---------------------------------------------------------------- | ------ |
| S1  | Ruby Ruby Leaf Sky | Ruby Ruby Ruby Ruby | 2 exact, 0 close  | Only two Rubies exist; both are exact, the other two miss        | ✅     |
| S2  | Ruby Ruby Leaf Sky | Leaf Leaf Ruby Ruby | 0 exact, 3 close  | Two Rubies + one Leaf present, none in place; second Leaf misses | ✅     |
| S3  | Ruby Ruby Leaf Sky | Sky Ruby Ruby Leaf  | 1 exact, 3 close  | Position 2 exact; the rest present elsewhere                     | ✅     |
| S4  | Ruby Ruby Leaf Sky | Amber Amber Sun Sun | 0 exact, 0 close  | No color in common                                               | ✅     |
| S5  | Ruby Ruby Leaf Sky | Ruby Ruby Leaf Sky  | 4 exact → cracked | Last chance for B (or win if A moved second)                     | ✅     |
| S6  | Sun Sun Sun Plum   | Sun Sun Plum Plum   | 3 exact, 0 close  | The extra Plum is not counted again                              | ✅     |
| S7  | Sun Sun Sun Plum   | Plum Sun Sun Sun    | 2 exact, 2 close  | Positions 2–3 exact; the third Sun and the Plum swapped          | ✅     |

### Secret isolation

Open one player in **Telegram Web** (web.telegram.org) in desktop Chrome, launch the Mini App,
then DevTools → Network → WS → the socket → Messages. Don't copy frames anywhere public.

| #   | Check                                             | Expected                                                                | Status |
| --- | ------------------------------------------------- | ----------------------------------------------------------------------- | ------ |
| X1  | Each `room:snapshot` during setup and play        | `"opponentSecret":null`; the opponent's pattern string never appears    | ✅     |
| X2  | Phone A's screen / phone B's screen while playing | Each shows only its own pattern                                         | ✅     |
| X3  | Snapshot after the result                         | `opponentSecret` now holds the opponent's pattern; the sheet shows both | ✅     |
| X4  | Atlas `matches` document for that game            | Guesses and counts only; no pattern fields                              | ✅     |

### Reconnect, rematch and data

| #   | Check                                                           | Expected                                                                                                                        | Status |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------ |
| R1  | Background Telegram 20 s during your own turn                   | Back on the same turn; timer still counting from the server deadline                                                            | ✅     |
| R2  | Background Telegram 20 s during the opponent's turn             | Their moves made meanwhile are shown; no duplicate rows                                                                         | ✅     |
| R3  | Airplane mode 20 s                                              | "Reconnecting…" then clears; opponent saw "Lost connection"                                                                     | ✅     |
| R4  | Fully close the Mini App, reopen from the bot (< 60 s)          | Lands back in the game with the same pattern and board                                                                          | ✅     |
| R5  | Leave a turn running while away until it times out, then return | "Timed out" row recorded once; it is now the other player's turn                                                                | ✅     |
| M1  | A wins → both tap Rematch                                       | New game, new patterns, the other player starts                                                                                 | ✅     |
| M2  | A draw (both crack on the last chance) → rematch                | Same as M1; starting player alternates again                                                                                    | ✅     |
| V1  | Atlas query below after the test games                          | One document per game, `gameType: "color-cipher"`, distinct `sessionId`s, correct winner/reason, `isRematch` true for rematches | ✅     |
| V2  | Profile on both phones                                          | W/L/D and history match the games played; each game named; no double counts                                                     | ✅     |

```js
// Atlas → rivalrush.matches → Aggregations
[
  { $match: { gameType: 'color-cipher' } },
  { $sort: { endedAt: -1 } },
  { $limit: 10 },
  {
    $project: {
      sessionId: 1,
      isRematch: 1,
      result: 1,
      endedAt: 1,
      'players.displayName': 1,
      'players.outcome': 1,
      moves: { guess: 1, exact: 1, partial: 1, timedOut: 1 },
    },
  },
];
```

### Crack the Code regression (separate result)

| #   | Check                                                                                | Expected                                        | Status |
| --- | ------------------------------------------------------------------------------------ | ----------------------------------------------- | ------ |
| T1  | Create, invite (preview says "challenged you to Crack the Code"), join, ready, start | Unchanged flow                                  | ✅     |
| T2  | Secrets, a full game to a result                                                     | Bulls/cows and result as before                 | ✅     |
| T3  | Rematch                                                                              | New game, other player first                    | ✅     |
| T4  | Profile                                                                              | Stats include it, history says "Crack the Code" | ✅     |
