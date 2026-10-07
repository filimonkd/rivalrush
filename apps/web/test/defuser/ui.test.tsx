// @vitest-environment jsdom
import { SHEETS, type DefuserTriedEntries } from '@rivalrush/shared';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRoom } from '../../src/store/room';
import { mount, next, reset, scene, viewOf } from './harness';

afterEach(reset);

const id = (testId: string) => screen.getByTestId(testId);
const maybe = (testId: string) => screen.queryByTestId(testId);
const click = async (el: HTMLElement) => {
  await act(async () => {
    fireEvent.click(el);
  });
};

describe('role-based rendering', () => {
  it('renders the Operator console, and no manual, for the Operator', () => {
    mount(scene('operator-fuse'));
    expect(id('defuser-game').dataset.kind).toBe('operator');
    expect(id('role-band').dataset.role).toBe('operator');
    expect(id('operator-console')).toBeTruthy();
    expect(id('fuse-board')).toBeTruthy();
    expect(maybe('analyst-manual')).toBeNull();
    expect(screen.queryAllByTestId('sheet')).toHaveLength(0);
  });

  it("renders only the Analyst's own sheets, and no device, for an Analyst", () => {
    const snap = scene('analyst-3p');
    mount(snap);
    expect(id('role-band').textContent).toContain('ANALYST A');
    expect(maybe('operator-console')).toBeNull();
    expect(maybe('fuse-board')).toBeNull();
    const mine = viewOf(snap).kind === 'analyst' ? viewOf(snap) : null;
    const held = (mine as { sheets: { id: string }[] }).sheets.map((s) => s.id);
    expect(held).toEqual(['fuse.procedure', 'glyph.procedure', 'valve.reference']);
    const tabs = within(id('sheet-tabs')).getAllByRole('tab');
    expect(tabs.map((t) => t.dataset.testid)).toEqual(held.map((s) => `sheet-tab-${s}`));
    for (const s of SHEETS.filter((x) => !held.includes(x.id))) {
      expect(maybe(`sheet-tab-${s.id}`)).toBeNull();
    }
  });

  it('switches between the sheets the Analyst holds, one at a time', async () => {
    mount(scene('analyst-3p'));
    expect(screen.getAllByTestId('sheet')).toHaveLength(1);
    expect(id('sheet').dataset.sheet).toBe('fuse.procedure');
    await click(id('sheet-tab-valve.reference'));
    expect(id('sheet').dataset.sheet).toBe('valve.reference');
  });

  it('shows a two-player Analyst all six sheets and a four-player Analyst two', () => {
    mount(scene('analyst-2p'));
    expect(within(id('sheet-tabs')).getAllByRole('tab')).toHaveLength(6);
    reset();
    mount(scene('analyst-4p'));
    expect(within(id('sheet-tabs')).getAllByRole('tab')).toHaveLength(2);
  });

  it('lists every sheet in the index with its holder, without its content', () => {
    mount(scene('analyst-3p'));
    const rows = within(id('sheet-index')).getAllByRole('listitem');
    expect(rows).toHaveLength(6);
    const ref = rows.find((r) => r.dataset.sheet === 'fuse.reference')!;
    expect(ref.dataset.mine).toBe('false');
    expect(ref.textContent).toContain('→ Cy');
    const own = rows.find((r) => r.dataset.sheet === 'fuse.procedure')!;
    expect(own.textContent).toContain('→ You');
    // Locked sheets are named, never rendered.
    expect(screen.queryAllByTestId('sheet').map((s) => s.dataset.sheet)).toEqual([
      'fuse.procedure',
    ]);
  });
});

