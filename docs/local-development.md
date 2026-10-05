# Local development

Requirements: Node 22 (`.node-version`), npm 10. No database setup is needed: in development
the server starts an in-memory MongoDB replica set when `MONGODB_URI` is empty (data is lost
on restart).

```bash
npm ci
cp .env.example apps/server/.env
cp apps/web/.env.example apps/web/.env.local
npm run dev            # shared watch + server :4000 + web :5173
```

## Play in two browsers (no Telegram)

`DEV_LOGIN_ENABLED=true` (server) and `VITE_DEV_LOGIN=true` (web) enable a development
sign-in. Open two isolated browser sessions (e.g. a normal and a private window, since the dev
name is kept per tab):

- `http://localhost:5173/?dev=Alice`
- `http://localhost:5173/?dev=Bob`

Create a room as Alice, copy the invite link (it is `http://localhost:5173/join/<token>` when
no bot username is set) and open it as Bob.

## Inside Telegram (development bot)

Telegram only opens HTTPS URLs. Expose both ports with a tunnel:

```bash
cloudflared tunnel --url http://localhost:5173   # → https://<web>.trycloudflare.com
cloudflared tunnel --url http://localhost:4000   # → https://<api>.trycloudflare.com
# (or: ngrok http 5173 / ngrok http 4000)
```

Then:

- `apps/web/.env.local`: `VITE_API_URL=https://<api>…`, `VITE_BOT_USERNAME=<dev bot>`,
  `VITE_DEV_LOGIN=false`; restart `npm run dev`
- `apps/server/.env`: `BOT_TOKEN=<dev bot token>`, `BOT_USERNAME=<dev bot>`,
  `WEBAPP_URL=https://<web>…`, `CLIENT_ORIGINS=https://<web>…`, `BOT_MODE=polling`
- BotFather (dev bot) → Configure Mini App → URL `https://<web>…`

Use a separate **development bot**. Never use the production token locally.

## Useful commands

| Command                                                  | Purpose                                                                                             |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `npm run verify`                                         | Lint, format check, typecheck, tests, build (same as CI job 1)                                      |
| `npm run test -w @rivalrush/server`                      | Server tests only                                                                                   |
| `npm run build -w @rivalrush/server && npm run test:e2e` | Two-browser E2E (Playwright). Use `PW_CHROMIUM_PATH=/path/to/chrome` to use a preinstalled Chromium |
| `npm run format`                                         | Prettier write                                                                                      |

If the MongoDB binary download is blocked on your network, set
`MONGOMS_SYSTEM_BINARY=/path/to/mongod` (MongoDB 8.0) or `MONGODB_TEST_URI` for tests.
