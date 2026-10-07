import type { DefuserRosterEntry, RoomEvent, RoomSnapshot } from '@rivalrush/shared';
import { describe, expect, it } from 'vitest';
import {
  becameOperator,
  clock,
  crossedTick,
  errorText,
  faultText,
  indexRows,
  nameFrom,
  nextOperatorId,
  resultHeadline,
  rosterNotices,
  urgency,
  type View,
} from '../../src/features/defuser/model';
import { describeEvent, rememberNames } from '../../src/store/roomLogic';
import fixtures from './fixtures.json';

const snap = (name: keyof typeof fixtures) =>
  structuredClone(fixtures[name]) as unknown as RoomSnapshot;
const view = (name: keyof typeof fixtures) => snap(name).game!.view as View;
const seat = (
  userId: string,
  letter: string | null,
  role: DefuserRosterEntry['role'] = 'analyst',
) => ({ userId, role, letter, status: 'active', ready: true }) as DefuserRosterEntry;

describe('clock and urgency (presentation only)', () => {
  it('formats a countdown', () => {
    expect(clock(187_000)).toBe('3:07');
    expect(clock(6_100)).toBe('0:07');
    expect(clock(0)).toBe('0:00');
    expect(clock(null)).toBe('–:––');
  });

  it('turns urgent at 30 seconds', () => {
    expect(urgency(30_001)).toBe('calm');
    expect(urgency(30_000)).toBe('urgent');
    expect(urgency(null)).toBe('calm');
  });

  it('ticks when crossing 30, 20 and 10 seconds only', () => {
    expect(crossedTick(30_100, 29_900)).toBe(true);
    expect(crossedTick(20_300, 19_800)).toBe(true);
    expect(crossedTick(10_001, 10_000)).toBe(true);
    expect(crossedTick(29_900, 29_600)).toBe(false);
    expect(crossedTick(null, 9_000)).toBe(false);
  });
});

describe('next Operator (mirrors the server rotation from public data)', () => {
  const roster = [seat('a', null, 'operator'), seat('b', 'A'), seat('c', 'B'), seat('d', 'C')];

  it('is the seat after the starting Operator', () => {
    expect(nextOperatorId(roster, ['a', 'b', 'c', 'd'])).toBe('b');
  });

  it('skips players who are no longer seated', () => {
    expect(nextOperatorId(roster, ['a', 'c', 'd'])).toBe('c');
  });

  it('finds the starting Operator after a promotion (the letters still say who started)', () => {
    const promoted = [seat('a', null, null), seat('b', 'A', 'operator'), seat('c', 'B')];
    expect(nextOperatorId(promoted, ['a', 'b', 'c'])).toBe('b');
  });

  it('wraps around the table', () => {
    const r = [seat('a', 'B'), seat('b', null, 'operator'), seat('c', 'A')];
    expect(nextOperatorId(r, ['a', 'b', 'c'])).toBe('c');
    expect(nextOperatorId(r, ['a', 'b'])).toBe('a');
  });

  it('agrees with the result screen fixture', () => {
    const v = view('debrief-defused');
    expect(nextOperatorId(v.roster, ['p1', 'p2', 'p3'])).toBe('p2');
  });
});

describe('role changes and roster notices', () => {
  it('detects a promotion only within one live game', () => {
    const before = view('analyst-3p');
    const after = view('promoted-operator');
    expect(becameOperator(before, after)).toBe(true);
    expect(becameOperator(null, after)).toBe(false);
    expect(becameOperator(view('debrief-defused'), after)).toBe(false);
    expect(becameOperator(after, before)).toBe(false);
  });

  it('describes a time-out, a rejoin, a Leave and a new Operator', () => {
    const before = view('analyst-3p');
    const out = structuredClone(before);
    out.version += 1;
    out.roster[2]!.status = 'timed_out';
    const names = (id: string) => ({ p1: 'Ana', p2: 'Ben', p3: 'Cy' })[id] ?? '?';
    expect(rosterNotices(before, out, names)).toEqual(['Cy timed out']);
    const back = structuredClone(out);
    back.version += 1;
    back.roster[2]!.status = 'active';
    expect(rosterNotices(out, back, names)).toEqual(['Cy rejoined as an Analyst']);
    const gone = structuredClone(before);
    gone.version += 1;
    gone.roster[2]!.status = 'left';
    expect(rosterNotices(before, gone, names)).toEqual(['Cy left the team']);
    expect(rosterNotices(before, view('promoted-operator'), names)).toEqual([
      'Ana timed out',
      'Operator dropped out. You are now the Operator',
    ]);
  });

  it('ignores stale snapshots', () => {
    const before = view('analyst-3p');
    const older = structuredClone(before);
    older.version -= 1;
    older.roster[2]!.status = 'timed_out';
    expect(rosterNotices(before, older, () => 'x')).toEqual([]);
  });
});

