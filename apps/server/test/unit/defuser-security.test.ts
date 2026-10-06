import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as shared from '@rivalrush/shared';

/**
 * Generator state is server-only (docs/defuser.md section 18): the seed, the generator, the
 * solver and the solution never reach the browser, and nothing exposes them.
 */
const repo = fileURLToPath(new URL('../../../../', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

/** Source without comments, so documentation that names a banned API doesn't count. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Defuser generator stays server-only', () => {
  it('the shared package (bundled into the web app) exports no generator, solver or seed code', () => {
    const exported = Object.keys(shared).filter(
      (k) => typeof (shared as Record<string, unknown>)[k] === 'function',
    );
    expect(
      exported.filter((k) => /generat|solve|seed|prng|edition|oracle|verify/i.test(k)),
    ).toEqual([]);
    // What it does export for Defuser is the deterministic renderer of data an Analyst holds.
    expect(exported).toContain('renderSheet');
  });

  it('the web app never imports server code or the generator', () => {
    for (const f of files(join(repo, 'apps/web/src'))) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/apps\/server|@rivalrush\/server|games\/defuser/);
    }
  });

  it('generator modules are pure: no framework, network, database, Telegram, clock or Math.random', () => {
    const dir = join(repo, 'apps/server/src/games/defuser');
    const sources = files(dir);
    expect(sources.length).toBeGreaterThanOrEqual(5);
    for (const f of sources) {
      const src = code(readFileSync(f, 'utf8'));
      expect(src, f).not.toMatch(
        /from ['"](express|socket\.io|mongoose|mongodb|pino|node:http|http)['"]/,
      );
      expect(src, f).not.toMatch(
        /from ['"][^'"]*(rooms|websocket|http|db|matches|users|bot|auth)\//,
      );
      expect(src, f).not.toMatch(/telegram/i);
      expect(src, f).not.toMatch(/Math\.random|Date\.now|new Date/);
    }
  });

  it('no REST route or socket handler mentions Defuser internals', () => {
    for (const dir of ['apps/server/src/http', 'apps/server/src/websocket']) {
      for (const f of files(join(repo, dir))) {
        expect(readFileSync(f, 'utf8'), f).not.toMatch(
          /games\/defuser|generateEdition|solveFuse|seed/i,
        );
      }
    }
  });

  it('the Defuser view types carry no seed and only the debrief carries the solution', () => {
    const src = readFileSync(join(repo, 'packages/shared/src/defuser.ts'), 'utf8');
    const views = src.slice(src.indexOf('export interface DefuserSharedView'));
    expect(views).not.toMatch(/\bseed\b/);
    const solutionUses = views.match(/solution: DefuserSolution/g) ?? [];
    expect(solutionUses).toHaveLength(1);
    expect(views.slice(views.indexOf("kind: 'debrief'"))).toContain('solution: DefuserSolution');
  });
});
