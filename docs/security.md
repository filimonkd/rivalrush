# Security model

**Rule:** the phone is a remote control, not a referee. It sends intents; the server decides
and shows each player only what they may see.

| Threat                             | Control                                                                                                                                                                                       | Test                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Forged sign-in                     | HMAC-validated initData, timing-safe compare, duplicate-key rejection                                                                                                                         | `telegram-auth.test.ts`, `api.test.ts`                        |
| Stale / future launch data         | 1 h max age, 60 s future skew                                                                                                                                                                 | same                                                          |
| Impersonation                      | Identity only from the JWT (HS256, issuer + audience, fixed algorithm); payload user ids ignored; strict schemas reject extra fields                                                          | `room-manager.test.ts` (fake `playerId`), `api.test.ts`       |
| Reading the opponent's code        | Raw state never leaves the server; `getPlayerView` reveals the opponent secret only after the game ends; public views never contain secrets                                                   | game fuzz test (60 random games), socket test, E2E frame scan |
| Out-of-turn / extra / late guesses | Engine checks phase, turn, deadline, limit, duplicates                                                                                                                                        | `ctc-game.test.ts`, `races.test.ts`                           |
| Faking a result / score / timer    | No client action carries results; scores computed server-side; deadlines are server timestamps                                                                                                | `ctc-game.test.ts`, `timers.test.ts`, shared schema tests     |
| Old match shown to a newcomer      | A room returning to the lobby drops the finished (already recorded) game; snapshots are built per viewer                                                                                      | `rematch.test.ts`, E2E declined-rematch test                  |
| Replaying actions                  | `actionId` idempotency per room and user                                                                                                                                                      | unit + socket tests                                           |
| Stalling                           | Server timers; a timeout burns the turn; 60 s disconnect grace then forfeit                                                                                                                   | timer tests                                                   |
| Arbitrary room access              | Membership checked on every read and action; invite tokens are 96-bit random and fill only an open seat; room ids are not revealed to non-members in previews                                 | api + socket tests                                            |
| Spam / brute force                 | 5 actions/s per socket (burst 12); 300 req/min API, 30 req/min auth per IP                                                                                                                    | socket throttle test                                          |
| Double-counted wins                | Unique `matches.sessionId`, one transaction for match + both players' stats                                                                                                                   | `api.test.ts`, `reliability.test.ts`                          |
| Secrets in logs                    | Logs never receive secret codes or guesses; pino redaction as a safety net; HTTP logs record route patterns (no invite tokens); auth failures log only a reason code                          | `socket.test.ts` log scan, `api.test.ts`                      |
| Secrets in the DB                  | Matches store guesses and scores only; invite tokens stored as SHA-256                                                                                                                        | `api.test.ts`                                                 |
| Analytics leaking players          | `game_starts` holds ids, game, rematch flag, player count and time only; `beta:report` reads with a read-only user, prints counts (never names) and redacts the connection string from errors | `beta-report.test.ts`, `game-starts.test.ts`                  |
| Misconfiguration                   | Env validated with Zod; production refuses to boot with dev login, weak or missing `JWT_SECRET`, no `BOT_TOKEN`/`MONGODB_URI`, or non-https / wildcard CORS                                   | `env.test.ts`, manual boot check                              |
| Browser attacks                    | helmet headers, exact-origin CORS (HTTP + Socket.IO), 16 KB body limit                                                                                                                        | `api.test.ts`                                                 |
| Client secrets                     | Only `VITE_API_URL`, `VITE_BOT_USERNAME`, `VITE_DEV_LOGIN` reach the bundle; bot token, JWT secret and Mongo URI exist only on the server                                                     | —                                                             |

## Development login

`POST /api/auth/dev` exists only when `DEV_LOGIN_ENABLED=true` **and** `NODE_ENV` is not
production. Production boot fails if the flag is set. Dev users have negative `telegramId`s, so
they can never collide with real accounts. The web app shows dev login only when built with
`VITE_DEV_LOGIN=true`; never set that in Vercel.

## Defuser flags (dev/test, and staging)

`DEFUSER_ENABLED` registers the Defuser server plug-in and `DEFUSER_FIXED_SEED` makes every game
predictable. On the live service (`NODE_ENV=production`, `DEPLOY_ENV` unset or `production`) boot
fails if either is set, and the game registry refuses to build with either, so neither can be
switched on by a code path that skips the config.

The one exception is a **staging** deployment (`DEPLOY_ENV=staging`) for Telegram QA: it keeps
`NODE_ENV=production` and every production check, allows `DEFUSER_ENABLED` only, still refuses
`DEFUSER_FIXED_SEED` and dev login, refuses `DEPLOY_ENV=staging` outside `NODE_ENV=production`,
and refuses to boot unless `MONGODB_DB_NAME` names a staging database. It must use its own bot,
database user and JWT secret ([deployment.md](deployment.md#staging-optional-telegram-qa-of-unreleased-games)).

The seed is never echoed in an error and never logged; the startup warning does not include it.
Defuser state, the Charge, the Codebook and the solution are built into per-role views only (see
[defuser.md](defuser.md)); the match document keeps the seed in a `select: false` field that no
API returns.

## Known limitations

- JWTs cannot be revoked before expiry (7 days); rotate `JWT_SECRET` to log everyone out.
- Rate limits are per process (fine with one instance; move them to Redis when scaling).
- No CSP header on the Mini App yet (`telegram.org` script + API origin would need allow-listing).
