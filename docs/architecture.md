# Architecture

## Overview

```
Telegram client (iOS / Android / Desktop / Web)
 └── RivalRush Mini App (apps/web, Vercel)
       │  HTTPS REST  (sign-in, create/join, profile)
       │  Socket.IO   (everything while in a room)
       ▼
Game server (apps/server, Render Free, ONE instance kept awake by a pinger)
 ├── auth/        Telegram initData validation → JWT session
 ├── users/       User model + service (identity, stats, profile)
 ├── rooms/       RoomManager · RoomStore (InMemoryRoomStore) · KeyedLock · TimerRegistry ·
 │                roomViews (per-player snapshots) · Room metadata repository
 ├── games/       GameDefinition contract · GameRegistry · crack-the-code (pure rules)
 ├── matches/     Match model · transactional, idempotent recorder
 ├── websocket/   Authenticated Socket.IO gateway, throttling, presence
 ├── http/        Express app, routes, middleware (helmet, CORS, limits, errors)
 └── bot/         Telegram bot (webhook in production, polling in dev): /start, /help, menu button
       ▼
MongoDB Atlas: users · matches · rooms (metadata only)
```

`packages/shared` holds what both sides must agree on: stable error codes, REST DTOs,
Socket.IO event names and payload schemas, Crack the Code settings/action schemas and views.

## Principles

- **Server-authoritative.** The phone sends intents (`GUESS 1234`); the server validates,
  scores and decides. Identity comes only from the server-issued JWT, never from payloads.
- **Pure game plug-ins.** `apps/server/src/games/**` cannot import Express, Socket.IO,
  Mongoose, or any infrastructure module. This is enforced by an ESLint rule. A game is
  `createInitialState / applyAction / getPlayerView / getPublicView / getResult /
getNextDeadline`. `applyAction` validates as it applies; `getResult` returns `null`
  while running.
- **Snapshot is truth, events are feedback.** Every change produces a per-player
  `room:snapshot` with a monotonically increasing `version`; `room:event`s only drive
  toasts and haptics. A client that misses events is corrected by the next snapshot or a
  `game:resync`.
- **Live state in memory, history in MongoDB.** The `RoomStore` (in-memory for the MVP) is
  the live authority. MongoDB stores users, finished matches and room metadata. Secret
  codes are never written to the database.

## Request flow: a guess

1. The client emits `game:action {roomId, actionId, clientVersion, action: {type: 'GUESS'}}`.
2. Gateway: the JWT from the handshake identifies the user, then a token-bucket throttle
   (5/s, burst 12) and Zod payload validation run.
3. `RoomManager.gameAction` runs inside the room's `KeyedLock`:
   1. load the room, check membership
   2. duplicate `actionId` → return the current snapshot without re-applying
   3. **apply every deadline that is already due**, so timers win ties
   4. reject `STALE_GAME_VERSION` unless the action type is version-independent
   5. `game.applyAction` validates turn, phase, input and duplicates, scores, and returns new state + events
   6. bump `room.version`; if `getResult` is non-null, finish the game and queue the match record
   7. save to the RoomStore and reschedule timers
4. Hooks fan out a separate snapshot to each player (their own secret only), record the match
   (transaction), and persist room metadata (best effort).

## Concurrency and ordering

All mutations of a room (player actions, presence, timers) are serialized through a per-room
promise queue. Every mutation first applies due deadlines in time order (game deadline before
grace expiry on a tie). Two simultaneous guesses therefore resolve deterministically: one is
applied, and the other fails with `NOT_YOUR_TURN` or `STALE_GAME_VERSION`. A guess arriving at
or after the turn deadline loses to the timeout.

## Scaling path (not built)

`RoomStore` is async and stores plain serializable data, so a `RedisRoomStore` can replace the
in-memory store. With it come the Socket.IO Redis adapter and moving `TimerRegistry` to a job
queue (e.g. BullMQ). The per-room lock would become a Redis lock. Until then: **exactly one
server instance**, and a restart ends live games (see [deployment.md](deployment.md)).
