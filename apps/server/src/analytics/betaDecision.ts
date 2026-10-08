import type { BetaReport } from './betaReport.js';
import type { SurveySummary } from './survey.js';

/**
 * The decision table of docs/beta-plan.md#what-happens-after-the-beta, worked out from the beta
 * report, the survey and two facts only a person knows (open blockers, a confirmed wrong result).
 * Every condition is shown with its numbers. One that needs data we don't have is "unknown",
 * never guessed. The output points at a decision; the owner makes it.
 */

/** true / false, or null when the data needed is missing. */
export type Tri = boolean | null;

export interface Condition {
  label: string;
  met: Tri;
  detail: string;
}

export interface DecisionRow {
  decision: 'polish' | 'game2' | 'postpone';
  title: string;
  /** polish: any condition; game2: all; postpone: as described per row. */
  rule: string;
  conditions: Condition[];
  met: Tri;
}

export interface DecisionInputs {
  report: BetaReport;
  survey: SurveySummary | null;
  /** Open GitHub issues labelled Blocker; null if not given. */
  openBlockers: number | null;
  /** A wrong result or wrong stats confirmed during the beta; null if not given. */
  wrongResult: boolean | null;
  /** Days (YYYY-MM-DD, in the report's time zone) when a reminder was posted; null if not given. */
  reminderDays: string[] | null;
}

export interface Decision {
  rows: DecisionRow[];
  /** The row the data points to, and why. */
  pointsTo: { decision: DecisionRow['decision']; title: string; why: string };
  /** The interpretations of the plan's wording that this file uses, printed with the result. */
  assumptions: string[];
}

const pct = (n: number, d: number): number | null => (d > 0 ? (n / d) * 100 : null);
const show = (v: number | null, unit = '%') => (v === null ? 'n/a' : `${Math.round(v)}${unit}`);
const tri = (v: number | null, test: (x: number) => boolean): Tri => (v === null ? null : test(v));
const all = (cs: Condition[]): Tri =>
  cs.some((c) => c.met === false) ? false : cs.some((c) => c.met === null) ? null : true;
const any = (cs: Condition[]): Tri =>
  cs.some((c) => c.met === true) ? true : cs.some((c) => c.met === null) ? null : false;

/** Late-week activity: days 5–7 against days 1–2 of the window, in matches per day. */
const LATE_WEEK_SIMILAR = 0.75;
const LATE_WEEK_FALLS_OFF = 0.4;
/** Unprompted play: share of matches on days without a reminder. */
const UNPROMPTED_STRONG = 0.3;
const UNPROMPTED_WEAK = 0.1;
/** Fixable friction in the survey. */
const RULES_UNCLEAR_BELOW = 4;
const TIMER_OFF_SHARE = 0.4;

const ASSUMPTIONS = [
  `"Days 5–7 similar to days 1–2": matches per day on days 5–7 are at least ${LATE_WEEK_SIMILAR * 100}% of days 1–2; "falls off" is ${LATE_WEEK_FALLS_OFF * 100}% or less.`,
  `"Unprompted play": at least ${UNPROMPTED_STRONG * 100}% of matches on days with no reminder posted (weak below ${UNPROMPTED_WEAK * 100}%).`,
  `"Feedback names fixable friction": rules clarity averages under ${RULES_UNCLEAR_BELOW}/5, or ${TIMER_OFF_SHARE * 100}%+ found the timer too short or too long. The written answers (Q6, Q9) can show friction these numbers miss: read them.`,
  '"Mostly not disappointed": more "not disappointed" than the other two answers together.',
  '"People don\'t come back": at least 3 of its 4 signals are weak.',
];

/** YYYY-MM-DD of an instant in a time zone. */
function localDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function dayIndex(day: string, since: string): number {
  return (
    Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 864e5) + 1
  );
}

