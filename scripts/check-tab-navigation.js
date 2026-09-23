#!/usr/bin/env node
/**
 * RV-110 — a cross-tab navigation must go through `navigateToTab`, never `router.push`.
 *
 * `app/(home)` and `app/health` are different route segments, so a push to a tab href unmounts the
 * entire `TabShell`: every panel's component state, `state.mounted`, and every inner `scrollTop`,
 * with the four code-split tabs re-mounting after. `navigateToTab` asks the mounted shell to flip
 * instead, and falls back to `router.push` when no shell is mounted — so it is correct from a
 * full-screen route too (`done-activity-screen`, `walk-summary`, `test-result`).
 *
 * **Only exact tab hrefs are flagged, which is narrower than the entry that prompted this.** RV-110
 * counted 37 `router.push('/health'|'/nutrition'|'/more'|'/workout')` sites; 22 of those are
 * sub-routes (`/health/day`, `/health/sleep`, `/more/details`, `/more/settings/…`) or the
 * full-screen `/workout?session=…`, and those are supposed to be route navigations —
 * `tabKeyForHref` returns null for every one of them, so `navigateToTab` would only forward them to
 * `router.push` while reading as a tab flip. Converting them would be misleading, not safer. The
 * real sweep was the other 15.
 */
const { execSync } = require('node:child_process');
const { readFileSync } = require('node:fs');

// Mirrors components/shell/tabs.ts — a tab is an EXACT path match, and the full-screen workout
// route is explicitly not one.
const TAB_PATHS = ['/', '/health', '/workout', '/nutrition', '/more'];

const files = execSync('git ls-files app components lib', { encoding: 'utf8' })
  .split('\n')
  .filter(f => /\.tsx?$/.test(f) && !f.includes('__tests__'));

const offenders = [];
for (const file of files) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const m = line.match(/router\.push\(\s*[`"']([^`"']*)/);
    if (!m) return;
    const href = m[1];
    const path = href.split('?')[0];
    if (!TAB_PATHS.includes(path)) return;
    if (path === '/workout' && href.includes('session=')) return; // full-screen route, not a tab
    offenders.push(`${file}:${i + 1}  router.push('${href}')`);
  });
}

if (offenders.length > 0) {
  console.error('check-tab-navigation: a cross-tab navigation must use navigateToTab(router, href),');
  console.error('so the tab shell flips instead of being torn down and rebuilt (RV-110).\n');
  offenders.forEach(o => console.error('  ' + o));
  console.error('\n`navigateToTab` (lib/shell-nav.ts) falls back to router.push when no shell is');
  console.error('mounted, so it is also correct from a full-screen route.');
  process.exit(1);
}

console.log(`check-tab-navigation: OK — ${files.length} files, no cross-tab router.push`);
