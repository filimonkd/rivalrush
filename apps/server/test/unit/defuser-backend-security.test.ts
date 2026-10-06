import type { DefuserPlayerView } from '@rivalrush/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { HarnessPlayer, startHarness, type DefuserHarness } from '../helpers/defuserHarness.js';
import { eventLeaksIn, historyLeaksIn, leaksIn, viewsIn } from '../helpers/leak.js';

/**
 * Security checkpoint: the serialized payloads that reach each role, over every channel the
 * server has, are scanned for hidden information. TypeScript types are not what is tested here:
 * the scanner walks the JSON that really went over the socket or the REST response.
 */

let h: DefuserHarness;
afterEach(async () => {
  await h?.close();
});

/**
 * One long game that touches every path: lobby, briefing, arming, refused and accepted actions,
 * a promotion, a redistribution, an inactive player, a rejoin, the debrief and a rematch.
 */
async function playEverything(): Promise<void> {
  h = await startHarness({ players: 4 });
  const edition = h.edition();
  await h.startGame();
  const everyone = async () => {
    for (const p of h.players) {
      if (!p.socket) continue;
      await p.resync();
      await p.get(`/api/rooms/${h.roomId}`);
      await p.get(`/api/rooms/${h.roomId}/state`);
      await p.get('/api/me/active-room');
    }
    await h.settle();
  };
  await everyone(); // briefing: nobody has the Charge or sheets yet

  await h.armAll();
  await everyone(); // armed: initial per-role views

  const op = h.operator();
  const [a, b] = h.analysts() as [(typeof h.players)[number], (typeof h.players)[number]];
  await a.act({ type: 'CUT_LINE', line: 1 }); // refused: not the Operator
  await op.act({ type: 'CUT_LINE', line: h.wrongLine() }); // a fault
  await op.act({ type: 'PRESS_GLYPH', key: edition.solution.glyph.first }); // lights a key
  await op.act({ type: 'CUT_LINE', line: 99 }); // malformed
  await everyone();

  op.drop(); // the Operator's connection dies and the grace period runs out
  await h.settle();
  await h.advance(60_000); // promotion + sheet redistribution
  await op.connect(); // back, but only as an inactive player
  await h.settle();
  await everyone();
  await op.act({ type: 'CUT_LINE', line: 2 }); // refused: inactive
  await op.act({ type: 'REJOIN' }); // back as an Analyst
  await h.settle();

  b.drop(); // an Analyst times out too: another redistribution
  await h.settle();
  await h.advance(60_000);
  await everyone();

  const newOp = h.operator();
  expect(newOp.userId).toBe(a.userId); // the earliest Analyst was promoted
  await newOp.act({ type: 'CUT_LINE', line: edition.solution.fuse.line });
  await newOp.act({ type: 'PRESS_GLYPH', key: edition.solution.glyph.second });
  await newOp.act({ type: 'SET_VALVE', ...edition.solution.valve });
  await b.connect(); // the timed-out player returns after the end and sees the debrief
  await h.settle();
  await everyone();

  for (const p of h.players) await p.roomRematch(); // a second game in the same room
  await h.settle();
  await h.armAll();
  await everyone();
}

