/**
 * The end-of-week survey (docs/beta-plan.md#feedback), read from a Google Forms or Tally CSV
 * export. Columns are found by their question text, so extra columns (timestamp, submission
 * id) and a different order are fine. Only counts leave this module: names and free-text
 * answers are never returned.
 */

export interface SurveySummary {
  responses: number;
  /** Q3: If RivalRush disappeared tomorrow, how would you feel? */
  disappointed: { very: number; somewhat: number; not: number };
  /** Q4: Would you keep playing next week if nobody reminded you? */
  keepPlaying: { yes: number; maybe: number; no: number };
  /** Q5: Did you invite anyone outside the beta group? */
  invitedOutside: { yes: number; no: number };
  /** Q7: Were the rules clear after your first game? (1–5); null without answers. */
  rulesClear: { average: number | null; answers: number };
  /** Q8: The turn timer felt… */
  timer: { tooShort: number; aboutRight: number; tooLong: number };
  /** Q11: What would make you play more? */
  playMore: { betterGame: number; differentGame: number; neither: number };
  /** Q6, Q9, Q10, Q12: how many people wrote something (read them in the form itself). */
  wroteText: { playAgainWhy: number; annoyed: number; broke: number; other: number };
  /** Questions the export did not contain. */
  missing: string[];
}

/** RFC 4180 CSV: quoted fields, "" escapes, commas and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const QUESTIONS = {
  disappointed: /disappeared tomorrow/i,
  keepPlaying: /nobody reminded/i,
  invitedOutside: /invite anyone outside/i,
  rulesClear: /rules clear/i,
  timer: /turn timer/i,
  playMore: /play more/i,
  playAgainWhy: /want to play again/i,
  annoyed: /annoyed you/i,
  broke: /anything break/i,
  other: /anything else/i,
} as const;

type Key = keyof typeof QUESTIONS;

export function summarizeSurvey(csv: string): SurveySummary {
  const [header = [], ...rows] = parseCsv(csv);
  const col = {} as Record<Key, number>;
  const missing: string[] = [];
  for (const [key, re] of Object.entries(QUESTIONS) as Array<[Key, RegExp]>) {
    col[key] = header.findIndex((h) => re.test(h));
    if (col[key] < 0) missing.push(key);
  }
  const answer = (r: string[], key: Key) => (col[key] >= 0 ? (r[col[key]] ?? '').trim() : '');
  const starts = (r: string[], key: Key, prefix: string) =>
    answer(r, key).toLowerCase().startsWith(prefix);
  const count = (key: Key, prefix: string) => rows.filter((r) => starts(r, key, prefix)).length;
  const wrote = (key: Key) => rows.filter((r) => answer(r, key) !== '').length;
  const rules = rows
    .map((r) => Number.parseInt(answer(r, 'rulesClear'), 10))
    .filter((v) => v >= 1 && v <= 5);
  return {
    responses: rows.length,
    disappointed: {
      very: count('disappointed', 'very'),
      somewhat: count('disappointed', 'somewhat'),
      not: count('disappointed', 'not'),
    },
    keepPlaying: {
      yes: count('keepPlaying', 'yes'),
      maybe: count('keepPlaying', 'maybe'),
      no: count('keepPlaying', 'no'),
    },
    invitedOutside: { yes: count('invitedOutside', 'yes'), no: count('invitedOutside', 'no') },
    rulesClear: {
      average: rules.length ? rules.reduce((a, b) => a + b, 0) / rules.length : null,
      answers: rules.length,
    },
    timer: {
      tooShort: count('timer', 'too short'),
      aboutRight: count('timer', 'about right'),
      tooLong: count('timer', 'too long'),
    },
    playMore: {
      betterGame: count('playMore', 'better'),
      differentGame: count('playMore', 'a different'),
      neither: count('playMore', 'neither'),
    },
    wroteText: {
      playAgainWhy: wrote('playAgainWhy'),
      annoyed: wrote('annoyed'),
      broke: wrote('broke'),
      other: wrote('other'),
    },
    missing,
  };
}
