# Implementation status

Statuses: PLANNED · IMPLEMENTED · TESTED (automated) · VERIFIED (manually) · DEPLOYED.

## Phase 0 audit (5 Oct 2026)

- The spec claimed stages 1–13 were "done in the scaffold, typechecked, 56 tests passing".
  **No such scaffold existed** in any accessible repository. The original target branch
  belonged to an unrelated product (FPL Radar), and `filimonkd/crack-the-code` is a 2024
  prototype (~530 lines, not reusable: wrong Telegram HMAC scheme, client-supplied player
  ids). Everything here was built fresh in this repository; the spec's architecture was kept.
- `core.telegram.org` and `fastdl.mongodb.org` were blocked in the build environment.
  Telegram details were cross-checked against maintained npm packages (see
  [telegram.md](telegram.md)); MongoDB 8.0.32 was taken from the official Docker image for
  local tests. CI downloads MongoDB normally.

## Decisions not fixed by the spec

| Topic                                            | Decision                                                                                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Do timed-out turns count toward the guess limit? | Yes, so idle games always end; "both out of turns" = draw                                                                          |
| Host readiness                                   | The host is implicitly ready; READY = room full and the guest ready                                                                |
| User in several rooms                            | One active room per user: creating or joining leaves an idle lobby automatically; refused (`ALREADY_IN_ROOM`) while a game is live |
| A player leaves a finished room                  | The remaining player keeps the room as host in LOBBY; the same invite can bring a new opponent                                     |
| Streaks                                          | `currentStreak` = consecutive wins; a draw or loss resets it                                                                       |
| Stale actions                                    | `GUESS` needs `clientVersion == game.version`; `SET_SECRET` and `FORFEIT` are version-independent                                  |
| Ties between timers and actions                  | A deadline that is due is applied before any action (inclusive)                                                                    |
| Player who never connects when the game starts   | Gets the same 60 s grace as a disconnect                                                                                           |
| Invite token storage                             | Only a SHA-256 hash is persisted                                                                                                   |
| MainButton                                       | Not used; large in-page buttons (BackButton and haptics are used)                                                                  |
| Repository                                       | New `filimonkd/rivalrush` (chosen by the product owner)                                                                            |

## Feature status

| Feature                                                                                                                                                               | Status                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Monorepo, strict TS, lint/format, scripts                                                                                                                             | IMPLEMENTED · TESTED (CI)                                                                  |
| Telegram initData auth + JWT                                                                                                                                          | IMPLEMENTED · TESTED (unit, integration). Not yet verified in real Telegram                |
| User model + stats + profile + history                                                                                                                                | IMPLEMENTED · TESTED                                                                       |
| RoomManager / RoomStore / locking / expiry / host hand-off                                                                                                            | IMPLEMENTED · TESTED                                                                       |
| Invites (opaque token, startapp deep link, preview)                                                                                                                   | IMPLEMENTED · TESTED (web link in E2E). The t.me deep link is not yet verified in Telegram |
| Socket.IO auth, snapshots, events, throttle                                                                                                                           | IMPLEMENTED · TESTED                                                                       |
| Idempotency, versioning, stale handling                                                                                                                               | IMPLEMENTED · TESTED                                                                       |
| Crack the Code incl. equalizer and timers                                                                                                                             | IMPLEMENTED · TESTED                                                                       |
| Reconnect / resync / grace / reopen                                                                                                                                   | IMPLEMENTED · TESTED (incl. E2E offline toggle). Not verified on phones                    |
| Rematch with start swap                                                                                                                                               | IMPLEMENTED · TESTED                                                                       |
| Transactional idempotent match recording                                                                                                                              | IMPLEMENTED · TESTED                                                                       |
| Web screens (loading, home, game selection, create, lobby, invite, join preview, setup, game, opponent turn, reconnecting, result, rematch, profile, history, errors) | IMPLEMENTED · TESTED (E2E, desktop Chromium, mobile viewport)                              |
| Telegram theme, safe area, haptics, BackButton                                                                                                                        | IMPLEMENTED. Not verified in Telegram                                                      |
| Bot /start, /help, menu button                                                                                                                                        | IMPLEMENTED · TESTED (unit). Not verified against the live Bot API                         |
| CI (GitHub Actions)                                                                                                                                                   | IMPLEMENTED; see the PR checks for the latest run                                          |
| Vercel / Render / Atlas config                                                                                                                                        | IMPLEMENTED (config only). **Not deployed**: needs accounts and secrets                    |
| Manual QA on two phones                                                                                                                                               | PLANNED ([testing.md](testing.md))                                                         |
| Branch protection on `main`                                                                                                                                           | PLANNED: needs repository admin ([ci-cd.md](ci-cd.md))                                     |

## Known limitations

- Live games live in memory: a restart or deploy ends them (documented, accepted for the MVP).
- One server instance only, until a Redis store, adapter and job queue exist.
- JWTs are not revocable before expiry; no CSP header yet.
- English UI only.
- The E2E runs in desktop Chromium with dev login, not inside Telegram's WebViews.
