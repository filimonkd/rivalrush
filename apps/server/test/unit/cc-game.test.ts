import type { CcSettings } from '@rivalrush/shared';
import { describe, expect, it } from 'vitest';
import { colorCipher as game, type CcState } from '../../src/games/color-cipher/game.js';
import { generatePattern } from '../../src/games/color-cipher/rules.js';
import type { Actor } from '../../src/games/engine/types.js';
import { seededRandom } from '../helpers/random.js';

const A = 'userA';
const B = 'userB';
const T0 = 1_000_000;

function create(settings: Partial<CcSettings> = {}, firstPlayerIndex = 0): CcState {
  return game.createInitialState(game.parseSettings({ ...settings }), {
    players: [A, B],
    firstPlayerIndex,
    now: T0,
    random: seededRandom(1),
  });
}

const p = (playerId: string): Actor => ({ kind: 'player', playerId });
const sys: Actor = { kind: 'system' };

function apply(state: CcState, actor: Actor, action: unknown, now = T0 + 1000) {
  return game.applyAction(state, actor, action, { now, random: seededRandom(7) });
}

function must(state: CcState, actor: Actor, action: unknown, now = T0 + 1000): CcState {
  const r = apply(state, actor, action, now);
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r.state;
}

function fails(state: CcState, actor: Actor, action: unknown, now = T0 + 1000) {
  const r = apply(state, actor, action, now);
  if (r.ok) throw new Error('expected failure');
  return r.error;
}

// A hides Ruby Ruby Leaf Sky ("0034"), B hides Sun Sun Sky Amber ("2241"). A moves first.
const A_SECRET = '0034';
const B_SECRET = '2241';
const guess = (who: string, pattern: string, s: CcState, now = T0 + 2000) =>
  must(s, p(who), { type: 'GUESS', pattern }, now);

function playing(settings: Partial<CcSettings> = {}, firstPlayerIndex = 0): CcState {
  let s = create(settings, firstPlayerIndex);
  s = must(s, p(A), { type: 'SET_SECRET', pattern: A_SECRET });
  s = must(s, p(B), { type: 'SET_SECRET', pattern: B_SECRET });
  return s;
}

describe('setup', () => {
  it('starts in SETUP with a 60 s deadline, fixed 4×6 settings and no turn', () => {
    const s = create();
    expect(s.phase).toBe('SETUP');
    expect(s.setupDeadlineAt).toBe(T0 + 60_000);
    expect(s.currentTurn).toBeNull();
    expect(s.settings).toEqual({
      patternLength: 4,
      colorCount: 6,
      turnSeconds: 45,
      maxGuesses: 10,
    });
    expect(game.getNextDeadline(s)).toEqual({ at: T0 + 60_000, action: { type: '$TIMEOUT' } });
  });

  it('rejects invalid patterns with a specific rule, and accepts repeats', () => {
    const s = create();
    expect(fails(s, p(A), { type: 'SET_SECRET', pattern: '012' })).toMatchObject({
      code: 'INVALID_SECRET',
      details: { rule: 'length' },
    });
    expect(fails(s, p(A), { type: 'SET_SECRET', pattern: '01234' }).details).toEqual({
      rule: 'length',
    });
    expect(fails(s, p(A), { type: 'SET_SECRET', pattern: '0126' })).toMatchObject({
      code: 'INVALID_SECRET',
      details: { rule: 'color' },
    });
    expect(fails(s, p(A), { type: 'SET_SECRET', pattern: 'RGBY' }).code).toBe('INVALID_ACTION');
    expect(fails(s, p(A), { type: 'SET_SECRET', code: '0123' }).code).toBe('INVALID_ACTION');
    expect(must(s, p(A), { type: 'SET_SECRET', pattern: '5555' }).players[0].secret).toBe('5555');
  });

  it('locks a pattern once', () => {
    const s = must(create(), p(A), { type: 'SET_SECRET', pattern: A_SECRET });
    expect(fails(s, p(A), { type: 'SET_SECRET', pattern: '1111' }).code).toBe('SECRET_ALREADY_SET');
  });

  it('moves to PLAYING with the first player on turn once both patterns are set', () => {
    const s = playing();
    expect(s.phase).toBe('PLAYING');
    expect(s.currentTurn).toBe(A);
    expect(s.turnDeadlineAt).toBe(T0 + 1000 + 45_000);
    expect(playing({}, 1).currentTurn).toBe(B);
  });

  it('generates missing patterns at the setup deadline; a late pattern loses the tie', () => {
    let s = must(create(), p(A), { type: 'SET_SECRET', pattern: A_SECRET });
    expect(fails(s, p(B), { type: 'SET_SECRET', pattern: B_SECRET }, T0 + 60_000).code).toBe(
      'INVALID_ACTION',
    );
    expect(fails(s, sys, { type: '$TIMEOUT' }, T0 + 59_999).code).toBe('INVALID_ACTION');
    s = must(s, sys, { type: '$TIMEOUT' }, T0 + 60_000);
    expect(s.phase).toBe('PLAYING');
    expect(s.players[0]).toMatchObject({ secret: A_SECRET, autoSecret: false });
    expect(s.players[1].autoSecret).toBe(true);
    expect(s.players[1].secret).toMatch(/^[0-5]{4}$/);
  });

  it('rejects guesses during setup', () => {
    expect(fails(create(), p(A), { type: 'GUESS', pattern: '0000' }).code).toBe('GAME_NOT_STARTED');
  });
});

