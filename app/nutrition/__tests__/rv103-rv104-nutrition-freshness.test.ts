import { describe, expect, it, vi } from 'vitest';
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

  it('also takes the channel that reaches a FAILED revalidation of a cached value (LB-128)', () => {
    // `onExhausted` covers the post-write norm, where the invalidation emptied the key and the
    // retries run against nothing. It structurally cannot cover the residue: a stale entry that
    // survived the invalidation paints, `fetchWithRetry` counts that paint as a response and stops
    // the ladder, and `cachedFetch` gates `onError` on `cached === null`. Taking only one of the
    // two channels leaves the pre-write figure on screen with nothing said — which is what RV-103
    // measured, reporting or staying silent on consecutive runs by cache state alone.
    expect(hook, 'onExhausted alone cannot see a failure behind a cached paint')
      .toMatch(/onRevalidateError:/);
  });

  it('never writes null into the balance on an empty payload', () => {
    // `balanceForDate` is gated on `energyBalance?.date === selectedDate`, so a null makes the
    // budget and the macro targets DISAPPEAR rather than go stale — worse than what it replaced.
    expect(hook).not.toMatch(/setBalance\(d \?\? null\)/);
    // The guard, not its exact spelling: sweep 2's fix added `setRefreshing(false)` beside the
    // write, and a regex pinned to one statement fails on a change that keeps the invariant.
    expect(hook).toMatch(/if \(d\) \{? ?setBalance\(d\)/);
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

/**
 * RV-103 sweep 2 — the entry shipped, and the device check FAILED anyway.
 *
 * With `energy-balance` blocked at the network the card held "320 kcal left" for **7 s** with no
 * failure line and no Retry. Every channel the fix added was wired correctly; none of them could
 * have fired yet, and that is the finding:
 *
 *   - `onRevalidateError` fires only when a cached value was painted, and the write's own
 *     `invalidateNutritionWrite()` has just emptied the key. So on the post-write path it is silent
 *     by construction.
 *   - `onExhausted` fires after `fetchWithRetry` runs out of attempts — four of them, with
 *     2.5 s + 5 s + 7.5 s of backoff between. Fifteen seconds.
 *
 * So for fifteen seconds the screen presented a pre-write number as current. The gap is real and
 * measured below rather than reasoned about, because the whole entry turns on it.
 */
describe('RV-103 sweep 2 — the fifteen seconds before the failure line', () => {
  const hook = src('app/nutrition/use-energy-balance-refetch.ts');
  const card = src('components/nutrition/energy-card.tsx');

  it('exhaustion really is ~15s away, so a 7s observation sees nothing', async () => {
    vi.useFakeTimers();
    try {
      const { fetchWithRetry } = await import('@trainingai/shared/fetch-with-retry');
      let exhausted = false;
      let attempts = 0;
      // Stands in for `cachedFetch` with the route blocked: never paints, never rejects.
      const deadFetch = async () => { attempts += 1; return false };

      fetchWithRetry<unknown>('k', '/u', 60, () => {}, () => false, 0, deadFetch, {
        onExhausted: () => { exhausted = true },
      });

      await vi.advanceTimersByTimeAsync(7_000);
      expect(attempts, 'two attempts have run by 7s').toBe(2);
      expect(exhausted, 'the device watched for 7s and this is why it saw nothing').toBe(false);

      await vi.advanceTimersByTimeAsync(8_000);
      expect(attempts, 'four attempts in total').toBe(4);
      expect(exhausted, 'the honest report arrives at 15s, not before').toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the hook says a refetch is in flight, which is what covers those seconds', () => {
    expect(hook).toMatch(/refreshing: boolean/);
    expect(hook, 'the in-flight flag must be raised when the refetch starts')
      .toMatch(/setRefreshing\(true\)/);
    // Cleared on every exit: a painted value, exhaustion, and a failed revalidation.
    expect(hook.match(/setRefreshing\(false\)/g) ?? [], 'cleared on all three exits').toHaveLength(3);
  });

  it('the card shows it, and never beside the failure line', () => {
    expect(card).toMatch(/balanceRefreshing/);
    expect(card, 'a failure and an in-flight state in the same slot would both render')
      .toMatch(/balanceRefreshing && !balanceStale/);
  });
});
