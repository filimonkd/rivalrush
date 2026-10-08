# Product

**RivalRush: quick games, real rivals.** A Telegram Mini App where two friends go from a chat
message to a live duel in under 30 seconds, with no signup and no install.

- **Who it's for:** friend groups who already hang out in Telegram chats and want a 3–5 minute
  competitive game, then a rematch.
- **The one job of the MVP:** let one player challenge another from inside Telegram, play a
  fair, cheat-proof match in real time, survive disconnects, and want to play again.
- **Why Telegram:** the chat is the lobby. Sign-in is free (Telegram signs the launch data),
  invites are links in a chat, and the app opens inside the conversation.

## MVP scope

| In                                                                              | Not yet (why)                                        |
| ------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Crack the Code, 1v1 via invite link                                             | Other games (prove one first)                        |
| Automatic Telegram sign-in                                                      | Email/password (never)                               |
| Invite links, presence, reconnect, rematch, toasts, haptics                     | In-game chat (people talk in Telegram)               |
| W/L/D, win rate, streaks, recent games                                          | Leaderboards, achievements (need players)            |
| One server on Render Free (kept awake), Atlas M0, Vercel Hobby — all free tiers | Redis / multiple servers (past ~1,000 concurrent)    |
| —                                                                               | Matchmaking, tournaments, Telegram Stars, spectators |

Coming-soon games are shown as non-playable cards: **Color Cipher** and **Defuser**. Every
future game uses original names, art and rules.

## Success signals (hypotheses for the first playtest, not guarantees)

| Metric                       | Source                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| Invite → join                | `rooms.peakPlayers >= 2` ÷ rooms created                                                          |
| Match completion             | `matches.result.reason` ∈ {cracked, both_cracked, out_of_guesses} ÷ games started (`game_starts`) |
| Abandon rate                 | `reason = abandoned` ÷ started                                                                    |
| Rematch rate                 | `matches.isRematch` ÷ finished                                                                    |
| Games per player / D7 return | `matches.players.userId`, `users.createdAt`                                                       |
| Organic invites              | `users.acquisition.viaInvite` (set from the signed `start_param` on first sign-in)                |

The most important early signal: **do people want to play again?** The closed beta measures it:
[beta-plan.md](beta-plan.md) (metrics, queries, decisions) and
[beta-tester-guide.md](beta-tester-guide.md).
