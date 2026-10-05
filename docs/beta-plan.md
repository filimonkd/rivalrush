# Closed beta plan

**One question decides what happens next: do people want to play again?** The closed beta
puts the verified MVP in front of 15–20 testers for one week (Mon 12 – Sun 18 Oct 2026),
aiming for 50+ completed matches. No new features ship during the beta; only fixes for
blocking bugs. Daily operations and incident response: [runbook.md](runbook.md). Tester
instructions and the message to post: [beta-tester-guide.md](beta-tester-guide.md).

## What we want to learn

1. **Do people come back on their own?** Rematches, play on more than one day, play without
   a reminder.
2. **Does the invite loop work?** Links get tapped, rooms fill, testers invite people outside
   the group.
3. **Do games finish fairly?** Few abandons, no wrong results, reconnects hold on real phones
   and networks.
4. **What gets in the way?** Rules confusion, timer length, waiting, slow first load.

## Metrics

All numbers are **learning targets, not pass/fail**. With ~50 matches, one match moves the
rematch rate by about 2 points; with 15–20 testers, one person moves day-7 return by 5–7
points. Read them together with what testers say.

| Metric                | Question it answers        | Definition                                                                                      | Source                        | Learning target |
| --------------------- | -------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------- | --------------- |
| Invite → join         | Does the invite flow work? | Rooms that reached 2 players ÷ rooms created                                                    | Atlas `rooms`                 | ≥ 60%           |
| Match completion      | Do games finish fairly?    | Matches ending `cracked` / `both_cracked` / `out_of_guesses` ÷ games started                    | Atlas `matches` + Render logs | ≥ 80%           |
| Abandon rate          | Are reconnects holding up? | Matches ending `abandoned` ÷ games started                                                      | Atlas `matches` + Render logs | ≤ 5%            |
| Rematch rate          | Is one game enough?        | Rematch sessions ÷ finished matches                                                             | Atlas `matches`               | ≥ 40%           |
| Games per active user | Is it a habit?             | Matches per player who played that week                                                         | Atlas `matches`               | ≥ 3             |
| Multi-day players     | Early "came back" signal   | Players who played on 2+ different days ÷ players                                               | Atlas `matches`               | ≥ 50%           |
| Day-7 return          | Retention                  | Players whose first game was 7+ days ago and who played again on day 7 or later ÷ those players | Atlas `matches` (from 19 Oct) | ≥ 25%           |
| Organic invite rate   | Growth loop                | New users whose first launch came from an invite link ÷ new users                               | Atlas `users`                 | ≥ 50%           |
| Outsiders             | Do testers spread it?      | Players who are not on the tester list                                                          | Atlas `users` vs tester list  | any             |

"Games started" is not stored in the database; count `game.started` lines in the Render logs
(Logs → search `"event":"game.started"`, filter to the day). Render may keep only recent logs on
the free plan, so write the count into the daily log every evening.

The difference between games started and matches recorded = games that never finished:
abandoned mid-way, still running, or lost to a restart. A large gap on a day with a deploy is
expected; a large gap on a quiet day is worth investigating.

### The "play again" signal

No single number answers it. Look for these together:

| Signal                                      | Strong                                  | Weak                                 |
| ------------------------------------------- | --------------------------------------- | ------------------------------------ |
| Rematch rate                                | > 40%                                   | < 25%                                |
| Multi-day players                           | ≥ 50% of players                        | < 30%                                |
| Unprompted play                             | Matches on days with no reminder posted | Play only right after reminders      |
| Late-week activity                          | Days 5–7 similar to days 1–2            | Falls off after day 2                |
| Survey: "If RivalRush disappeared tomorrow" | ≥ 40% "very disappointed"               | Mostly "not disappointed"            |
| Outsiders                                   | Testers invite people outside the group | Nobody outside the tester list plays |

### Queries

Run them in Atlas → Data Explorer → `rivalrush` database → the collection → **Aggregations**.

Replace the date with the beta start (UTC). If the editor rejects `ISODate(...)`, use
`{ "$date": "2026-10-12T00:00:00Z" }`. Or run the same pipelines in `mongosh`.

**Invite → join** (`rooms`):

```js
[
  { $match: { createdAt: { $gte: ISODate('2026-10-12T00:00:00Z') } } },
  {
    $group: {
      _id: null,
      roomsCreated: { $sum: 1 },
      roomsJoined: { $sum: { $cond: [{ $gte: ['$peakPlayers', 2] }, 1, 0] } },
    },
  },
];
```

**Endings and rematches** (`matches`): gives finished matches, abandoned, normal endings and
the rematch count per ending.

