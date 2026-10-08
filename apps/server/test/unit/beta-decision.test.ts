import { describe, expect, it } from 'vitest';
import { decide, formatDecision, type DecisionInputs } from '../../src/analytics/betaDecision.js';
import type { BetaReport, DailyRow } from '../../src/analytics/betaReport.js';
import { parseCsv, summarizeSurvey, type SurveySummary } from '../../src/analytics/survey.js';

describe('survey export', () => {
  it('parses quoted fields, escaped quotes, commas and line breaks, BOM and CRLF', () => {
    const csv = '﻿a,"b, c","say ""hi""\r\nsecond line"\r\n1,2,3\r\n\r\n';
    expect(parseCsv(csv)).toEqual([
      ['a', 'b, c', 'say "hi"\r\nsecond line'],
      ['1', '2', '3'],
    ]);
  });

  const forms = [
    'Timestamp,Your Telegram name,How many games did you play this week?,"If RivalRush disappeared tomorrow, how would you feel?",Would you keep playing next week if nobody reminded you?,Did you invite anyone outside the beta group?,What made you want to play again (or stop)?,Were the rules clear after your first game?,The turn timer felt…,What annoyed you or got in the way?,"Did anything break? (what, when, which phone)","What would make you play more: a better Crack the Code, or a different game?",Anything else?',
    '2026/10/18 10:00,Ana,6–10,Very disappointed,Yes,Yes,"Beating Ben, obviously",5,About right,,,A different game,',
    '2026/10/18 11:00,Ben,3–5,Somewhat disappointed,Maybe,No,,4,Too short,"Waiting, the timer",,Better Crack the Code,',
    '2026/10/18 12:00,Cy,1–2,Not disappointed,No,No,Not my thing,2,Too long,,"Froze once, iPhone",A different game,thanks',
  ].join('\n');

  it('counts every closed question from a Google Forms export', () => {
    expect(summarizeSurvey(forms)).toEqual({
      responses: 3,
      disappointed: { very: 1, somewhat: 1, not: 1 },
      keepPlaying: { yes: 1, maybe: 1, no: 1 },
      invitedOutside: { yes: 1, no: 2 },
      rulesClear: { average: 11 / 3, answers: 3 },
      timer: { tooShort: 1, aboutRight: 1, tooLong: 1 },
      playMore: { betterGame: 1, differentGame: 2, neither: 0 },
      wroteText: { playAgainWhy: 2, annoyed: 1, broke: 1, other: 1 },
      missing: [],
    } satisfies SurveySummary);
  });

  it('never returns names or written answers', () => {
    const out = JSON.stringify(summarizeSurvey(forms));
    expect(out).not.toMatch(/Ana|Ben|Cy|obviously|iPhone|thanks/);
  });

  it('works with reordered and extra columns, and names the questions it could not find', () => {
    const tally = [
      'Submission ID,Respondent ID,Submitted at,Were the rules clear after your first game?,"If RivalRush disappeared tomorrow, how would you feel?"',
      'x1,r1,2026-10-18,3,Very disappointed',
    ].join('\n');
    const s = summarizeSurvey(tally);
    expect(s.disappointed.very).toBe(1);
    expect(s.rulesClear).toEqual({ average: 3, answers: 1 });
    expect(s.missing).toEqual([
      'keepPlaying',
      'invitedOutside',
      'timer',
      'playMore',
      'playAgainWhy',
      'annoyed',
      'broke',
      'other',
    ]);
  });
});

// --- decision -------------------------------------------------------------------------------

const days = (matches: number[]): DailyRow[] =>
  matches.map((n, i) => ({
    day: `2026-10-${String(12 + i).padStart(2, '0')}`,
    rooms: n,
    joined: n,
    started: n,
    matches: n,
    normal: n,
    abandoned: 0,
    rematches: 0,
    players: 4,
  }));

function report(over: {
  started?: number;
  total?: number;
  normal?: number;
  abandoned?: number;
  rematches?: number;
  players?: number;
  multiDay?: number;
  created?: number;
  joined?: number;
  daily?: number[];
  viaInvite?: number;
  outsiders?: number | null;
  until?: string;
}): BetaReport {
  const daily = over.daily ?? [10, 10, 9, 9, 8, 8, 8];
  return {
    window: {
      since: '2026-10-12T00:00:00.000Z',
      until: over.until ?? '2026-10-19T00:00:00.000Z',
      timeZone: 'UTC',
    },
    rooms: { created: over.created ?? 40, joined: over.joined ?? 34 },
    starts: { started: over.started ?? 62, unfinished: 0, trackedSince: '2026-10-09T00:00:00Z' },
    matches: {
      total: over.total ?? daily.reduce((a, b) => a + b, 0),
      normal: over.normal ?? 57,
      forfeit: 0,
      abandoned: over.abandoned ?? 1,
      rematches: over.rematches ?? 30,
      byReason: {},
      byGame: [],
    },
    players: {
      players: over.players ?? 18,
      totalGames: 120,
      threePlusGames: 12,
      multiDay: over.multiDay ?? 11,
    },
    daySeven: { eligible: 0, returned: 0 },
    users: { newUsers: 20, viaInvite: over.viaInvite ?? 12 },
    outsiders: over.outsiders === undefined ? 4 : over.outsiders,
    daily: days(daily),
  };
}

