import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const code = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const src = (rel: string) => code(readFileSync(path.join(ROOT, rel), 'utf8'));

/**
 * LA-59. `fetch` resolves on a 4xx, so `.then(success).catch(failure)` reports every response the
 * server sends as a success and only ever catches a transport error. RV-48 gave the reorder route a
 * 404 for an order it refuses to apply — a meal type deleted on another device is the realistic
 * route — and this surface read none of it.
 */
describe('every meal-type write reads the status it is given', () => {
  const manager = src('components/nutrition/meal-type-manager.tsx');

  it('has no bare then/catch left on a fetch', () => {
    // The exact shape the entry names. A `.then` directly on a fetch call is the bug.
    expect(manager).not.toMatch(/\}\)\.then\(\(\) => invalidateMealTypes\(\)\)\.catch\(/);
  });

  it('checks res.ok on every fetch in the file', () => {
    const fetches = manager.match(/await fetch\(/g) ?? [];
    const checks = manager.match(/if \(!res\.ok\)/g) ?? [];
    expect(fetches.length, 'no fetches found — has this file moved?').toBeGreaterThan(0);
    expect(checks.length, 'a fetch here whose status nobody reads').toBeGreaterThanOrEqual(fetches.length);
  });

  it('refetches after a refused reorder rather than only toasting', () => {
    // The screen would otherwise keep showing an order the server rejected, and a rollback to the
    // previous LOCAL order would just be a different wrong one — the list itself is what is stale.
    const handler = manager.slice(manager.indexOf('const handleDragEnd'));
    const body = handler.slice(0, handler.indexOf('}, [])'));
    expect(body).toMatch(/if \(!res\.ok\) throw/);
    expect(body).toMatch(/toast\.error\('Failed to save order'\)/);
    expect(body, 'a toast alone leaves the wrong order on screen').toMatch(/invalidateMealTypes\(\)\.then\(load\)/);
  });
});
