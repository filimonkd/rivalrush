import { expect, test, type Browser, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Defuser end to end with real browsers on the real server (dev/test only: the Playwright server
 * registers Defuser with DEFUSER_ENABLED and a fixed seed, which production refuses). The seed
 * deals the edition pinned in defuser-seed.json; a server test fails if that ever changes.
 * Set SHOTS=<dir> to save screenshots of the main screens.
 */

const pinned = JSON.parse(
  readFileSync(new URL('./defuser-seed.json', import.meta.url), 'utf8'),
) as {
  seed: string;
  editionLabel: string;
  solution: {
    fuse: { line: number };
    glyph: { first: number; second: number };
    valve: { level: number; vent: 'seal' | 'vent' };
  };
  wrongLines: number[];
};
const { solution, wrongLines, editionLabel } = pinned;
const shots = process.env.SHOTS;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
}

interface Player {
  name: string;
  page: Page;
  /** Every Socket.IO frame this browser received, in order. */
  frames: string[];
}

async function player(browser: Browser, name: string): Promise<Player> {
  const page = await (await browser.newContext()).newPage();
  const frames: string[] = [];
  page.on('websocket', (ws) =>
    ws.on('framereceived', (f) => {
      if (typeof f.payload === 'string') frames.push(f.payload);
    }),
  );
  // "Leave the team?" is a confirm dialog outside Telegram.
  page.on('dialog', (d) => void d.accept());
  await page.goto(`/?dev=${name}`);
  await expect(page.getByTestId('greeting')).toHaveText(`Hey, ${name}`);
  return { name, page, frames };
}

const game = (p: Player) => p.page.getByTestId('defuser-game');
const id = (p: Player, testId: string) => p.page.getByTestId(testId);

/** The host opens the hidden create route; the others join by the invite link and get ready. */
async function assemble(host: Player, guests: Player[]) {
  await host.page.goto('/create/defuser');
  await expect(id(host, 'defuser-create-info')).toBeVisible();
  await id(host, 'create-room').click();
  await expect(id(host, 'lobby-game')).toHaveText('Defuser');
  const invite = (await id(host, 'invite-link').textContent())!.trim();
  for (const g of guests) {
    await g.page.goto(new URL(invite).pathname);
    await expect(id(g, 'challenge-title')).toHaveText(
      `${host.name} needs a team to defuse a Charge`,
    );
    await id(g, 'join-game').click();
    await expect(id(g, 'lobby-game')).toHaveText('Defuser');
  }
  for (const g of guests) await id(g, 'ready-toggle').click();
  await expect(id(host, 'start-game')).toBeEnabled();
  await id(host, 'start-game').click();
}

/** Everyone sees the briefing; returns the Operator and the Analysts (the server picks). */
async function briefing(team: Player[]): Promise<{ op: Player; analysts: Player[] }> {
  for (const p of team) await expect(id(p, 'briefing')).toBeVisible();
  const kinds = await Promise.all(team.map((p) => game(p).getAttribute('data-kind')));
  expect(kinds.filter((k) => k === 'operator')).toHaveLength(1);
  expect(kinds.filter((k) => k === 'analyst')).toHaveLength(team.length - 1);
  const op = team[kinds.indexOf('operator')]!;
  return { op, analysts: team.filter((p) => p !== op) };
}

async function readyUp(team: Player[]) {
  for (const p of team) await id(p, 'ready').click();
  for (const p of team) await expect(game(p)).toHaveAttribute('data-phase', 'ARMED');
}

async function cut(op: Player, line: number) {
  await id(op, `fuse-line-${line}`).click();
  await id(op, 'cut-line').click();
}

const faults = async (team: Player[], n: number) => {
  for (const p of team) await expect(id(p, 'fault-pips')).toHaveAttribute('data-faults', String(n));
};

