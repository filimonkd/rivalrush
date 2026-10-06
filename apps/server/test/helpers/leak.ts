import { SHEET_IDS, type SheetId } from '@rivalrush/shared';
import type { Edition } from '../../src/games/defuser/edition.js';
import { sheetData } from '../../src/games/defuser/edition.js';

/**
 * Serialized-payload leak scanner for Defuser (spec section 18). It looks at JSON as it would go
 * over the wire, not at TypeScript types: every key and every string, in snapshots, action acks,
 * resync results, room events, REST bodies and match history.
 */

/** Keys that exist only inside the Charge (the Operator's device). */
const CHARGE_KEYS = ['charge', 'lines', 'keys', 'balance', 'gauge', 'plate', 'style'];
/** Keys that exist only inside Codebook sheets. */
const SHEET_KEYS = [
  'sheets',
  'rules',
  'otherwise',
  'heat',
  'frameValues',
  'markValues',
  'adjustment',
  'adjustments',
  'flip',
  'grid',
];
/** Server-only generator and state internals: never in any payload, in any phase. */
const INTERNAL_KEYS = [
  'seed',
  'generator',
  'generatorVersion',
  'assignment',
  'panelOrder',
  'usedSafeTemplate',
  'rejoinSheets',
];

export function allKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) allKeys(v, into);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      allKeys(v, into);
    }
  }
  return into;
}

interface AnyView {
  gameId: 'defuser';
  kind: 'operator' | 'analyst' | 'inactive' | 'debrief' | 'public';
  me?: string;
  sheetIndex: Array<{ sheet: SheetId; holders: string[] }>;
  sheets?: Array<{ id: SheetId }>;
}

/** Every Defuser view object anywhere inside a payload (snapshot, ack, resync, REST). */
export function viewsIn(payload: unknown, into: AnyView[] = []): AnyView[] {
  if (Array.isArray(payload)) for (const v of payload) viewsIn(v, into);
  else if (payload && typeof payload === 'object') {
    const o = payload as Record<string, unknown>;
    if (o.gameId === 'defuser' && typeof o.kind === 'string') into.push(o as unknown as AnyView);
    for (const v of Object.values(o)) viewsIn(v, into);
  }
  return into;
}

/** The same payload with every debrief view blanked: what is left must never show the answer. */
function withoutDebriefs(payload: unknown): unknown {
  if (Array.isArray(payload)) return payload.map(withoutDebriefs);
  if (payload && typeof payload === 'object') {
    const o = payload as Record<string, unknown>;
    if (o.gameId === 'defuser' && o.kind === 'debrief') return { kind: 'debrief' };
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, withoutDebriefs(v)]));
  }
  return payload;
}

const has = (keys: Set<string>, list: string[]) => list.filter((k) => keys.has(k));

/**
 * Returns every leak found in `payload` (an empty list means clean). `edition` is the test's own
 * copy of the generated game, so sheet contents and the seed can be searched for by value.
 */
export function leaksIn(payload: unknown, edition: Edition, label = 'payload'): string[] {
  const problems: string[] = [];
  const json = JSON.stringify(payload) ?? '';
  const live = JSON.stringify(withoutDebriefs(payload)) ?? '';

  // Everyone, always: generator internals.
  if (json.includes(edition.seed)) problems.push(`${label}: contains the seed`);
  for (const k of has(allKeys(payload), INTERNAL_KEYS)) problems.push(`${label}: key "${k}"`);
  // Outside a debrief, the solution must not appear in any form.
  const liveKeys = allKeys(JSON.parse(live));
  if (liveKeys.has('solution')) problems.push(`${label}: key "solution" outside a debrief`);

  for (const v of viewsIn(payload)) {
    const own = (v.sheetIndex ?? [])
      .filter((e) => v.me && e.holders.includes(v.me))
      .map((e) => e.sheet);
    const tag = `${label} [${v.kind}]`;
    const keys = allKeys(v);
    const sheetsShown = (v.sheets ?? []).map((s) => s.id);
    switch (v.kind) {
      case 'operator':
        for (const k of has(keys, SHEET_KEYS)) problems.push(`${tag}: sheet key "${k}"`);
        break;
      case 'analyst': {
        for (const k of has(keys, CHARGE_KEYS)) problems.push(`${tag}: Charge key "${k}"`);
        if (keys.has('litKey')) problems.push(`${tag}: key "litKey"`);
        for (const s of sheetsShown)
          if (!own.includes(s)) problems.push(`${tag}: sheet ${s} is not theirs`);
        // By value: no other sheet's rule data, anywhere in the view.
        const vj = JSON.stringify(v);
        for (const id of SHEET_IDS.filter((x) => !own.includes(x))) {
          if (vj.includes(JSON.stringify(sheetData(edition, id).data)))
            problems.push(`${tag}: contains the content of ${id}`);
        }
        break;
      }
      case 'inactive':
      case 'public':
        for (const k of [...has(keys, CHARGE_KEYS), ...has(keys, SHEET_KEYS)])
          problems.push(`${tag}: key "${k}"`);
        break;
      case 'debrief':
        break;
    }
    // By value, for every live view: the Operator may not hold any sheet's content, and the
    // Charge as a whole may only be in the Operator's.
    if (v.kind !== 'debrief') {
      const vj = JSON.stringify(v);
      if (v.kind !== 'analyst') {
        for (const id of SHEET_IDS) {
          if (vj.includes(JSON.stringify(sheetData(edition, id).data)))
            problems.push(`${tag}: contains the content of ${id}`);
        }
      }
      if (v.kind !== 'operator' && vj.includes(JSON.stringify(edition.charge.fuse)))
        problems.push(`${tag}: contains the Fuse Charge`);
    }
  }
  return problems;
}

/** Room events: public and secret-free, in every phase. */
export function eventLeaksIn(events: unknown[], edition: Edition, label = 'events'): string[] {
  const problems: string[] = [];
  for (const [i, e] of events.entries()) {
    const json = JSON.stringify(e);
    const keys = allKeys(e);
    if (json.includes(edition.seed)) problems.push(`${label}[${i}]: contains the seed`);
    if (json.includes(`"${edition.label}"`))
      problems.push(`${label}[${i}]: contains the edition label`);
    for (const k of [
      ...has(keys, CHARGE_KEYS),
      ...has(keys, SHEET_KEYS),
      ...has(keys, INTERNAL_KEYS),
    ])
      problems.push(`${label}[${i}]: key "${k}"`);
    if (keys.has('solution')) problems.push(`${label}[${i}]: key "solution"`);
  }
  return problems;
}

/** The match-history API: summaries only. */
export function historyLeaksIn(body: unknown, edition: Edition, label = 'history'): string[] {
  const problems: string[] = [];
  const json = JSON.stringify(body) ?? '';
  const keys = allKeys(body);
  if (json.includes(edition.seed)) problems.push(`${label}: contains the seed`);
  for (const k of [
    ...has(keys, CHARGE_KEYS),
    ...has(keys, SHEET_KEYS),
    ...has(keys, INTERNAL_KEYS),
    ...(keys.has('solution') ? ['solution'] : []),
    ...(keys.has('moves') ? ['moves'] : []),
  ])
    problems.push(`${label}: key "${k}"`);
  return problems;
}
