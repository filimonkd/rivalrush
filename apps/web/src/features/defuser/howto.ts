import type { HowToStep } from '../../lib/howto';

/**
 * The How-to-play explainer for first-time teams (QA run 1: a first game "worked, but confused
 * me", mostly the sheets and why it blew up). Plain words, no spoilers: it explains how to read
 * the sheets, never what any edition's answer is.
 */
export const DEFUSER_HOW_TO_STEPS: readonly HowToStep[] = [
  {
    title: 'Defuse the Charge together',
    lines: [
      'Solve all 3 panels (Fuse Lines, Glyph Ledger, Coolant Valve), in any order, before the timer runs out (about 4–5 minutes).',
      'One player is the Operator; everyone else is an Analyst. Nobody can solve it alone, so talk: a Telegram call works best.',
    ],
  },
  {
    title: 'Two roles',
    lines: [
      'Operator: sees the Charge but none of the rules. Describes what is on it, then does what the team says.',
      'Analysts: hold the rule sheets but cannot see the Charge. Ask the Operator what you need, read your sheets, say what to do.',
      'With 2 players the Analyst holds all 6 sheets. With 3–4 they are split: the sheet index at the bottom of the manual shows who holds which.',
    ],
  },
  {
    title: 'Reading a sheet',
    lines: [
      'Every panel has two sheets that work together.',
      'The procedure is a numbered list. Go top to bottom; on the Fuse Lines ladder the first rule that is true is the one you follow ("Otherwise" if none is).',
      'The reference is a table the procedure points to: Heat, key values or the level grid.',
      'If the other sheet of a panel is with a teammate, ask them for the number you need.',
    ],
  },
  {
    title: 'The three panels',
    lines: [
      'Fuse Lines: the Operator reads each line from the top: bead color, dashed or solid. The ladder picks the line (Heat is in the Heat table). Tap it, then Cut.',
      'Glyph Ledger: the Operator reads each key’s frame and mark, and the Balance. Key value = frame value + mark value; follow the entry order. First key, then second: order matters.',
      'Coolant Valve: the Operator reads the plate color, lamp and gauge. The level grid gives a level and Seal or Vent; the adjustments change it by the gauge. Set it, hold the lever.',
    ],
  },
  {
    title: 'Faults and the timer',
    lines: [
      'A wrong cut, a wrong pair of keys or a wrong valve setting is a fault. The Charge never tells you the right answer.',
      '3 faults: DETONATION. At 2 faults a red bar warns you.',
      'The timer reaching 0:00 is also a DETONATION, however many panels are solved.',
      'Read the rule out loud and double-check before the Operator acts. Wrong tries stay marked, so you never repeat one.',
    ],
  },
];
