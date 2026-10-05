# MVP readiness review

Date: 5 Oct 2026 · Scope: Crack the Code duels in the Telegram Mini App (no second game).

Legend: ✅ Verified · 🟡 Not yet verified · ⚠️ Known limitation · ⬜ Planned.
"Automated" means covered by tests that run in CI. "Production" means a person saw it work in
real Telegram against the live deployment. Details: [status.md](status.md),
[testing.md](testing.md).

## Verdict

**Ready for a small closed beta once the remaining production QA rows are run on two phones.**
The core journey works in production. Everything the beta depends on (rematch, reconnect,
timers, stats, duplicate and concurrent actions) is implemented and covered by automated tests,
but it has not yet been checked in real Telegram. No known blocking bugs remain.

## Checklist

| Area       | Item                                                     | Automated | Production         |
| ---------- | -------------------------------------------------------- | --------- | ------------------ |
| PRODUCT    | Core journey: open → invite → join → play → result       | ✅        | ✅                 |
| AUTH       | Telegram initData sign-in, server-side HMAC check        | ✅        | ✅                 |
| ROOMS      | Create / join / ready / start                            | ✅        | ✅                 |
| INVITES    | `startapp` deep link opens the challenge                 | ✅        | ✅                 |
| INVITES    | Expired / closed / full / bogus links explain themselves | ✅        | 🟡                 |
| GAME       | Crack the Code: secrets, turns, bulls/cows, result       | ✅        | ✅                 |
| GAME       | Last chance, draw, forfeit                               | ✅        | 🟡                 |
| GAME       | Turn timer, timeout, setup auto-secret                   | ✅        | 🟡                 |
| REALTIME   | Socket.IO live updates                                   | ✅        | ✅                 |
| SECURITY   | Server-authoritative moves, results, timers              | ✅        | n/a                |
| SECURITY   | No opponent secret in snapshots, API, logs or database   | ✅        | 🟡 spot-check logs |
| SECURITY   | Bot token, JWT secret and MongoDB URI server-side only   | ✅ (code) | ✅ (config)        |
| RECONNECT  | Network drop, socket drop, reopen, resync, grace period  | ✅        | 🟡                 |
| REMATCH    | Both agree, new session, start swaps, no old-game leak   | ✅        | 🟡                 |
| STATS      | Recorded once, W/L/D, streaks, history = stats           | ✅        | 🟡                 |
| RACES      | 10 concurrency cases with deterministic outcomes         | ✅        | n/a                |
| CI         | Lint, format, typecheck, unit, integration, build, E2E   | ✅        | n/a                |
| DEPLOYMENT | Vercel (web)                                             | n/a       | ✅                 |
| DEPLOYMENT | Render (API + Socket.IO + webhook)                       | n/a       | ✅                 |
| DEPLOYMENT | MongoDB Atlas (users written on sign-in)                 | ✅        | ✅                 |
| DEPLOYMENT | `/health` + keep-warm pinger                             | ✅        | 🟡                 |
| TELEGRAM   | Bot `/start`, Play button, Main Mini App                 | ✅        | ✅                 |
| TELEGRAM   | Theme, safe areas, haptics, Back button on real phones   | n/a       | 🟡                 |
| MANUAL QA  | 37-row production checklist                              | n/a       | 11 ✅ · 27 🟡      |
| REPO       | Branch protection on `main`                              | n/a       | ⬜                 |

## Definition of done for this phase

| #   | Requirement                                  | State                                                                                        |
| --- | -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | Two Telegram users can complete a match      | ✅ production                                                                                |
| 2   | Both can rematch                             | ✅ automated (unit, integration, E2E) · 🟡 production                                        |
| 3   | Starting player swaps on rematch             | ✅ automated · 🟡 production                                                                 |
| 4   | Reconnect/resync works                       | ✅ automated (incl. E2E offline/online and reopen) · 🟡 on phones                            |
| 5   | Timer behavior is correct                    | ✅ automated (server deadlines, ties, reconnect) · 🟡 production                             |
| 6   | Stats are correct                            | ✅ automated against real MongoDB · 🟡 production                                            |
| 7   | Match history is correct                     | ✅ automated · 🟡 production                                                                 |
| 8   | Duplicate actions are safe                   | ✅ automated                                                                                 |
| 9   | Race-condition tests exist and pass          | ✅ `races.test.ts` + `rematch.test.ts` + `timers.test.ts` + `reliability.test.ts`            |
| 10  | Production manual QA as far as devices allow | 🟡 run 1 covered the core loop; the rest needs two phones (not available to the build agent) |
| 11  | Documentation reflects reality               | ✅ status, testing, deployment, runbook, this review                                         |
| 12  | CI remains green                             | ✅ on the hardening PR                                                                       |
| 13  | Production deployment remains healthy        | 🟡 healthy as of the product owner's game; `/health` not reachable from the build sandbox    |

## Remaining risks

1. **Restarts end live games.** Render Free can restart or sleep at any time; every deploy
   does it too. Mitigation: pinger, deploy at quiet hours, announce deploys to testers.
2. **Mobile backgrounding** behaves differently on iOS and Android Telegram. The client now
   forces a reconnect if a resync gets no answer within 3 s, but only real phones can confirm
   it (QA rows 19–22).
3. **Launch data older than 1 hour** after a WebView reload makes sign-in fail until the user
   reopens from the bot (clear message shown).
4. **Free-tier limits**: Render's 750 instance hours per month (one always-awake service only),
   Atlas M0's 512 MB storage, and Vercel Hobby's non-commercial terms.
5. **Single instance**: no horizontal scaling until a Redis-backed store exists. That is
   enough for a closed beta of 15–20 testers.

## Recommended next step

1. Run QA rows 11–37 in [testing.md](testing.md#production-manual-qa) on two phones (one iOS,
   one Android). Rematch, reconnect, timers, profile and invite edge cases come first.
2. Set up the keep-warm pinger and run the daily health check in [runbook.md](runbook.md).
3. Turn on branch protection for `main`.
4. Start the closed beta (15–20 testers, one week) and watch completion and rematch rates
   ([roadmap.md](roadmap.md)).
