# Roadmap

**Next: run the closed beta, not new features** ([beta-plan.md](beta-plan.md), 12–18 Oct 2026). 15–20 testers in two Telegram groups for a
week. Watch room abandonment, failed invites, reconnect failures, completion and rematch rate,
and whether people want to play again. Metric definitions and queries: [beta-plan.md](beta-plan.md#metrics).
The first numbers are baselines, not pass/fail.

Launch gate suggested by the plan: 50+ finished matches, no open blocking bugs, and a
rematch rate above 40%.

## Built

| Feature                                        | Status                                                                                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Color Cipher** (original color-pattern duel) | Released (`a5d0781`) and verified in production on two phones, 5 Oct 2026 ([color-cipher.md](color-cipher.md#release)) |

## After the beta (default order; metrics decide)

| Feature                                      | Where it plugs in                                                                                                                                     | Effort |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Rich invite card                             | Bot `savePreparedInlineMessage` + `WebApp.shareMessage` in the lobby                                                                                  | S      |
| 3-screen how-to-play, branded loading screen | Web + BotFather                                                                                                                                       | S      |
| Global and per-group leaderboards            | `users.stats.wins` index exists; group boards from the signed `chat_instance`                                                                         | S      |
| **Defuser** (cooperative 2–4 players)        | Design and feasibility done ([defuser.md](defuser.md)): 4 additive platform changes + a co-op stats decision; build only if the beta shows group play | L      |
| Team games                                   | `teamId` per seat; results gain a winner list                                                                                                         | M      |
| Matchmaking                                  | A per-game queue that pairs players and calls `RoomManager.createRoom`                                                                                | M      |
| Tournaments                                  | Tournament model + bracket service creating rooms; results from the match recorder                                                                    | L      |
| Telegram Stars                               | Cosmetic themes / entry fees via `openInvoice` (XTR)                                                                                                  | M      |
| Spectators                                   | `getPublicView` already exists and has no secrets; add a spectator seat type                                                                          | M      |
| Redis + horizontal scaling                   | `RedisRoomStore`, Socket.IO Redis adapter, timers → job queue, Redis rate limits and room locks, bot → webhook                                        | M      |

Not implemented now, by design.
