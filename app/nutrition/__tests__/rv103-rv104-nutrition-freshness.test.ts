import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const code = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const src = (rel: string) => code(readFileSync(path.join(ROOT, rel), 'utf8'));

/**
 * RV-103 / RV-104 — the owner re-reported BF-177, and the two reasons it could come back.
 *
 * Both are the Q-402 shape: the eviction lands and nothing asks for a new value. So both assertions
 * here are about who is *subscribed*, not about who invalidates — `invalidateNutritionWrite()`
 * already cleared every key involved, and always had.
 */
describe('RV-103 — the balance refetch can report its own failure', () => {
  const hook = src('app/nutrition/use-energy-balance-refetch.ts');

  it('does not swallow the failure in a catch that cannot fire', () => {
    // Per RV-84 `cachedFetch` never rejects, so a `.catch` on it is dead code standing in for
    // error handling. The whole of RV-103 is that this looked handled and was not.
    expect(hook).not.toMatch(/\.catch\(\(\) => \{\}\)/);
  });

  it('routes the fetch through the bounded retry and takes its exhaustion channel', () => {
    expect(hook).toMatch(/fetchWithRetry</);
    expect(hook, 'retries that give up silently are the RV-85 gap this would inherit')
      .toMatch(/onExhausted:/);
  });

  it('never writes null into the balance on an empty payload', () => {
    // `balanceForDate` is gated on `energyBalance?.date === selectedDate`, so a null makes the
    // budget and the macro targets DISAPPEAR rather than go stale — worse than what it replaced.
    expect(hook).not.toMatch(/setBalance\(d \?\? null\)/);
    expect(hook).toMatch(/if \(d\) setBalance\(d\)/);
  });

  it('exposes the failure and a retry to the card that renders the figure', () => {
    expect(hook).toMatch(/failed: boolean/);
    expect(hook).toMatch(/retry: \(\) => void/);
    const card = src('components/nutrition/energy-card.tsx');
    expect(card).toMatch(/balanceStale\?: boolean/);
    expect(card, 'a flag nothing renders is not a report').toMatch(/\{balanceStale && \(/);
    expect(card).toMatch(/onClick=\{onRetryBalance\}/);
  });
});

describe('RV-104 — the weekly chart and adherence are subscribed, not remembered', () => {
  const KEYS = ['nutrition-weekly-summary', 'nutrition-adherence'];
  const hook = src('app/nutrition/use-nutrition-derived-refresh.ts');

  it('subscribes both keys to their own invalidation', () => {
    expect(hook).toMatch(/useInvalidationRefetch\(/);
    for (const k of KEYS) expect(hook).toContain(`'${k}'`);
  });

  it('both keys are cleared by the nutrition write group', () => {
    const groups = src('lib/cache-groups.ts');
    const fn = groups.slice(groups.indexOf('export async function invalidateNutritionWrite'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    for (const k of KEYS) expect(body, `${k} is subscribed but never cleared`).toContain(`'${k}'`);
  });

  it('is the only place either key is fetched', () => {
    // The asymmetry RV-104 found — the delete path had learned to refetch the chart by hand and the
    // add path had not — can only come back if a second fetch site does. A key fetched in exactly
    // one place cannot develop a second write path that forgets it.
    const tracked = execFileSync('git', ['ls-files', 'app', 'components', 'lib'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(f => /\.tsx?$/.test(f) && !f.includes('__tests__'));
    const owner = 'app/nutrition/use-nutrition-derived-refresh.ts';
    expect(tracked, 'the pathspec stopped listing files').toContain(owner);
    for (const key of KEYS) {
      const fetched = tracked.filter(f => new RegExp(`cachedFetch[^\\n]*\\n?[^\\n]*'${key}'`).test(src(f)));
      // Matching the owner is what stops this passing vacuously after a rename.
      expect(fetched, `nothing fetches ${key} — has the hook moved?`).toContain(owner);
      expect(fetched.filter(f => f !== owner), `${key} is fetched outside ${owner}`).toEqual([]);
    }
  });
});
