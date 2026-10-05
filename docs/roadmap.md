# Roadmap

**Next: run the closed beta, not new features.** 15–20 testers in two Telegram groups for a
week. Watch room abandonment, failed invites, reconnect failures, completion and rematch rate,
and whether people want to play again. Use [product.md](product.md) for metric definitions.
The first numbers are baselines, not pass/fail.

Launch gate suggested by the plan: 50+ finished matches, no open blocking bugs, rematch rate

> 40%.

## After the beta (default order; metrics decide)

| Feature                                      | Where it plugs in                                                                                              | Effort |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------ |
| Rich invite card                             | Bot `savePreparedInlineMessage` + `WebApp.shareMessage` in the lobby                                           | S      |
| 3-screen how-to-play, branded loading screen | Web + BotFather                                                                                                | S      |
| Global and per-group leaderboards            | `users.stats.wins` index exists; group boards from the signed `chat_instance`                                  | S      |
| **Color Cipher** (original color-code duel)  | New `GameDefinition` + board component; rooms, sockets and stats unchanged                                     | M      |
| **Defuser** (asymmetric 2–4 players)         | Per-role `getPlayerView`; `maxPlayers > 2` already supported by rooms                                          | L      |
| Team games                                   | `teamId` per seat; results gain a winner list                                                                  | M      |
| Matchmaking                                  | A per-game queue that pairs players and calls `RoomManager.createRoom`                                         | M      |
| Tournaments                                  | Tournament model + bracket service creating rooms; results from the match recorder                             | L      |
| Telegram Stars                               | Cosmetic themes / entry fees via `openInvoice` (XTR)                                                           | M      |
| Spectators                                   | `getPublicView` already exists and has no secrets; add a spectator seat type                                   | M      |
| Redis + horizontal scaling                   | `RedisRoomStore`, Socket.IO Redis adapter, timers → job queue, Redis rate limits and room locks, bot → webhook | M      |

Not implemented now, by design.
