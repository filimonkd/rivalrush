import {
  DEFUSER_COLORS,
  GLYPH_FRAMES,
  GLYPH_MARKS,
  VALVE_LAMPS,
  VALVE_PLATE_COLORS,
  type ColorId,
  type FuseAction,
  type FuseCondition,
  type GlyphAdjustment,
  type GlyphSelector,
  type MarkId,
  type RenderedSheet,
  type SheetData,
  type ValveFlip,
  type ValveLamp,
} from '@rivalrush/shared';

/**
 * Test-only reader for rendered sheets: words → rule data. If renderSheet(data) parses back to
 * exactly `data`, the wording states every rule unambiguously, so what an Analyst reads means
 * what the solver computes (guarantee G3). Throws on any text it can't read.
 */

function color(name: string, symbol: string): ColorId {
  const c = DEFUSER_COLORS.find((x) => x.name === name);
  if (!c || c.symbol !== symbol) throw new Error(`bad color "${name} ${symbol}"`);
  return c.id as ColorId;
}

const C = '(\\w+) (\\S)'; // "Ruby ●"

function condition(t: string): FuseCondition {
  let m: RegExpMatchArray | null;
  if ((m = t.match(new RegExp(`^there is no ${C} bead$`))))
    return { kind: 'noColor', color: color(m[1]!, m[2]!) };
  if ((m = t.match(new RegExp(`^two or more beads are ${C}$`)))) {
    return { kind: 'colorAtLeastTwo', color: color(m[1]!, m[2]!) };
  }
  if (t === 'exactly 1 line is dashed') return { kind: 'dashedExactly', count: 1 };
  if ((m = t.match(/^exactly ([23]) lines are dashed$/))) {
    return { kind: 'dashedExactly', count: Number(m[1]) as 2 | 3 };
  }
  if ((m = t.match(new RegExp(`^the (top|bottom) bead is ${C}$`)))) {
    return { kind: 'endColor', end: m[1] as 'top' | 'bottom', color: color(m[2]!, m[3]!) };
  }
  if ((m = t.match(new RegExp(`^an? ${C} bead is directly above an? ${C} bead$`)))) {
    return { kind: 'colorAbove', upper: color(m[1]!, m[2]!), lower: color(m[3]!, m[4]!) };
  }
  throw new Error(`unreadable condition "${t}"`);
}

function action(t: string): FuseAction {
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^cut the (?:(dashed|solid) )?line with the (highest|lowest) Heat$/))) {
    return { kind: 'heat', which: m[2] as 'highest' | 'lowest', group: (m[1] ?? 'all') as 'all' };
  }
  if ((m = t.match(new RegExp(`^cut the ${C} line nearest the (top|bottom)$`)))) {
    return { kind: 'colorEnd', color: color(m[1]!, m[2]!), end: m[3] as 'top' | 'bottom' };
  }
  if (t === 'cut the 2nd solid line from the top') return { kind: 'nthSolid', n: 2 };
  throw new Error(`unreadable action "${t}"`);
}

const SELECTORS: Record<string, GlyphSelector> = {
  'the key with the highest value': 'highest',
  'the key with the lowest value': 'lowest',
  'the key whose value is closest to the Balance': 'closest',
  'the key whose value equals the Balance': 'equals',
};

function glyphAdjustment(t: string): GlyphAdjustment {
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^Double the value of any key whose mark is a (\w+)\.$/))) {
    return { kind: 'doubleMark', mark: GLYPH_MARKS.indexOf(m[1] as never) as MarkId };
  }
  if (t === 'Add 3 to the outer keys (1 and 4).') return { kind: 'addOuter', amount: 3 };
  if (t === 'Add 2 to any key whose frame is on another key too.')
    return { kind: 'addSharedFrame', amount: 2 };
  throw new Error(`unreadable adjustment "${t}"`);
}