export function decide(i: DecisionInputs): Decision {
  const { report: r, survey: s } = i;
  const m = r.matches;
  const started = r.starts.started;
  const completion = started > 0 ? pct(m.normal, started) : null;
  const abandon = started > 0 ? pct(m.abandoned, started) : null;
  const rematch = pct(m.rematches, m.total);
  const multiDay = pct(r.players.multiDay, r.players.players);
  const inviteJoin = pct(r.rooms.joined, r.rooms.created);

  // Late week: day 1 is the window's first local day (report days are in its time zone).
  const first = localDay(r.window.since, r.window.timeZone);
  const lastDay = localDay(
    new Date(Date.parse(r.window.until) - 1).toISOString(),
    r.window.timeZone,
  );
  const perDay = (from: number, to: number) => {
    const rows = r.daily.filter((d) => {
      const k = dayIndex(d.day, first);
      return k >= from && k <= to;
    });
    return rows.reduce((n, d) => n + d.matches, 0) / (to - from + 1);
  };
  const early = perDay(1, 2);
  const late = perDay(5, 7);
  const lateRatio = early && late !== null ? late / early : null;
  const weekLong = dayIndex(lastDay, first) >= 7;

  const unprompted =
    i.reminderDays && m.total > 0
      ? r.daily.filter((d) => !i.reminderDays!.includes(d.day)).reduce((n, d) => n + d.matches, 0) /
        m.total
      : null;

  const answered3 = s ? s.disappointed.very + s.disappointed.somewhat + s.disappointed.not : 0;
  const veryDisappointed = s && answered3 > 0 ? pct(s.disappointed.very, answered3) : null;
  const mostlyNot =
    s && answered3 > 0 ? s.disappointed.not > s.disappointed.very + s.disappointed.somewhat : null;
  const timerAnswers = s ? s.timer.tooShort + s.timer.aboutRight + s.timer.tooLong : 0;
  const timerOff =
    s && timerAnswers > 0 ? (s.timer.tooShort + s.timer.tooLong) / timerAnswers : null;
  const rulesAvg = s?.rulesClear.average ?? null;
  const friction: Tri =
    rulesAvg === null && timerOff === null
      ? null
      : (rulesAvg !== null && rulesAvg < RULES_UNCLEAR_BELOW) ||
        (timerOff !== null && timerOff >= TIMER_OFF_SHARE);
  const variety: Tri =
    s && s.playMore.betterGame + s.playMore.differentGame > 0
      ? s.playMore.differentGame > s.playMore.betterGame
      : null;

  const blockers: Condition = {
    label: 'A blocker is open',
    met: i.openBlockers === null ? null : i.openBlockers > 0,
    detail: i.openBlockers === null ? 'pass --blockers N' : `${i.openBlockers} open`,
  };
  const middling =
    rematch === null || multiDay === null
      ? null
      : (rematch >= 25 && rematch <= 40) || (multiDay >= 30 && multiDay <= 50);

  const polish: Condition[] = [
    blockers,
    {
      label: 'A wrong result was confirmed',
      met: i.wrongResult,
      detail:
        i.wrongResult === null ? 'pass --wrong-result if one was' : i.wrongResult ? 'yes' : 'no',
    },
    {
      label: 'Completion < 80%',
      met: tri(completion, (v) => v < 80),
      detail: completion === null ? 'no recorded game starts' : show(completion),
    },
    {
      label: 'Abandon > 5%',
      met: tri(abandon, (v) => v > 5),
      detail: abandon === null ? 'no recorded game starts' : show(abandon),
    },
    { label: 'Invite → join < 60%', met: tri(inviteJoin, (v) => v < 60), detail: show(inviteJoin) },
    {
      label: 'Play-again middling and feedback names fixable friction',
      met:
        middling === false
          ? false
          : friction === false
            ? false
            : middling && friction
              ? true
              : null,
      detail: `rematch ${show(rematch)}, multi-day ${show(multiDay)}; rules ${rulesAvg === null ? 'n/a' : `${rulesAvg.toFixed(1)}/5`}, timer off for ${timerOff === null ? 'n/a' : show(timerOff * 100)}`,
    },
  ];

  const game2: Condition[] = [
    {
      label: '50+ finished matches',
      met: m.total >= 50,
      detail: `${m.total}`,
    },
    { label: 'Rematch > 40%', met: tri(rematch, (v) => v > 40), detail: show(rematch) },
    {
      label: 'No open blockers',
      met: blockers.met === null ? null : !blockers.met,
      detail: blockers.detail,
    },
    {
      label: 'Completion ≥ 80% and abandon ≤ 5%',
      met: completion === null || abandon === null ? null : completion >= 80 && abandon <= 5,
      detail: `${show(completion)} / ${show(abandon)}`,
    },
    { label: 'Multi-day ≥ 50%', met: tri(multiDay, (v) => v >= 50), detail: show(multiDay) },
    {
      label: 'Play continues late in the week',
      met: weekLong ? tri(lateRatio, (v) => v >= LATE_WEEK_SIMILAR) : null,
      detail: weekLong
        ? `days 5–7 at ${show(lateRatio === null ? null : lateRatio * 100)} of days 1–2`
        : 'the window is shorter than 7 days',
    },
    {
      label: 'Play without reminders',
      met: tri(unprompted, (v) => v >= UNPROMPTED_STRONG),
      detail:
        unprompted === null
          ? 'pass --reminder-days'
          : `${show(unprompted * 100)} of matches on days with no reminder`,
    },
    {
      label: '≥ 40% "very disappointed"',
      met: tri(veryDisappointed, (v) => v >= 40),
      detail: veryDisappointed === null ? 'pass --survey' : show(veryDisappointed),
    },
    {
      label: 'Feedback asks for variety more than fixes',
      met: variety,
      detail: s
        ? `different game ${s.playMore.differentGame}, better Crack the Code ${s.playMore.betterGame}`
        : 'pass --survey',
    },
  ];

  const weakSignals: Tri[] = [
    tri(rematch, (v) => v < 25),
    tri(multiDay, (v) => v < 30),
    weekLong ? tri(lateRatio, (v) => v <= LATE_WEEK_FALLS_OFF) : null,
    mostlyNot,
  ];
  const weak = weakSignals.filter((v) => v === true).length;
  const unknownWeak = weakSignals.filter((v) => v === null).length;
  const gameWorks: Tri = completion === null ? null : completion >= 80 && blockers.met !== true;
  const nobodyInvites: Tri =
    r.outsiders === null && r.users.newUsers === 0
      ? null
      : r.users.viaInvite === 0 && (r.outsiders ?? 0) === 0;
  const postpone: Condition[] = [
    {
      label: 'The game works (games finish, no open blockers)',
      met: gameWorks,
      detail: `completion ${show(completion)}; ${blockers.detail}`,
    },
    {
      label:
        "People don't come back (3+ of: rematch < 25%, multi-day < 30%, play stops after day 2–3, mostly not disappointed)",
      met: weak >= 3 ? true : weak + unknownWeak < 3 ? false : null,
      detail: `${weak} weak${unknownWeak ? `, ${unknownWeak} unknown` : ''}`,
    },
    {
      label: 'or: nobody invites anyone',
      met: nobodyInvites,
      detail: `${r.users.viaInvite} joined via an invite; outsiders ${r.outsiders ?? 'n/a (pass --testers)'}`,
    },
  ];
  const postponeMet: Tri = postpone[2]!.met === true ? true : all([postpone[0]!, postpone[1]!]);

  const rows: DecisionRow[] = [
    {
      decision: 'polish',
      title: 'Fix and polish',
      rule: 'any of',
      conditions: polish,
      met: any(polish),
    },
    {
      decision: 'game2',
      title: 'Move toward Game #2',
      rule: 'all of',
      conditions: game2,
      met: all(game2),
    },
    {
      decision: 'postpone',
      title: 'Postpone expansion',
      rule: "the game works and people don't come back, or nobody invites anyone",
      conditions: postpone,
      met: postponeMet,
    },
  ];

  const pointsTo = ((): Decision['pointsTo'] => {
    const hits = polish.filter((c) => c.met === true).map((c) => c.label);
    if (hits.length) return { decision: 'polish', title: 'Fix and polish', why: hits.join('; ') };
    if (rows[1]!.met === true)
      return { decision: 'game2', title: 'Move toward Game #2', why: 'every condition holds' };
    if (postponeMet === true)
      return {
        decision: 'postpone',
        title: 'Postpone expansion',
        why: postpone
          .filter((c) => c.met === true)
          .map((c) => c.label)
          .join('; '),
      };
    const missing = rows.flatMap((row) => row.conditions).filter((c) => c.met === null);
    return {
      decision: 'polish',
      title: 'Fix and polish',
      why:
        'no row is clearly met: the plan says to polish first when the signals disagree, and to let survey questions 3, 4, 6 and 11 break the tie' +
        (missing.length
          ? `. Still unknown: ${[...new Set(missing.map((c) => c.label))].join('; ')}`
          : ''),
    };
  })();

  return { rows, pointsTo, assumptions: ASSUMPTIONS };
}

