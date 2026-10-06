# Defuser

**Status: BACKEND INTEGRATED, dev/test only. Not playable by users.** The server-side game
(state machine, drop-out procedure, per-role views) is registered in the server's game
registry, but only when `DEFUSER_ENABLED=true`, which the server refuses in production. There is
no UI, no Home card and no production availability: the catalog lists Defuser as `coming_soon`,
and without the flag creating a Defuser room fails with `GAME_NOT_AVAILABLE`. Production QA and
Telegram multi-phone QA have **not** been done. Starting this engineering work is not a product
decision: the build/no-build gate in the specification (closed beta, decision 19–20 Oct) is
unchanged.

The authoritative game design is the _Defuser — Game Design Specification_ (Claude Doc, with
its consistency audits and correction log). This file records what is built in the repository.
Everything below **Implementation status** is the original feasibility draft (kept for history);
where it disagrees with the specification, the specification wins.

## Implementation status

| Area                                                                                                                                            | State                                                                                               | Where                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Co-op result model (`CoopResult`: outcome, reason, panelsSolved, faults, msRemaining, individual)                                               | Implemented, tested                                                                                 | `packages/shared/src/games.ts`                                                      |
| Defuser shared contract (id, settings, sheet catalogue, rule data, Charge, actions, moves, view types)                                          | Implemented (types only; no view is built yet)                                                      | `packages/shared/src/defuser.ts`                                                    |
| Sheet renderer (rule data → deterministic sheet text)                                                                                           | Implemented, tested                                                                                 | `packages/shared/src/defuserSheets.ts`                                              |
| Starting-player rotation for 2–4 players                                                                                                        | Implemented, tested (2-player swap unchanged)                                                       | `apps/server/src/rooms/rotation.ts`                                                 |
| Player names snapshotted at game start; co-op player records and server-only generator info passed to match recording                           | Implemented, tested                                                                                 | `rooms/roomManager.ts`, `matches/matchService.ts`                                   |
| `stats.coop {played, wins, losses, dropped}`; co-op never touches competitive stats                                                             | Implemented; unit-tested here, integration-tested in CI                                             | `matches/matchService.ts`, `users/*`                                                |
| History: teammates, roles, co-op summary; seed stored `select: false`, never in any API                                                         | Implemented; integration-tested in CI                                                               | `matches/Match.model.ts`, `users/userService.ts`                                    |
| Deterministic PRNG (xoshiro128**, 128-bit seed from 3 × 47 platform random bits)                                                                | Implemented, tested                                                                                 | `apps/server/src/games/defuser/prng.ts`                                             |
| Fuse Lines, Glyph Ledger, Coolant Valve: generator, solver, constraints, safe template                                                          | Implemented, tested                                                                                 | `apps/server/src/games/defuser/{fuse,glyph,valve}.ts`                               |
| Edition pipeline (retry up to 200, safe template, sheet limits, sheet assignment)                                                               | Implemented, tested                                                                                 | `apps/server/src/games/defuser/edition.ts`                                          |
| `GameDefinition`: state machine, actions, validation order, views, drop-out procedure, rejoin, timers                                           | Implemented, tested (unit, room-level with a fake clock, 3-client Socket.IO; Mongo recording in CI) | `apps/server/src/games/defuser/{game,state,transitions,dropout,views}.ts`           |
| Room and Socket.IO integration: `DefuserPlayerView` in snapshots, 5 new room events                                                             | Implemented and tested over real sockets and REST with the registered plug-in (dev/test)            | `packages/shared/src/rooms.ts`, `rooms/roomManager.ts`, `websocket/socketServer.ts` |
| Operator console, Analyst Codebook, debrief, result UI                                                                                          | **Not implemented**                                                                                 | —                                                                                   |
| Registry: `createGameRegistry`, `DEFUSER_ENABLED` (dev/test only), never advertised (catalog stays `coming_soon`)                               | Implemented, tested                                                                                 | `games/registry.ts`, `config/env.ts`, `server.ts`                                   |
| `DEFUSER_FIXED_SEED`: same seed, same edition; refused in production by config and by the registry                                              | Implemented, tested                                                                                 | `config/env.ts`, `games/registry.ts`                                                |
| Backend test harness (real `buildServer`, real sockets and REST, fixed seed, controllable server clock) and the serialized-payload leak scanner | Implemented                                                                                         | `test/helpers/defuserHarness.ts`, `test/helpers/leak.ts`                            |
| Playwright E2E with `DEFUSER_FIXED_SEED` in the Playwright env                                                                                  | **Not implemented**                                                                                 | —                                                                                   |
| Production activation, production QA, Telegram multi-phone QA                                                                                   | **Not done**                                                                                        | —                                                                                   |

