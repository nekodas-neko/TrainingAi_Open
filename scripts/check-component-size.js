#!/usr/bin/env node
// Keeps component files under ~800 lines (CLAUDE.md: Mobile UI & Performance). The known
// hotspots absorb every new feature by default, so this is a ratchet rather than a flat limit:
// the files below are allowed at their recorded size and may only shrink, and any other file
// crossing the limit fails. New features go into extracted children in components/, not onto
// the end of a screen that is already too long.
'use strict';
const fs = require('fs');
const path = require('path');

const LIMIT = 800;

// Baseline recorded 2026-08-08. A file may sit at or below its baseline; it may never grow.
// Shrinking one below the limit? Delete its row — it is then held to LIMIT like everything else.
//
// This does not forbid growth outright — it forces growth to be *acknowledged*. A change that
// genuinely has to add lines to a hotspot raises the number here in the same PR, which puts the
// growth in the diff where a reviewer sees it, instead of letting these files drift upward one
// unremarked commit at a time (which is how they reached these sizes).
const BASELINE = {
  'components/workout-screen.tsx': 1850,
  'app/session-select/session-select-content.tsx': 1457,
  'components/config-screen.tsx': 997,
  'app/health/health-content.tsx': 911,
  'components/config/program-editor-sheet.tsx': 963,
};

const root = path.join(__dirname, '..');
const failures = [];

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
      if (lines > allowed) {
        failures.push({ rel, lines, allowed, grandfathered: rel in BASELINE });
      }
    }
  }
}

for (const top of ['app', 'components']) walk(path.join(root, top));

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
