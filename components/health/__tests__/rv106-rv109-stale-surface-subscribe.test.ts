import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const code = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const src = (rel: string) => code(readFileSync(path.join(ROOT, rel), 'utf8'));

/**
 * RV-106 / RV-107 / RV-109 — three cards inside the persistent tab shell that read a cache key and
 * never asked for it again. All three are the Q-402 shape: the write group cleared the key and
 * nothing re-rendered, so the fix is a subscription, never another invalidation.
 *
 * Each case pairs two assertions on purpose — the surface subscribes the key, AND a write group
 * clears it. Either alone is a subscription to something that never fires, or an eviction nobody
 * listens for.
 */
const CASES = [
  {
    id: 'RV-106',
    file: 'components/health/hr-day-card.tsx',
    keys: ['oura-hr-day:', 'workout-sessions-day:'],
    why: 'a ring sync updated Home’s HR strip and left this card on pre-sync data',
  },
  {
    id: 'RV-107',
    file: 'app/nutrition/use-nutrition-targets-refresh.ts',
    keys: ['nutrition-targets'],
    why: 'editing macro targets left the rings banding against the previous target',
  },
  {
    id: 'RV-109',
    file: 'components/health/activity-history-card.tsx',
    keys: ['activity-logs', 'activity-types'],
    why: 'an activity confirmed from Home never reached Health’s Activity History',
  },
] as const;

describe('stale-surface-subscribe — each surface subscribes the key it reads', () => {
  const groups = src('lib/cache-groups.ts');

  for (const c of CASES) {
    it(`${c.id}: ${c.why}`, () => {
      const file = src(c.file);
      expect(file, `${c.file} does not subscribe to anything`).toMatch(/useInvalidationRefetch\(/);
      for (const key of c.keys) {
        expect(file, `${c.id} reads ${key} but does not name it in its subscription`).toContain(`'${key}'`);
        // A subscription to a key no write clears is a no-op dressed as a fix.
        expect(groups, `${key} is subscribed but no cache group clears it`)
          .toMatch(new RegExp(`invalidateCache\\('${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\)`));
      }
    });
  }

  it('RV-106 and RV-109 no longer chain a catch that cannot fire', () => {
    // Per RV-84 `cachedFetch` never rejects, so `.catch(() => {})` on it is dead code standing in
    // for error handling — the same shape RV-103 found behind a silent failure. Asserted as
    // "every cachedFetch is voided" rather than "no empty catch anywhere": the local-store promise
    // in the activity card keeps its catch, because `store.getActivityLogs` genuinely can reject.
    for (const rel of ['components/health/hr-day-card.tsx', 'components/health/activity-history-card.tsx']) {
      const calls = src(rel).match(/^.*\bcachedFetch</gm) ?? [];
      expect(calls.length, `no cachedFetch found in ${rel} — has it moved?`).toBeGreaterThan(0);
      for (const line of calls) {
        expect(line, `${rel} calls cachedFetch without voiding it — the dead .catch shape`).toMatch(/void cachedFetch</);
      }
    }
  });

  it('RV-107 leaves exactly one fetch expression for nutrition-targets', () => {
    // The TDEE card’s `onApplied` had a second, identical `cachedFetch` for this key — one write
    // path fixed site-by-site while its siblings were not. Two expressions for one key is what the
    // TTL-divergence rule exists to stop.
    const screen = src('app/nutrition/nutrition-content.tsx');
    expect(screen, 'the screen still fetches nutrition-targets itself').not.toMatch(/cachedFetch<NutritionTargets>/);
    expect(screen).toMatch(/onApplied=\{refreshTargets\}/);
  });

  it('the HR card’s stress read was already correct and is left alone', () => {
    // RV-106 listed this as untraced. `useStressDay` goes through `useCachedValue`, which
    // subscribes — so it is the reference for why the other two reads were the broken ones.
    expect(src('lib/hooks/use-stress-day.ts')).toMatch(/useCachedValue</);
  });
});
