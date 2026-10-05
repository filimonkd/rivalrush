# Telegram

> **Documentation check.** `core.telegram.org` was not reachable from the build environment
> (egress policy), so the official pages could not be re-read during implementation. The
> launch-data algorithm was cross-checked against the maintained `@telegram-apps/init-data-node`
> validator (v2.0.10) and the WebApp API against `@types/telegram-web-app` (v10.1.0), and it
> matches the spec's description (checked 2 Oct 2026). **Re-verify against
> https://core.telegram.org/bots/webapps before going live.**

## Sign-in (initData)

1. The Mini App sends the raw `Telegram.WebApp.initData` string to `POST /api/auth/telegram`.
   `initDataUnsafe` is used only for UI routing hints, never for identity.
2. The server (`apps/server/src/auth/telegramAuth.ts`):
   - parses the query string and rejects duplicated keys
   - `data_check_string` = every field except `hash`, as `key=value`, sorted by key, joined
     with `\n` (`signature` stays in, as Telegram specifies)
   - `secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)`;
     `hash = hex(HMAC_SHA256(key=secret_key, msg=data_check_string))`
   - compares with `timingSafeEqual`
   - rejects `auth_date` older than `AUTH_MAX_AGE_SECONDS` (1 h) or more than 60 s in the
     future
   - parses and type-checks `user`, upserts the user by `telegramId`, and issues a 7-day
     HS256 JWT
3. Replay: captured launch data is only useful for at most 1 hour and only signs in as the
   same Telegram user. Legitimate reloads re-send the same initData, so hashes are not
   single-use.

## Deep links and invites

- Invite link: `https://t.me/<bot_username>?startapp=room_<inviteToken>`. This is the Main Mini
  App direct link and requires the Main Mini App to be enabled in BotFather. `startapp` allows
  `A-Za-z0-9_-`, up to 512 chars; tokens are 16 base64url chars (96 random bits).
- Telegram delivers it as `start_param` inside the signed initData. The server returns it as
  `inviteToken`, and the app routes to `/join/<token>`.
- Fallback: `/start room_<token>` sent to the bot replies with a **Join game** `web_app`
  button opening `<WEBAPP_URL>/join/<token>`.
- Sharing: in Telegram, **Send invite** opens `https://t.me/share/url?url=…&text=…` via
  `openTelegramLink`. Outside Telegram it uses `navigator.share` or copies to the clipboard.
  Rich invite cards (`savePreparedInlineMessage` + `shareMessage`) are post-MVP.

## WebApp features used (version-guarded)

| Feature                                                                 | Min version | Where                                                                       |
| ----------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------- |
| `ready()`, `expand()`                                                   | —           | boot                                                                        |
| `disableVerticalSwipes()`                                               | 7.7         | boot (prevents swipe-to-close during play)                                  |
| `setHeaderColor/BackgroundColor('bg_color')`                            | 6.1         | boot                                                                        |
| Theme params → CSS vars (`--tg-theme-*`)                                | —           | `index.css` tokens with fallbacks; `themeChanged` updates `color-scheme`    |
| Safe areas (`--tg-safe-area-inset-*`, `--tg-content-safe-area-inset-*`) | 8.0         | `Screen` padding, with `env(safe-area-inset-*)` fallback                    |
| `BackButton`                                                            | 6.1         | sub-pages → Home (rooms stay resumable)                                     |
| `HapticFeedback` (impact / selection / notification)                    | 6.1         | keypad, accepted guesses, invalid input, turn start, results, joins         |
| `showConfirm`                                                           | 6.2         | leave / give up                                                             |
| `activated` event                                                       | 8.0         | reconnect/resync on return to foreground                                    |
| `MainButton`                                                            | —           | **not used**: in-page buttons are clearer and testable; documented decision |
| Fullscreen                                                              | —           | not used; `expand()` is enough for the MVP                                  |

## Bot (`apps/server/src/bot/bot.ts`)

`BOT_MODE` selects how updates arrive:

- **`webhook`** (production on Render Free): on boot the server calls `setWebhook` with
  `<PUBLIC_URL or RENDER_EXTERNAL_URL>/telegram/webhook`, `allowed_updates: ["message"]` and a
  `secret_token` derived from the bot token (HMAC, hex). Requests without the matching
  `X-Telegram-Bot-Api-Secret-Token` header get 401. The endpoint answers 200 at once and
  replies afterwards. Because Telegram makes an inbound request, this also wakes a sleeping
  free instance; Telegram retries until it gets an answer.
- **`polling`** (local development, no public URL): `deleteWebhook` → `getUpdates` loop with
  backoff. Starting it with the production token would remove the production webhook, so use
  the dev bot.
- **`off`** (default).

Both modes then call `setMyCommands` (`/start`, `/help`) and `setChatMenuButton` (web_app
"Play"). The token is never logged (errors exclude the URL).

## BotFather setup

Use **two bots**: a development bot pointing at your tunnel URL, and the production bot
pointing at the Vercel domain. Never mix their tokens.

1. `/newbot` → name "RivalRush", username e.g. `RivalRushBot`. Save the token to Render's
   `BOT_TOKEN` (production) or `apps/server/.env` (dev bot).
2. Bot Settings → **Configure Mini App** → enable, set the URL to the HTTPS web app URL. This
   makes it the **Main Mini App** and enables `t.me/<bot>?startapp=` links.
3. Bot Settings → Menu Button → "Play" + the same URL (the server also sets this on boot).
4. Optional: loading-screen icon and colors; bot description and about text.
5. Set `VITE_BOT_USERNAME` (Vercel) and `BOT_USERNAME` (Render) to the username without `@`.
