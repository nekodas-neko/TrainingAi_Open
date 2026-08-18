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

const root = path.join(__dirname, '..');
const DIRS = ['app', 'components'];

// Recorded 2026-08-18 (Q-490). These are the sites that PREDATE the check; each is a real defeat.
// Q-357 is queued to clear them. Do not add a row to dodge a failure — hoist the prop instead.
const BASELINE = {
  // Two single-instance cards on the nutrition screen: four inline arrows and one inline object.
  // Cheap relative to the list sites below, but real.
  'app/nutrition/nutrition-content.tsx': 2,
  // The expensive one: five inline arrows on a card rendered inside `visibleMeals.map(...)`, so
  // every render of the sheet re-renders every saved meal.
  'components/nutrition/saved-meals-sheet.tsx': 1,
  // Debug console, admin-only surface.
  'components/oura-ble/oura-ble-debug.tsx': 1,
};

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '__tests__'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const files = DIRS.flatMap(d => walk(path.join(root, d), []));

// Every component wrapped in memo(...), by the name it is rendered under.
const memoised = new Set();
for (const abs of files) {
  const src = fs.readFileSync(abs, 'utf8');
  for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*(?::[^=]+)?=\s*(?:React\.)?memo\s*\(/g)) memoised.add(m[1]);
  for (const m of src.matchAll(/(?:React\.)?memo\s*\(\s*function\s+(\w+)/g)) memoised.add(m[1]);
}

const perFile = new Map();
const detail = [];

for (const abs of files) {
  const rel = path.relative(root, abs).replace(/\\/g, '/');
  const src = fs.readFileSync(abs, 'utf8');
  for (const name of memoised) {
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

const failures = [];
for (const [rel, count] of perFile) {
  const allowed = BASELINE[rel] ?? 0;
  if (count > allowed) {
    failures.push(allowed === 0
      ? `${rel}: ${count} memoised call site(s) with an inline prop; this file is not in the baseline, so it must have zero.`
      : `${rel}: ${count} memoised call site(s) with an inline prop, over its baseline of ${allowed}.`);
  }
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