### Generator verification

| Suite                                                                                                                                                                                                                                                                                                                                                                                 | Seeds / samples                              | Runs                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------- |
| `defuser-generator.test.ts`: G1 (one answer, by an independent oracle), G2 (Charge + sheets give the answer), G3 (wording reads back to the rule data), G4 (each sheet genuinely changes the answer), G5 (assignment), G6 (team sizes), ranges, ties, distribution targets, Valve independence (chi-square)                                                                           | 5,000 seeds                                  | every `npm test`                                                             |
| same, full                                                                                                                                                                                                                                                                                                                                                                            | 100,000 seeds                                | `npm run test:defuser:full -w @rivalrush/server`; CI job "Defuser generator" |
| `defuser-oracle.test.ts`: production solver vs a separately written oracle on arbitrary (also invalid) panels                                                                                                                                                                                                                                                                         | 20,000 per panel (200,000 in the full suite) | as above                                                                     |
| `defuser-golden.test.ts`: 20 fixed seeds reproduce identical editions                                                                                                                                                                                                                                                                                                                 | 20 seeds                                     | every `npm test`                                                             |
| `defuser-game` (creation, countdown, error precedence, every transition, events, +1 version), `defuser-dropout` (all 19 scenarios, rejoin, G6 over every drop-out sequence for 2–4 players), `defuser-views` (exact key lists per role, 2,000 editions; 10,000 in the full suite), `defuser-room` (RoomManager with a fake clock, rotation, races), `defuser-socket` (3 real clients) | 2,000 editions per PR                        | every `npm test`                                                             |
| `defuser-registry` (gating, production refusal, fixed seed, wiring), `defuser-backend` (lifecycle 2–4 players over real sockets, roles, rotation, promotion, redistribution, rejoin, Leave vs time-out, actions, timers to the millisecond), `defuser-backend-security` (serialized payloads of every role over every channel, scanner self-test)                                     | —                                            | every `npm test`                                                             |
| `test/integration/defuser-match.test.ts` (real MongoDB: REST room creation, a defuse and a detonation, stats, history, profile, stored seed)                                                                                                                                                                                                                                          | —                                            | CI (needs MongoDB)                                                           |
| `defuser-prng`, `defuser-panels`, `defuser-security`, `coop-platform`                                                                                                                                                                                                                                                                                                                 | —                                            | every `npm test`                                                             |

**Changing the generator:** any change to generated editions fails the golden test. If it is
intended, bump `GENERATOR_VERSION` in `edition.ts`, regenerate the fixture with
`UPDATE_DEFUSER_GOLDEN=1 npx vitest run test/unit/defuser-golden.test.ts` (in `apps/server`) and
explain why in the commit.

**Measured on the real generator** (5,000-seed suite, also asserted by the tests):

- No edition needed the safe template.
- Rules 2–5 each decide about 25% of Fuse panels.
- The Valve adjustment applies in about 60% of editions.
- Ignoring the Glyph adjustment changes the answer in about 64% of editions.
- The Valve answer is statistically independent of plate, lamp and gauge.

### Running Defuser locally (dev/test only)

```bash
DEFUSER_ENABLED=true                                   # registers the plug-in; refused in production
DEFUSER_FIXED_SEED=0123456789abcdef0123456789abcdef    # optional: every game uses this seed
```

