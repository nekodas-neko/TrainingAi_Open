#!/usr/bin/env node
// `React.memo` compares props shallowly, so ONE inline object, array, or arrow in a prop defeats it
// completely and silently — the component keeps its `memo(...)` wrapper, keeps reading as optimised,
// and re-renders on every parent render. CLAUDE.md states the rule; nothing measured it, and by
// 2026-08-18 six call sites across five memoised components were defeating it, two of them inside a
// `.map` (Q-490: every keystroke in the meal-plan sheet re-rendered every meal row's macro bars).
//
// This finds them: every `memo(...)` component in the tree, then every JSX call site of one, then
// any prop whose value is an inline `{{…}}`, `{[…]}`, or `{… => …}`.
//
// Shrink-only per-file baseline, same shape as check-hex-literals.js. A file not listed must have
// zero; a listed file may only shrink; a file that reaches zero must have its row deleted. Fixing a
// site means hoisting with useCallback/useMemo — or, when the site is inside a `.map` where a hook
// is not allowed, changing the prop to a scalar or moving the identity into the child, which is what
// Q-490 did.
'use strict';
const fs = require('fs');
const path = require('path');
const { resolveBaseRef, treeFilesAtBase, verdict } = require('./lib/base-ref');
const { readFilesUtf8, runMain } = require('./lib/read-sources');
const { stripComments } = require('./lib/strip-comments');

const root = path.join(__dirname, '..');
const DIRS = ['app', 'components'];

// Recorded 2026-08-18 (Q-490). These are the sites that PREDATE the check; each is a real defeat.
// Q-357 is queued to clear them. Do not add a row to dodge a failure — hoist the prop instead.
// EMPTY, and that is the point: any defeated call site is now a regression rather than a debt row.
//
// It held four when Q-490 wrote this check and Q-357 cleared the rest (2026-08-24). The expensive
// one was `SavedMealCard`, five inline arrows on a card inside `visibleMeals.map(...)` — where a
// hook is not allowed, so the fix was to move the identity into the child: each callback takes the
// meal and hands it back, letting the parent share one `useCallback` per action across every card.
const BASELINE = {};

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '__tests__'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/**
 * The same file filter as `walk`, for a path the base tree listing names: a `.tsx` under one of
 * `DIRS`, with no directory on the way named like one `walk` skips.
 */
function keptAtBase(rel) {
  const parts = rel.split('/');
  return DIRS.includes(parts[0]) && rel.endsWith('.tsx') &&
    !parts.some(p => ['node_modules', '.next', '__tests__'].includes(p));
}

/**
 * The whole check, over one set of sources (`[{ rel, content }]`). Run twice — the working tree, and
 * the base branch read from git — so the base is measured by its OWN memoised-component list rather
 * than this branch's (LA-16). A branch that newly memoises a component with existing inline call
 * sites is exactly the case a shared component list would mis-report, and mis-report as passing.
 *
 * #2560: each file is stripped once, not once per pass, and a memoised name the file never spells
 * as `<Name` is not searched for. That skip cannot hide a site: the tag regex below matches only
 * text that starts with exactly those characters.
 */
