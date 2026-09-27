import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { stripComments } from '../../../scripts/lib/strip-comments.js';

const read = (p: string) => stripComments(readFileSync(path.join(process.cwd(), p), 'utf8'));

describe('RV-215 ① — the weekly-stats skeleton has to be able to end', () => {
  const hub = read('components/stats/weekly-stats-hub.tsx');
  const content = read('app/health/health-content.tsx');
  const sections = read('app/health/health-sections.tsx');

  // `cachedFetchToday` swallows `!res.ok` unless the caller passes `onError` (CLAUDE.md, the
  // self-fetching-card rule). Without it `weeklyStats` stays null, `loading` stays true, and the
  // skeleton runs until the app is killed.
  it('the fetch reports its failure', () => {
    expect(content).toMatch(/\{ onError: \(\) => setWeeklyStatsError\(true\) \}/);
  });

  // A successful refetch after a failure has to clear the flag, or the error shows over data
  // that has arrived.
  it('a later success clears the error', () => {
    expect(content).toMatch(/setWeeklyStats\(d\); setWeeklyStatsError\(false\)/);
  });

  it('the hub is told, and is given a way back', () => {
    expect(sections).toMatch(/error=\{weeklyStatsError\}/);
    expect(sections).toMatch(/onRetry=\{retryWeeklyStats\}/);
  });

  // Order matters and is not a tie-break: a failure leaves `data` null, so `loading` is ALSO true.
  // If the loading branch came first it would win and nothing would change.
  it('checks error before loading', () => {
    const errIdx = hub.indexOf('if (error)');
    const loadIdx = hub.indexOf('if (loading)');
    expect(errIdx, 'the hub must have an error branch').toBeGreaterThan(-1);
    expect(errIdx, 'error must be checked before loading, or the skeleton still wins')
      .toBeLessThan(loadIdx);
  });

  // RV-215 ③ counts `EmptyState` as used in only 10 places. This is the eleventh rather than a
  // twelfth bespoke failure card.
  it('uses the shared EmptyState primitive', () => {
    expect(hub).toMatch(/from ['"]@\/components\/ui\/empty-state['"]/);
  });
});
