import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * RV-110 / RV-112 — the tab shell survives a cross-tab navigation, and the two panels that stay
 * mounted no longer share one scroll slot.
 */
describe('RV-110 — a cross-tab navigation flips the shell', () => {
  // Mirrors components/shell/tabs.ts: a tab is an EXACT path match, and the full-screen workout
  // route is deliberately not one.
  const TAB_PATHS = ['/', '/health', '/workout', '/nutrition', '/more'];

  const tabPushes = () => {
    const files = execFileSync('git', ['ls-files', 'app', 'components', 'lib'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(f => /\.tsx?$/.test(f) && !f.includes('__tests__'));
    const hits: string[] = [];
    for (const f of files) {
      src(f).split('\n').forEach((line, i) => {
        const m = line.match(/router\.push\(\s*[`"']([^`"']*)/);
        if (!m) return;
        const href = m[1];
        const p = href.split('?')[0];
        if (!TAB_PATHS.includes(p)) return;
        if (p === '/workout' && href.includes('session=')) return;
        hits.push(`${f}:${i + 1} ${href}`);
      });
    }
    return hits;
  };

  it('no cross-tab router.push survives', () => {
    expect(tabPushes()).toEqual([]);
  });

  it('the sub-routes and the full-screen workout route are deliberately NOT converted', () => {
    // RV-110 counted 37 sites; 22 are sub-routes or `/workout?session=`, for which
    // `tabKeyForHref` returns null. Routing those through `navigateToTab` would only forward them
    // to `router.push` while reading as a tab flip, so they stay as they are — and this asserts
    // that a later sweep does not "finish the job" by converting them.
    const timeline = src('components/home-day-timeline.tsx');
    expect(timeline, 'a day sub-route is not a tab').toMatch(/router\.push\(`\/health\/day\?date=/);
    const home = src('app/session-select/session-select-content.tsx');
    expect(home, 'the full-screen workout route is not a tab').toMatch(/router\.push\(`\/workout\?session=/);
  });

  it('the rule that holds it runs in the Custom Rules job', () => {
    expect(src('.github/workflows/ci.yml')).toContain('node scripts/check-tab-navigation.js');
  });
});

describe('RV-112 — Home and More keep their own scroll slot', () => {
  it('both pass a scrollKey, so the shared key cannot collide', () => {
    expect(src('app/session-select/session-select-content.tsx')).toMatch(/scrollKey="home"/);
    expect(src('app/more/more-content.tsx')).toMatch(/scrollKey="more"/);
  });

  it('the key really is suffix-separated, not path-separated', () => {
    // `usePathname()` reads the route tree, which a tab flip leaves stale (LA-109) — so the
    // pathname half of this key cannot be relied on to differ between two mounted tabs. The
    // suffix is what does the separating.
    expect(src('lib/hooks/use-scroll-restoration.ts'))
      .toMatch(/keySuffix \? `\$\{pathname\}#\$\{keySuffix\}` : pathname/);
  });
});
