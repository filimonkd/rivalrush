# Defuser: Telegram multi-phone QA (staging)

**Status: run 1 done (8 Oct 2026, partial: one 2-player game). Most rows not yet run.**
This QA runs on **staging only** ([deployment.md](deployment.md#staging-optional-telegram-qa-of-unreleased-games)):
the staging bot, the staging Vercel project and the `rivalrush_staging` database. It never touches
the live bot, the live database or the closed beta. A pass here is evidence for the product
decision; it is **not** a release, and Defuser stays off on the live service whatever the result.

What the automated suites already cover (unit, jsdom, real-socket backend, Playwright in Chromium
with dev login, see [testing.md](testing.md)) is the game logic and the browser UI. This script is
for what only real phones in real Telegram can show: the Telegram WebView, touch and haptics,
safe areas, backgrounding, real networks, voice calls, and how the game feels to a team.

## Before the session

- Staging is up: `curl https://<staging api>/health` shows `"database":"up"`, and `version` is the
  commit you want to test. Write that commit down.
- **Devices:** at least one iPhone and one Android phone with Telegram up to date; ideally a small
  phone (≤ 375 pt / 360 dp wide) and Telegram Desktop too. Mix light and dark Telegram themes.
- **People:** 4 testers (2–4 per game), each with their own Telegram account, in one Telegram group
  with a **voice chat** running: Defuser is designed to be played talking.
- Each tester opens the **staging** bot (not `@rivalrushbot`) → `/start` → Play.
- One person records results in the table below; testers report problems as in
  [beta-tester-guide.md](beta-tester-guide.md#reporting-a-problem), adding the room's edition label
  (top right of the role band, e.g. "Edition PFM").

Status: ✅ passed · ❌ failed (with a bug link) · 🟡 not yet run. Note the device for every ✅/❌.

## Runs

**Run 1, 8 Oct 2026, product owner, staging (`@RivalRushStagingbot`), 2 players.** Staging set up
the same day (staging bot, `rivalrush-api-staging` on Render, a separate Vercel project, the
`rivalrush_staging` database user). Devices and the deployed commit were not recorded. Reported:
the staging app showed the Defuser preview card while `@rivalrushbot` still showed "Coming soon";
a room was created, the second player joined from a shared invite link, and the game ended in a
DETONATION (cause not recorded). The rows marked ✅ below are the ones that report covers.

**Finding (run 1):** the game "worked, but confused me" for a first-time player who had never
played Defuser. Not a defect in the rows below, but the most important input so far: a first game
needs to explain itself (roles, what to say, how a panel is solved).

## Script

Play at least **one game with 2, one with 3 and one with 4 players**, and let one game run out of
time. Rotate who hosts and who is Operator.

| #   | Area          | Step                                                                  | Expected                                                                                                                       | Status             |
| --- | ------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| 1   | Entry         | Open the staging app                                                  | Home shows the dashed "Staging preview · not released" Defuser card; duels unchanged                                           | ✅ run 1           |
| 2   | Entry         | Open the **live** bot (`@rivalrushbot`)                               | No Defuser card, only the "Coming soon" tile (live is untouched)                                                               | ✅ run 1           |
| 3   | Create        | Tap the card → Create room                                            | "New team game"; lobby says "Team lobby", game "Defuser", "Best with voice"                                                    | ✅ run 1           |
| 4   | Invite        | Send invite → share to the group chat                                 | Message reads "<name> needs a team to defuse a Charge…"; the link opens the staging app                                        | ✅ run 1           |
| 5   | Join          | Teammates tap the link                                                | Join page "<host> needs a team to defuse a Charge" → Join → lobby; up to 4 seats                                               | ✅ run 1 (2 seats) |
| 6   | Join          | A 5th person taps the link                                            | "Someone already took this seat" (room full)                                                                                   | 🟡                 |
| 7   | Start         | Guests tap I'm ready; host taps Start                                 | Start stays disabled until everyone is ready; then all phones move to the briefing together                                    | ✅ run 1           |
| 8   | Briefing      | Read the briefing on every phone                                      | Exactly one "You are the OPERATOR"; Analysts see their letter and "You hold N of 6 sheets"; no sheet text, no device yet       | 🟡                 |
| 9   | Briefing      | Nobody taps Ready                                                     | The 20 s briefing ends on its own and the Charge arms on all phones at the same moment                                         | 🟡                 |
| 10  | Briefing      | Everyone taps I'm ready                                               | Arms immediately; countdown ≈ 4:00–5:00 on all phones, within a second of each other                                           | 🟡                 |
| 11  | Roles         | Compare screens                                                       | Operator: dark device, no sheets anywhere. Analysts: paper sheets only, never the device. Sheet index names who holds the rest | 🟡                 |
| 12  | Fuse          | Operator taps a line, then Cut (describe the lines; the team decides) | The line shows cut only after the server answers; a right cut ✓ on all phones; a wrong one is a fault                          | 🟡                 |
| 13  | Glyph         | Operator presses two keys in order                                    | First key lights up; second completes; a wrong pair is a fault and that pair is marked tried                                   | 🟡                 |
| 14  | Valve         | Operator sets level and Seal/Vent, then **short-taps** the lever      | Nothing happens on a short tap                                                                                                 | 🟡                 |
| 15  | Valve         | Hold the lever ≈ 1 s                                                  | Commits once with a haptic; a wrong setting is a fault and the lever resets to level 1 / Seal                                  | 🟡                 |
| 16  | Faults        | Make a wrong move                                                     | Red flash, haptic, a pip fills on **every** phone; the toast names only the move made, never the right answer                  | 🟡                 |
| 17  | Faults        | Reach 2 faults                                                        | "One more fault detonates the Charge" bar on every phone                                                                       | 🟡                 |
| 18  | Timer         | Watch the last 30 s                                                   | Countdown turns red; light haptic ticks at 30, 20 and 10 s                                                                     | 🟡                 |
| 19  | End           | Solve all three panels                                                | DEFUSED with time left on every phone; "You helped defuse it"                                                                  | 🟡                 |
| 20  | End           | Third fault in another game                                           | DETONATION · "3 faults" on every phone                                                                                         | 🟡                 |
| 21  | End           | Let one game run out of time                                          | DETONATION · "Time ran out" on every phone at the same moment                                                                  | 🟡                 |
| 22  | Debrief       | Open Debrief                                                          | The Charge, the right inputs and every sheet, per panel; Back to result works                                                  | 🟡                 |
| 23  | Rematch       | Everyone taps Again                                                   | "Next Operator: X" on the result matches who becomes Operator; a fresh briefing starts                                         | 🟡                 |
| 24  | Telegram      | During a game, press Telegram's Back button (or swipe back)           | "Leave the team?" confirm; Cancel keeps you in the game                                                                        | 🟡                 |
| 25  | Telegram      | Notch / home-indicator phones; rotate if possible                     | Nothing under the notch or home bar; all controls reachable without scrolling the device panel                                 | 🟡                 |
| 26  | Telegram      | Switch Telegram between light and dark                                | Shell follows the theme; the device stays dark and the sheets stay paper, both readable                                        | 🟡                 |
| 27  | Telegram      | Play with the voice chat open (floating bar)                          | Voice keeps working; the bar does not hide the countdown or the controls                                                       | 🟡                 |
| 28  | Reconnect     | A tester switches to another app for ~20 s, then returns              | Game still running; their screen catches up (faults, cuts, lit key) without reloading                                          | 🟡                 |
| 29  | Reconnect     | A tester turns on airplane mode for ~20 s, then off                   | Reconnect banner, then the current state; teammates see them back online in Team                                               | 🟡                 |
| 30  | Drop-out      | An **Analyst** stays away > 60 s                                      | Others see "<name> timed out"; their sheets go to teammates ("You now hold …")                                                 | 🟡                 |
| 31  | Drop-out      | That Analyst returns                                                  | Their screen names who now holds their sheets, with Rejoin; Rejoin gives them copies back                                      | 🟡                 |
| 32  | Drop-out      | The **Operator** stays away > 60 s (3–4 players)                      | The next player gets "You are now the Operator" and sees the device; the game goes on                                          | 🟡                 |
| 33  | Leave         | Team → Leave the team (3–4 players)                                   | Confirm; the leaver goes Home; the others see "<name> left the team" and keep playing                                          | 🟡                 |
| 34  | Leave         | In a 2-player game, one leaves                                        | The other returns to the lobby with "Game ended: not enough players"                                                           | 🟡                 |
| 35  | Kill / reopen | Swipe Telegram away mid-game and reopen the staging bot within 60 s   | Back in the same game, same role, same state                                                                                   | 🟡                 |
| 36  | History       | Profile → recent games                                                | "with <teammates> · Defuser · Defused/Detonated"; duel wins/losses unchanged                                                   | 🟡                 |
| 37  | Small screen  | On the smallest phone, play as Operator and as Analyst                | Fuse/Glyph/Valve fit without scrolling; sheets readable without zoom                                                           | 🟡                 |
| 38  | Logs          | After the session, read the staging Render logs                       | No seed, solution, token or init data in any log line; no repeated errors                                                      | 🟡                 |

## After the session

Record the date, commit, devices and testers above the table (as in
[testing.md](testing.md#production-manual-qa)), file a bug for every ❌, and note anything that
felt confusing even if it "worked": that is the most useful input for the product decision.

**Exit criteria for "Telegram QA passed":** every row ✅ on at least one iPhone and one Android
phone; games played with 2, 3 and 4 players; no row about secrecy (8, 11, 16, 38) ever failed; any
❌ fixed and re-checked. Passing does not activate Defuser anywhere but staging.
