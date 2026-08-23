#!/usr/bin/env node
// Semantic colours come from theme tokens, not hex literals (CLAUDE.md: Visual consistency &
// theme). A literal bypasses the tuned `--accent-*` scale, and a literal `text-white` breaks light
// mode outright.
//
// That rule was prose only, and prose lost. The count under app/ + components/ went 455
// (2026-08-07) -> 430 (2026-08-09) -> 471 (2026-08-14) while CLAUDE.md recorded the trend as
// improving: +41 in five days, in the wrong direction, unnoticed. The two comparable rules that DO
// hold — component size and the color-mix hue bug — each have a shrink-only CI baseline, and that
// is the only structural difference between them and this one.
//
// So this is a ratchet, not a ban. Every file holding hex today is recorded at its current count
// and may only shrink; any file NOT listed must have zero. A change that genuinely needs a literal
// (canvas paint cannot resolve `var(--x)`; the icon routes have no CSS at all) raises the number
// here in the same PR — which puts the growth in the diff where a reviewer sees it, instead of
// letting it accumulate one unremarked commit at a time, which is how it reached 471.
//
// Sweeping the existing 471 is deliberately NOT this script's job. The baseline is the
// mechanism; the sweep is separate, optional and much larger.
//
// Counting caveat, so the number stays comparable with the ones above: this is the same expression
// CLAUDE.md and the 2026-08-14 review used, over .tsx under app/ + components/. It is a proxy — it
// also matches a `#1279`-style PR reference in a comment. Kept identical anyway, because a baseline
// whose number cannot be reproduced from a shell is a baseline nobody will trust:
//   grep -rhoE '#[0-9a-fA-F]{3,8}\b' app components --include=*.tsx | wc -l
'use strict';
const fs = require('fs');
const path = require('path');
const { resolveBaseRef, countAtBase, verdict } = require('./lib/base-ref');

const HEX = /#[0-9a-fA-F]{3,8}\b/g;

/** The one counting expression, so the working tree and the base branch are measured identically. */
const countHex = (src) => (src.match(HEX) || []).length;

// Baseline recorded 2026-08-15 — 471 literals across 95 files. Shrink-only.
// A file that reaches zero should have its row deleted, so it is held to zero from then on.
const BASELINE = {
  'app/apple-icon.tsx': 8,
  'app/health/activity/activity-content.tsx': 7,
  'app/health/day/day-detail-content.tsx': 4,
  'app/health/health-sections.tsx': 50,
  'app/health/heart-rate/page.tsx': 6,
  'app/health/readiness/readiness-content.tsx': 1,
  'app/health/sleep/sleep-content.tsx': 2,
  'app/icon.tsx': 8,
  'app/layout.tsx': 1,
  'app/profile/[userId]/page.tsx': 3,
  'app/session-select/components/deload-banner.tsx': 3,
  'app/session-select/components/deload-explanation.tsx': 3,
  'app/session-select/components/recommendation-card.tsx': 6,
  'app/session-select/components/streak-card.tsx': 4,
  'app/session-select/session-select-content.tsx': 1,
  'app/workout-select/workout-select-content.tsx': 1,
  'components/activity/activity-route-map.tsx': 4,
  'components/activity/done-activity-screen.tsx': 1,
  'components/admin/calibration-card.tsx': 5,
  'components/body-battery-card.tsx': 2,
  'components/cardio/modality-picker.tsx': 3,
  'components/cardio/time-picker-sheet.tsx': 1,
  'components/chart-message.tsx': 6,
  'components/checkin/readiness-checkin-card.tsx': 1,
  'components/exercise-history-sheet.tsx': 1,
  'components/google-sign-in.tsx': 4,
  'components/guided-walk/walk-active.tsx': 1,
  'components/guided-walk/walk-summary.tsx': 2,
  'components/health/ai-weekly-volume-card.tsx': 1,
  'components/health/body-cards/rhr-hrv-spo2-card.tsx': 15,
  'components/health/body-cards/sleep-card.tsx': 5,
  'components/health/body-muscle-card.tsx': 1,
  'components/health/detail-hero.tsx': 55,
  'components/health/goals-progress-card.tsx': 6,
  'components/health/hr-day-chart.tsx': 1,
  'components/health/injury-card.tsx': 3,
  'components/health/metric-scale.tsx': 11,
  'components/health/metric-sheets.tsx': 5,
  'components/health/nutrition-activity-trends-card.tsx': 3,
  'components/health/sleep-timing-trend-card.tsx': 2,
  'components/health/sleep-vs-performance-card.tsx': 2,
  'components/health/strength-progress-card.tsx': 8,
  'components/health/strength-trend-card.tsx': 3,
  'components/health/training-load-card.tsx': 5,
  'components/health/training-stress-line.tsx': 2,
  'components/health/trend-sparkline.tsx': 6,
  'components/health/trends-section.tsx': 2,
  'components/health/weekly-muscle-sets-card.tsx': 6,
  'components/health/workout-density-card.tsx': 1,
  'components/health/zone-gauge.tsx': 8,
  'components/home/early-deload-card.tsx': 2,
  'components/home/home-card-widget.tsx': 5,
  'components/more/home-widgets-section.tsx': 16,
  'components/more/profile-tab.tsx': 6,
  'components/more/stats-grid.tsx': 2,
  'components/muscle-heatmap.tsx': 8,
  'components/nutrition/end-of-day/scale-selector.tsx': 2,
  'components/nutrition/ingredient-search.tsx': 1,
  'components/nutrition/meal-macro-bars.tsx': 2,
  'components/nutrition/supplements-section.tsx': 1,
  'components/nutrition/weekly-nutrition-chart.tsx': 1,
  'components/oura-score-chip-row.tsx': 4,
  'components/profile/achievements-grid.tsx': 13,
  'components/profile/goal-targets-section.tsx': 3,
  'components/profile/level-sheet.tsx': 1,
  'components/profile/macro-targets-pane.tsx': 2,
  'components/running/running-plan-content.tsx': 1,
  'components/shell/bottom-nav.tsx': 1,
  'components/ui/color-swatch-picker.tsx': 2,
  'components/ui/sparkline-chart.tsx': 1,
  'components/weather-chip.tsx': 5,
  'components/workout-builder/builder-review.tsx': 1,
  'components/workout-builder/goal-spectrum.tsx': 8,
  'components/workout/active-workout-screen.tsx': 1,
  'components/workout/done-screen.tsx': 6,
  'components/workout/exercise-stats-sheet.tsx': 6,
  'components/workout/hr-recovery-chart.tsx': 6,
  'components/workout/last-set-rest-timer.tsx': 1,
  'components/workout/live-1rm-readout.tsx': 2,
  'components/workout/log-activity-sheet.tsx': 1,
  'components/workout/pip-view.tsx': 2,
  'components/workout/rest-ring.tsx': 6,
  'components/workout/rpe-strip.tsx': 7,
  'components/workout/time-summary-card.tsx': 5,
  'components/workout/warmup-screen.tsx': 4,
  'components/workout/workout-clocks.tsx': 3,
};

