// @vitest-environment jsdom
import type { RoomEvent } from '@rivalrush/shared';
import { screen } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { describeEvent } from '../../src/store/roomLogic';
import { mount, reset, scene, viewOf } from './harness';

/**
 * The client renders the role view it is sent and nothing more. These tests hand the screen views
 * carrying fields a role must never see (as if the server had leaked them) and check none of it
 * reaches the page: the screen reads fields by role, it does not hide extra data with CSS.
 */

afterEach(reset);

const MARK = 'LEAKED-7f3a';
const debrief = viewOf(scene('debrief-defused')) as unknown as {
  charge: unknown;
  sheets: { id: string }[];
  solution: unknown;
};
const text = () => document.body.textContent ?? '';

function poison(view: object) {
  Object.assign(view, {
    seed: MARK,
    solution: debrief.solution,
    codebook: { owner: MARK },
    solverState: MARK,
    hidden: MARK,
  });
}

describe('role views are rendered by role, never by hiding', () => {
  it("an Analyst view never draws the Charge, the solution or another Analyst's sheet", () => {
    const snap = scene('analyst-3p');
    const view = viewOf(snap);
    poison(view);
    Object.assign(view, { charge: debrief.charge, litKey: 2, otherSheets: debrief.sheets });
    mount(snap);
    expect(screen.queryByTestId('fuse-board')).toBeNull();
    expect(screen.queryByTestId('glyph-board')).toBeNull();
    expect(screen.queryByTestId('valve-board')).toBeNull();
    expect(screen.queryByTestId('debrief-answer')).toBeNull();
    expect(screen.queryByTestId('sheet-tab-fuse.reference')).toBeNull();
    expect(text()).not.toContain(MARK);
    expect(text()).not.toMatch(/correct/i);
  });

  it('an Operator view never draws a sheet, even if one is attached', () => {
    const snap = scene('operator-fuse');
    const view = viewOf(snap);
    poison(view);
    Object.assign(view, { sheets: debrief.sheets });
    mount(snap);
    expect(screen.queryByTestId('analyst-manual')).toBeNull();
    expect(screen.queryAllByTestId('sheet')).toHaveLength(0);
    expect(text()).not.toContain('PROCEDURE');
    expect(text()).not.toContain(MARK);
    expect(text()).not.toContain('✓ CUT');
  });

  it('an inactive view draws neither the Charge nor any sheet', () => {
    const snap = scene('inactive-analyst');
    const view = viewOf(snap);
    poison(view);
    Object.assign(view, { charge: debrief.charge, sheets: debrief.sheets });
    mount(snap);
    expect(screen.queryByTestId('fuse-board')).toBeNull();
    expect(screen.queryAllByTestId('sheet')).toHaveLength(0);
    expect(text()).not.toContain(MARK);
  });

  it('a briefing view draws no sheet content and no Charge', () => {
    for (const name of ['briefing-analyst', 'briefing-operator'] as const) {
      const snap = scene(name);
      const view = viewOf(snap);
      poison(view);
      Object.assign(view, { sheets: debrief.sheets, charge: debrief.charge });
      mount(snap);
      expect(screen.queryAllByTestId('sheet')).toHaveLength(0);
      expect(screen.queryByTestId('fuse-board')).toBeNull();
      expect(text()).not.toContain(MARK);
      reset();
    }
  });

  it('a live screen ignores the solution even when the server view carries one', () => {
    const snap = scene('operator-fuse');
    poison(viewOf(snap));
    mount(snap);
    for (const n of [1, 2, 3, 4, 5]) {
      expect(screen.getByTestId(`fuse-line-${n}`).textContent).not.toContain('✓');
    }
    expect(screen.queryByTestId('debrief-answer')).toBeNull();
  });
});

describe('fault feedback never reveals the answer', () => {
  const fault = (data: Record<string, unknown>): RoomEvent =>
    ({ type: 'fault', at: 0, actorId: 'p1', data }) as unknown as RoomEvent;

  it('names only the chosen input, whatever else the event carries', () => {
    for (const role of ['operator-fuse', 'analyst-3p'] as const) {
      const snap = scene(role);
      const out = describeEvent(
        fault({ panel: 'fuse', faults: 1, input: { line: 2 }, correct: 5, solution: { line: 5 } }),
        snap,
        viewOf(snap).me,
      )!;
      expect(out.text).toContain('line 2');
      expect(out.text).not.toMatch(/5|correct/i);
    }
  });
});

describe('the bundle cannot reach server code', () => {
  const SRC = join(__dirname, '../../src');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
    });
  const imports = (file: string) =>
    [...readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(
      (m) => m[1]!,
    );

  it('imports nothing from the server, its generator or its solver', () => {
    const all = files(SRC);
    expect(all.length).toBeGreaterThan(20);
    const bad = all.flatMap((f) =>
      imports(f)
        .filter((i) =>
          /apps\/server|@rivalrush\/server|(^|\/)server\/|generator|solver|prng|edition|transitions|dropout/i.test(
            i,
          ),
        )
        .map((i) => `${f}: ${i}`),
    );
    expect(bad).toEqual([]);
  });

  it('only imports the shared package and its own files', () => {
    const external = new Set(
      files(SRC)
        .flatMap(imports)
        .filter((i) => !i.startsWith('.'))
        .map((i) => (i.startsWith('@') ? i.split('/').slice(0, 2).join('/') : i.split('/')[0]!)),
    );
    expect([...external].filter((i) => i.startsWith('@rivalrush/'))).toEqual(['@rivalrush/shared']);
  });
});