Without `DEFUSER_FIXED_SEED` each game draws its own 128-bit seed from the platform's
CSPRNG-backed `random()`. With it, the whole edition (Charge, sheets, assignment, solution) is
reproducible; `generateEdition({ seed, analystCount })` gives the test the answers. There is still
no UI, so drive a game with the backend harness (`test/helpers/defuserHarness.ts`): it starts the
real server, opens real Socket.IO clients and calls the real REST routes.

### Backend integration decisions

- Registration is gated by `DEFUSER_ENABLED`, not by a catalog change: the catalog entry stays
  `coming_soon` whether or not the plug-in is registered, so nothing advertises it. Config and
  `createGameRegistry` both refuse the flag, and a fixed seed, in production.
- `buildServer` now builds the game lookup from config and passes it to RoomManager and
  `/api/games`. The duels are unchanged and always registered.
- The harness has no database: rooms are created through RoomManager, match recording is captured
  in memory, and the server clock is frozen and moved explicitly, so deadlines and the 60 s grace
  period are exact. It backs off on `RATE_LIMITED` like a real client; the production limiter is
  untouched. REST room creation, stats and history need MongoDB and are covered in
  `defuser-match.test.ts` (CI).
- The leak scanner reads serialized JSON (keys and values), not types, and is itself tested with
  planted leaks. A secret is matched as a quoted string, never a bare substring (a timestamp can
  contain a code's digits).

### Decisions made while building

Server plug-in phase:

- Every Defuser action is version-independent (there are no turns), so `STALE_GAME_VERSION` never
  applies. The platform still deduplicates by `actionId`.
- Refusals use `INVALID_ACTION` with `details.rule` (`not_operator`, `inactive`, `not_inactive`,
  `already_ready`, `line_cut`, `key_lit`, `panel_solved`, `already_tried`). Phase errors use
  `GAME_NOT_STARTED` and `GAME_ALREADY_STARTED`. A refused action changes nothing and bumps nothing.
- A late briefing timer still arms from the briefing deadline itself, so the countdown never
  starts late. A last solve at the detonation millisecond loses, because the platform applies
  `$TIMEOUT` before any action.
- Platform fix from spec section 14: when a grace expiry's `$ABANDON` is refused (the player had
  already timed out), RoomManager now marks the room dirty, so the cleared grace deadline is saved
  and cannot replay. The test fails without the fix.
- The Charge and sheet contents are absent from every view during BRIEFING. After the end every
  member gets the debrief view. Views are built field by field; tests pin the exact key list per role.
- Snapshots are built through `RoomManager.snapshotFor`, so the socket layer uses the same game
  lookup as everything else.
- `DEFUSER_FIXED_SEED` is parsed and refused in production, but nothing reads it yet: the plug-in
  is only constructed with a fixed seed in tests until the registration phase.
- Duel tests read snapshot views through a `duelView` helper, since a snapshot view may now be a
  Defuser view. No duel assertion changed.

Foundation phase:

- Duel types stay exactly as they were: `GameResult` is still the duel result. The co-op variant
  is `CoopResult`, and the platform uses the union `AnyGameResult`.
- `DefuserPlayerView` exists as a type, but joins the snapshot view union only with the plug-in
  (doing it now would only break type narrowing in duel tests, with nothing to gain).
- The co-op counter is `stats.coop.dropped`, not `left`: it counts time-outs and Leave, and the
  spec reserves "left" for tapping Leave.
