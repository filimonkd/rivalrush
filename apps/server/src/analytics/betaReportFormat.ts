import type { BetaReport, TesterList } from './betaReport.js';

/** Pure helpers for the beta report CLI: dates, the tester list and the printed report. */

/** Offset of `timeZone` from UTC at `at`, in ms (positive east of Greenwich). */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * `2026-10-12` → that day's midnight in `timeZone`; a full ISO timestamp is taken as is.
 * Throws on anything else, and on an unknown time zone.
 */
export function parseDay(value: string, timeZone: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number) as [number, number, number];
    const naive = Date.UTC(y, m - 1, d);
    if (new Date(naive).getUTCDate() !== d) throw new Error(`Not a date: ${value}`);
    // Two passes settle days where the offset changes (daylight saving).
    let t = naive - zoneOffsetMs(new Date(naive), timeZone);
    t = naive - zoneOffsetMs(new Date(t), timeZone);
    return new Date(t);
  }
  if (/^\d{4}-\d{2}-\d{2}T.+(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const t = new Date(value);
    if (!Number.isNaN(t.getTime())) return t;
  }
  throw new Error(`Not a date: ${value} (use YYYY-MM-DD or a full ISO timestamp)`);
}

/** One tester per line: a numeric Telegram id or an @username. `#` starts a comment. */
export function parseTesters(text: string): TesterList {
  const ids = new Set<number>();
  const usernames = new Set<string>();
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    if (/^-?\d+$/.test(line)) ids.add(Number(line));
    else usernames.add(line.replace(/^@/, '').toLowerCase());
  }
  return { ids, usernames };
}

function pct(n: number, d: number): string {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : 'n/a';
}

function line(label: string, value: string, detail: string, target: string): string {
  return `${label.padEnd(24)}${value.padStart(6)}   ${detail.padEnd(40)}${target}`;
}

function table(header: string[], rows: Array<Array<string | number>>): string[] {
  const all = [header, ...rows.map((r) => r.map(String))];
  const widths = header.map((_, i) => Math.max(...all.map((r) => r[i]!.length)));
  return all.map((r) =>
    r.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join('  '),
  );
}

/** The plain-text report the CLI prints. */
export function formatBetaReport(r: BetaReport, database: string): string {
  const { rooms, starts, matches: m, players: p, daySeven, users } = r;
  const startsKnown = starts.started > 0;
  const fromLogs = 'n/a: count game.started in the Render logs';
  const out: string[] = [
    `RivalRush beta report · database ${database}`,
    `Window: ${r.window.since} → ${r.window.until} (days in ${r.window.timeZone})`,
    '',
    line('Metric', 'Value', 'Numbers', 'Target'),
    line(
      'Invite → join',
      pct(rooms.joined, rooms.created),
      `${rooms.joined} of ${rooms.created} rooms reached 2 players`,
      '≥ 60%',
    ),
    startsKnown
      ? line(
          'Match completion',
          pct(m.normal, starts.started),
          `${m.normal} normal endings / ${starts.started} started`,
          '≥ 80%',
        )
      : line('Match completion', 'n/a', fromLogs, '≥ 80%'),
    startsKnown
      ? line(
          'Abandon rate',
          pct(m.abandoned, starts.started),
          `${m.abandoned} abandoned / ${starts.started} started`,
          '≤ 5%',
        )
      : line('Abandon rate', 'n/a', fromLogs, '≤ 5%'),
    line(
      'Rematch rate',
      pct(m.rematches, m.total),
      `${m.rematches} of ${m.total} matches`,
      '≥ 40%',
    ),
    line(
      'Games per active user',
      p.players > 0 ? (p.totalGames / p.players).toFixed(1) : 'n/a',
      `${p.players} players · ${p.threePlusGames} played 3+`,
      '≥ 3',
    ),
    line(
      'Multi-day players',
      pct(p.multiDay, p.players),
      `${p.multiDay} of ${p.players} played on 2+ days`,
      '≥ 50%',
    ),
    line(
      'Day-7 return',
      pct(daySeven.returned, daySeven.eligible),
      daySeven.eligible > 0
        ? `${daySeven.returned} of ${daySeven.eligible} came back on day 7+`
        : 'nobody started 7+ days before the end',
      '≥ 25%',
    ),
    line(
      'Organic invite rate',
      pct(users.viaInvite, users.newUsers),
      `${users.viaInvite} of ${users.newUsers} new users via an invite`,
      '≥ 50%',
    ),
    line(
      'Outsiders',
      r.outsiders === null ? 'n/a' : String(r.outsiders),
      r.outsiders === null
        ? 'pass --testers <file> to count them'
        : 'players not on the tester list',
      'any',
    ),
    '',
    `Games started: ${starts.started} · never finished: ${starts.unfinished}` +
      (starts.trackedSince
        ? ` · starts recorded since ${starts.trackedSince}`
        : ' · no starts recorded yet (deploy this version first)'),
    `Endings: ${
      Object.entries(m.byReason)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k} ${v}`)
        .join(' · ') || 'none'
    } (forfeits are neither normal endings nor abandons)`,
    '',
    'Per game',
    ...table(
      ['game', 'matches', 'rematches', 'abandoned'],
      m.byGame.map((g) => [g.gameType, g.matches, g.rematches, g.abandoned]),
    ),
    '',
    'Per day (counts on that day only)',
    ...table(
      [
        'day',
        'rooms',
        'joined',
        'started',
        'matches',
        'normal',
        'abandoned',
        'rematches',
        'players',
      ],
      r.daily.map((d) => [
        d.day,
        d.rooms,
        d.joined,
        d.started,
        d.matches,
        d.normal,
        d.abandoned,
        d.rematches,
        d.players,
      ]),
    ),
    '',
    'Daily log row (cumulative; paste into the log and fill in the blanks):',
    `| ${r.daily.at(-1)?.day ?? r.window.until.slice(0, 10)} |  | ${rooms.created} | ${rooms.joined} | ${starts.started} | ${m.total} | ${m.normal} | ${m.abandoned} | ${m.rematches} | ${p.players} | ${p.multiDay} |  |  |`,
  ];
  return out.join('\n') + '\n';
}