const root = path.join(__dirname, '..');
const failures = [];
const inherited = [];
const stale = [];
let total = 0;
const seen = new Set();

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      walk(full);
      continue;
    }
    if (!entry.name.endsWith('.tsx')) continue;
    const rel = path.relative(root, full).split(path.sep).join('/');
    const count = countHex(fs.readFileSync(full, 'utf8'));
    total += count;
    seen.add(rel);
    const allowed = BASELINE[rel] ?? 0;
    // LA-16 / Q-424: whether THIS BRANCH added one, not whether the file is over. The base count
    // runs the SAME matcher over the base content — never a second regex, which would disagree with
    // the working-tree count for reasons nobody could see.
    const v = verdict({ count, limit: allowed, atBase: countAtBase(baseRef, rel, countHex) });
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

// A row for a file that is now clean (or gone) has to come out, or the list rots into an allowlist
// that permits hex to come back to a file that had been fixed. Same rule the sibling checks use.
for (const rel of Object.keys(BASELINE)) if (!seen.has(rel)) stale.push(`${rel} (deleted)`);

// Reported whether or not the run fails, and never as a failure (Q-424).
if (inherited.length > 0) {
  console.log('check-hex-literals: inherited from the base branch, not caused here:');
  inherited.forEach((f) => console.log('  • ' + f));
}

if (failures.length > 0 || stale.length > 0) {
  if (failures.length > 0) {
    console.error('Hex colour literal(s) added (CLAUDE.md: semantic colours come from theme tokens, never hex literals).');
    console.error('Use an --accent-* / Tailwind theme colour. If a literal is genuinely required (canvas paint cannot');
    console.error('resolve var(--x); icon routes have no CSS), raise the count in scripts/check-hex-literals.js in this PR.');
    for (const f of failures) {
      console.error(f.allowed === 0
        ? `  ${f.rel}: ${f.count} hex literal(s) — this file had none.`
        : `  ${f.rel}: ${f.count} hex literal(s), baseline ${f.allowed}.`);
    }
  }
  if (stale.length > 0) {
    console.error('Baseline row(s) to delete — these files no longer carry the hex they are recorded for:');
    for (const s of stale) console.error(`  ${s}`);
  }
  process.exit(1);
}

console.log(`check-hex-literals: ${total} hex literals under app/ + components/ (.tsx) across ${Object.keys(BASELINE).length} recorded files, none above baseline.`);
