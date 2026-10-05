#!/usr/bin/env node
// Two controls with the same accessible name, both in the accessibility tree at once (LB-189).
//
// The tab shell keeps EVERY tab's tree mounted — that is deliberate, it is what makes a tab switch
// paint instantly — so a name that is unique per screen is not unique per document. A screen reader
// cannot use the viewport to tell two identically-named buttons apart the way a sighted user does,
// and it lands on whichever comes first in the DOM.
//
// It also breaks tests in a way that reads as a product bug. `getByRole('button', { name: … })`
// resolved to two elements for the energy-balance ⓘ toggle — `energy-card.tsx` on Nutrition and
// `calorie-balance-bar.tsx` on Health — and a `.first()` clicked the OFF-SCREEN one for a full 60
// seconds while `aria-expanded` stayed `false`. A dead-looking button that is really a mis-aimed
// one costs a session to diagnose, and `e2e/bf138-energy-model-explainer.spec.ts` carried an
// `evaluateAll` workaround for it until the names were made distinct.
//
// ⚠ This checks STATIC labels only — `aria-label="…"` with a literal string. An interpolated one
// (`aria-label={`Delete ${name}`}`) is left alone because it is usually distinct by construction
// and cannot be compared without resolving the expression; the run prints how many it skipped, so a
// clean result is never mistaken for full coverage.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { stripComments } = require('./lib/strip-comments');

const ROOT = path.join(__dirname, '..');

/**
 * Names that are SUPPOSED to repeat, each with the reason.
 *
 * The test is not "does this string appear twice" — it is "would a screen-reader user be unable to
 * tell which one they are on". A dismiss or navigation control is unambiguous because there is one
 * per surface and its meaning is the surface you are on; two controls that EXPLAIN different
 * figures are not.
 *
 * Add to this list only with a reason, and only for that shape. A second control that does a
 * different thing under the same words belongs renamed, not exempted.
 */
const EXEMPT = new Map([
  ['Go back', 'one per pushed route, and "back" means the route you are on'],
  ['Back', 'same as "Go back"; the two spellings are their own inconsistency, RV-208 territory'],
  ['Close', 'one per sheet or dialog, and it closes the one you are in'],
  ['Cancel', 'one per sheet or dialog, same reasoning as Close'],
  ['Clear search', 'one per search field, and it clears the field it sits in'],
  ['Refresh', 'one per refreshable surface; it refreshes what you are looking at'],
  ['Send message', 'the chat composer and its empty state — one is mounted at a time'],
  ['Previous day', 'Nutrition and the admin day-review console; admin surfaces are exempt by CLAUDE.md'],
  ['Next day', 'as Previous day'],
  ['Minutes to look back', 'admin console only'],
  ['Days to look back', 'admin console only'],
  ['Meal name', 'a form field label, one per form, and the forms are not co-mounted'],
  ['Reorder sections', 'one real use; the second hit is a comment quoting it'],
  ['Required (trigger end-of-day reminder)', 'one per reminder row in one list, distinguished by its row'],
  ['Loading collection', 'the pushed /collection route against Home\'s card — a pushed route is not co-mounted with the tab it came from'],
]);

const files = execFileSync('git', ['ls-files', 'app', 'components'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter(f => f.endsWith('.tsx') && !f.includes('__tests__'));

/** label -> [file:line, …] */
const seen = new Map();
let dynamic = 0;

for (const file of files) {
  const source = stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const lines = source.split('\n');
  lines.forEach((line, i) => {
    dynamic += (line.match(/aria-label=\{/g) ?? []).length;
    for (const m of line.matchAll(/aria-label="([^"]+)"/g)) {
      const at = `${file}:${i + 1}`;
      const list = seen.get(m[1]);
      if (list) list.push(at);
      else seen.set(m[1], [at]);
    }
  });
}

const offenders = [...seen].filter(([label, at]) => at.length > 1 && !EXEMPT.has(label));

if (offenders.length > 0) {
  console.error('Two controls share one static accessible name.');
  console.error('');
  console.error('The tab shell keeps every tab mounted, so a name unique per screen is not unique');
  console.error('per document: a screen reader cannot tell them apart, and a test locator resolves');
  console.error('to both — clicking whichever is first, which may be the off-screen one.');
  console.error('');
  console.error('Name each for the thing it acts on. If the repeat is genuinely fine — one dismiss');
  console.error('control per sheet, say — add it to EXEMPT in this script WITH its reason.');
  console.error('');
  for (const [label, at] of offenders) console.error(`  "${label}"\n    ${at.join('\n    ')}`);
  process.exit(1);
}

console.log(
  `check-duplicate-aria-labels: ${seen.size} static labels, no unexplained duplicates `
  + `(${EXEMPT.size} exempted with reasons; ${dynamic} interpolated labels not comparable).`,
);
