#!/usr/bin/env node
// Keeps component files under ~800 lines (CLAUDE.md: Mobile UI & Performance). The known
// hotspots absorb every new feature by default, so this is a ratchet rather than a flat limit:
// the files below are allowed at their recorded size and may only shrink, and any other file
// crossing the limit fails. New features go into extracted children in components/, not onto
// the end of a screen that is already too long.
'use strict';
const fs = require('fs');
const path = require('path');
const { resolveBaseRef, lineCountAtBase, verdict } = require('./lib/base-ref');

const LIMIT = 800;

// Baseline recorded 2026-08-08. A file may sit at or below its baseline; it may never grow.
// Shrinking one below the limit? Delete its row — it is then held to LIMIT like everything else.
//
// This does not forbid growth outright — it forces growth to be *acknowledged*. A change that
// genuinely has to add lines to a hotspot raises the number here in the same PR, which puts the
// growth in the diff where a reviewer sees it, instead of letting these files drift upward one
// unremarked commit at a time (which is how they reached these sizes).
const BASELINE = {
  'components/workout-screen.tsx': 1833,
  // Raised 2026-08-19 (Lane B, Q-359): 1456 -> 1458. The screen's `sleep-sessions` refetch moved
  // off the `ta:oura-ble-synced` event onto `useInvalidationRefetch`, which covers every writer of
  // that key rather than the one event that thought to dispatch — `invalidateBiometrics` clears it
  // too, so an edited sleep row used to leave this screen stale until a remount. Two lines is the
  // wrapper the hook call needs; the event listener it replaced is already down to its minimum
  // (it still bumps `refreshTick` for the four gated effects, which are not cache reads).
  'app/session-select/session-select-content.tsx': 1448,
  'components/config-screen.tsx': 997,
  // Raised 2026-08-18 (Lane B, Q-478): 911 -> 912. Net +1 after paying for what could be paid
  // for — the file's two `@/app/api/body-metadata/route` type imports were merged, reclaiming a
  // line against the two this needed (`useUserTimezone` + `const tz`). The remaining line buys
  // the screen the user's actual timezone: without it `isBodyMetadataFresh` compares a
  // server-stamped date to Brisbane's, and today's metrics and active energy stay blank for
  // 14 hours a day for a New York user. There is no smaller shape — a hook cannot be called
  // from inside the callback that needs its value.
  // Raised 2026-08-18 (Lane A, Q-488): 912 -> 915. Three lines — one call and two lines of
  // comment pointing at where the reasoning lives. The item is *specifically* that this handler
  // deletes server-side only, so three screens reading activity_logs local-first keep showing the
  // deleted activity until the next sync; there is no zero-line shape for "also write locally".
  // The full explanation deliberately lives on `deleteActivityLog` in sqlite-backend.ts rather
  // than here, which is what kept this to three lines instead of nine.
  'components/config/program-editor-sheet.tsx': 963,
};

const root = path.join(__dirname, '..');
const failures = [];
const inherited = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === '.next') continue;
      walk(full);
    } else if (entry.name.endsWith('.tsx')) {
      const rel = path.relative(root, full).split(path.sep).join('/');
      const src = fs.readFileSync(full, 'utf8');
      // Match `wc -l` (newline count), so a baseline can be read straight off the shell.
      const lines = src.split('\n').length - (src.endsWith('\n') ? 1 : 0);
      const allowed = BASELINE[rel] ?? LIMIT;
      // LA-16 / Q-424: ask whether THIS BRANCH grew the file, not whether it is over. A file already
      // over its number on the base is not this branch's to fix, and failing it here reports someone
      // else's merge as this author's oversized change.
      const v = verdict({ count: lines, limit: allowed, atBase: lineCountAtBase(baseRef, rel) });
      if (v === 'inherited') {
        inherited.push(`${rel}: ${lines} lines against a ${allowed}-line baseline, but the base branch is already there. Not this branch's growth.`);
      } else if (v === 'fail') {
        failures.push({ rel, lines, allowed, grandfathered: rel in BASELINE });
      }
    }
  }
}

const baseRef = resolveBaseRef();

for (const top of ['app', 'components']) walk(path.join(root, top));

// Reported whether or not the run fails, and never as a failure (Q-424).
if (inherited.length > 0) {
  console.log('check-component-size: inherited from the base branch, not caused here:');
  inherited.forEach((f) => console.log('  • ' + f));
}

// The header above says "Shrinking one below the limit? Delete its row" — and nothing enforced it,
// so a hotspot that got fixed kept its exemption. Missed three times: `health-sections.tsx` was
// removed correctly on 2026-08-09, then `profile-tab.tsx` sat listed at 476 lines and
// `health-content.tsx` at 651 against a 915 baseline. A stale row is not harmless — it silently
// re-grants a file up to `baseline - LIMIT` lines of room it is no longer entitled to, which for
// `health-content` was 115. `check-client-today-timezone.js` has enforced the same rule for its own
// baseline all along; this is that half, arriving late.
const stale = Object.keys(BASELINE).filter((rel) => {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return true;
  const src = fs.readFileSync(full, 'utf8');
  return src.split('\n').length - (src.endsWith('\n') ? 1 : 0) <= LIMIT;
});
if (stale.length > 0) {
  console.error('BASELINE holds file(s) that are no longer over the limit — delete the row in the');
  console.error(`same PR, so the file is held to ${LIMIT} like everything else:`);
  for (const rel of stale) {
    const full = path.join(root, rel);
    const n = fs.existsSync(full)
      ? (() => { const src = fs.readFileSync(full, 'utf8'); return src.split('\n').length - (src.endsWith('\n') ? 1 : 0); })()
      : 'file no longer exists';
    console.error(`  ${rel}: now ${n}, baseline ${BASELINE[rel]}`);
  }
  process.exit(1);
}

if (failures.length > 0) {
  console.error(`Component file(s) over the ${LIMIT}-line limit (CLAUDE.md: keep files under ~800 lines — extract into components/ children instead of appending):`);
  for (const f of failures) {
    console.error(f.grandfathered
      ? `  ${f.rel}: ${f.lines} lines — grew past its ${f.allowed}-line baseline. This file is a known hotspot; extract, do not append.`
      : `  ${f.rel}: ${f.lines} lines (limit ${f.allowed})`);
  }
  process.exit(1);
}

console.log(`check-component-size: no .tsx file over ${LIMIT} lines beyond the ${Object.keys(BASELINE).length} recorded hotspots.`);