- Co-op `turns` in history = accepted Operator inputs for the whole team.
- Fuse Lines: a Heat action counts as needing the Heat table only if its group has 2+ colors
  (otherwise Heat can't change the answer); the generator enforces it.
- Coolant Valve: if the gauge is in a range, only that range's change is redrawn, so the
  "adjustment applies" rate equals the ranges' coverage (about 60%).
- Procedure items may be up to 100 characters: the longest possible Ladder rule renders at 99.
- Glyph selector pairs exclude identical selectors and closest + equals, which always name one key.

---

# Original feasibility draft (6 Oct 2026, kept for history)

**Verdict:** Defuser fits the platform with **four small, additive platform changes** plus one
product decision about stats. Rooms, invites, presence, reconnect, timers, versions, per-player
views and match recording already handle 2–4 players. The real cost is the game UI (a device
screen and a manual screen for each module), which is roughly 3–4× the size of Color Cipher's
board. The biggest risk is product, not code: Defuser is **cooperative** and needs players to
**talk**, which is a different promise from "Quick games. Real rivals."

## Concept

A team of 2–4 players gets one live device with a countdown. Only the **Operator** sees the
device. The **Analysts** hold the manual, which only they can see. The Operator describes what
they see; the Analysts find the rule and say what to do. The team defuses the device or it
blows up together.

Players talk outside the app: sitting together, or in a Telegram call or voice chat. The Mini
App has no audio.

**Originality.** The asymmetric "one sees, others read the manual" genre is shared by several
games. Defuser uses its own name, a "vault console" look, its own modules and its own manual
text. No module copies another game's puzzle, layout, wording or art. Every manual is generated
per game, so it can't be memorised.

## Rules (MVP)

| Rule         | Behaviour                                                                                                                                           | Value            |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Players      | 1 Operator + 1–3 Analysts                                                                                                                           | 2–4              |
| Roles        | Random Operator for the first game; **the Operator role rotates** on every rematch                                                                  | —                |
| Device       | 3 modules, drawn from the module pool; each has exactly one correct solution under this game's manual                                               | 3                |
| Timer        | Server deadline; reaching it = explosion                                                                                                            | 4:00 (3:00–5:00) |
| Strikes      | A wrong action is a strike; the third strike = explosion                                                                                            | 3                |
| Win          | All modules solved before the deadline and before the third strike → **defused**                                                                    | —                |
| Manual       | Generated from the game's seed ("edition"). With 2+ Analysts, pages are split so each holds different modules                                       | —                |
| Leave / drop | Operator gone past the 60 s grace = the team loses (`abandoned`). An Analyst gone: play continues if another Analyst remains; otherwise `abandoned` | 60 s grace       |
| Rematch      | Everyone votes → new device, new manual edition, next Operator                                                                                      | —                |

## Modules (MVP pool)

All three are original. Each has a device side (what the Operator sees and touches) and a
manual side (what the Analysts read). Rule parameters change with every edition.

| Module            | Device (Operator)                                       | Manual (Analysts)                                                                                                         | Operator action     |
| ----------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **Fuse Lines**    | 3–6 colored lines, a serial code on the casing          | An ordered rule list ("if there are more red lines than blue and the serial ends in an even digit, cut the second line")  | Cut one line        |
| **Glyph Ledger**  | 4 glyphs, each with a small number                      | A table giving each glyph a value for this edition and a rule picking one (for example, the highest glyph value + number) | Press one glyph     |
| **Coolant Valve** | A gauge reading (0–99), a label color and a status lamp | A table mapping label color × lamp to a valve level 1–5, with exceptions by gauge range                                   | Set the valve level |

A fourth module (**Frequency Dial**: match a call sign to a frequency) is held back for later.

## State machine

```
BRIEFING (10 s: roles shown, manual opens) ──▶ ARMED ──all modules solved──▶ DEFUSED
                                                 ├──3rd strike / deadline──▶ EXPLODED
                                                 └──Operator abandons / no Analysts left──▶ ABANDONED
```

| Phase                        | Allowed                                                                                                 | Rejected                                                                                                                   | Timer              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| BRIEFING                     | nothing (read your screen)                                                                              | every action                                                                                                               | 10 s → ARMED       |
| ARMED                        | Operator: `CUT_LINE`, `PRESS_GLYPH`, `SET_VALVE` on unsolved modules. Anyone: `FORFEIT` (team gives up) | Analyst device actions → `INVALID_ACTION` ("Only the Operator can do that."); actions on solved modules → `INVALID_ACTION` | Explosion deadline |
| DEFUSED, EXPLODED, ABANDONED | nothing                                                                                                 | every action → `GAME_FINISHED`                                                                                             | none               |

Device actions are **version-independent** (like `SET_SECRET`): only the Operator acts, and fast
taps must not bounce as `STALE_GAME_VERSION`. A repeated `actionId` is applied once, as on the
rest of the platform.

## Views and secrecy

- `getPlayerView` for the **Operator**: device modules, solved flags, strikes, deadline, team
  list. **No manual.**
- For an **Analyst**: their manual pages, strikes, deadline, solved flags, team list. **No device
  state.**
- After the game, everyone sees both the device and the manual, so the team can see what went
  wrong.
- Match history stores actions with their result (correct/strike) and the edition seed, no
  personal data. Nothing secret remains after the game.

Players can still share screenshots with each other. In a cooperative game that only hurts the
team itself, so it isn't policed.

## Platform feasibility

What Defuser reuses unchanged: rooms with up to 4 seats (`maxPlayers` comes from the game),
invites (several people can tap one link in a group chat until the room is full), ready/start
with `minPlayers`, presence and 60 s grace per player, reconnect and resync, server deadlines,
per-player views, idempotent actions, room versions and the match recorder's transaction.

Changes needed. All are additive and keep Crack the Code and Color Cipher behaviour identical:

| #   | Where                                           | Today                                                       | Change                                                                                                                                         | Size |
| --- | ----------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | `GameResult` (`shared/games.ts`), `Match.model` | One `winnerId`; outcome `win` or `draw`                     | Add optional `winnerIds: string[]`. `outcomeFor` checks it first. Old records unchanged                                                        | S    |
| 2   | `RoomManager.finishGame`                        | Next first player = "the other one" (2 players only)        | Next = the following seat in order. Identical for 2 players                                                                                    | S    |
| 3   | `MatchSummary` + history UI                     | One `opponent`                                              | Add `teammates` / `players` list; history shows "with A, B" for co-op                                                                          | S    |
| 4   | `RoomEventType`                                 | Duel events only                                            | Add `module_solved`, `strike`, `defused`, `exploded`                                                                                           | S    |
| 5   | Stats (product decision)                        | W/L/D and streaks for every game                            | **Recommended:** co-op games don't touch competitive W/L/D or streaks; add a separate `coop: { played, defused }` counter shown on the profile | S–M  |
| 6   | Web shared pieces                               | `TopBar`, `ResultSheet` and invite copy assume one opponent | Defuser gets its own top bar and result sheet; invite text "invited you to defuse" via `lib/games.ts`                                          | M    |

Nothing in auth, Socket.IO, the room store, timers or reconnect needs to change.

## Estimate

| Work                                                                                                                       | Size                         |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Platform changes 1–5 with tests                                                                                            | 2–3 days                     |
| Rules plug-in: edition generator, 3 modules, solver check (every generated device has exactly one solution), state machine | 3–4 days                     |
| UI: briefing, Operator device (3 modules), Analyst manual (3 pages), result, lobby for 2–4                                 | 5–7 days                     |
| Tests: rules, solvability across thousands of seeds, role isolation, 3–4 player E2E                                        | 2–3 days                     |
| **Total**                                                                                                                  | **~2.5–3.5 weeks part-time** |

## Risks

1. **Brand fit.** Defuser is cooperative. RivalRush's promise is rivals. A group might love it,
   but it tests a different hypothesis than the two duels.
2. **Talking is required.** Without a voice channel the game doesn't work. Many Telegram users
   play in silence or apart. Expect lower completion than the duels.
3. **Group size.** It needs 2–4 people at once, which is harder to gather than one rival.
4. **Content cost.** Every new module needs both screens, manual text and a solvability check.
5. **Stats change.** If co-op results counted in W/L/D, they would distort competitive records.
   That's why item 5 recommends a separate counter.

## Build it only if the beta shows

- Testers play in **groups** (rooms in group chats, several friends active at the same time).
- Testers ask for **variety or group play**, not fixes, in the survey.
- Both duels are healthy: rematch around 40%, completion ≥ 80%, few abandons.

If the beta shows strong 1v1 play but little group play, a **competitive** third game is a better
fit for the brand than Defuser. It would reuse even more of the platform (no stats change and no
co-op result) and keep the "rivals" promise.
