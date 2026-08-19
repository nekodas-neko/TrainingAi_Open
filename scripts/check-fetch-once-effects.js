#!/usr/bin/env node
// A `useEffect(() => { … cachedFetch … }, [])` fetches once per MOUNT and never again. On a screen
// you navigate away from that is fine — the next mount refetches. In the persistent tab shell it is
// a bug, because nothing there unmounts: all five tab screens stay mounted once visited
// (`components/shell/tab-shell.tsx`), so the effect never re-runs and the component holds its first
// payload until the app is killed.
//
// That is Q-402, which the owner reported as "requires a restart of the app" — while all six write
// groups were evicting the key correctly the whole time. Invalidating a key and re-rendering the
// component that reads it are two different things; `useCachedValue` (`lib/hooks/use-cached-value.ts`)
// is the second one.
//
// **This is a ratchet, not a ban.** Some of these are deliberate — a sheet that snapshots data when
// it opens, the sync provider's warm pass — and converting them would add refetches with no reader
// waiting. So the existing sites are frozen at their count and a NEW one has to be argued for in the
// diff. Adoption itself is Q-359, judged per site.
//
// Shrink-only, same shape as check-hex-literals.js and check-memo-prop-stability.js: a file not
// listed must have zero, a listed file may only shrink, and a file that reaches zero must have its
// row deleted so the inventory cannot rot into a stale allowlist.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const DIRS = ['app', 'components', 'lib'];

// Recorded 2026-08-19 (Q-359). Every one of these predates the check.
//
// **36, not the 37 the Q-402 journal reported, and not for the reason you would guess.** That figure
// came from a scan whose pattern required a newline before the effect's closing brace, so it missed
// single-line effects entirely — while separately counting Q-402's own site, since fixed. The two
// errors happened to cancel to within one. The count here is from the pattern below, which has been
// mutation-checked in both directions.
const BASELINE = {
  // ── CAN BITE: permanently mounted. 19 sites.
  //
  // `components/shell/tab-shell.tsx` keeps all five tab contents mounted once visited, and **the tab
  // screens mount their sheets unconditionally** — `<ActivityDetailSheet log={selectedActivity} />`
  // and `<ExerciseReviewSheet sessionId={reviewingSessionId} />` are rendered with a null prop, not
  // behind a boolean. So "it's a sheet, it unmounts" is false here, and an earlier draft of this
  // grouping got both of those wrong. Every entry below was checked by tracing its renderer up to a
  // tab screen, not by where the file sits.
  'app/session-select/session-select-content.tsx': 4,
  'app/health/health-content.tsx': 2,
  'app/nutrition/nutrition-content.tsx': 2,
  'app/workout-select/workout-select-content.tsx': 1,
  'components/home-day-timeline.tsx': 2,                     // Home
  'components/activity/exercise-detected-card.tsx': 1,       // Home
  'components/activity/exercise-review-sheet.tsx': 1,        // Home, mounted with a null sessionId
  'components/calendar-widget.tsx': 1,                       // Health, via health-sections
  'components/health/hr-recovery-profile-card.tsx': 1,       // Health, via health-sections
  'components/health/strength-progress-card.tsx': 1,         // Health, via health-sections
  'components/health/training-stress-line.tsx': 1,           // Health, via training-load-card
  'components/cardio/trends-section.tsx': 1,                 // Health, via health-sections
  'components/activity/activity-detail-sheet.tsx': 1,        // Health, mounted with a null log

  // ── Deliberately fetch-once. 1 site.
  // `sync-provider` warms the cache on mount by design; it is not a reader, so converting it would
  // add refetches nothing is waiting for.
  'components/sync-provider.tsx': 1,

  // ── Unmount on navigate or on a conditional render, so their next mount refetches. 16 sites.
  // Latent rather than broken, and some may never be worth converting.
  'app/health/sleep/sleep-content.tsx': 1,                   // route
  'app/session-explain/session-explain-client.tsx': 1,       // route
  'components/coach/coach-history.tsx': 1,                   // route
  'components/activity/run-active-screen.tsx': 1,            // conditional inside its route
  'components/activity/run-hr-zone-hero.tsx': 1,             // inside run-active-screen
  'components/guided-walk/walk-config.tsx': 1,               // conditional
  'components/guided-walk/walk-summary.tsx': 1,              // conditional
  'components/nutrition/my-meals-picker.tsx': 1,             // conditional, inside a sheet
  'components/running/running-plan-content.tsx': 4,
  'components/workout-screen.tsx': 2,
  'components/workout/done-screen.tsx': 1,
  'components/workout/live-hr-chart.tsx': 1,                 // inside exercise-summary-screen
};


function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '__tests__'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = DIRS.filter(d => fs.existsSync(path.join(root, d)))
  .flatMap(d => walk(path.join(root, d), []));

const perFile = new Map();
const detail = [];

for (const abs of files) {
  const rel = path.relative(root, abs).replace(/\\/g, '/');
  const src = fs.readFileSync(abs, 'utf8');
  if (!src.includes('cachedFetch')) continue;
  // `useEffect(() => { … }, [])` — an empty dependency array is the whole signal. A non-empty one
  // re-runs when its deps change, which is a different (and usually correct) shape.
  //
  // `[\s\S]*?` with no required newline before the close, deliberately: an earlier version demanded
  // one and therefore missed a SINGLE-LINE `useEffect(() => { cachedFetch(…) }, [])` entirely. That
  // slipped through the first mutation check of this very rule, which is the whole argument for
  // running one.
  for (const m of src.matchAll(/useEffect\(\(\)\s*=>\s*\{([\s\S]*?)\}\s*,\s*\[\s*\]\s*\)/g)) {
    if (!m[1].includes('cachedFetch')) continue;
    perFile.set(rel, (perFile.get(rel) ?? 0) + 1);
    detail.push(`${rel}:${src.slice(0, m.index).split('\n').length}`);
  }
}

const failures = [];
for (const [rel, count] of perFile) {
  const allowed = BASELINE[rel] ?? 0;
  if (count > allowed) {
    failures.push(allowed === 0
      ? `${rel}: ${count} fetch-once effect(s); this file is not in the baseline, so it must have zero.`
      : `${rel}: ${count} fetch-once effect(s), over its baseline of ${allowed}.`);
  }
}
for (const [rel, allowed] of Object.entries(BASELINE)) {
  const count = perFile.get(rel) ?? 0;
  if (count < allowed) {
    failures.push(`${rel}: down to ${count} from a baseline of ${allowed} — ${count === 0 ? 'delete its row' : `lower it to ${count}`}, the baseline is shrink-only.`);
  }
}

if (failures.length) {
  console.error('Fetch-once effect check failed:\n');
  for (const f of failures) console.error(`  • ${f}`);
  console.error(`
  A useEffect(…, []) that calls cachedFetch runs once per mount and never again. In the persistent
  tab shell nothing unmounts, so the component holds its first payload until the app is killed —
  that is Q-402, reported as "requires a restart of the app".

  Use useCachedValue(key, url, ttl) from lib/hooks/use-cached-value.ts, which refetches when the key
  is invalidated. If this site genuinely should fetch once — a sheet snapshotting at open, a warm
  pass with no reader — add it to the BASELINE here with the reason, so the choice is in the diff.`);
  process.exit(1);
}

const total = [...perFile.values()].reduce((a, b) => a + b, 0);
console.log(`check-fetch-once-effects: OK — ${total} known fetch-once effect(s) across ${perFile.size} file(s), none new`);
