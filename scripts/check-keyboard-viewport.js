#!/usr/bin/env node
// Two things the soft keyboard needs, held at zero (RV-210).
//
// ── 1. Sheet heights are in `dvh`, never `vh` ────────────────────────────────────────────────
//
// `vh` is the LARGE viewport — it never shrinks, by definition. A bottom sheet at `max-h-[90vh]`
// keeps a height computed for a screen that no longer exists the moment the keyboard covers half
// of it, so its submit button ends up underneath. `dvh` tracks the dynamic viewport, which is the
// unit that responds.
//
// This was a 22/23 split when the rule was written: the newer sheets were already on `dvh` and
// nothing said so, so each new sheet was a coin toss. That is the shape a check fixes and prose
// does not.
//
// ── 2. `interactive-widget=resizes-content` is set ───────────────────────────────────────────
//
// Android's default is `resizes-visual`: the keyboard is drawn OVER a page that keeps its full
// height, so neither `dvh` nor `env(safe-area-inset-bottom)` moves and item 1 buys nothing. The
// two are a pair — checking one without the other passes a half-fix.
//
// ── What this check cannot do ────────────────────────────────────────────────────────────────
//
// Nothing here proves the keyboard behaves. There is no soft keyboard in a headless Chromium, so
// the harness cannot reach this at all; the device pass is RV-205's P26 and is owed separately.
// This guards the two source conditions that are NECESSARY for it, not that it works.
'use strict';
const fs = require('fs');
const path = require('path');
const { stripComments } = require('./lib/strip-comments');

const root = path.join(__dirname, '..');
const ROOTS = ['components', 'app'];

/** `[90vh]` in a Tailwind arbitrary value — `dvh`/`svh`/`lvh` are all fine. */
const VH = /\[(\d+(?:\.\d+)?)vh\]/g;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(full, out); continue; }
    if (e.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const offenders = [];
let scanned = 0;

for (const r of ROOTS) {
  for (const file of walk(path.join(root, r))) {
    scanned++;
    const rel = path.relative(root, file).split(path.sep).join('/');
    // Comments blanked: the two surviving `90vh`/`35vh` mentions in the tree are both prose
    // EXPLAINING a height, and a check that flags its own explanation teaches people to delete it.
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    src.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(VH)) {
        offenders.push({ rel, line: i + 1, text: m[0] });
      }
    });
  }
}

const LAYOUT = 'app/layout.tsx';
const layout = stripComments(fs.readFileSync(path.join(root, LAYOUT), 'utf8'));
const hasWidget = /interactiveWidget\s*:\s*["']resizes-content["']/.test(layout);

if (offenders.length > 0 || !hasWidget) {
  console.error('check-keyboard-viewport: the soft keyboard cannot resize what it cannot reach (RV-210).');
  if (!hasWidget) {
    console.error(`\n  ${LAYOUT} — the viewport export needs \`interactiveWidget: "resizes-content"\`.`);
    console.error('  Without it Android draws the keyboard OVER a full-height page and `dvh` never moves.');
  }
  if (offenders.length > 0) {
    console.error('\n  A height in `vh` never shrinks — use `dvh`:');
    for (const o of offenders) console.error(`    ${o.rel}:${o.line}  ${o.text}`);
  }
  process.exit(1);
}

console.log(`check-keyboard-viewport: ${scanned} .tsx file(s); no \`vh\` heights, interactive-widget set.`);