function scan(sources) {
  const stripped = sources.map(({ rel, content }) => ({ rel, src: stripComments(content) }));

  // Every component wrapped in memo(...), by the name it is rendered under.
  const memoised = new Set();
  for (const { src } of stripped) {
    for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*(?::[^=]+)?=\s*(?:React\.)?memo\s*\(/g)) memoised.add(m[1]);
    for (const m of src.matchAll(/(?:React\.)?memo\s*\(\s*function\s+(\w+)/g)) memoised.add(m[1]);
  }

  const perFile = new Map();
  const detail = [];

  for (const { rel, src } of stripped) {
    for (const name of memoised) {
    if (!src.includes('<' + name)) continue;
    const re = new RegExp('<' + name + '(?=[\\s/>])', 'g');
    let m;
    while ((m = re.exec(src))) {
      // Slice the opening tag, tracking brace depth so a `>` inside an expression does not end it.
      let depth = 0, j = m.index;
      for (; j < src.length; j++) {
        const c = src[j];
        if (c === '{') depth++;
        else if (c === '}') depth--;
        else if (c === '>' && depth === 0) break;
      }
      const tag = src.slice(m.index, j + 1);
      const inlineObject = /=\{\s*\{/.test(tag);
      const inlineArray = /=\{\s*\[/.test(tag);
      const inlineArrow = /=\{\s*(?:\([^)]*\)|\w+)\s*=>/.test(tag);
      if (inlineObject || inlineArray || inlineArrow) {
        perFile.set(rel, (perFile.get(rel) ?? 0) + 1);
        const line = src.slice(0, m.index).split('\n').length;
        const kinds = [inlineObject && 'object', inlineArray && 'array', inlineArrow && 'arrow'].filter(Boolean);
        detail.push(`${rel}:${line}  <${name}> — inline ${kinds.join(' + ')} in a prop`);
        }
      }
    }
  }
  return { perFile, detail, memoised };
}

runMain(async () => {
  const files = DIRS.flatMap(d => walk(path.join(root, d), []));
  const contents = await readFilesUtf8(files);
  const { perFile, detail, memoised } = scan(files.map((abs, k) => ({
    rel: path.relative(root, abs).replace(/\\/g, '/'),
    content: contents[k],
  })));

  // #2560: read from git in memory rather than `git archive` into a temp directory and walked — the
  // same files, and the same `null` (no base, STRICT) when they cannot all be read.
  const baseRef = resolveBaseRef();
  const baseFiles = treeFilesAtBase(baseRef, keptAtBase);
  const basePerFile = baseFiles === null
    ? null
    : scan([...baseFiles].map(([rel, content]) => ({ rel, content }))).perFile;

  const failures = [];
  const inherited = [];
  for (const [rel, count] of perFile) {
    const allowed = BASELINE[rel] ?? 0;
    // LA-16 / Q-424: whether THIS BRANCH added one, not whether the file is over.
    const atBase = basePerFile === null ? null : (basePerFile.get(rel) ?? 0);
    const v = verdict({ count, limit: allowed, atBase });
    if (v === 'inherited') {
      inherited.push(`${rel}: ${count} inline-prop call site(s) against a baseline of ${allowed}, but the base branch is already there.`);
    } else if (v === 'fail') {
      failures.push(allowed === 0
        ? `${rel}: ${count} memoised call site(s) with an inline prop; this file is not in the baseline, so it must have zero.`
        : `${rel}: ${count} memoised call site(s) with an inline prop, over its baseline of ${allowed}.`);
    }
  }

  // Reported whether or not the run fails, and never as a failure (Q-424).
  if (inherited.length) {
    console.log('check-memo-prop-stability: inherited from the base branch, not caused here:');
    inherited.forEach((f) => console.log('  • ' + f));
  }
  for (const [rel, allowed] of Object.entries(BASELINE)) {
    const count = perFile.get(rel) ?? 0;
    if (count < allowed) {
      failures.push(`${rel}: down to ${count} from a baseline of ${allowed} — ${count === 0 ? 'delete its row' : `lower it to ${count}`}, the baseline is shrink-only.`);
    }
  }

  if (failures.length) {
    console.error('Memo prop-stability check failed:\n');
    for (const f of failures) console.error(`  • ${f}`);
    console.error('\n  Sites found:');
    for (const d of detail) console.error(`    ${d}`);
    console.error(`
  memo() compares props shallowly, so one inline object/array/arrow defeats it entirely and the
  component re-renders on every parent render while still looking optimised. Hoist the value with
  useCallback/useMemo at the call site. If the call site is inside a .map() — where a hook is not
  allowed — pass scalars instead, or move the identity into the child.`);
    process.exit(1);
  }

  const total = [...perFile.values()].reduce((a, b) => a + b, 0);
  console.log(`check-memo-prop-stability: OK — ${memoised.size} memoised components, ${total} known defeated call site(s), none new`);
});
