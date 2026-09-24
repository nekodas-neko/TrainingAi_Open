import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { uiTouched, clientReachable, clientRoots } = require('../e2e-ui-touched');

/** A fixed reachable set, so these cases do not move when the import graph does. */
const reachable = new Set(['lib/resume-repaint.ts', 'lib/sqlite/cache.ts', 'lib/hooks/use-x.ts']);

describe('uiTouched', () => {
  it('runs the suite for an app page', () => {
    expect(uiTouched(['app/health/page.tsx'], reachable).touched).toBe(true);
  });

  it('runs the suite for a component', () => {
    expect(uiTouched(['components/home/card.tsx'], reachable).touched).toBe(true);
  });

  it('skips an API route — no browser reaches it (LA-63)', () => {
    expect(uiTouched(['app/api/version/route.ts'], reachable).touched).toBe(false);
  });

  it('skips a vitest file under app/, which bought four full runs once', () => {
    expect(uiTouched(['app/session-explain/__tests__/a.test.ts'], reachable).touched).toBe(false);
  });

  it('skips an engine module', () => {
    expect(uiTouched(['lib/data/postgres/adapter.ts'], reachable).touched).toBe(false);
  });

  it('RUNS for a lib module reached from a client one — the LB-108 case', () => {
    const r = uiTouched(['lib/resume-repaint.ts'], reachable);
    expect(r.touched).toBe(true);
    expect(r.why[0]).toContain('reached from a client module');
  });

  it('runs for the cache every screen reads through', () => {
    expect(uiTouched(['lib/sqlite/cache.ts'], reachable).touched).toBe(true);
  });

  it('runs when one file of many qualifies', () => {
    expect(uiTouched(['lib/data/postgres/adapter.ts', 'README.md', 'lib/sqlite/cache.ts'], reachable).touched).toBe(true);
  });

  it('skips an empty list and ignores blank lines', () => {
    expect(uiTouched([], reachable).touched).toBe(false);
    expect(uiTouched(['', '  '], reachable).touched).toBe(false);
  });

  it('runs for the playwright config itself', () => {
    expect(uiTouched(['playwright.config.ts'], reachable).touched).toBe(true);
  });
});

describe('against the real tree', () => {
  it('finds client roots and a reachable set larger than them', () => {
    const roots = clientRoots();
    const set = clientReachable();
    expect(roots.length).toBeGreaterThan(0);
    expect(set.size).toBeGreaterThan(roots.length);
  });

  it('reaches lib/resume-repaint.ts, which a subtree list misses', () => {
    expect(clientReachable().has('lib/resume-repaint.ts')).toBe(true);
  });

  it('does NOT reach the Postgres adapter', () => {
    expect(clientReachable().has('lib/data/postgres/adapter.ts')).toBe(false);
  });
});
