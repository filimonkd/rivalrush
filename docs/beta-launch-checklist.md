# Closed beta: launch checklist (9–11 Oct 2026)

Everything to do before the first tester message goes out on **Mon 12 Oct**, in order, with how
to know each step worked. Only you can do these: they need the Render, Vercel, Atlas, GitHub and
Telegram accounts. Tick them off here or copy the list into your notes.

Never paste a token, password or connection string into a chat, an issue or a commit. Where a
command needs one, read it into your shell with `read -rs` (shown below), which does not echo it
or keep it in your history.

The plan this serves: [beta-plan.md](beta-plan.md). Daily routine once it starts:
[runbook.md](runbook.md#closed-beta-daily-routine).

## A. Deploy what the beta runs on (Fri 9 Oct)

`main` now holds everything for the beta: game starts recorded for the metrics (#23), How to play
for both duels and the fix for a lost tap right after joining (#24).

- [ ] **Vercel** → the `rivalrush` project → Deployments: the latest **Production** deployment is
      the newest commit on `main`. If not, open that commit's deployment → **Promote to
      Production** (or **Redeploy**).
- [ ] **Render** → the live API service → **Manual Deploy → Deploy latest commit**. Pick a quiet
      moment: a deploy ends games in progress.
- [ ] **Check the deployment** from a clone of the repository on your computer (`npm ci` once):

  ```sh
  npm run prod:check -w @rivalrush/server -- \
    --api https://<render-service>.onrender.com --web https://<vercel-domain> --commit <sha>
  ```

  `<sha>` is the commit on `main` you just deployed. Every line should be ✅:

  | Check                              | What a ❌ means                                                             |
  | ---------------------------------- | --------------------------------------------------------------------------- |
  | API health, Deployed commit        | The API is down, the database is unreachable, or Render runs an older build |
  | Security headers                   | helmet is not in front of the API                                           |
  | CORS allows / refuses              | `CLIENT_ORIGINS` is missing the web app, or lets any site in                |
  | Dev login is off                   | **Stop:** anyone could sign in as anyone. Set `DEV_LOGIN_ENABLED=false`     |
  | API needs sign-in                  | An endpoint answers without a session                                       |
  | Telegram webhook route             | The bot is not running (`BOT_TOKEN`, `WEBAPP_URL`)                          |
  | Socket.IO                          | Live games can't connect                                                    |
  | Web app, Web app talks to this API | Vercel serves something else, or `VITE_API_URL` points elsewhere            |

  To also ask Telegram where it sends the bot's updates, run it with the token in the
  environment (it goes only to `api.telegram.org` and is never printed):

  ```sh
  read -rs BOT_TOKEN && export BOT_TOKEN   # paste the token, then Enter
  npm run prod:check -w @rivalrush/server -- --api … --web … --commit <sha>
  unset BOT_TOKEN
  ```

## B. Safety nets (Fri 9 Oct)

- [ ] **Read-only report user** in Atlas: `rivalrush_report` with only `read` on `rivalrush`
      ([how](beta-plan.md#the-beta-report-one-command)).
- [ ] **Uptime pinger** on the **live** API only: UptimeRobot → New monitor → HTTP(s) →
      `https://<render-service>.onrender.com/health`, every 5 minutes, alert to your email.
      Never ping the staging service too: two always-awake services use up Render's 750 free
      hours and Render suspends both.
- [ ] **Branch protection** on `main`: GitHub → Settings → Branches → Add rule for `main` →
      require a pull request, and require these status checks to pass: _Lint, typecheck, test,
      build_, _Two-browser end-to-end_, _Defuser generator (100,000 seeds)_.
- [ ] **Render Auto-Deploy: Off** for the beta week (Settings → Build & Deploy). A merge then never
      ends live games by surprise; you deploy by hand at a quiet hour with a heads-up, as the
      [deploy rule](runbook.md#closed-beta-daily-routine) says. Turn it back on after the beta if
      you like.

## C. Two-phone smoke test (Sat 10 Oct, ~15 minutes)

With a second phone (or a friend), against the **live** bot `@rivalrushbot`:

| #   | Do                                                           | Expect                                                                                                           |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| 1   | `/start` → **Play** on phone A                               | Home with Crack the Code and Color Cipher live; Defuser as "Coming soon", or its live card once you switch it on |
| 2   | **Start a duel** → **Create room**                           | The lobby opens How to play by itself (first time on this phone), with your room's numbers                       |
| 3   | **Send invite** to phone B's chat; B taps it → **Join game** | B sees How to play once too; after it, **I'm ready** works on the first tap                                      |
| 4   | A taps **Start game**, both play to a result                 | Result on both phones; **Rematch** starts a new game with the other player first                                 |
| 5   | Repeat 2–4 with **Color Cipher**                             | Same, with Color Cipher's own How to play                                                                        |
| 6   | Profile on both phones                                       | Both games in recent matches; wins and losses add up                                                             |
| 7   | Background the app on B for ~20 s mid-game, return           | Game still running, B catches up without reloading                                                               |

Then on your computer:

- [ ] `npm run beta:report -w @rivalrush/server -- --since <today> --tz <your zone>` (with the
      read-only URI, [how](beta-plan.md#the-beta-report-one-command)) shows the games you just
      played under "Games started" and **0 never finished**.
- [ ] Render → Logs for the last hour: no `"level":50`, no `match.record_failed`, and no secret
      codes or `initData` anywhere.

These games stay in the data: start the beta report at `--since 2026-10-12` and they are not
counted.

## D. Testers and feedback (10–11 Oct)

- [ ] 15–20 testers recruited; one or two Telegram groups created.
- [ ] A **local** tester list for the "outsiders" count: one Telegram id or `@username` per line in
      `testers.txt` (git ignores it; never commit or share it). Use it with
      `beta:report -- --testers testers.txt`.
- [ ] The [tester message](beta-tester-guide.md#message-to-post-in-the-beta-group) ready to post
      on Monday morning (and pin).
- [ ] The end-of-week survey built in Google Forms or Tally from the
      [12 questions](beta-plan.md#feedback), not shared yet (it goes out on day 6).
- [ ] The two polls drafted (day 3: games played; day 5: turn timer).
- [ ] The [daily log](beta-plan.md#daily-log) spreadsheet with its header row.
- [ ] You can open a **Beta bug report** issue on GitHub (Issues → New issue).

## E. Go / no-go (Sun 11 Oct, evening)

**Go** when all of these hold:

- `prod:check` is all ✅ on the commit the beta will run on;
- the two-phone smoke test passed and the report counted its games;
- the pinger has been green for the last 24 hours;
- no open issue labelled Blocker.

**No-go:** fix what failed (a deploy at a quiet hour is fine before the beta), or move the start
by a day and tell the testers. Do not start the week with a known Blocker.

## F. During the week

- Only fixes for Blockers (or a safe, tested Major) reach the live service, deployed by hand
  with a heads-up ([deploy rule](runbook.md#closed-beta-daily-routine)).
- Anything else is tried on staging first ([deployment.md](deployment.md#staging-optional-telegram-qa-of-unreleased-games)).
- Defuser on the live service is your switch (`DEFUSER_ENABLED` in the Render dashboard,
  [how](deployment.md#releasing-defuser-on-the-live-service)). Flipping it restarts the service, so
  treat it like a deploy: quiet hour, heads-up. Its games show up in the beta report as their own
  row in "Per game".
