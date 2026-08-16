#!/usr/bin/env node
// `color-mix(in oklch, <colour> N%, <achromatic>)` renders the WRONG HUE.
//
// oklch is a polar space, so mixing interpolates the hue angle. An achromatic endpoint (white,
// black, --color-muted, --color-background, --card) has chroma 0 and a stored hue of 0 — CSS Color 4
// says such a hue is "powerless" and should be carried from the other colour, but Chromium does not
// do that for color-mix. Measured in Chromium 2026-08-08:
//
//   color-mix(in oklch, oklch(0.72 0.19 149) 18%, oklch(1 0 0))  ->  oklch(0.9496 0.0342 26.82)
//                                          ^ green 149°                                 ^ PINK
//   color-mix(in oklab, oklch(0.72 0.19 149) 18%, oklch(1 0 0))  ->  oklab(0.9496 -0.029 0.018)
//                                                                              ^ correctly green
//
// 26 sites shipped this way — a brand-green tint rendering as salmon. It hid because the app was
// dark-only: against a near-black endpoint the same wrong hue lands at very low lightness, where it
// reads as "dark grey" rather than "wrong colour".
//
// Use `in oklab` instead: same perceptual space, rectangular coordinates, no hue to interpolate.
// Mixing with `transparent` is FINE and not flagged — alpha compositing preserves the hue.
'use strict';
const fs = require('fs');
const path = require('path');

// Chroma-0 in both themes, so all of these trigger the bug.
const ACHROMATIC = /^(?:var\(--color-muted\)|var\(--color-background\)|var\(--card\)|var\(--background\)|var\(--muted\)|var\(--popover\)|#000|#000000|#fff|#ffffff|white|black)$/;

const root = path.join(__dirname, '..');
const offenders = new Map();

function scan(file, rel) {
  const s = fs.readFileSync(file, 'utf8');
  for (const m of s.matchAll(/color-mix\(in oklch,/g)) {
    // Walk to this call's matching close paren so nested var(...) don't end it early.
    let depth = 0, k = s.indexOf('(', m.start ?? m.index);
    const open = k;
    while (k < s.length) {
      if (s[k] === '(') depth++;
      else if (s[k] === ')' && --depth === 0) break;
      k++;
    }
    const body = s.slice(open + 1, k);
    if (!body.includes('%,')) continue;
    const second = body.slice(body.lastIndexOf('%,') + 2).trim();
    if (!ACHROMATIC.test(second)) continue;
    const line = s.slice(0, m.index).split('\n').length;
    if (!offenders.has(rel)) offenders.set(rel, []);
    offenders.get(rel).push(`${line} (mixes with ${second})`);
  }
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.next', 'dist'].includes(entry.name)) continue;
      walk(full);
      continue;
    }
    if (!/\.(tsx?|css)$/.test(entry.name)) continue;
    scan(full, path.relative(root, full).split(path.sep).join('/'));
  }
}

for (const top of ['app', 'components', 'lib', 'packages']) {
  const dir = path.join(root, top);
  if (fs.existsSync(dir)) walk(dir);
}

if (offenders.size > 0) {
  console.error('color-mix(in oklch, …, <achromatic>) interpolates the HUE toward 0 — a green tint renders salmon.');
  console.error('Use `in oklab` instead (same perceptual space, no hue angle). Mixing with `transparent` is fine.');
  for (const [f, lines] of offenders) console.error(`  ${f}: line(s) ${lines.join(', ')}`);
  process.exit(1);
}

console.log('check-color-mix-hue: no oklch mixes against an achromatic colour.');
