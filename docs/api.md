# REST API

Base path `/api`. JSON in, JSON out, 16 KB body limit. Everything except `POST /auth/*` and
the health checks needs `Authorization: Bearer <session token>`. The user is **always** taken
from the token; ids in bodies or queries are never trusted.

Errors use one shape with a stable code (see `packages/shared/src/errors.ts`):

```json
{ "error": { "code": "NOT_YOUR_TURN", "message": "It's not your turn.", "details": {} } }
```

| Method | Path                                     | Auth     | Description                                                                                                                                                                                 |
| ------ | ---------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`, `/api/health`                 | —        | `{status, uptimeSeconds, version, database}`; 503 when the DB is down                                                                                                                       |
| POST   | `/api/auth/telegram`                     | —        | Body `{initData}` (raw string). Validates it, upserts the user, returns `{token, expiresAt, user, inviteToken}`. `inviteToken` comes from a signed `start_param` of the form `room_<token>` |
| POST   | `/api/auth/dev`                          | —        | **Development only** (route absent unless `DEV_LOGIN_ENABLED=true` outside production). Body `{name}`                                                                                       |
| GET    | `/api/me`                                | ✓        | Current user (`PublicUser`)                                                                                                                                                                 |
| GET    | `/api/me/stats`                          | ✓        | `{stats, winRate}`                                                                                                                                                                          |
| GET    | `/api/me/active-room`                    | ✓        | `{room: RoomSnapshot \| null}`: the room to resume on launch                                                                                                                                |
| GET    | `/api/me/matches?limit=`                 | ✓        | `{matches: MatchSummary[]}` (1–50, default 20)                                                                                                                                              |
| GET    | `/api/profile/:userId`                   | ✓        | `{user, winRate, recentMatches}` (last 10)                                                                                                                                                  |
| GET    | `/api/games`                             | ✓        | `{games}`: live and coming-soon catalog                                                                                                                                                     |
| POST   | `/api/rooms`                             | ✓        | Body `{gameType, settings?}` → 201 `RoomSnapshot`                                                                                                                                           |
| GET    | `/api/rooms/invite/:inviteToken`         | ✓        | `InvitePreview` (host name, settings, joinable + reason). Old rooms → `ROOM_CLOSED` / `ROOM_EXPIRED`, unknown → `ROOM_NOT_FOUND`                                                            |
| POST   | `/api/rooms/join`                        | ✓        | Body `{inviteToken}` → `RoomSnapshot` (idempotent for members)                                                                                                                              |
| GET    | `/api/rooms/:roomId`                     | ✓ member | `RoomSnapshot` for the caller                                                                                                                                                               |
| GET    | `/api/rooms/:roomId/state?knownVersion=` | ✓ member | `{changed:false, version}` or `{changed:true, room}`                                                                                                                                        |
| POST   | `/api/rooms/:roomId/leave`               | ✓        | `{left:true}`. Idempotent; mid-game = forfeit                                                                                                                                               |
| POST   | `/api/rooms/:roomId/start`               | ✓ host   | Body `{actionId?}` → `RoomSnapshot`                                                                                                                                                         |

Rate limits: 300 requests/min per IP on `/api`, 30/min on `/api/auth`.

## Status codes

`400` validation / invalid move · `401` auth · `403` not a member / not host · `404` not found ·
`409` conflicting state (full, started, not your turn, stale, duplicate) · `410` expired or
closed room · `413` body too large · `429` rate limited · `500` internal (no details leaked).
