#!/usr/bin/env node
// `ProgressFill` has a precondition on its CALLER, and nothing enforced it (LB-162).
//
// The primitive renders the fill and not the track, deliberately — every track already carries its
// own `role="progressbar"`, its ARIA values, a background derived from the fill colour, a height
// between 1.5 and 2.5, and in one case an absolutely-positioned target tick. Owning the fill alone
// is the part that is genuinely identical across call sites.
//
// The cost is one invariant the call site has to hold: **the fill is SQUARE, and `scaleX` scales a
// radius along with it.** So a track with a radius has to clip:
//
//   rounded track + `overflow-hidden`  → the square fill is clipped to the track's shape. Correct.
//   rounded track, no clipping         → square ends stick out past the rounded corners, and at a
//                                        low percentage the fill's own radius reads visibly oval.
//   no radius at all                   → a square fill in a square track. Also correct, and this is
//                                        why the rule is "rounded ⇒ clipped" rather than
//                                        "always rounded-full overflow-hidden".
//
// `ProgressFill`'s docstring states this ("A new caller without those two classes gets square
// ends"), which is a rule policed by whoever reads the docstring — and `LB-162`'s device pass test
// carried *"no fill looks oval at a low percentage"* as a thing the owner had to go and look at.
// It is a source property, so it is checked here instead: all **11** call sites hold it today, and
// the baseline is empty.
//
// ⚠ It checks the element that DIRECTLY wraps `<ProgressFill`, not the outermost track — and that
// distinction is load-bearing. `weekly-muscle-sets-card` deliberately leaves its outer track
// `overflow-visible` so two `h-3` target markers can escape an `h-2` track, and nests the fill in
// an `absolute inset-0 rounded-full overflow-hidden` wrapper. Judging the outer element would
// report that correct site as broken.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { stripComments } = require('./lib/strip-comments');

const ROOT = path.join(__dirname, '..');
const TAG = '<ProgressFill';

/** The opening tag of the nearest preceding element, flattened to one line. */
function wrappingTag(source, at) {
  const opens = [...source.slice(0, at).matchAll(/<(?:div|span)\b/g)];
  if (opens.length === 0) return null;
  const start = opens[opens.length - 1].index;
  // Stop at the first `>` outside a JSX expression — `style={{ … }}` holds braces, not angles.
  let depth = 0;
  for (let i = start; i < at; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    else if (source[i] === '>' && depth === 0) return source.slice(start, i + 1).replace(/\s+/g, ' ');
  }
  return source.slice(start, at).replace(/\s+/g, ' ');
}

const files = execFileSync('git', ['ls-files', 'app', 'components'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter(f => f.endsWith('.tsx') && !f.includes('__tests__'));

const offenders = [];
let sites = 0;

for (const file of files) {
  const source = stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  for (let at = source.indexOf(TAG); at >= 0; at = source.indexOf(TAG, at + 1)) {
    sites++;
    const line = source.slice(0, at).split('\n').length;
    const tag = wrappingTag(source, at);
    if (tag == null) {
      offenders.push({ at: `${file}:${line}`, why: 'no wrapping element found', tag: '' });
      continue;
    }
    // `rounded` alone is Tailwind's default radius; `rounded-none` is the explicit opt-out.
    const rounded = /\brounded(-(?!none\b)[\w[\]./-]+)?\b/.test(tag) || /borderRadius/.test(tag);
    const clipped = /\boverflow-(hidden|clip)\b/.test(tag) || /overflow:\s*['"]?(hidden|clip)/.test(tag);
    if (rounded && !clipped) {
      offenders.push({ at: `${file}:${line}`, why: 'rounded track does not clip', tag });
    }
  }
}

if (offenders.length > 0) {
  console.error('A ProgressFill sits in a rounded track that does not clip it.');
  console.error('');
  console.error('The fill is square and `scaleX` scales a radius with it, so a rounded track must');
  console.error('carry `overflow-hidden` (or `overflow-clip`) or the fill shows square ends and');
  console.error('reads oval at a low percentage. A track with no radius needs neither.');
  console.error('');
  console.error('If the fill is nested one level deeper on purpose — as weekly-muscle-sets-card');
  console.error('does, to let its target markers escape the track — put the clipping classes on');
  console.error('the element that DIRECTLY wraps <ProgressFill>.');
  console.error('');
  for (const o of offenders) console.error(`  ${o.at}  (${o.why})\n    ${o.tag.slice(0, 160)}`);
  process.exit(1);
}

console.log(`check-progress-fill-track: ${sites} ProgressFill call sites, every rounded track clips its fill.`);