test('a team of three defuses the Charge: roles, faults, reconnect, all panels, debrief, rematch, history', async ({
  browser,
}) => {
  const ivy = await player(browser, 'Ivy');
  const jon = await player(browser, 'Jon');
  const kai = await player(browser, 'Kai');
  const team = [ivy, jon, kai];

  // Not offered on Home: no start button, only the "Coming soon" tile.
  await expect(ivy.page.getByText('Coming soon')).toBeVisible();
  await expect(id(ivy, 'start-defuser')).toHaveCount(0);
  await shot(ivy.page, 'df-1-home');

  await assemble(ivy, [jon, kai]);
  const { op, analysts } = await briefing(team);
  await expect(id(op, 'briefing-operator')).toContainText('You are the OPERATOR.');
  for (const a of analysts) {
    await expect(id(a, 'briefing-sheet-count')).toHaveText('You hold 3 of 6 sheets.');
    // Sheets are named during the briefing, never shown.
    await expect(id(a, 'sheet')).toHaveCount(0);
  }
  await shot(op.page, 'df-2-briefing-operator');
  await shot(analysts[0]!.page, 'df-3-briefing-analyst');

  await readyUp(team);

  // One game, two perspectives: only the Operator has the device, only Analysts have sheets.
  await expect(id(op, 'operator-console')).toBeVisible();
  await expect(id(op, 'sheet')).toHaveCount(0);
  await expect(id(op, 'role-band')).toContainText(`Edition ${editionLabel}`);
  for (const a of analysts) {
    await expect(id(a, 'analyst-manual')).toBeVisible();
    await expect(id(a, 'fuse-board')).toHaveCount(0);
    await expect(id(a, 'sheet-tabs').getByRole('tab')).toHaveCount(3);
  }
  await shot(op.page, 'df-4-operator');
  await shot(analysts[0]!.page, 'df-5-analyst');

  // A wrong cut is a fault for the whole team.
  await cut(op, wrongLines[0]!);
  await faults(team, 1);
  await expect(id(op, `fuse-line-${wrongLines[0]}`)).toHaveAttribute('data-cut', 'true');

  // The Operator reloads mid-game: the server's snapshot brings everything back.
  await op.page.reload();
  await expect(game(op)).toHaveAttribute('data-phase', 'ARMED');
  await expect(id(op, `fuse-line-${wrongLines[0]}`)).toHaveAttribute('data-cut', 'true');
  await faults([op], 1);

  // Fuse Lines.
  await cut(op, solution.fuse.line);
  await expect(id(op, 'tab-fuse')).toHaveAttribute('data-solved', 'true');
  for (const a of analysts)
    await expect(id(a, 'panel-dots').locator('[data-panel="fuse"]')).toHaveAttribute(
      'data-solved',
      'true',
    );

  // Glyph Ledger: two keys, in order; the first lights up from the server's snapshot.
  await id(op, 'tab-glyph').click();
  await id(op, `glyph-key-${solution.glyph.first}`).click();
  await expect(id(op, `glyph-key-${solution.glyph.first}`)).toHaveAttribute('data-lit', 'true');
  await id(op, `glyph-key-${solution.glyph.second}`).click();
  await expect(id(op, 'tab-glyph')).toHaveAttribute('data-solved', 'true');

  // Coolant Valve: set the lever, then hold to commit (a short press does nothing).
  await id(op, 'tab-valve').click();
  await id(op, `valve-level-${solution.valve.level}`).click();
  await id(op, `valve-${solution.valve.vent}`).click();
  const lever = id(op, 'valve-commit');
  await lever.focus();
  await op.page.keyboard.down('Space');
  await op.page.waitForTimeout(150);
  await op.page.keyboard.up('Space');
  await op.page.waitForTimeout(800);
  await expect(id(op, 'tab-valve')).toHaveAttribute('data-solved', 'false');
  await expect(game(op)).toHaveAttribute('data-phase', 'ARMED');

  // Nothing secret reached a browser while the game was live (checked before the end, after which
  // the debrief legitimately shows everything).
  const live = new Map(team.map((p) => [p, p.frames.length]));
  for (const p of team) {
    const frames = p.frames.slice(0, live.get(p));
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) {
      expect(f).not.toContain('"solution"');
      expect(f).not.toContain('"seed"');
      expect(f).not.toContain(pinned.seed);
      if (p === op) expect(f).not.toContain('"sheets"');
      else expect(f).not.toMatch(/"charge":\{/);
    }
  }

  await lever.focus();
  await op.page.keyboard.down('Space');
  await op.page.waitForTimeout(900);
  await op.page.keyboard.up('Space');

  for (const p of team) {
    await expect(id(p, 'result-title')).toHaveText('DEFUSED');
    await expect(id(p, 'result-panels')).toHaveText('3 / 3');
    await expect(id(p, 'result-faults')).toHaveText('1 / 3');
    await expect(id(p, 'result-you')).toHaveText('You helped defuse it.');
  }
  await shot(op.page, 'df-6-result');

  // The debrief shows the answers to everyone once the game is over.
  const a0 = analysts[0]!;
  await id(a0, 'open-debrief').click();
  await expect(id(a0, 'debrief-answer')).toContainText(`Cut line ${solution.fuse.line}`);
  await shot(a0.page, 'df-7-debrief');
  await id(a0, 'close-debrief').click();

  // Rematch: the result names the next Operator, and the server agrees.
  const nextIsMe = await Promise.all(
    team.map(async (p) => (await id(p, 'next-operator').textContent()) === 'Next Operator: You'),
  );
  expect(nextIsMe.filter(Boolean)).toHaveLength(1);
  const nextOp = team[nextIsMe.indexOf(true)]!;
  expect(nextOp).not.toBe(op);
  for (const p of team) await id(p, 'rematch').click();
  const second = await briefing(team);
  expect(second.op).toBe(nextOp);

  // History: the co-op game is listed with the team; competitive stats are untouched.
  await jon.page.goto('/profile');
  await expect(id(jon, 'match-list')).toContainText('Defuser');
  await expect(id(jon, 'match-list')).toContainText('Defused');
  await expect(id(jon, 'match-title').first()).toHaveText('with Ivy, Kai');
  await expect(id(jon, 'stat-played')).toHaveText('0');
  await shot(jon.page, 'df-8-history');
});

