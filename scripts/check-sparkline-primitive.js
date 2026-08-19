#!/usr/bin/env node
// `components/ui/sparkline.tsx` exists. Hand-rolling another `<polyline>` mini-chart instead of using
// it is what CLAUDE.md's *"Any pattern at ≥2 sites gets extracted before a third copy"* and
// *"replace on touch"* forbid — and it kept happening anyway: on 2026-08-08 a **sixth** inline copy
// landed in `day-detail/day-sections.tsx` (#1136), days after the count was last re-verified at five,
// with the primitive already sitting in `components/ui/` (Q-154).
//
// A rule policed only by reviewer memory is policed by nothing. This is the mechanical version.
'use strict';
const fs = require('fs');
const path = require('path');

// Legitimately not sparklines — these draw something else with the same element.
//
// The three time-axis entries were moved out of GRANDFATHERED on 2026-08-09, after reading them:
// `components/ui/sparkline.tsx` projects x by INDEX (`step = width / (values.length - 1)`), so a
// series whose samples are not evenly spaced in time would be redrawn with its points in the wrong
// places. Converting them would not be a refactor, it would be a silent distortion — and each one
// already carried a written reason, which the "convert the six" framing had read past.
const EXEMPT = new Set([
  'components/ui/sparkline.tsx',        // the primitive itself
  'components/health/detail-hero.tsx',  // decorative hero art, not a data series
  'components/workout/live-hr-chart.tsx', // a real time-series chart with its own axis logic
  // x = minute / 1440 — a fixed 0–1440 axis, so the overnight trough sits where the night was.
  'components/health/day-detail/day-sections.tsx',
  // x = (timestamp - startMs) / durationMs — real elapsed time across the activity.
  'components/activity/exercise-review-sheet.tsx',
  // x = (t - t0) / span, plus a 50% guide line and wall-clock end labels.
  'components/body-battery-card.tsx',
  // Q-414. A fixed 0–1440 time axis with its own hour labels, TWO series (cumulative intake and
  // cumulative burn) and bars for the discrete meals underneath them. The primitive projects x by
  // index and draws one line, so it cannot express any of that — this is the same reason the three
  // time-axis entries above are exempt rather than converted.
  'components/health/energy-timeline-chart.tsx',
]);

// Inline copies that predate this check. Shrink-only: replace with the primitive and delete the row.
// A NEW file appearing here is a regression, not an exemption to grant.
// These three ARE index-projected sparklines. They are still inline because the primitive cannot
// draw them yet — it has no value label, no stroke width, no emphasized last point, and its fixed
// ±0.5 value padding flattens a small-range series (a 0.5 kg body-weight spread loses half its
// amplitude). See Q-154 for the exact prop list.
const GRANDFATHERED = new Set([
  'components/exercise-history-sheet.tsx',
  'components/health-metric-sheet.tsx',
  'components/workout/active-workout-screen.tsx',
]);

const root = path.join(__dirname, '..');
const found = new Map();

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '__tests__', '.next', 'dist'].includes(entry.name)) continue;
      walk(full);
      continue;
    }
    if (!entry.name.endsWith('.tsx')) continue;
    const rel = path.relative(root, full).split(path.sep).join('/');
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!line.includes('<polyline')) return;
      if (!found.has(rel)) found.set(rel, []);
      found.get(rel).push(i + 1);
    });
  }
}

for (const top of ['app', 'components']) {
  const dir = path.join(root, top);
  if (fs.existsSync(dir)) walk(dir);
}

const offenders = [...found.keys()].filter(f => !EXEMPT.has(f) && !GRANDFATHERED.has(f));
const fixed = [...GRANDFATHERED].filter(f => !found.has(f));

if (offenders.length > 0) {
  console.error('Inline `<polyline>` mini-chart instead of `components/ui/sparkline.tsx` (CLAUDE.md: extract before a third copy; Q-154).');
  console.error('Use the primitive. If this genuinely is not a sparkline — decorative art, or a chart with its own axes — add it to EXEMPT in this script with a reason:');
  for (const f of offenders) console.error(`  ${f}: line(s) ${found.get(f).join(', ')}`);
  process.exit(1);
}

if (fixed.length > 0) {
  console.error('These files no longer hand-roll a `<polyline>` — remove them from GRANDFATHERED so they stay on the primitive:');
  for (const f of fixed) console.error(`  ${f}`);
  process.exit(1);
}

console.log(`check-sparkline-primitive: no new inline sparklines (${GRANDFATHERED.size} pre-existing copies to replace on touch, ${EXEMPT.size} exempt).`);
