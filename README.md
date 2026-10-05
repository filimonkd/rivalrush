# RivalRush

**Quick games. Real rivals.** A Telegram Mini App for quick multiplayer games. The first game
is **Crack the Code**, a 1-vs-1 deduction duel: hide a code, crack your rival's first.

```
Telegram → Bot → Mini App → automatic sign-in → Start a duel → invite a friend → lobby →
ready → start → hide your code → take turns (bulls & cows, timer) → win / lose / draw →
rematch → stats
```

## Status

| Area                                                              | Status                                                                                                                  |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Game engine + Crack the Code rules                                | Implemented, tested                                                                                                     |
| Server: Telegram auth, rooms, Socket.IO, timers, reconnect, stats | Implemented, tested (unit + integration on a real MongoDB replica set)                                                  |
| Web Mini App (all MVP screens)                                    | Implemented, tested (two-browser Playwright E2E with dev login)                                                         |
| CI (GitHub Actions)                                               | Configured                                                                                                              |
| Vercel / Render / MongoDB Atlas / BotFather                       | **Configured in repo, not yet deployed**: needs your accounts and secrets, see [docs/deployment.md](docs/deployment.md) |
| Inside real Telegram on phones                                    | **Not yet verified**: see the manual QA plan in [docs/testing.md](docs/testing.md)                                      |

Full status, verified claims and known gaps: [docs/status.md](docs/status.md).

## Repository layout

```
apps/
  server/   Node + Express + Socket.IO + Mongoose game server (and the Telegram bot)
  web/      React + Vite + Tailwind + Zustand Telegram Mini App
packages/
  shared/   Error codes, DTOs, socket events, Crack the Code schemas (used by both)
docs/       Architecture, rules, protocols, security, testing, deployment, roadmap
.github/workflows/ci.yml   Lint, typecheck, tests, build, E2E
render.yaml                Render blueprint (API)
apps/web/vercel.json       Vercel config (Mini App)
```

## Quick start

```bash
npm ci
cp .env.example apps/server/.env        # dev defaults; in-memory MongoDB if MONGODB_URI is empty
cp apps/web/.env.example apps/web/.env.local
npm run dev                             # server :4000, web :5173
```

Open `http://localhost:5173/?dev=Alice` and `http://localhost:5173/?dev=Bob` in two browser
profiles to play against yourself. Testing inside Telegram needs an HTTPS tunnel:
[docs/local-development.md](docs/local-development.md).

| Script                                                        | What it does                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `npm run dev`                                                 | Shared (watch) + server (tsx watch) + web (Vite)                         |
| `npm run build`                                               | Build shared, server and web                                             |
| `npm test`                                                    | Unit + integration tests in every workspace                              |
| `npm run test:e2e`                                            | Two-browser Playwright match (needs `npm run build` of the server first) |
| `npm run lint` / `npm run typecheck` / `npm run format:check` | Static checks (CI gates)                                                 |
| `npm run verify`                                              | Everything CI's first job runs                                           |
| `npm run clean`                                               | Remove build output                                                      |

## Documentation

[Architecture](docs/architecture.md) · [Product](docs/product.md) ·
[Game rules](docs/game-rules.md) · [State machines](docs/state-machine.md) ·
[REST API](docs/api.md) · [WebSocket protocol](docs/websocket.md) ·
[Telegram](docs/telegram.md) · [Security](docs/security.md) · [Testing & QA](docs/testing.md) ·
[Local development](docs/local-development.md) · [CI/CD](docs/ci-cd.md) ·
[Deployment & operations](docs/deployment.md) · [Roadmap](docs/roadmap.md) ·
[Status](docs/status.md)