describe('turns and feedback', () => {
  it('enforces strict alternation', () => {
    let s = playing();
    expect(fails(s, p(B), { type: 'GUESS', pattern: '0000' }).code).toBe('NOT_YOUR_TURN');
    s = guess(A, '0000', s);
    expect(s.currentTurn).toBe(B);
    expect(fails(s, p(A), { type: 'GUESS', pattern: '1111' }).code).toBe('NOT_YOUR_TURN');
  });

  it('scores each guess against the other player’s pattern, duplicates included', () => {
    let s = playing();
    // A guesses B's "2241" with "2222": two exact (positions 1–2), no close.
    s = guess(A, '2222', s);
    expect(s.moves.at(-1)).toMatchObject({ playerId: A, guess: '2222', exact: 2, partial: 0 });
    // B guesses A's "0034" with "3400": Ruby ×2, Leaf, Sky all present, none in place.
    s = guess(B, '3400', s);
    expect(s.moves.at(-1)).toMatchObject({ playerId: B, exact: 0, partial: 4 });
    // A guesses "1422": 0 exact; colors 1, 4, 2, 2 all in "2241" → 4 close.
    s = guess(A, '1422', s);
    expect(s.moves.at(-1)).toMatchObject({ exact: 0, partial: 4 });
  });

  it('rejects invalid and duplicate guesses without using the turn', () => {
    let s = playing();
    expect(fails(s, p(A), { type: 'GUESS', pattern: '00' })).toMatchObject({
      code: 'INVALID_GUESS',
      details: { rule: 'length' },
    });
    expect(fails(s, p(A), { type: 'GUESS', pattern: '0009' })).toMatchObject({
      code: 'INVALID_GUESS',
      details: { rule: 'color' },
    });
    s = guess(A, '0011', s);
    s = guess(B, '0011', s); // the other player may try the same pattern
    expect(fails(s, p(A), { type: 'GUESS', pattern: '0011' }).code).toBe('DUPLICATE_GUESS');
    expect(s.players[0].turnsUsed).toBe(1);
  });

  it('a guess exactly at the turn deadline is refused; a timeout burns the turn', () => {
    let s = playing();
    expect(fails(s, p(A), { type: 'GUESS', pattern: '0000' }, s.turnDeadlineAt!).code).toBe(
      'NOT_YOUR_TURN',
    );
    expect(fails(s, sys, { type: '$TIMEOUT' }, s.turnDeadlineAt! - 1).code).toBe('INVALID_ACTION');
    s = must(s, sys, { type: '$TIMEOUT' }, s.turnDeadlineAt!);
    expect(s.moves).toEqual([
      expect.objectContaining({ playerId: A, guess: null, timedOut: true, turnNumber: 1 }),
    ]);
    expect(s.currentTurn).toBe(B);
    expect(s.players[0].turnsUsed).toBe(1);
  });

  it('bumps the version on every accepted change only', () => {
    let s = playing();
    const v = s.version;
    apply(s, p(B), { type: 'GUESS', pattern: '0000' });
    expect(s.version).toBe(v);
    s = guess(A, '0000', s);
    expect(s.version).toBe(v + 1);
  });
});

