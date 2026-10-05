# Testing and QA

## Automated

| Suite              | Location                                   | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared schemas     | `packages/shared/test`                     | Invite `start_param` round trip and rejection of junk; settings ranges; action schemas reject extra fields (no fake winner)                                                                                                                                                                                                                                                                                                                  |
| Scoring            | `apps/server/test/unit/ctc-rules.test.ts`  | Bulls/cows incl. the worked example, exact match, permutations, repeated guess digits; generated secrets are valid and can lead with 0                                                                                                                                                                                                                                                                                                       |
| Game rules         | `.../ctc-game.test.ts`                     | Setup, invalid/duplicate secret, auto secrets on timeout, alternation, invalid/duplicate guess, timeouts burn turns, equalizer win/draw/timeout, out-of-guesses draw, forfeit, abandon, finished rejects all, immutability, **60 random full games with no secret leak in any view**                                                                                                                                                         |
| Telegram auth      | `.../telegram-auth.test.ts`                | Valid data; independent re-implementation of the algorithm; tampered; wrong bot; stale; future; malformed; duplicate fields                                                                                                                                                                                                                                                                                                                  |
| Config             | `.../env.test.ts`                          | Production refuses dev login, weak secrets, missing DB/bot token, wildcard/http CORS                                                                                                                                                                                                                                                                                                                                                         |
| RoomManager        | `.../room-manager.test.ts`                 | Create, join, full, invalid/expired/closed invite, duplicate join, one active room per user, host-only start, host hand-off, idempotent start/guess/secret/rematch, stale versions, server timers, **all race conditions** in [state-machine.md](state-machine.md), disconnect grace, reconnect, multi-tab presence, leave = forfeit, monotonic versions                                                                                     |
| Bot                | `.../bot.test.ts`                          | /start, deep-link /start, /help, token never in errors                                                                                                                                                                                                                                                                                                                                                                                       |
| REST integration   | `apps/server/test/integration/api.test.ts` | Real MongoDB replica set: auth flow, acquisition flag, room flow, persisted metadata hashes the invite, old invites, validation, 413, CORS + helmet, transactional idempotent stats + streaks, profile, logs contain no launch data                                                                                                                                                                                                          |
| Socket integration | `.../socket.test.ts`                       | Bad/forged tokens rejected, non-members blocked, a full match (secrets, stale/duplicate actions, equalizer draw, recorded stats, rematch with swapped start), **no opponent secret in any snapshot before the end**, no secrets in logs, offline → resync → resume, leave = forfeit, throttling                                                                                                                                              |
| Web logic          | `apps/web/test`                            | Snapshot ordering, event → toast mapping, server-time countdowns, invite links                                                                                                                                                                                                                                                                                                                                                               |
| **E2E**            | `apps/web/e2e/match.spec.ts`               | Two Chromium browsers (mobile viewport) play the whole loop against the built server and the production web build: invite → join → ready → start → secrets → turns → duplicate guess → last chance draw → result with revealed codes → rematch (start swaps) → offline/online → app reopen lands back in game → give up → profile stats. **Scans every WebSocket frame for leaked opponent secrets.** Bogus invite → "Can't join this room". |

Run: `npm test` (all unit + integration) and `npm run build -w @rivalrush/server && npm run test:e2e`.

Integration tests use `mongodb-memory-server` (one-node replica set, so transactions work).
Set `MONGODB_TEST_URI` to point at an existing replica set instead, or `MONGOMS_SYSTEM_BINARY`
for a local `mongod`. Automated tests never touch staging or production databases.

## Manual QA: two Telegram accounts

The automated E2E uses dev login in desktop Chromium. These items need **real Telegram on two
phones** (ideally one iOS, one Android) against staging or production. Record the date,
devices, app version and pass/fail per row.

| #   | Step                                               | Expected                                                                 |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | A sends `/start` to the bot                        | Welcome text + **Play** button; chat menu button says Play               |
| 2   | Tap Play                                           | Mini App opens full height, no login screen                              |
| 3   | Authentication                                     | Home says "Hey, <first name>"                                            |
| 4   | Home                                               | Crack the Code hero, record card, coming-soon games                      |
| 5   | Start a duel → pick 4 / 45 s / 10 → Create room    | Lobby: host seat + "Waiting for opponent"                                |
| 6   | Send invite                                        | Telegram chat picker opens with the link and text                        |
| 7   | B taps the link in the chat                        | App opens on "A challenged you"                                          |
| 8   | B taps Join game                                   | A gets a buzz and a "B joined" toast                                     |
| 9   | B taps I'm ready                                   | A's button becomes **Start game**                                        |
| 10  | A starts                                           | Both see "Hide your code" with a 60 s timer                              |
| 11  | Secret setup                                       | Used digits are disabled; Lock it in; other side sees "locked in"        |
| 12  | Gameplay                                           | Only the player on turn sees the keypad; pegs match a hand-checked count |
| 13  | Timer                                              | Let a turn expire → "Time's up — turn skipped"; guesses left decrease    |
| 14  | Invalid guess                                      | Incomplete input cannot be submitted; the field shakes                   |
| 15  | Duplicate guess                                    | "You already tried that one"                                             |
| 16  | Win                                                | Second player cracks → "You won! 🏆"; both codes revealed                |
| 17  | Loss                                               | Other phone shows "You lost"                                             |
| 18  | Draw                                               | Both crack via last chance, or both run out → draw                       |
| 19  | Last-chance rule                                   | First player cracks → other sees "Last chance — crack it to tie!"        |
| 20  | Rematch                                            | Both tap Rematch → new game, other player first                          |
| 21  | Background app 20 s mid-game                       | On return the board is current, no forfeit                               |
| 22  | Reconnect                                          | "Reconnecting… your game is safe" banner clears on its own               |
| 23  | Close fully, reopen from the bot                   | Lands back in the game                                                   |
| 24  | Airplane mode > 60 s                               | Opponent wins with "Dropped out"                                         |
| 25  | Full disconnect then return within 60 s            | Game continues                                                           |
| 26  | Expired invite (room older than 2 h, or both left) | "Can't join this room"                                                   |
| 27  | Old room link after a game                         | Correct message, no crash                                                |
| 28  | Light Telegram theme                               | Readable, colors follow the theme                                        |
| 29  | Dark Telegram theme                                | Same                                                                     |
| 30  | Profiles                                           | Both show correct W/L/D, streak and recent games                         |

**Current status:** not yet executed. It needs deployed URLs and two Telegram accounts.