function flip(t: string): ValveFlip {
  let m: RegExpMatchArray | null;
  if (t === 'Flip the vent if the final level is even.') return { kind: 'levelEven' };
  if (t === 'Flip the vent if the final level is 4 or more.')
    return { kind: 'levelAtLeast', level: 4 };
  if ((m = t.match(/^Flip the vent if the lamp is (\w+)\.$/))) {
    return { kind: 'lampIs', lamp: m[1]!.toLowerCase() as ValveLamp };
  }
  if ((m = t.match(/^Flip the vent if the gauge reads (\d\d)–(\d\d)\.$/))) {
    return { kind: 'gaugeIn', from: Number(m[1]), to: Number(m[2]) };
  }
  throw new Error(`unreadable flip "${t}"`);
}

const numbered = (items: string[]) =>
  items.map((it, i) => {
    const prefix = `${i + 1}. `;
    if (!it.startsWith(prefix)) throw new Error(`bad numbering "${it}"`);
    return it.slice(prefix.length);
  });

export function parseSheet(r: RenderedSheet): SheetData {
  switch (r.id) {
    case 'fuse.procedure': {
      const items = numbered(r.items);
      const last = items.at(-1)!.match(/^Otherwise, (.+)\.$/);
      if (!last) throw new Error('missing Otherwise');
      const rules = items.slice(0, -1).map((it) => {
        const m = it.match(/^If (.+), (cut .+)\.$/);
        if (!m) throw new Error(`unreadable rule "${it}"`);
        return { if: condition(m[1]!), then: action(m[2]!) };
      });
      return { id: r.id, data: { rules, otherwise: action(last[1]!) } };
    }
    case 'fuse.reference': {
      const heat: number[] = [];
      for (const [label, h] of r.table!.rows) {
        const [name, symbol] = label!.split(' ');
        heat[color(name!, symbol!)] = Number(h);
      }
      return { id: r.id, data: { heat } };
    }
    case 'glyph.procedure': {
      const [adj, first, second] = numbered(r.items);
      const sel = (t: string, which: string) => {
        const m = t.match(new RegExp(`^${which} key: (.+)\\.$`));
        const s = m && SELECTORS[m[1]!];
        if (!s) throw new Error(`unreadable selector "${t}"`);
        return s;
      };
      return {
        id: r.id,
        data: {
          adjustment: glyphAdjustment(adj!),
          first: sel(first!, 'First'),
          second: sel(second!, 'Second'),
        },
      };
    }
    case 'glyph.reference': {
      const frameValues: number[] = [];
      const markValues: number[] = [];
      for (const [frame, fv, mark, mv] of r.table!.rows) {
        frameValues[GLYPH_FRAMES.indexOf(frame as never)] = Number(fv);
        markValues[GLYPH_MARKS.indexOf(mark as never)] = Number(mv);
      }
      return { id: r.id, data: { frameValues, markValues } };
    }
    case 'valve.procedure': {
      const items = numbered(r.items);
      const adjustments = items.slice(0, -1).map((it) => {
        const m = it.match(/^Gauge (\d\d)–(\d\d): (raise|lower) (one|two) levels?\.$/);
        if (!m) throw new Error(`unreadable adjustment "${it}"`);
        const size = m[4] === 'one' ? 1 : 2;
        return {
          from: Number(m[1]),
          to: Number(m[2]),
          delta: (m[3] === 'raise' ? size : -size) as 1,
        };
      });
      return { id: r.id, data: { adjustments, flip: flip(items.at(-1)!) } };
    }
    case 'valve.reference': {
      if (
        r.table!.header.slice(1).join() !==
        VALVE_LAMPS.map((l) => l[0]!.toUpperCase() + l.slice(1)).join()
      ) {
        throw new Error('bad lamp header');
      }
      const grid = r.table!.rows.map(([label, ...cells], plate) => {
        const [name, symbol] = label!.split(' ');
        if (color(name!, symbol!) !== VALVE_PLATE_COLORS[plate]) throw new Error('bad plate row');
        return cells.map((cell) => {
          const m = cell.match(/^([1-5])·([SV])$/);
          if (!m) throw new Error(`bad cell "${cell}"`);
          return {
            level: Number(m[1]),
            vent: m[2] === 'V' ? ('vent' as const) : ('seal' as const),
          };
        });
      });
      return { id: r.id, data: { grid } };
    }
  }
}