describe('briefing', () => {
  it('tells the Operator their role and that only they see the Charge', () => {
    mount(scene('briefing-operator'));
    expect(id('briefing-operator').textContent).toContain('You are the OPERATOR.');
    expect(id('briefing-operator').textContent).toContain('Only you see the Charge.');
    expect(maybe('fuse-board')).toBeNull();
    expect(id('countdown').textContent).toBe('0:14');
  });

  it('tells an Analyst their letter and how many sheets they hold, and who holds the rest', () => {
    mount(scene('briefing-analyst'));
    expect(id('briefing-analyst').textContent).toContain('You are ANALYST A.');
    expect(id('briefing-sheet-count').textContent).toBe('You hold 3 of 6 sheets.');
    expect(id('briefing-analyst').textContent).toContain('Cy holds the rest.');
    expect(within(id('briefing-sheets')).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryAllByTestId('sheet')).toHaveLength(0);
  });

  it('sends READY and then shows who it is waiting for', async () => {
    const snap = scene('briefing-analyst');
    const h = mount(snap);
    expect(id('ready').textContent).toBe("I'm ready");
    await click(id('ready'));
    expect(h.sent).toEqual([{ type: 'READY' }]);
    h.push(
      next(snap, (v) => {
        v.roster.find((r) => r.userId === v.me)!.ready = true;
      }),
    );
    expect(id('ready').textContent).toBe('Waiting for 2 more…');
    expect((id('ready') as HTMLButtonElement).disabled).toBe(true);
    const rows = within(id('briefing-roster')).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
  });
});

describe('Fuse Lines', () => {
  it('cuts only after a line is chosen, and sends the line as an intent', async () => {
    const h = mount(scene('operator-fuse'));
    const cut = id('cut-line') as HTMLButtonElement;
    expect(cut.disabled).toBe(true);
    expect(cut.textContent).toBe('Tap a line, then cut it');
    await click(id('fuse-line-4'));
    expect(id('fuse-line-4').dataset.selected).toBe('true');
    expect(cut.textContent).toBe('Cut line 4');
    await click(cut);
    expect(h.sent).toEqual([{ type: 'CUT_LINE', line: 4 }]);
    // Nothing is decided locally: the line is not shown cut until the server says so.
    expect(id('fuse-line-4').dataset.cut).toBe('false');
  });

  it('shows the cut lines from the snapshot and keeps them out of reach', () => {
    mount(scene('operator-1fault'));
    expect(id('fuse-line-1').dataset.cut).toBe('true');
    expect((id('fuse-line-1') as HTMLButtonElement).disabled).toBe(true);
    expect(id('fault-pips').dataset.faults).toBe('1');
  });

  it('opens on the first unsolved panel and shows a solved one as solved', async () => {
    mount(scene('operator-fuse-solved'));
    expect(id('tab-glyph').getAttribute('aria-selected')).toBe('true');
    await click(id('tab-fuse'));
    expect(id('solved-banner').textContent).toContain('Fuse Lines solved');
    expect((id('cut-line') as HTMLButtonElement).disabled).toBe(true);
    expect(id('tab-fuse').dataset.solved).toBe('true');
  });
});

describe('faults', () => {
  it('flashes, fills a pip and names only the input the Operator chose', () => {
    const snap = scene('operator-fuse');
    const h = mount(snap);
    h.push(
      next(snap, (v) => {
        v.faults = 1;
        v.cutLines = [1];
        v.tried.fuse = [1];
      }),
    );
    expect(id('fault-flash')).toBeTruthy();
    expect(id('fault-pips').dataset.faults).toBe('1');
    expect(maybe('fault-bar')).toBeNull();
    expect(document.body.textContent).not.toMatch(/correct/i);
  });

  it('warns that one more fault detonates the Charge at two faults', () => {
    mount(scene('operator-2faults'));
    expect(id('fault-bar').textContent).toBe('One more fault detonates the Charge');
  });

  it("shows the server's refusal as a short line and never guesses an outcome", async () => {
    const h = mount(scene('operator-fuse'), () => ({
      code: 'INVALID_ACTION',
      message: 'nope',
      details: { rule: 'line_cut' },
    }));
    await click(id('fuse-line-2'));
    await click(id('cut-line'));
    expect(h.toasts()).toContain('That line is already cut.');
    expect(id('fault-pips').dataset.faults).toBe('0');
  });

  it('resyncs when the server says the game already ended', async () => {
    const h = mount(scene('operator-fuse'), () => ({ code: 'GAME_FINISHED', message: 'x' }));
    await click(id('fuse-line-2'));
    await click(id('cut-line'));
    expect(h.resync).toHaveBeenCalled();
  });
});