const mark = (t: Tri) => (t === true ? '✅' : t === false ? '–' : '❓');

export function formatDecision(d: Decision, s: SurveySummary | null): string {
  const out: string[] = ['', 'Decision (docs/beta-plan.md#what-happens-after-the-beta)'];
  if (s) {
    const n = s.disappointed.very + s.disappointed.somewhat + s.disappointed.not;
    out.push(
      `Survey: ${s.responses} responses · very disappointed ${s.disappointed.very}/${n} · keep playing yes ${s.keepPlaying.yes} maybe ${s.keepPlaying.maybe} no ${s.keepPlaying.no} · invited outside ${s.invitedOutside.yes} · rules ${s.rulesClear.average === null ? 'n/a' : `${s.rulesClear.average.toFixed(1)}/5`} · timer short/right/long ${s.timer.tooShort}/${s.timer.aboutRight}/${s.timer.tooLong}`,
      `        written answers to read in the form: why play again ${s.wroteText.playAgainWhy}, annoyed ${s.wroteText.annoyed}, broke ${s.wroteText.broke}, other ${s.wroteText.other}` +
        (s.missing.length ? ` · not found in the export: ${s.missing.join(', ')}` : ''),
    );
  }
  for (const row of d.rows) {
    out.push('', `${mark(row.met)} ${row.title} (${row.rule})`);
    for (const c of row.conditions) out.push(`   ${mark(c.met)} ${c.label}: ${c.detail}`);
  }
  out.push(
    '',
    `The data points to: ${d.pointsTo.title}. Why: ${d.pointsTo.why}.`,
    '✅ holds · – does not hold · ❓ unknown (the hint says what to pass). You decide; re-check day-7 return on 25 Oct.',
    '',
    "How the plan's wording is read:",
    ...d.assumptions.map((a) => `  - ${a}`),
  );
  return out.join('\n') + '\n';
}