describe('endings', () => {
  it('second player cracking wins immediately (equal turns)', () => {
    let s = playing();
    s = guess(A, '0000', s);
    s = guess(B, A_SECRET, s);
    expect(s.phase).toBe('FINISHED');
    expect(game.getResult(s)).toEqual({ outcome: 'win', winnerId: B, reason: 'cracked' });
  });

  it('equalizer: first player cracks → last chance → miss → first player wins', () => {
    let s = guess(A, B_SECRET, playing());
    expect(s.phase).toBe('LAST_CHANCE');
    expect(s.currentTurn).toBe(B);
    s = guess(B, '1111', s);
    expect(game.getResult(s)).toEqual({ outcome: 'win', winnerId: A, reason: 'cracked' });
  });

  it('equalizer: second player also cracks → draw', () => {
    let s = guess(A, B_SECRET, playing());
    s = guess(B, A_SECRET, s);
    expect(game.getResult(s)).toEqual({ outcome: 'draw', winnerId: null, reason: 'both_cracked' });
  });

  it('equalizer: second player times out on the last chance → first player wins', () => {
    let s = guess(A, B_SECRET, playing());
    s = must(s, sys, { type: '$TIMEOUT' }, s.turnDeadlineAt!);
    expect(game.getResult(s)).toMatchObject({ winnerId: A, reason: 'cracked' });
  });

  it('both players out of guesses → draw, nobody exceeds the limit', () => {
    let s = playing({ maxGuesses: 8 });
    const misses = ['5555', '5550', '5505', '5055', '0555', '5511', '5151', '1555'];
    for (const m of misses) {
      s = guess(A, m, s);
      s = guess(B, m, s);
    }
    expect(game.getResult(s)).toEqual({
      outcome: 'draw',
      winnerId: null,
      reason: 'out_of_guesses',
    });
    expect(s.players.map((x) => x.turnsUsed)).toEqual([8, 8]);
  });

  it('timeouts count toward the limit so idle games end', () => {
    let s = playing({ maxGuesses: 8 });
    for (let i = 0; i < 16; i++) s = must(s, sys, { type: '$TIMEOUT' }, s.turnDeadlineAt!);
    expect(game.getResult(s)).toMatchObject({ outcome: 'draw', reason: 'out_of_guesses' });
  });

  it('forfeit and abandon from any live phase', () => {
    for (const s of [create(), playing(), guess(A, B_SECRET, playing())]) {
      const f = must(s, p(B), { type: 'FORFEIT' });
      expect(game.getResult(f)).toEqual({ outcome: 'win', winnerId: A, reason: 'forfeit' });
      const ab = must(s, sys, { type: '$ABANDON', playerId: A });
      expect(ab.phase).toBe('ABANDONED');
      expect(game.getResult(ab)).toEqual({ outcome: 'win', winnerId: B, reason: 'abandoned' });
    }
  });

  it('rejects every action once finished', () => {
    const s = must(playing(), p(A), { type: 'FORFEIT' });
    for (const a of [
      { type: 'GUESS', pattern: '0000' },
      { type: 'SET_SECRET', pattern: '0000' },
      { type: 'FORFEIT' },
    ])
      expect(fails(s, p(B), a).code).toBe('GAME_FINISHED');
    expect(fails(s, sys, { type: '$TIMEOUT' }).code).toBe('GAME_FINISHED');
    expect(game.getNextDeadline(s)).toBeNull();
  });
});

describe('anti-cheat', () => {
  it('ignores non-players, unknown actions and client-supplied results or feedback', () => {
    const s = playing();
    expect(fails(s, p('mallory'), { type: 'GUESS', pattern: '0000' }).code).toBe('NOT_ROOM_MEMBER');
    for (const a of [
      { type: 'WIN' },
      { type: '$TIMEOUT' },
      { type: '$FORFEIT', playerId: B },
      { type: 'GUESS', pattern: '0000', exact: 4 },
      { type: 'GUESS', pattern: '0000', partial: 0, playerId: B },
      { type: 'GUESS', pattern: '0000', winnerId: A },
      { type: 'SET_SECRET', pattern: '0000', opponentSecret: '0000' },
    ])
      expect(fails(s, p(A), a).code).toBe('INVALID_ACTION');
    expect(game.parseAction({ type: 'GUESS', pattern: '0000', exact: 4 })).toBeNull();
  });
});

