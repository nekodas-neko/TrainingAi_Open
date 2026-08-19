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
  // **⚠ These numbers were rewritten on 2026-08-19 because the scanner above was over-counting,
  // and the size of the error is the point: 25 sites across 16 files were really 15 across 12.**
  // TEN of the twenty-five never existed — session-select 2, health-content 2, nutrition-content 2,
  // workout-screen 2, sync-provider 1, running-plan-content 1. See the brace-matching loop for the
  // mechanism; the consequence is recorded here because this list is what a session reads first.
  //
  // What the correction changed about the WORK, not just the count:
  //   · `health-content` (2) and `nutrition-content` (2) had **no** fetch-once effect at all. Their
  //     fetches live in tab-group `useCallback`s re-run on `tabEpoch` — which is the shape this rule
  //     exists to steer people toward. They were on the "hard, do them last" list for nothing.
  //   · `sync-provider` (1) likewise: its warm pass is a plain function, not an effect. The
  //     "deliberately fetch-once" category it justified had no members and is gone.
  //   · `workout-screen` (2) is `[userId]`-deps; `running-plan-content` was 3, not 4.
  //   · So the CAN-BITE group — the only one that is a live bug — was **two** sites, not the eight
  //     the previous revision claimed, and this change converts one of them (`more-user-profile`),
  //     leaving one. Totals here are therefore 14 across 12: the correction found 15, minus that.

  // ── CAN BITE: permanently mounted, so nothing ever remounts them to refetch. 1 site.
  //
  // `components/shell/tab-shell.tsx` keeps all five tab contents mounted once visited, and the tab
  // screens mount their sheets unconditionally (`<ActivityDetailSheet log={selectedActivity} />`),
  // so "it's a sheet, it unmounts" is false here. Judge a site by where it is MOUNTED — grep for
  // the component name and check the renderer against `components/shell/tabs.ts`, never by the
  // directory the file sits in. That mistake produced two wrong groupings before this one.
  //
  // The survivor is session-select's `ta:oura-ble-synced` listener, which refetches
  // 'sleep-sessions' on one event because nothing refetches it on invalidation. It is the same
  // workaround `home-day-timeline` carried, but it cannot be deleted the same way: that screen's
  // sleep read is a `[userId]` effect with a local-first store seed and a retry wrapper, so moving
  // it to `useCachedValue` is a state refactor and wants its own PR.
  'app/session-select/session-select-content.tsx': 1,

  // ── Unmount on navigate or on a conditional render, so their next mount refetches. 13 sites
  // across 11 files.
  // Latent rather than broken, and some may never be worth converting.
  'app/health/sleep/sleep-content.tsx': 1,                   // route
  'app/session-explain/session-explain-client.tsx': 1,       // route
  'components/coach/coach-history.tsx': 1,                   // route
  'components/activity/run-active-screen.tsx': 1,            // conditional inside its route
  'components/activity/run-hr-zone-hero.tsx': 1,             // inside run-active-screen
  'components/guided-walk/walk-config.tsx': 1,               // conditional
  'components/guided-walk/walk-summary.tsx': 1,              // conditional
  'components/nutrition/my-meals-picker.tsx': 1,             // conditional, inside a sheet
  'components/running/running-plan-content.tsx': 3,
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
  // **The effect body is found by BRACE MATCHING, not by a regex, and the first version of this
  // check got that wrong in a way that inflated its own baseline by 11 of 25.** A non-greedy
  // `useEffect\(\(\) => \{([\s\S]*?)\}\s*,\s*\[\s*\]\)` starts at some `useEffect(() => {` and
  // runs to the FIRST `}, [])` anywhere after it. When the effect it started on has real
  // dependencies, that close belongs to a different effect further down, and everything in between
  // — other effects, `useCallback` bodies, plain functions — is swallowed into the "body" and
  // searched for `cachedFetch`. Five lines reproduce it:
  //
  //   useEffect(() => { setThing(1) }, [dep])
  //   const load = useCallback(() => { cachedFetch(…) }, [])
  //   useEffect(() => { load() }, [load])
  //   useEffect(() => { doSomethingElse() }, [])   // ← the regex's match ends here
  //
  // The regex reports one fetch-once effect; the correct answer is zero, because the fetch is in a
  // `useCallback` that an effect with real deps invokes. That is exactly the shape of
  // `health-content.tsx`, which was carrying a baseline of 2 with **no** fetch-once effect at all —
  // its fetches live in tab-group `useCallback`s re-run on `tabEpoch`, which is the correct shape
  // the rule is supposed to be steering people toward.
  for (const m of src.matchAll(/useEffect\(\(\)\s*=>\s*\{/g)) {
    const bodyStart = m.index + m[0].length - 1;
    let depth = 0, j = bodyStart;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}' && --depth === 0) break;
    }
    if (!/^\}\s*,\s*\[\s*\]\s*\)/.test(src.slice(j, j + 30))) continue;
    if (!src.slice(bodyStart, j).includes('cachedFetch')) continue;
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