describe('Glyph Ledger', () => {
  it('sends each key press in order, as intents', async () => {
    const h = mount(scene('operator-fuse'));
    await click(id('tab-glyph'));
    expect(id('glyph-hint').textContent).toContain('Order matters');
    await click(id('glyph-key-3'));
    await click(id('glyph-key-1'));
    expect(h.sent).toEqual([
      { type: 'PRESS_GLYPH', key: 3 },
      { type: 'PRESS_GLYPH', key: 1 },
    ]);
    // The lit key comes from the server, not from the tap.
    expect(id('glyph-key-3').dataset.lit).toBe('false');
  });

  it('shows the lit first key from the snapshot', async () => {
    const snap = scene('operator-fuse');
    const h = mount(snap);
    await click(id('tab-glyph'));
    h.push(next(snap, (v) => v.kind === 'operator' && (v.litKey = 2)));
    expect(id('glyph-key-2').dataset.lit).toBe('true');
    expect((id('glyph-key-2') as HTMLButtonElement).disabled).toBe(true);
    expect(id('glyph-hint').textContent).toBe('Key 2 is lit. Now press the second key.');
  });

  it('marks known-wrong keys as tried', async () => {
    const snap = scene('operator-fuse');
    const h = mount(snap);
    await click(id('tab-glyph'));
    h.push(
      next(snap, (v) => {
        v.tried.glyph = [{ first: 4, second: null }] as DefuserTriedEntries['glyph'];
      }),
    );
    expect(id('glyph-key-4').dataset.tried).toBe('true');
    expect((id('glyph-key-4') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Coolant Valve', () => {
  const press = (el: HTMLElement) => act(() => void fireEvent.pointerDown(el));
  const release = (el: HTMLElement) => act(() => void fireEvent.pointerUp(el));
  const wait = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  async function valve() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const snap = scene('operator-fuse');
    const h = mount(snap);
    await click(id('tab-valve'));
    return { h, snap };
  }

  it('commits level and switch only after an uninterrupted hold', async () => {
    const { h } = await valve();
    await click(id('valve-level-3'));
    await click(id('valve-vent'));
    const lever = id('valve-commit');
    expect(lever.textContent).toBe('HOLD TO COMMIT');
    press(lever);
    expect(lever.dataset.holding).toBe('true');
    await wait(599);
    expect(h.sent).toEqual([]);
    await wait(1);
    expect(h.sent).toEqual([{ type: 'SET_VALVE', level: 3, vent: 'vent' }]);
    release(lever);
  });

  it('does nothing when released early', async () => {
    const { h } = await valve();
    const lever = id('valve-commit');
    press(lever);
    await wait(300);
    release(lever);
    expect(lever.dataset.holding).toBe('false');
    await wait(1000);
    expect(h.sent).toEqual([]);
  });

  it('cancels when the finger slides off the lever', async () => {
    const { h } = await valve();
    const lever = id('valve-commit');
    press(lever);
    await wait(200);
    act(() => void fireEvent.pointerLeave(lever));
    await wait(1000);
    expect(h.sent).toEqual([]);
  });

  it('refuses a pair already tried and resets the controls after a fault', async () => {
    const { h, snap } = await valve();
    await click(id('valve-level-4'));
    await click(id('valve-vent'));
    h.push(
      next(snap, (v) => {
        v.faults = 1;
        v.tried.valve = [{ level: 4, vent: 'vent' }];
      }),
    );
    // A wrong commit puts the lever back to level 1 / SEAL.
    expect(id('valve-level-1').getAttribute('aria-pressed')).toBe('true');
    expect(id('valve-seal').getAttribute('aria-pressed')).toBe('true');
    await click(id('valve-level-4'));
    await click(id('valve-vent'));
    expect(id('valve-commit').textContent).toBe('ALREADY TRIED');
    expect((id('valve-commit') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('timer', () => {
  it('counts down from the server deadline', () => {
    mount(scene('operator-fuse', 187_000));
    expect(id('countdown').textContent).toBe('3:07');
    expect(id('top-strip').dataset.urgent).toBe('false');
  });

  it('turns urgent in the last 30 seconds', () => {
    mount(scene('operator-fuse', 25_000));
    expect(id('top-strip').dataset.urgent).toBe('true');
  });

  it('never decides a timeout itself: it asks the server', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const h = mount(scene('operator-fuse', 0));
    expect(id('countdown').textContent).toBe('0:00');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
    });
    expect(h.resync).toHaveBeenCalled();
    expect(maybe('result-sheet')).toBeNull();
    expect(id('defuser-game').dataset.phase).toBe('ARMED');
  });

  it("shows the server's timeout as the result", () => {
    const h = mount(scene('operator-fuse', 0));
    h.push(scene('debrief-timer'));
    expect(id('result-title').textContent).toBe('DETONATION');
    expect(id('result-detail').textContent).toBe('Time ran out');
  });
});

describe('reconnect and role changes', () => {
  it('announces a promotion seen in a later snapshot', async () => {
    const h = mount(scene('analyst-3p'));
    h.push(scene('promoted-operator'));
    expect(id('promotion').textContent).toContain('You are now the Operator');
    expect(id('operator-console')).toBeTruthy();
    await click(id('promotion-ok'));
    expect(maybe('promotion')).toBeNull();
  });

  it('does not call a rematch a promotion', () => {
    const h = mount(scene('debrief-defused'));
    const op = scene('promoted-operator');
    op.game!.sessionId = 'another-session';
    h.push(op);
    expect(maybe('promotion')).toBeNull();
  });

  it('tells the team when someone times out', () => {
    const snap = scene('analyst-3p');
    const h = mount(snap);
    h.push(
      next(snap, (v) => {
        v.roster.find((r) => r.userId === 'p3')!.status = 'timed_out';
      }),
    );
    expect(id('notice').textContent).toBe('Cy timed out');
  });

  it('adds redistributed sheets from the snapshot', () => {
    const snap = scene('analyst-3p');
    const other = viewOf(scene('analyst-3p-b')) as { sheets: unknown[] };
    const h = mount(snap);
    h.push(
      next(snap, (v) => {
        if (v.kind === 'analyst') v.sheets = [...v.sheets, other.sheets[0]] as typeof v.sheets;
      }),
    );
    expect(id('sheet-tab-fuse.reference')).toBeTruthy();
  });

  it('offers a timed-out Analyst a way back, naming who has their sheets', async () => {
    const h = mount(scene('inactive-analyst'));
    expect(id('inactive-screen').textContent).toContain('went to');
    await click(id('rejoin'));
    expect(h.sent).toEqual([{ type: 'REJOIN' }]);
  });

  it("names a teammate who left from the room's memory", () => {
    const snap = scene('analyst-3p');
    snap.players = snap.players.filter((p) => p.userId !== 'p3');
    mount(snap);
    act(() => useRoom.setState({ names: { p3: 'Cy' } }));
    const ref = within(id('sheet-index'))
      .getAllByRole('listitem')
      .find((r) => r.dataset.sheet === 'fuse.reference')!;
    expect(ref.textContent).toContain('→ Cy');
  });
});

describe('results', () => {
  it('shows DEFUSED with time left, and offers a rematch through the room', async () => {
    const h = mount(scene('debrief-defused'));
    expect(id('result-sheet').dataset.outcome).toBe('defused');
    expect(id('result-title').textContent).toBe('DEFUSED');
    expect(id('result-detail').textContent).toBe('3:11 left');
    expect(id('result-panels').textContent).toBe('3 / 3');
    expect(id('result-you').textContent).toBe('You helped defuse it.');
    expect(id('next-operator').textContent).toBe('Next Operator: Ben');
    await click(id('rematch'));
    expect(h.rematch).toHaveBeenCalledTimes(1);
  });

  it('shows DETONATION for three faults', () => {
    mount(scene('debrief-faults'));
    expect(id('result-title').textContent).toBe('DETONATION');
    expect(id('result-detail').textContent).toBe('3 faults');
    expect(id('result-faults').textContent).toBe('3 / 3');
  });

  it('shows GAME ENDED when the team fell apart', () => {
    mount(scene('debrief-abandoned'));
    expect(id('result-sheet').dataset.outcome).toBe('abandoned');
    expect(id('result-title').textContent).toBe('GAME ENDED');
  });

  it('opens the debrief with the Charge, the answers and every sheet', async () => {
    mount(scene('debrief-defused'));
    await click(id('open-debrief'));
    expect(id('debrief-answer').textContent).toContain('Cut line 3');
    expect(screen.getAllByTestId('sheet').map((s) => s.dataset.sheet)).toEqual([
      'fuse.procedure',
      'fuse.reference',
    ]);
    await click(id('debrief-tab-glyph'));
    expect(id('debrief-answer').textContent).toBe('Correct inputKey 1, then key 2');
    await click(id('close-debrief'));
    expect(id('result-sheet')).toBeTruthy();
  });
});