describe('secret isolation', () => {
  function assertNoOpponentSecret(s: CcState) {
    const over = s.phase === 'FINISHED' || s.phase === 'ABANDONED';
    for (const [viewer, other] of [
      [A, B],
      [B, A],
    ] as const) {
      const view = game.getPlayerView(s, viewer);
      const otherSecret = s.players.find((x) => x.id === other)!.secret;
      if (!over) {
        expect(view.opponentSecret).toBeNull();
        const withoutGuesses = { ...view, moves: view.moves.map((m) => ({ ...m, guess: null })) };
        if (otherSecret) expect(JSON.stringify(withoutGuesses)).not.toContain(`"${otherSecret}"`);
      } else {
        expect(view.opponentSecret).toBe(otherSecret);
      }
    }
    const pubView = game.getPublicView(s);
    const pub = JSON.stringify({
      ...pubView,
      moves: pubView.moves.map((m) => ({ ...m, guess: null })),
    });
    for (const x of s.players) if (x.secret) expect(pub).not.toContain(`"${x.secret}"`);
    expect(pub).not.toContain('secret"'); // hasSecret (a public flag) is fine
  }

  it('never exposes an opponent pattern before the end, across random full games', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rnd = seededRandom(seed);
      let s = game.createInitialState(game.parseSettings({ maxGuesses: 8 }), {
        players: [A, B],
        firstPlayerIndex: seed % 2,
        now: T0,
        random: rnd,
      });
      let now = T0;
      assertNoOpponentSecret(s);
      if (seed % 4 !== 0) s = must(s, p(A), { type: 'SET_SECRET', pattern: '1122' }, now + 1);
      now = s.setupDeadlineAt!;
      s = must(s, sys, { type: '$TIMEOUT' }, now);
      assertNoOpponentSecret(s);
      let guard = 0;
      while ((s.phase === 'PLAYING' || s.phase === 'LAST_CHANCE') && guard++ < 50) {
        now += 1000;
        const mover = s.currentTurn!;
        const roll = rnd();
        if (roll < 0.15) s = must(s, sys, { type: '$TIMEOUT' }, (now = s.turnDeadlineAt!));
        else if (roll < 0.17) s = must(s, p(mover), { type: 'FORFEIT' }, now);
        else {
          const tried = new Set(s.moves.filter((m) => m.playerId === mover).map((m) => m.guess));
          let pattern: string;
          do pattern = generatePattern(4, 6, rnd);
          while (tried.has(pattern));
          s = must(s, p(mover), { type: 'GUESS', pattern }, now);
        }
        assertNoOpponentSecret(s);
      }
      expect(game.getResult(s)).not.toBeNull();
      expect(s.players[0].turnsUsed).toBeLessThanOrEqual(8);
      expect(s.players[1].turnsUsed).toBeLessThanOrEqual(8);
    }
  });

  it('getMoves holds guesses and counts only, never the patterns', () => {
    const s = guess(A, '5555', playing());
    const json = JSON.stringify(game.getMoves(s));
    expect(json).not.toContain(A_SECRET);
    expect(json).not.toContain(B_SECRET);
    expect(game.getMoves(s)).toEqual([
      expect.objectContaining({ guess: '5555', exact: 0, partial: 0, timedOut: false }),
    ]);
  });
});

describe('settings', () => {
  it('defaults, ranges and fixed pattern size', () => {
    expect(game.parseSettings(undefined)).toEqual({
      patternLength: 4,
      colorCount: 6,
      turnSeconds: 45,
      maxGuesses: 10,
    });
    expect(() => game.parseSettings({ turnSeconds: 29 })).toThrow();
    expect(() => game.parseSettings({ maxGuesses: 13 })).toThrow();
    expect(() => game.parseSettings({ patternLength: 5 })).toThrow();
    expect(() => game.parseSettings({ colorCount: 8 })).toThrow();
    expect(() => game.parseSettings({ codeLength: 4 })).toThrow();
  });
});
