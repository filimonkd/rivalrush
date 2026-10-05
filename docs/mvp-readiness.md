# MVP readiness review

Date: 5 Oct 2026 · Scope: Crack the Code duels in the Telegram Mini App (no second game).

Legend: ✅ Verified · 🟡 Not yet verified · ⚠️ Known limitation · ⬜ Planned.
"Automated" means covered by tests that run in CI. "Production" means a person saw it work in
real Telegram against the live deployment. Details: [status.md](status.md),
[testing.md](testing.md).

## Verdict

**Ready for the closed beta.** The core journey, rematch, reconnect, timers, stats, themes and
invite errors were all verified on two phones in production (QA run 2, 5 Oct 2026), on top of
the automated suite that runs in CI. No known blocking bugs remain. Open items are operational
(health check from outside, keep-warm pinger, branch protection) plus two optional invite
checks.

## Checklist

| Area       | Item                                                     | Automated | Production                 |
| ---------- | -------------------------------------------------------- | --------- | -------------------------- |
| PRODUCT    | Core journey: open → invite → join → play → result       | ✅        | ✅                         |
| AUTH       | Telegram initData sign-in, server-side HMAC check        | ✅        | ✅                         |
| ROOMS      | Create / join / ready / start                            | ✅        | ✅                         |
| INVITES    | `startapp` deep link opens the challenge                 | ✅        | ✅                         |
| INVITES    | Expired / closed / full / bogus links explain themselves | ✅        | ✅ full/closed; 🟡 expired |
| GAME       | Crack the Code: secrets, turns, bulls/cows, result       | ✅        | ✅                         |
| GAME       | Last chance, draw, forfeit                               | ✅        | ✅                         |
| GAME       | Turn timer, timeout, setup auto-secret                   | ✅        | ✅                         |
| REALTIME   | Socket.IO live updates                                   | ✅        | ✅                         |
| SECURITY   | Server-authoritative moves, results, timers              | ✅        | n/a                        |
| SECURITY   | No opponent secret in snapshots, API, logs or database   | ✅        | 🟡 spot-check logs         |
| SECURITY   | Bot token, JWT secret and MongoDB URI server-side only   | ✅ (code) | ✅ (config)                |
| RECONNECT  | Network drop, socket drop, reopen, resync, grace period  | ✅        | ✅                         |
| REMATCH    | Both agree, new session, start swaps, no old-game leak   | ✅        | ✅                         |
| STATS      | Recorded once, W/L/D, streaks, history = stats           | ✅        | ✅                         |
| RACES      | 10 concurrency cases with deterministic outcomes         | ✅        | n/a                        |
| CI         | Lint, format, typecheck, unit, integration, build, E2E   | ✅        | n/a                        |
| DEPLOYMENT | Vercel (web)                                             | n/a       | ✅                         |
| DEPLOYMENT | Render (API + Socket.IO + webhook)                       | n/a       | ✅                         |
| DEPLOYMENT | MongoDB Atlas (users written on sign-in)                 | ✅        | ✅                         |
| DEPLOYMENT | `/health` + keep-warm pinger                             | ✅        | 🟡                         |
| TELEGRAM   | Bot `/start`, Play button, Main Mini App                 | ✅        | ✅                         |
| TELEGRAM   | Theme, safe areas, haptics, Back button on real phones   | n/a       | ✅                         |
| MANUAL QA  | 38-row production checklist                              | n/a       | 36 ✅ · 2 🟡 (optional)    |
| REPO       | Branch protection on `main`                              | n/a       | ⬜                         |

## Definition of done for this phase

| #   | Requirement                                  | State                                                                                            |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | Two Telegram users can complete a match      | ✅ production                                                                                    |
| 2   | Both can rematch                             | ✅ automated (unit, integration, E2E) · ✅ production (QA run 2)                                 |
| 3   | Starting player swaps on rematch             | ✅ automated · ✅ production (QA run 2)                                                          |
| 4   | Reconnect/resync works                       | ✅ automated (incl. E2E offline/online and reopen) · ✅ production (QA run 2)                    |
| 5   | Timer behavior is correct                    | ✅ automated (server deadlines, ties, reconnect) · ✅ production (QA run 2)                      |
| 6   | Stats are correct                            | ✅ automated against real MongoDB · ✅ production (QA run 2)                                     |
| 7   | Match history is correct                     | ✅ automated · ✅ production (QA run 2)                                                          |
| 8   | Duplicate actions are safe                   | ✅ automated                                                                                     |
| 9   | Race-condition tests exist and pass          | ✅ `races.test.ts` + `rematch.test.ts` + `timers.test.ts` + `reliability.test.ts`                |
| 10  | Production manual QA as far as devices allow | ✅ run 1 (core loop) + run 2 (two phones, full script); 2 optional invite rows open              |
| 11  | Documentation reflects reality               | ✅ status, testing, deployment, runbook, this review                                             |
| 12  | CI remains green                             | ✅ on the hardening PR and on `main` after the merge                                             |
| 13  | Production deployment remains healthy        | ✅ the full two-phone run passed on the post-merge deploy; 🟡 `/health` not checked from outside |

## Remaining risks

1. **Restarts end live games.** Render Free can restart or sleep at any time; every deploy
   does it too. Mitigation: pinger, deploy at quiet hours, announce deploys to testers.
2. **Mobile backgrounding** passed on the tested phones; other devices and OS versions in the
   beta may still behave differently. Watch for reconnect complaints.
3. **Launch data older than 1 hour** after a WebView reload makes sign-in fail until the user
   reopens from the bot (clear message shown).
4. **Free-tier limits**: Render's 750 instance hours per month (one always-awake service only),
   Atlas M0's 512 MB storage, and Vercel Hobby's non-commercial terms.
5. **Single instance**: no horizontal scaling until a Redis-backed store exists. That is
   enough for a closed beta of 15–20 testers.

## Recommended next step

1. Set up the keep-warm pinger and run the daily health check in [runbook.md](runbook.md).
2. Turn on branch protection for `main`.
3. Start the closed beta (15–20 testers, one week) and watch completion and rematch rates
   ([roadmap.md](roadmap.md)). Announce deploys to testers: a deploy ends live games.