test('a team of two: three faults detonate, roles swap on rematch, a Leave ends the game', async ({
  browser,
}) => {
  const lea = await player(browser, 'Lea');
  const max = await player(browser, 'Max');
  const team = [lea, max];

  await assemble(lea, [max]);
  const { op, analysts } = await briefing(team);
  const analyst = analysts[0]!;
  // With two players the only Analyst holds all six sheets.
  await expect(id(analyst, 'briefing-sheet-count')).toHaveText('You hold 6 of 6 sheets.');
  await readyUp(team);
  await expect(id(analyst, 'sheet-tabs').getByRole('tab')).toHaveCount(6);

  await cut(op, wrongLines[0]!);
  await faults(team, 1);
  await cut(op, wrongLines[1]!);
  await faults(team, 2);
  for (const p of team)
    await expect(id(p, 'fault-bar')).toHaveText('One more fault detonates the Charge');
  await shot(op.page, 'df-9-two-faults');
  await cut(op, wrongLines[2]!);

  for (const p of team) {
    await expect(id(p, 'result-title')).toHaveText('DETONATION');
    await expect(id(p, 'result-detail')).toHaveText('3 faults');
    await expect(id(p, 'result-you')).toHaveText('The team lost this one.');
  }
  await shot(analyst.page, 'df-10-detonation');

  // Two players swap roles on a rematch.
  for (const p of team) await id(p, 'rematch').click();
  const second = await briefing(team);
  expect(second.op).toBe(analyst);

  // The new Analyst leaves from the team drawer: fewer than two players, so the game ends.
  // The room then drops the finished game (as after any Leave), so the one left waits in the
  // lobby for a new teammate and is told why.
  const leaver = second.analysts[0]!;
  await id(leaver, 'open-team').click();
  await id(leaver, 'leave-team').click();
  await expect(
    id(second.op, 'toast').filter({ hasText: 'Game ended: not enough players' }),
  ).toBeVisible();
  await expect(id(second.op, 'lobby-game')).toHaveText('Defuser');
  await expect(id(second.op, 'defuser-game')).toHaveCount(0);
  await expect(id(leaver, 'greeting')).toBeVisible();
  await shot(second.op.page, 'df-11-ended');
});
