#!/usr/bin/env node
// `aestMidnight(y, m, d)` builds a day window in Australia/Brisbane. Its fourth argument is the
// timezone, defaulting to `DEFAULT_TZ` — so a call that omits it silently keys the window to the
// owner's zone for every user.
//
// Found by the Q-394 sweep, which was looking for something else. Shifting a test user's timezone
// into the 00:00–02:00 band — the trick `local-day-fixture-anchoring.test.ts` uses — made
// `getUnsyncedHrSessionsForDay` return nothing for a session it had just inserted on that user's
// today. The test was written in the correct shape (it reads the local day back from the row); the
// query re-derived midnight in Brisbane and disagreed.
//
// Measured 2026-08-23: 9 call sites passed a timezone and 12 did not; LA-19 converted the 12. That split is exactly what
// CLAUDE.md warns about — "a default every caller overrides is a safety net, and it is what makes
// forgetting silent." Prose has already failed to hold this class twice (the `toISOString().slice`
// ban needed a check; the hex-literal count grew 41 in five days while the docs called it
// improving), so this is a ratchet rather than a paragraph.
//
// Shrink-only: a file listed here may only lose omitting call sites, and a file NOT listed must
// have none. With the list empty, that reduces to: no call site may omit the timezone.
//
// The count is reproducible from a shell, so the baseline is never a number only this file knows:
//   grep -rn 'aestMidnight(' --include='*.ts' lib app packages | grep -v __tests__ | grep -v 'export function'
'use strict';
const fs = require('fs');
const path = require('path');
const { resolveBaseRef, countAtBase, verdict } = require('./lib/base-ref');

/**
 * Blank out comments and string bodies, keeping the byte length so nothing else shifts.
 *
 * Without this the scanner counted prose: `app/api/day-log/route.ts` says *"Old workouts stored
 * aestMidnight (14:00 UTC)"* in a comment, and `aestMidnight (` matched. That put a file with no
 * call site at all into the first baseline — caught the same day, while converting the list.
 */
function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const two = src.slice(i, i + 2);
    if (two === '//') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      let j = i + 1;
      while (j < src.length && src[j] !== quote) {
        if (src[j] === '\\') j++;
        j++;
      }
      const stop = Math.min(j + 1, src.length);
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * Top-level argument count for each `aestMidnight(...)` call. Splitting on commas would miscount
 * `aestMidnight(y, m, d + f(a, b))`; this tracks nesting, so a nested call cannot inflate the arity
 * and make an omitting site look tz-aware.
 */
function countOmittingCalls(raw) {
  const src = stripCommentsAndStrings(raw);
  let n = 0;
  const re = /\baestMidnight\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let i = m.index + m[0].length;
    let depth = 1;
    let args = 1;
    let inStr = null;
    for (; i < src.length && depth > 0; i++) {
      const c = src[i];
      if (inStr) { if (c === '\\') i++; else if (c === inStr) inStr = null; continue; }
      if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      else if (c === ',' && depth === 1) args++;
    }
    if (args < 4) n++;
  }
  return n;
}

// Baseline: EMPTY, and that is the point — every call site passes a timezone as of 2026-08-23
// (LA-19). A file appearing here at all is now a regression, not a debt row.
//
// It was 12 for a few hours between the ratchet landing and the conversion. The number had been
// wrong in both directions before it settled, which is the argument for a script over a grep: a
// `grep | sed` audit gave **11** (missing `early-deload.ts`'s second call), and this scanner's first
// version gave **13**, counting a *comment* in `app/api/day-log/route.ts` that mentions
// `aestMidnight (14:00 UTC)`. Comments and string bodies are blanked before scanning now, and the
// stale-row rule is what surfaced that — the day-log row could not survive its own file having no
// call site.
const BASELINE = {};

const root = process.cwd();
const seen = new Set();
const failures = [];
const inherited = [];
const stale = [];
let total = 0;

function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__' || e.name === '.next') continue;
      walk(full);
      continue;
    }
    if (!e.name.endsWith('.ts') && !e.name.endsWith('.tsx')) continue;
    const rel = path.relative(root, full).split(path.sep).join('/');
    // The definition itself declares the default; it is not a call site.
    if (rel === 'packages/shared/src/date-utils.ts') continue;
    const src = fs.readFileSync(full, 'utf8');
    const count = countOmittingCalls(src);
    if (count === 0 && !(rel in BASELINE)) continue;
    seen.add(rel);
    total += count;
    const allowed = BASELINE[rel] ?? 0;
    const v = verdict({ count, limit: allowed, atBase: countAtBase(baseRef, rel, countOmittingCalls) });
    if (v === 'inherited') {
      inherited.push(`${rel}: ${count} against a baseline of ${allowed}, but the base branch already has ${count}. Not this branch's growth.`);
    } else if (v === 'fail') {
      failures.push({ rel, count, allowed });
    }
    if (count === 0 && rel in BASELINE) stale.push(rel);
  }
}

const baseRef = resolveBaseRef();

for (const top of ['app', 'lib', 'packages']) walk(path.join(root, top));

for (const rel of Object.keys(BASELINE)) if (!seen.has(rel)) stale.push(`${rel} (deleted)`);

// Reported whether or not the run fails, and never as a failure (Q-424).
if (inherited.length > 0) {
  console.log('check-aest-midnight-timezone: inherited from the base branch, not caused here:');
  inherited.forEach((f) => console.log('  • ' + f));
}

if (failures.length > 0 || stale.length > 0) {
  if (failures.length > 0) {
    console.error('aestMidnight() called without a timezone — the window is keyed to the owner\'s zone for every user.');
    console.error('Pass the user\'s timezone as the fourth argument (session.user.timezone ?? DEFAULT_TZ), the way');
    console.error('getCalendarData / getRecentTrainedDays / the Oura rollup already do.');
    for (const f of failures) {
      console.error(f.allowed === 0
        ? `  ${f.rel}: ${f.count} call(s) omitting the timezone — this file had none.`
        : `  ${f.rel}: ${f.count} omitting call(s), baseline ${f.allowed}.`);
    }
  }
  if (stale.length > 0) {
    console.error('Baseline row(s) to delete — these files no longer omit the timezone they are recorded for:');
    for (const s of stale) console.error(`  ${s}`);
  }
  process.exit(1);
}

console.log(`check-aest-midnight-timezone: ${total} aestMidnight() call(s) omit the timezone, across ${Object.keys(BASELINE).length} recorded files, none above baseline.`);