```js
[
  { $match: { endedAt: { $gte: ISODate('2026-10-12T00:00:00Z') } } },
  {
    $group: {
      _id: '$result.reason',
      matches: { $sum: 1 },
      rematches: { $sum: { $cond: ['$isRematch', 1, 0] } },
    },
  },
];
```

**Games per player and multi-day players** (`matches`):

```js
[
  { $match: { endedAt: { $gte: ISODate('2026-10-12T00:00:00Z') } } },
  { $unwind: '$players' },
  {
    $group: {
      _id: '$players.userId',
      games: { $sum: 1 },
      days: { $addToSet: { $dateToString: { format: '%Y-%m-%d', date: '$endedAt' } } },
    },
  },
  {
    $group: {
      _id: null,
      players: { $sum: 1 },
      avgGames: { $avg: '$games' },
      threePlusGames: { $sum: { $cond: [{ $gte: ['$games', 3] }, 1, 0] } },
      multiDay: { $sum: { $cond: [{ $gte: [{ $size: '$days' }, 2] }, 1, 0] } },
    },
  },
];
```

**Day-7 return** (`matches`; run from 19 Oct; set the date to 7 days before today):

```js
[
  { $unwind: '$players' },
  { $group: { _id: '$players.userId', first: { $min: '$endedAt' }, last: { $max: '$endedAt' } } },
  { $match: { first: { $lte: ISODate('2026-10-12T00:00:00Z') } } },
  {
    $group: {
      _id: null,
      eligible: { $sum: 1 },
      returned: {
        $sum: { $cond: [{ $gte: ['$last', { $add: ['$first', 7 * 24 * 3600 * 1000] }] }, 1, 0] },
      },
    },
  },
];
```

**Organic invites** (`users`):

```js
[
  { $match: { createdAt: { $gte: ISODate('2026-10-12T00:00:00Z') }, isDev: { $ne: true } } },
  {
    $group: {
      _id: null,
      newUsers: { $sum: 1 },
      viaInvite: { $sum: { $cond: ['$acquisition.viaInvite', 1, 0] } },
    },
  },
];
```

In a closed beta most testers arrive through the organiser's own invite links, so this rate
is inflated. The "outsiders" count is the more honest growth signal.

### Daily log

Copy into a spreadsheet and fill in every evening (cumulative since the beta started).

| Date   | Reminder posted? | Rooms | Joined | Games started (logs) | Matches | Normal endings | Abandoned | Rematches | Players | Multi-day | Deploys / incidents | Notes |
| ------ | ---------------- | ----- | ------ | -------------------- | ------- | -------------- | --------- | --------- | ------- | --------- | ------------------- | ----- |
| 12 Oct |                  |       |        |                      |         |                |           |           |         |           |                     |       |

## Feedback

Three channels, all free and nothing to build:

