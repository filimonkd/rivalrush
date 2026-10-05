# State machines

## Room (`apps/server/src/rooms/roomManager.ts`)

```
            join / ready toggles
   LOBBY ◀──────────────────────▶ READY
     ▲                              │ host: room:start
     │ a player leaves              ▼
     └──────────── FINISHED ◀──── IN_GAME
                     │  ▲   game result
         both vote   │  │
         rematch     ▼  │
                   IN_GAME (new session)

 any non-terminal ──last player leaves──▶ CLOSED
 LOBBY/READY/FINISHED ──TTL (2 h idle)──▶ EXPIRED
```

| Transition         | Who                           | Conditions                                                              | Side effects                                                                              |
| ------------------ | ----------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| create → LOBBY     | any user                      | user not in a live game (an idle lobby they hold is left automatically) | opaque invite token; host seat is always ready                                            |
| LOBBY → (join)     | invite holder                 | room not full/expired/closed/in game                                    | seat added (`player_joined`); metadata persisted                                          |
| LOBBY ⇄ READY      | guest (`room:ready`)          | READY = seats ≥ minPlayers and everyone ready                           | `player_ready`                                                                            |
| READY → IN_GAME    | **host only**                 | status READY                                                            | new `sessionId`; first player random (or swapped); offline players get a grace deadline   |
| IN_GAME → FINISHED | server                        | `getResult` non-null                                                    | match recorded (transaction); next first player = the other one                           |
| FINISHED → IN_GAME | both players (`room:rematch`) | both voted, both still seated                                           | new session, `isRematch`, swapped start                                                   |
| any → LOBBY        | a player leaves               | —                                                                       | mid-game leave = forfeit first; host hand-off to the remaining player; invite stays valid |
| → CLOSED           | last player leaves            | —                                                                       | tombstone kept 30 min so old invites explain themselves                                   |
| → EXPIRED          | server timer                  | not IN_GAME and past `expiresAt` (refreshed by activity)                | members get `room:closed {reason: expired}`                                               |

During a game nothing depends on the host.

## Crack the Code (`apps/server/src/games/crack-the-code/game.ts`)

```
 (room LOBBY: no game state exists yet)
 SETUP ──both secrets / setup deadline (auto-generate missing)──▶ PLAYING
 PLAYING ──first player cracks──▶ LAST_CHANCE ──second player's turn──▶ FINISHED
 PLAYING ──second player cracks / both out of turns──▶ FINISHED
 SETUP|PLAYING|LAST_CHANCE ──FORFEIT──▶ FINISHED     ──$ABANDON (grace expired)──▶ ABANDONED
```

`LOBBY` from the spec is represented by the room's LOBBY/READY states: the game state is
created only when the host starts.

## Deterministic races

| Race                                                           | Result                                                                                          |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Guess arrives at the exact turn deadline (timer not yet fired) | Due timeout applied first (version bumps) → guess rejected `STALE_GAME_VERSION`; client resyncs |
| Guess 1 ms before the deadline                                 | Accepted                                                                                        |
| `SET_SECRET` at the setup deadline                             | Server-generated secret wins → `GAME_ALREADY_STARTED`                                           |
| Two simultaneous guesses                                       | Serialized by the room lock: exactly one applied                                                |
| Same action sent twice (same `actionId`)                       | Applied once; the duplicate gets the current snapshot                                           |
| Two rematch votes from one player at once                      | One vote; with both voted, exactly one new session                                              |
| Reconnect exactly at the grace deadline                        | Expiry wins → `abandoned`                                                                       |
| Disconnect while the game is ending                            | Game result stands; no grace timer starts on a finished game                                    |
| Two users join the last seat at once                           | One joins, the other gets `ROOM_FULL`                                                           |
| Host leaves while someone joins                                | Join first → joiner hosts an open lobby; leave first → room closes, joiner gets `ROOM_CLOSED`   |
| Reconnect exactly at a turn deadline                           | Timeout applied first, then the player is online with the updated board                         |
| Turn deadline and reconnect grace due at the same instant      | Game deadline first (it may end the game; then the grace expiry is moot)                        |
| Rematch vote racing the opponent leaving                       | Never a one-player game: either the rematch starts and the leave forfeits it, or the vote fails |

Every case above has a test in `apps/server/test/unit/` (`races.test.ts`, `rematch.test.ts`,
`timers.test.ts`, `room-manager.test.ts`). The full numbered list with outcomes is in
[testing.md](testing.md#race-conditions-and-their-deterministic-outcomes).

## Versions

- `room.version` increases on every accepted change (room or game).
- `game.version` (inside the game state) increases on every accepted game change.
- `game:action` must carry `clientVersion === game.version`, except for
  version-independent actions (`SET_SECRET`, `FORFEIT`). Otherwise the server replies
  `STALE_GAME_VERSION` together with the current snapshot.