function survey(
  very: number,
  somewhat: number,
  not: number,
  different = 6,
  better = 3,
): SurveySummary {
  return {
    responses: very + somewhat + not,
    disappointed: { very, somewhat, not },
    keepPlaying: { yes: 5, maybe: 3, no: 2 },
    invitedOutside: { yes: 4, no: 6 },
    rulesClear: { average: 4.4, answers: 10 },
    timer: { tooShort: 1, aboutRight: 8, tooLong: 1 },
    playMore: { betterGame: better, differentGame: different, neither: 1 },
    wroteText: { playAgainWhy: 7, annoyed: 4, broke: 1, other: 2 },
    missing: [],
  };
}

const inputs = (over: Partial<DecisionInputs> = {}): DecisionInputs => ({
  report: report({}),
  survey: survey(5, 3, 2),
  openBlockers: 0,
  wrongResult: false,
  reminderDays: ['2026-10-12', '2026-10-14'],
  ...over,
});

const cond = (d: ReturnType<typeof decide>, row: string, label: string) =>
  d.rows.find((r) => r.decision === row)!.conditions.find((c) => c.label.startsWith(label))!;

describe('the decision table', () => {
  it('a strong, clean week points to Game #2, with every condition shown', () => {
    const d = decide(inputs());
    expect(d.rows.map((r) => [r.decision, r.met])).toEqual([
      ['polish', false],
      ['game2', true],
      ['postpone', false],
    ]);
    expect(d.pointsTo).toEqual({
      decision: 'game2',
      title: 'Move toward Game #2',
      why: 'every condition holds',
    });
    expect(cond(d, 'game2', 'Play continues late')).toMatchObject({
      met: true,
      detail: 'days 5–7 at 80% of days 1–2',
    });
    expect(cond(d, 'game2', 'Play without reminders').detail).toBe(
      '69% of matches on days with no reminder',
    );
  });

  it('any polish trigger wins, and says which', () => {
    const d = decide(inputs({ report: report({ normal: 45 }), openBlockers: 1 }));
    expect(d.pointsTo.decision).toBe('polish');
    expect(d.pointsTo.why).toBe('A blocker is open; Completion < 80%');
    expect(d.rows[1]!.met).toBe(false);
  });

  it('middling play-again counts as polish only with fixable friction in the survey', () => {
    const middling = report({ rematches: 20, multiDay: 7 }); // 33%, 39%
    const calm = decide(inputs({ report: middling }));
    expect(cond(calm, 'polish', 'Play-again middling').met).toBe(false);
    const frustrated = decide(
      inputs({
        report: middling,
        survey: { ...survey(5, 3, 2), timer: { tooShort: 5, aboutRight: 4, tooLong: 1 } },
      }),
    );
    expect(cond(frustrated, 'polish', 'Play-again middling').met).toBe(true);
    expect(frustrated.pointsTo.decision).toBe('polish');
  });

  it("a game that works but that people don't come back to points to postponing", () => {
    const d = decide(
      inputs({
        report: report({ rematches: 6, multiDay: 4, daily: [20, 15, 6, 3, 2, 1, 1] }),
        survey: survey(1, 2, 7, 2, 2),
      }),
    );
    expect(cond(d, 'postpone', "People don't come back")).toMatchObject({
      met: true,
      detail: '4 weak',
    });
    expect(d.pointsTo.decision).toBe('postpone');
  });

  it('nobody inviting anyone is enough to postpone', () => {
    const d = decide(
      inputs({ report: report({ viaInvite: 0, outsiders: 0, rematches: 20, multiDay: 7 }) }),
    );
    expect(cond(d, 'postpone', 'or: nobody invites anyone').met).toBe(true);
    expect(d.pointsTo.decision).toBe('postpone');
  });

  it('missing inputs stay unknown and are listed, never guessed', () => {
    const d = decide(
      inputs({ survey: null, openBlockers: null, wrongResult: null, reminderDays: null }),
    );
    expect(d.rows[1]!.met).toBeNull();
    expect(cond(d, 'polish', 'A blocker is open')).toMatchObject({
      met: null,
      detail: 'pass --blockers N',
    });
    expect(d.pointsTo.decision).toBe('polish');
    expect(d.pointsTo.why).toMatch(/signals disagree/);
    expect(d.pointsTo.why).toMatch(/Still unknown: .*A blocker is open.*≥ 40% "very disappointed"/);
  });

  it('does not judge late-week play before the week is over', () => {
    const d = decide(inputs({ report: report({ until: '2026-10-16T00:00:00.000Z' }) }));
    expect(cond(d, 'game2', 'Play continues late')).toMatchObject({
      met: null,
      detail: 'the window is shorter than 7 days',
    });
  });

  it('prints the rows, what it points to and how the plan is read', () => {
    const s = survey(5, 3, 2);
    const text = formatDecision(decide(inputs({ survey: s })), s);
    expect(text).toContain('Survey: 10 responses · very disappointed 5/10');
    expect(text).toContain('✅ Move toward Game #2 (all of)');
    expect(text).toContain('   ✅ 50+ finished matches: 62');
    expect(text).toContain('The data points to: Move toward Game #2. Why: every condition holds.');
    expect(text).toContain("How the plan's wording is read:");
  });
});
