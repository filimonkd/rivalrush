# Defuser: design and feasibility (not built)

**Status: design only.** Nothing here is implemented. Building it waits on the closed-beta
decision (19–20 Oct 2026, [beta-plan.md](beta-plan.md#what-happens-after-the-beta)).

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
