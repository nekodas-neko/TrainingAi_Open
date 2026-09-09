#!/usr/bin/env node
// A button whose click flips a boolean that also gates a render is a disclosure or a mode toggle,
// and a screen reader is told which by `aria-expanded` or `aria-pressed`. Without either, the only
// cue that the thing is on is a colour.
//
// **Q-491 says a ratchet here is not obviously worth building, and the first attempt proved it.**
// The obvious heuristic — a file with a Chevron icon, no `CollapsibleTrigger` and no literal
// `aria-expanded` — matched **34 files**, almost all back-button chevrons and non-toggle uses. A
// script that flags 34 to save auditing 9 by hand is a bigger version of the problem, so it was left
// unbuilt.
//
// What makes this version different is that it does not look at icons at all. The signal is the
// SHAPE of a control: a `set…(v => !v)` **inside an `onClick`** whose state also appears in a
// conditional render in the same file. A back-button chevron navigates and never matches; derived
// state like `setLoading(!seeded)` is not in a click handler and never matches. Measured on
// 2026-09-09 against the same tree: **8 candidates, of which 4 were real** — then, with the toggle
// required to sit inside the `onClick` and files carrying `aria-pressed` excluded, **1**, which was
// also real. All five are fixed and the baseline below is empty.
//
// **It reports the QUESTION, not an answer, and that distinction is the whole reason the earlier
// version would have made things worse.** `app/coach/coach-content.tsx` swaps the panel between
// history and composer and is correctly `aria-pressed`; `app/session-select/session-select-content.tsx`
// put the sections into reorder mode and had neither. A check that said "add aria-expanded" would
// have pushed the wrong attribute onto both. So this one says: decide which of the two it is.
//
// Shrink-only, and the baseline is EMPTY — a file appearing here is a regression, not a debt row.
//
// The candidates are reproducible without this file:
//   grep -rn 'onClick={' --include='*.tsx' app components | grep -E 'set[A-Z]\w*\(\s*(!|\(?\w+\)?\s*=>\s*!)'
'use strict';
const fs = require('fs');
const path = require('path');
const { resolveBaseRef, countAtBase, verdict } = require('./lib/base-ref');

/**
 * Blank comments and string bodies, keeping byte length so nothing else shifts.
 *
 * Copied in shape from `check-aest-midnight-timezone.js`, which learned it the hard way: without it
 * that scanner counted a *comment* mentioning the call and baselined a file with no call site. The
 * same trap is live here — a doc comment describing `setOpen(v => !v)` would otherwise register as
 * a control.
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
 * How many click-toggled states in this file gate a render and carry no ARIA state.
 *
 * Counted per FILE rather than per control, deliberately. Whether a given `aria-pressed` belongs to
 * the button under inspection cannot be decided by a text scan, so a file that already declares one
 * is treated as handled — under-reporting rather than crying wolf, which is the failure mode that
 * killed the first attempt at this check.
 */
function countUnlabelledToggles(raw) {
  const src = stripCommentsAndStrings(raw);
  if (/aria-expanded|aria-pressed|CollapsibleTrigger/.test(src)) return 0;

  const toggled = new Set();
  // `onClick={... setX(!x)` or `onClick={... setX(v => !v)`, within one handler's worth of text.
  const re = /onClick=\{[^}]{0,160}?\bset([A-Z]\w*)\s*\(\s*(?:!|\(?\s*\w+\s*\)?\s*=>\s*!)/g;
  let m;
  while ((m = re.exec(src)) !== null) toggled.add(m[1][0].toLowerCase() + m[1].slice(1));
  if (toggled.size === 0) return 0;

  // …and the state must gate something, or it is a flag rather than a disclosure.
  let n = 0;
  for (const s of toggled) {
    const gates = new RegExp(`\\{\\s*${s}\\s*&&|\\{[^}]{0,40}\\b${s}\\s*&&|\\{\\s*${s}\\s*\\?`);
    if (gates.test(src)) n++;
  }
  return n;
}

// EMPTY, and that is the point: the five this check found on the tree it was written against are
// fixed (`program-export-card`, `injury-card`, `trophy-case`, `oura-ble-debug` took
// `aria-expanded`; `session-select-content` took `aria-pressed`). A row here is a regression.
const BASELINE = {};

const root = process.cwd();
const seen = new Set();
const failures = [];
const inherited = [];
const stale = [];

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
    if (!e.name.endsWith('.tsx')) continue;
    const rel = path.relative(root, full).split(path.sep).join('/');
    const count = countUnlabelledToggles(fs.readFileSync(full, 'utf8'));
    if (count === 0 && !(rel in BASELINE)) continue;
    seen.add(rel);
    const allowed = BASELINE[rel] ?? 0;
    const v = verdict({ count, limit: allowed, atBase: countAtBase(baseRef, rel, countUnlabelledToggles) });
    if (v === 'inherited') {
      inherited.push(`${rel}: ${count} against a baseline of ${allowed}, but the base branch already has ${count}. Not this branch's growth.`);
    } else if (v === 'fail') {
      failures.push({ rel, count, allowed });
    }
    if (count === 0 && rel in BASELINE) stale.push(rel);
  }
}

const baseRef = resolveBaseRef();

for (const top of ['app', 'components']) walk(path.join(root, top));

for (const rel of Object.keys(BASELINE)) if (!seen.has(rel)) stale.push(`${rel} (deleted)`);

if (inherited.length > 0) {
  console.log('check-toggle-aria: inherited from the base branch, not caused here:');
  inherited.forEach((f) => console.log('  • ' + f));
}

if (failures.length > 0 || stale.length > 0) {
  if (failures.length > 0) {
    console.error('A click toggles a boolean that gates a render, and nothing tells a screen reader which state it is in.');
    console.error('Decide which of the two this control is — the check deliberately does not:');
    console.error('  • it REVEALS a region  → aria-expanded={state} + aria-controls={id} on an id the region carries');
    console.error('  • it turns a MODE on   → aria-pressed={state}');
    console.error('Getting that wrong is worse than leaving it out, which is why this is a question and not a fix.');
    for (const f of failures) {
      console.error(f.allowed === 0
        ? `  ${f.rel}: ${f.count} toggle(s) with neither — this file had none.`
        : `  ${f.rel}: ${f.count} toggle(s), baseline ${f.allowed}.`);
    }
  }
  if (stale.length > 0) {
    console.error('Baseline row(s) to delete — these files no longer have the toggles they are recorded for:');
    for (const s of stale) console.error(`  ${s}`);
  }
  process.exit(1);
}

console.log('check-toggle-aria: OK — every click-toggled disclosure or mode declares its ARIA state.');