1. **The beta Telegram group** for bugs and quick reactions (template in
   [beta-tester-guide.md](beta-tester-guide.md#reporting-a-problem)).
2. **Two Telegram polls** in the group: a one-question pulse on day 3 ("How many games have you
   played?": 0 / 1–2 / 3–5 / 6+) and one on day 5 ("Turn timer feels": too short / about right
   / too long).
3. **An end-of-week survey** (Google Forms or Tally, free), sent on day 6 and closed on day 8.
   It takes about 2 minutes:

| #   | Question                                                                     | Type                                                         |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | Your Telegram name                                                           | Short text                                                   |
| 2   | How many games did you play this week?                                       | 0 / 1–2 / 3–5 / 6–10 / 10+                                   |
| 3   | If RivalRush disappeared tomorrow, how would you feel?                       | Very disappointed / Somewhat disappointed / Not disappointed |
| 4   | Would you keep playing next week if nobody reminded you?                     | Yes / Maybe / No                                             |
| 5   | Did you invite anyone outside the beta group?                                | Yes / No                                                     |
| 6   | What made you want to play again (or stop)?                                  | Long text                                                    |
| 7   | Were the rules clear after your first game?                                  | 1–5                                                          |
| 8   | The turn timer felt…                                                         | Too short / About right / Too long                           |
| 9   | What annoyed you or got in the way?                                          | Long text                                                    |
| 10  | Did anything break? (what, when, which phone)                                | Long text                                                    |
| 11  | What would make you play more: a better Crack the Code, or a different game? | Better Crack the Code / A different game / Neither           |
| 12  | Anything else?                                                               | Long text                                                    |

## Bug reports

Every report becomes a GitHub issue using the **Beta bug report** template
(`.github/ISSUE_TEMPLATE/beta-bug.yml`), so nothing gets lost. Collect:

| Field              | Why                                                                   |
| ------------------ | --------------------------------------------------------------------- |
| Reporter           | Telegram name, to follow up                                           |
| When               | Date, time and time zone: matches the Render logs                     |
| Device             | iPhone / Android, OS version, Telegram app version                    |
| Network            | Wi-Fi or mobile data; VPN?                                            |
| Where in the app   | Home, lobby, invite, setup, my turn, their turn, result, profile      |
| Steps              | What they did, in order                                               |
| Expected vs actual | What should have happened and what did                                |
| Evidence           | Screenshot or screen recording; for wrong results both result screens |
| Recovered?         | Did reopening the app fix it?                                         |
| Other player       | Their name, if it happened in a game (to get their side)              |
| Severity           | Blocker / Major / Minor (below)                                       |

| Severity | Meaning                                                                                | Response                                    |
| -------- | -------------------------------------------------------------------------------------- | ------------------------------------------- |
| Blocker  | Can't sign in, can't join, games can't finish, wrong result or stats, many players hit | Fix now; deploy at a quiet time with notice |
| Major    | A game is interrupted or a feature fails, but there's a workaround                     | Fix this week if safe; else after the beta  |
| Minor    | Cosmetic, wording, small annoyance                                                     | Collect for the polish week                 |

## What happens after the beta

Decide on 19–20 Oct, using the numbers and the survey together. Re-check day-7 return on
25 Oct before committing to expansion.

| Decision                          | When                                                                                                                                                                                                                                                                                         | Next step                                                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fix and polish Crack the Code** | Any blocker open or a confirmed wrong result; completion < 80% or abandon > 5%; invite → join < 60%; or play-again is middling (rematch 25–40%, multi-day 30–50%) and feedback names fixable friction (rules, timer, waiting, first load)                                                    | Polish week (plan stage 16: fixes, how-to-play, branded loading screen, rich invite card), then a short second round with the same testers      |
| **Move toward Game #2**           | All of: launch gate met (50+ finished matches, rematch > 40%, no open blockers); completion ≥ 80% and abandon ≤ 5%; strong play-again signals (multi-day ≥ 50%, play continues late in the week without reminders, ≥ 40% "very disappointed"); and feedback asks for variety more than fixes | Follow the plan: polish week → public launch of Crack the Code → start Game #2 (Color Cipher). Game #2 work starts only after the public launch |
| **Postpone expansion**            | The game works (few bugs, games finish) but people don't come back: rematch < 25%, multi-day < 30%, play stops after day 2–3 without reminders, mostly "not disappointed"; or nobody invites anyone                                                                                          | No new games. Interview 5 testers, change the core hook (shorter matches, default settings, how duels start) and run another small round        |

When the signals disagree, the qualitative answers (survey questions 3, 4, 6 and 11) break the
tie. A strong "want to play again" with weak numbers usually means friction, so polish first.

## One-week schedule

| When                | What                                                                                                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before (6–11 Oct)   | Owner actions in [mvp-readiness.md](mvp-readiness.md) (health, pinger, branch protection, Render version). Recruit 15–20 testers into 1–2 Telegram groups; keep a tester list. Prepare the survey and the daily log. |
| Day 1 · Mon 12 Oct  | Morning health check. Post the tester message. Play the first games with testers. Evening: daily log, triage.                                                                                                        |
| Day 2 · Tue 13 Oct  | Health check. No reminder today (measures unprompted play). Fix blockers only.                                                                                                                                       |
| Day 3 · Wed 14 Oct  | Health check. Poll 1 (games played). Nudge testers who haven't played yet, individually.                                                                                                                             |
| Day 4 · Thu 15 Oct  | Health check. Mid-week review of the daily log against the targets. If a deploy is needed, do it in a quiet hour with notice.                                                                                        |
| Day 5 · Fri 16 Oct  | Health check. Poll 2 (timer). Ask testers to invite one friend outside the group.                                                                                                                                    |
| Day 6 · Sat 17 Oct  | Health check. Send the survey.                                                                                                                                                                                       |
| Day 7 · Sun 18 Oct  | Health check. Last daily log. Remind about the survey.                                                                                                                                                               |
| Mon 19 – Tue 20 Oct | Close the survey, run all queries, fill [the decision table](#what-happens-after-the-beta), thank testers and tell them what's next. Keep the app running (no reminders) to measure day-7 return.                    |
| Sun 25 Oct          | Day-7 return query; confirm the decision.                                                                                                                                                                            |
