#!/usr/bin/env node
// WCAG contrast for the theme tokens, computed from `app/globals.css` — no browser, no
// screenshotting, no pixel sampling.
//
// Both browser-based attempts failed (2026-08-08): walking computed styles returned identical
// light/dark numbers because `body` is transparent under the dynamic-background layer, and pixel
// sampling returned 1:1 everywhere. A third attempt was abandoned when its own self-test scored
// black-on-white at 1.96:1.
//
// So this computes the ratio from the token values directly: oklch -> OKLab -> linear sRGB ->
// WCAG relative luminance. **It self-tests before reporting anything** — the earlier attempts'
// one redeeming feature was that a self-test caught them, and every number below is worthless if
// the anchors do not land, so a failed anchor exits non-zero instead of printing results.
'use strict';
const fs = require('fs');
const path = require('path');

function oklchToLinearSrgb(L, C, Hdeg) {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}
const clamp = v => Math.min(1, Math.max(0, v));
// WCAG relative luminance is defined on LINEARISED sRGB, which is what the transform above
// already returns — there is no gamma round-trip to do here.
const lum = ([L, C, H]) => {
  const [r, g, b] = oklchToLinearSrgb(L, C, H).map(clamp);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
function ratioFromLum(l1, l2) {
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
const ratio = (fg, bg) => ratioFromLum(lum(fg), lum(bg));

function hexLum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

// ---- self-test ----
// The black/white oklch anchors are exact by definition, but they are ACHROMATIC — and for
// r == g == b the luminance weights only have to sum to 1, so a wrong set of coefficients sails
// straight through them. Proven by mutation: replacing 0.2126/0.7152/0.0722 with 0.5/0.3/0.2 left
// both passing and the script reported bogus token failures instead of admitting its math was
// broken. The chromatic cross-path anchor below is what actually pins the weights: pure sRGB red
// via oklch must land on the same luminance as pure sRGB red via hex.
const OKLCH_RED = [0.6280, 0.2577, 29.2338]; // sRGB #FF0000
const SELF_TESTS = [
  ['black on white (oklch)', ratio([0, 0, 0], [1, 0, 0]), 21, 0.1],
  ['white on white (oklch)', ratio([1, 0, 0], [1, 0, 0]), 1, 0.01],
  ['#767676 on #fff (hex)', ratioFromLum(hexLum('#767676'), hexLum('#ffffff')), 4.54, 0.05],
  ['#000 on #fff (hex)', ratioFromLum(hexLum('#000000'), hexLum('#ffffff')), 21, 0.05],
  ['red: oklch path == hex path', lum(OKLCH_RED), hexLum('#ff0000'), 0.005],
  ['red on white (chromatic)', ratioFromLum(lum(OKLCH_RED), hexLum('#ffffff')), 4.0, 0.05],
];
for (const [name, got, want, tol] of SELF_TESTS) {
  if (Math.abs(got - want) > tol) {
    console.error(`check-contrast SELF-TEST FAILED: ${name} = ${got.toFixed(3)}, expected ~${want}.`);
    console.error('The conversion is wrong, so every ratio it produces is meaningless. Not reporting results.');
    process.exit(1);
  }
}

// ---- read tokens out of globals.css ----
const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8');

// The light palette lives on bare `:root`; the dark overrides come later. Splitting on the first
// dark block keeps "last definition wins" per theme without a real CSS parser.
//
// The pattern must anchor on a rule OPENER at the start of a line. A bare /\.dark\b/ matches
// `@custom-variant dark (&:is(.dark *))` on line 4 — which silently made the light palette empty and
// scored every pair against dark tokens twice. The check then PASSED, for entirely the wrong reason.
const darkAt = css.search(/^(?:\.dark\s*\{|@media \(prefers-color-scheme: dark\)|:root\[data-theme=["']dark["']\])/m);
if (darkAt === -1) {
  console.error('check-contrast: could not locate the dark-theme block in app/globals.css — refusing to report light-only numbers as if they covered both themes.');
  process.exit(1);
}
const lightSrc = css.slice(0, darkAt);
const darkSrc = css.slice(darkAt);

function tokens(src) {
  const out = {};
  for (const m of src.matchAll(/--([a-z0-9-]+):\s*oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/g)) {
    out[m[1]] = [parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])];
  }
  return out;
}
const light = tokens(lightSrc);
const dark = { ...light, ...tokens(darkSrc) };

// A parse that silently yields nothing is the failure mode this script exists to avoid — every
// earlier contrast attempt "succeeded" while measuring the wrong thing. Assert both palettes
// actually resolved before trusting a single ratio.
for (const [name, T] of [['light', light], ['dark', dark]]) {
  for (const req of ['background', 'foreground', 'muted', 'muted-foreground']) {
    if (!T[req]) {
      console.error(`check-contrast: ${name} theme has no --${req} parsed from globals.css. The palette split is wrong; not reporting.`);
      process.exit(1);
    }
  }
}
if (JSON.stringify(light.background) === JSON.stringify(dark.background)) {
  console.error('check-contrast: light and dark --background resolved identically, so the two palettes did not separate. Not reporting.');
  process.exit(1);
}

// fg token, bg token, required ratio. 4.5 = AA body text; 3.0 = large text / UI components.
const PAIRS = [
  ['foreground', 'background', 4.5],
  ['card-foreground', 'card', 4.5],
  ['muted-foreground', 'background', 4.5],
  ['muted-foreground', 'card', 4.5],
  ['muted-foreground', 'muted', 4.5],
  ['primary-foreground', 'primary', 4.5],
  ['accent-green', 'background', 4.5],
  ['accent-cyan', 'background', 4.5],
  ['accent-amber', 'background', 4.5],
  ['accent-purple', 'background', 4.5],
];

// Pairs known to fall short, with the measured value at the time of recording. Shrink-only: fix the
// token and delete the row. A NEW entry here is a regression, not an exemption to grant.
// Empty on purpose. `light:muted-foreground on muted` lived here at 4.34:1 until the token was
// darkened to oklch(0.546) (Q-167); the check below fails if a listed pair starts passing, so a
// fixed row must be deleted rather than left as a comment.
const GRANDFATHERED = new Map([]);

const failures = [];
const results = [];
for (const [themeName, T] of [['light', light], ['dark', dark]]) {
  for (const [fg, bg, need] of PAIRS) {
    if (!T[fg] || !T[bg]) continue; // token not defined as a literal oklch triple
    const r = ratio(T[fg], T[bg]);
    const key = `${themeName}:${fg} on ${bg}`;
    results.push({ key, r, need });
    if (r + 1e-9 < need && !GRANDFATHERED.has(key)) failures.push({ key, r, need });
  }
}

const fixed = [...GRANDFATHERED.keys()].filter(k => {
  const hit = results.find(x => x.key === k);
  return hit && hit.r + 1e-9 >= hit.need;
});

if (failures.length) {
  console.error('Theme token pair below its WCAG contrast minimum:');
  for (const f of failures) console.error(`  ${f.key}: ${f.r.toFixed(2)}:1 (needs ${f.need}:1)`);
  console.error('Adjust the token in app/globals.css. Darkening a foreground lightness by ~0.01 in oklch is usually enough and is visually imperceptible.');
  process.exit(1);
}

if (fixed.length) {
  console.error('These pairs now meet their minimum — remove them from GRANDFATHERED so they stay compliant:');
  for (const k of fixed) console.error(`  ${k}`);
  process.exit(1);
}

console.log(`check-contrast: ${results.length} token pairs meet WCAG AA (${GRANDFATHERED.size} grandfathered below minimum).`);