describe('sheet index and names', () => {
  it('lists the six sheets with their holders, marking the viewer', () => {
    const rows = indexRows(view('analyst-3p'));
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => r.mine).map((r) => r.sheet)).toEqual([
      'fuse.procedure',
      'glyph.procedure',
      'valve.reference',
    ]);
    expect(rows.find((r) => r.sheet === 'fuse.reference')!.holders).toEqual(['p3']);
  });

  it('names a teammate from their seat, then from memory, then neutrally', () => {
    const seats = [{ userId: 'p1', displayName: 'Ana' }];
    expect(nameFrom('p1', seats, { p1: 'Old' })).toBe('Ana');
    expect(nameFrom('p3', seats, { p3: 'Cy' })).toBe('Cy');
    expect(nameFrom('p9', seats, {})).toBe('A teammate');
  });

  it('remembers names across snapshots without churning', () => {
    const s = snap('analyst-3p');
    const known = rememberNames({}, s);
    expect(known).toEqual({ p1: 'Ana', p2: 'Ben', p3: 'Cy' });
    expect(rememberNames(known, s)).toBe(known);
    s.players = s.players.filter((p) => p.userId !== 'p3');
    expect(rememberNames(known, s)).toBe(known);
  });
});

describe('wording', () => {
  it('maps refusals to short lines', () => {
    expect(
      errorText({ code: 'INVALID_ACTION', message: 'x', details: { rule: 'not_operator' } }),
    ).toBe('Only the Operator can do that.');
    expect(errorText({ code: 'GAME_FINISHED', message: 'x' })).toBe('The game just ended.');
    expect(errorText({ code: 'RECONNECT_REQUIRED', message: 'x' })).toBe(
      'Reconnecting… your game is safe.',
    );
  });

  it('words faults by role', () => {
    const data = { panel: 'valve', faults: 2, input: { level: 3, vent: 'vent' } };
    expect(faultText('operator', data)).toBe('Fault 2 of 3: that was level 3 · Vent');
    expect(faultText('analyst', data)).toBe('Fault 2 of 3 on Coolant Valve (level 3 · Vent)');
  });

  it('heads each result', () => {
    const r = (o: object) => resultHeadline(o as never);
    expect(r({ outcome: 'defused', reason: 'defused', msRemaining: 61_000 })).toMatchObject({
      title: 'DEFUSED',
      detail: '1:01 left',
    });
    expect(r({ outcome: 'detonated', reason: 'faults' }).detail).toBe('3 faults');
    expect(r({ outcome: 'detonated', reason: 'timeout' }).detail).toBe('Time ran out');
    expect(r({ outcome: 'abandoned', reason: 'abandoned' }).title).toBe('GAME ENDED');
  });
});

describe('Defuser event toasts', () => {
  const ev = (type: string, data: Record<string, unknown>, actorId: string | null = null) =>
    ({ type, at: 1_000, actorId, data }) as unknown as RoomEvent;

  it('announces arming, solved panels and faults', () => {
    const s = snap('operator-fuse');
    expect(describeEvent(ev('device_armed', { deadlineAt: 301_000 }), s, 'p1')!.text).toBe(
      'Armed. 5:00',
    );
    expect(
      describeEvent(ev('panel_solved', { panel: 'glyph', solvedCount: 2 }), s, 'p1')!.text,
    ).toBe('Glyph Ledger solved, 2 of 3');
    expect(
      describeEvent(ev('fault', { panel: 'fuse', faults: 1, input: { line: 3 } }), s, 'p1')!.text,
    ).toBe('Fault 1 of 3: that was line 3');
    const a = snap('analyst-3p');
    expect(
      describeEvent(ev('fault', { panel: 'glyph', faults: 2, input: { key: 4 } }), a, 'p2')!.text,
    ).toBe('Fault 2 of 3 on Glyph Ledger (key 4)');
  });

  it('tells a player which sheets they were handed', () => {
    const a = snap('analyst-3p');
    const moves = [{ sheet: 'fuse.reference', fromPlayerId: 'p3', toPlayerId: 'p2' }];
    expect(
      describeEvent(ev('sheets_reassigned', { reason: 'timeout', moves }), a, 'p2')!.text,
    ).toBe('You now hold Fuse Lines · Heat table');
    expect(
      describeEvent(ev('sheets_reassigned', { reason: 'timeout', moves }), a, 'p1'),
    ).toBeNull();
    expect(
      describeEvent(ev('sheets_reassigned', { reason: 'rejoin', moves }, 'p3'), a, 'p2')!.text,
    ).toBe('Cy rejoined');
  });

  it('leaves duel games untouched', () => {
    const duel = { ...snap('operator-fuse'), gameType: 'crack-the-code' } as RoomSnapshot;
    expect(describeEvent(ev('fault', { faults: 1 }), duel, 'p1')).toBeNull();
  });
});
