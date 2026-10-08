import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import mongoose from 'mongoose';
import { decide, formatDecision } from './betaDecision.js';
import { computeBetaReport } from './betaReport.js';
import { formatBetaReport, parseDay, parseTesters } from './betaReportFormat.js';
import { summarizeSurvey } from './survey.js';

/**
 * Prints the closed-beta metrics (docs/beta-plan.md#metrics).
 *
 *   MONGODB_URI=… npm run beta:report -w @rivalrush/server -- --since 2026-10-12 [--until 2026-10-19]
 *     [--tz Europe/Berlin] [--testers testers.txt] [--json]
 *     [--decide [--survey survey.csv] [--blockers N] [--wrong-result] [--reminder-days D1,D2]]
 *
 * --decide adds the beta plan's decision table, worked out from the numbers and the survey
 * export (docs/beta-plan.md#what-happens-after-the-beta).
 *
 * Read-only: aggregations and counts only, no index builds. Use a read-only database user.
 * The connection string is never printed; only the database name is.
 */
const USAGE =
  'Usage: MONGODB_URI=… npm run beta:report -w @rivalrush/server -- --since YYYY-MM-DD ' +
  '[--until YYYY-MM-DD] [--tz Area/City] [--testers file] [--json] ' +
  '[--decide [--survey file.csv] [--blockers N] [--wrong-result] [--reminder-days YYYY-MM-DD,…]]\n';

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      since: { type: 'string' },
      until: { type: 'string' },
      tz: { type: 'string', default: 'UTC' },
      testers: { type: 'string' },
      json: { type: 'boolean', default: false },
      decide: { type: 'boolean', default: false },
      survey: { type: 'string' },
      blockers: { type: 'string' },
      'wrong-result': { type: 'boolean' },
      'reminder-days': { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help || !values.since) {
    process.stderr.write(USAGE);
    return values.help ? 0 : 2;
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    process.stderr.write('MONGODB_URI is not set (use a read-only database user).\n' + USAGE);
    return 2;
  }
  const timeZone = values.tz;
  const since = parseDay(values.since, timeZone);
  // --until names the last day included, so the window ends at the following midnight.
  const until = values.until
    ? new Date(parseDay(values.until, timeZone).getTime() + 24 * 3600 * 1000)
    : new Date();
  if (until.getTime() <= since.getTime()) {
    process.stderr.write(
      `The window is empty: ${since.toISOString()} is not before ${until.toISOString()}.\n`,
    );
    return 2;
  }
  const testers = values.testers ? parseTesters(readFileSync(values.testers, 'utf8')) : null;
  const survey = values.survey ? summarizeSurvey(readFileSync(values.survey, 'utf8')) : null;
  const blockers = values.blockers === undefined ? null : Number(values.blockers);
  if (blockers !== null && !(Number.isInteger(blockers) && blockers >= 0)) {
    process.stderr.write(`--blockers needs a whole number, got ${values.blockers}\n`);
    return 2;
  }
  const reminderDays = values['reminder-days']
    ? values['reminder-days'].split(',').map((d) => d.trim())
    : null;
  if (reminderDays?.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) {
    process.stderr.write('--reminder-days needs YYYY-MM-DD dates, separated by commas\n');
    return 2;
  }

  await mongoose.connect(uri, {
    ...(process.env.MONGODB_DB_NAME ? { dbName: process.env.MONGODB_DB_NAME } : {}),
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 15_000,
  });
  try {
    const db = mongoose.connection.db!;
    if (
      (await db.listCollections({ name: 'matches' }, { nameOnly: true }).toArray()).length === 0
    ) {
      process.stderr.write(
        `Database "${db.databaseName}" has no matches collection. Set MONGODB_DB_NAME ` +
          '(production: rivalrush).\n',
      );
      return 2;
    }
    const report = await computeBetaReport({ since, until, timeZone }, testers);
    const decision = values.decide
      ? decide({
          report,
          survey,
          openBlockers: blockers,
          wrongResult: values['wrong-result'] ?? null,
          reminderDays,
        })
      : null;
    process.stdout.write(
      values.json
        ? JSON.stringify(decision ? { report, survey, decision } : report, null, 2) + '\n'
        : formatBetaReport(report, mongoose.connection.name) +
            (decision ? formatDecision(decision, survey) : ''),
    );
  } finally {
    await mongoose.disconnect();
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    // Driver errors can quote the connection string; print only the message, redacted.
    let msg = err instanceof Error ? err.message : String(err);
    const uri = process.env.MONGODB_URI;
    if (uri) msg = msg.split(uri).join('<uri>');
    msg = msg.replace(/mongodb(\+srv)?:\/\/[^\s"']+/g, '<uri>');
    process.stderr.write(`beta report failed: ${msg}\n`);
    process.exit(1);
  },
);