describe('Defuser payloads never carry hidden information (every role, every channel)', () => {
  it('snapshots, resync, action acks, REST state, room events: all clean', async () => {
    await playEverything();
    const edition = h.edition();
    const problems: string[] = [];
    const seenKinds = new Set<string>();
    let payloadCount = 0;

    for (const p of h.players) {
      const { snapshots, acks, events, rest } = p.payloads();
      const channels: Array<[string, unknown[]]> = [
        ['snapshot', snapshots],
        ['ack/resync', acks],
        ['rest', rest],
      ];
      for (const [name, list] of channels) {
        list.forEach((payload, i) => {
          payloadCount++;
          problems.push(...leaksIn(payload, edition, `${p.name} ${name}[${i}]`));
          for (const v of viewsIn(payload)) {
            seenKinds.add(v.kind);
            // Every view in a player's own payloads is built for that player.
            if (v.me !== p.userId) problems.push(`${p.name} ${name}[${i}]: view built for ${v.me}`);
          }
        });
      }
      problems.push(...eventLeaksIn(events, edition, `${p.name} events`));
    }

    expect(problems).toEqual([]);
    // The scan must have really seen every kind of view and plenty of payloads.
    expect([...seenKinds].sort()).toEqual(['analyst', 'debrief', 'inactive', 'operator']);
    expect(payloadCount).toBeGreaterThan(150);
    // Every role got both game-ending and mid-game events.
    const types = new Set(h.players.flatMap((p) => p.events.map((e) => e.type)));
    for (const t of [
      'device_armed',
      'fault',
      'role_changed',
      'sheets_reassigned',
      'panel_solved',
      'game_over',
      'rematch_started',
    ]) {
      expect(types.has(t as never), t).toBe(true);
    }
  });

  it('server logs and the recorded match keep the seed and the Charge out of reach', async () => {
    await playEverything();
    const edition = h.edition();
    const logs = h.logLines.join('');
    expect(logs).toContain('"event":"game.started"');
    expect(logs).toContain('"event":"game.ended"');
    expect(logs).not.toContain(edition.seed);
    expect(logs).not.toContain(`"${edition.label}"`);
    expect(logs).not.toMatch(/"(charge|solution|sheets|balance|gauge)"/);
    // What is handed to persistence: the seed only inside the server-only generator field, and
    // the move log holds positions and levels, never Charge attributes or sheet content.
    const rec = h.finished[0]!;
    expect(rec.generator).toEqual({ version: 1, seed: edition.seed });
    expect(leaksIn(rec.moves, edition, 'moves')).toEqual([]);
    const { generator: _generator, moves: _moves, ...summary } = rec;
    void _generator;
    void _moves;
    expect(historyLeaksIn(summary, edition)).toEqual([]);
    for (const m of rec.moves as Array<Record<string, unknown>>) {
      expect(
        Object.keys(m).every((k) =>
          ['kind', 'playerId', 'panel', 'input', 'ok', 'at', 'atMs', 'event'].includes(k),
        ),
      ).toBe(true);
    }
  });

  it('a stranger cannot read a room: REST and the socket refuse, and say nothing about the game', async () => {
    await playEverything();
    const edition = h.edition();
    const stranger = new HarnessPlayer(h, 'e'.repeat(24), 'Eve');
    for (const path of [
      `/api/rooms/${h.roomId}`,
      `/api/rooms/${h.roomId}/state`,
      '/api/me/active-room',
    ]) {
      const r = await stranger.get(path);
      const body = JSON.stringify(r.body);
      expect(body).not.toContain(edition.seed);
      expect(body).not.toMatch(/"(view|charge|sheets|solution|roster)"/);
      if (path !== '/api/me/active-room') expect([403, 404]).toContain(r.status);
    }
    // The invite preview shows a lobby card, never a game.
    const preview = await stranger.get(`/api/rooms/invite/${h.inviteToken}`);
    expect(JSON.stringify(preview.body)).not.toMatch(/"(game|view|seed|charge|sheets)"/);
    // A socket from a non-member is refused.
    await stranger.connect().then(
      () => {
        throw new Error('stranger subscribed');
      },
      (err: Error) => expect(err.message).toMatch(/NOT_ROOM_MEMBER|subscribe refused/),
    );
  });
});

describe('the scanner itself', () => {
  it('is not vacuous: it catches every planted leak', async () => {
    h = await startHarness({ players: 3 });
    await h.startGame();
    await h.armAll();
    const edition = h.edition();
    const opSnap = h.operator().snapshots.at(-1)!;
    const anSnap = h.analysts()[0]!.snapshots.at(-1)!;
    const clean = (s: typeof opSnap) => leaksIn(s, edition);
    expect(clean(opSnap)).toEqual([]);
    expect(clean(anSnap)).toEqual([]);

    const plant = (snap: typeof opSnap, f: (v: Record<string, unknown>) => void) => {
      const copy = structuredClone(snap);
      f(copy.game!.view as unknown as Record<string, unknown>);
      return leaksIn(copy, edition);
    };
    const anView = anSnap.game!.view as Extract<DefuserPlayerView, { kind: 'analyst' }>;
    const otherSheet = edition.glyph.panel.procedure; // content of a sheet this Analyst may not hold
    void otherSheet;
    expect(plant(anSnap, (v) => (v.charge = edition.charge)).join()).toMatch(/Charge key/);
    expect(plant(anSnap, (v) => (v.seed = edition.seed)).join()).toMatch(/seed/);
    expect(plant(anSnap, (v) => (v.solution = edition.solution)).join()).toMatch(/solution/);
    expect(plant(opSnap, (v) => (v.sheets = anView.sheets)).join()).toMatch(/sheet key/);
    expect(plant(opSnap, (v) => (v.generator = { seed: edition.seed })).join()).toMatch(
      /generator/,
    );
    // Another Analyst's sheet pasted into this Analyst's view is found by value.
    const others = h.analysts()[1]!.snapshots.at(-1)!.game!.view as Extract<
      DefuserPlayerView,
      { kind: 'analyst' }
    >;
    expect(plant(anSnap, (v) => (v.sheets = [...anView.sheets, others.sheets[0]!])).join()).toMatch(
      /is not theirs|contains the content/,
    );
    // Events and history.
    expect(
      eventLeaksIn([{ type: 'fault', data: { charge: edition.charge } }], edition).join(),
    ).toMatch(/key "charge"/);
    expect(
      eventLeaksIn([{ type: 'device_armed', data: { label: edition.label } }], edition).join(),
    ).toMatch(/edition label/);
    expect(
      historyLeaksIn({ matches: [{ generator: { seed: edition.seed } }] }, edition).join(),
    ).toMatch(/seed/);
  });
});
