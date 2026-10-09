#!/usr/bin/env node
// Issue 2429. Sub-12 px text drawn at reduced opacity: audit + ratchet.
//
// `check-contrast.js` guards `text-(muted-)foreground/NN` below 70 at EVERY size. It does not see
// the other ways small text gets dimmed: `opacity-NN` on the element, `text-brand/70`,
// `text-background/70`, `text-white/30`. This scan finds every element whose class list has a
// font size under 12 px (`text-[Npx]`, N < 12) AND an effective alpha under 100%, resolves the dark
// theme tokens from `app/globals.css`, alpha-blends the text over each surface it can sit on
// (--card, --background, --muted, at the worst brand hue) in gamma-encoded sRGB the way CSS does, and
// compares with WCAG AA for text under 18 px, 4.5:1.
//
// RATCHET. Sites under 4.5:1 (or that cannot be measured) are counted per file in BASELINE. A file
// may not exceed its count, a file not listed may not have any, and a count that fell must be
// lowered here. The baseline can only shrink. Nothing about it changes a rendered class: it is a
// list of what exists today.
//
//   node scripts/check-small-text-contrast.js            the gate
//   node scripts/check-small-text-contrast.js --report   the audit table (markdown)
//
// Limits, stated so nobody over-trusts the number: size and alpha are read from ONE className value
// (`className="..."`, `className={...}`) or, outside one, one string literal. A size set in one
// constant and an opacity in another is not joined. `text-xs` is 12 px, so not "sub-12". The surface
// is the common three, not the one actually behind each site; the row reports the worst of them.
'use strict';
const fs = require('fs');
const path = require('path');
const { isSkippedFixtureDir } = require('./lib/fixture-dirs');
const M = require('./lib/contrast-math');
const { tokens } = M;

const root = path.join(__dirname, '..');
const SIZE_FLOOR_PX = 12;
const NEED = 4.5;

// ---- self-test: refuse to report on broken maths ----
{
  const bw = M.ratio([0, 0, 0], [1, 0, 0]);
  if (Math.abs(bw - 21) > 0.1) {
    console.error(`check-small-text-contrast SELF-TEST FAILED: black on white = ${bw.toFixed(2)}.`);
    process.exit(1);
  }
}

// ---- tokens: the dark palette, the only theme the app ships ----
const css = fs.readFileSync(path.join(root, 'app', 'globals.css'), 'utf8');
const darkAt = css.search(/^\.dark\s*\{/m);
if (darkAt === -1) { console.error('check-small-text-contrast: no .dark block in app/globals.css.'); process.exit(1); }
// The `.dark {` block only: the per-brand blocks after it redefine --brand and must not win here.
const darkEnd = css.indexOf('\n}', darkAt);
const T = { ...tokens(css.slice(0, darkAt)), ...tokens(css.slice(darkAt, darkEnd)) };
// accent-* are plain tokens; the dark brand presets are each `.dark[data-brand="x"] { --brand: ... }`.
const brands = [T.brand];
for (const m of css.matchAll(/^\.dark\[data-brand="[a-z]+"\]\s*\{\s*--brand:\s*oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/gm)) {
  brands.push([parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]);
}
for (const req of ['background', 'foreground', 'card', 'muted', 'muted-foreground', 'brand']) {
  if (!T[req]) { console.error(`check-small-text-contrast: --${req} not parsed from the dark theme.`); process.exit(1); }
}
if (brands.length < 8) { console.error(`check-small-text-contrast: found ${brands.length} dark brand presets, expected 8.`); process.exit(1); }

// ---- colour maths ----
const rgbOf = oklch => M.oklchToLinearSrgb(...oklch).map(M.clamp).map(M.toGamma); // encoded 0..1
const HUES = Array.from({ length: 120 }, (_, i) => i * 3);
const atHue = (tok, h) => (tok.hueVaries ? [tok[0], tok[1], h] : tok);
const ratioBlend = (fgEnc, alpha, bgEnc) => {
  const mixed = fgEnc.map((v, i) => v * alpha + bgEnc[i] * (1 - alpha)).map(M.toLinear);
  return M.ratioFromLum(M.relLum(mixed), M.relLum(bgEnc.map(M.toLinear)));
};

// fg colour class -> list of candidate fg colours (brand: every preset), and the surfaces it can sit on.
const SURFACES_DEFAULT = ['card', 'background', 'muted'];
const FG = {
  'muted-foreground': { fg: [T['muted-foreground']], on: SURFACES_DEFAULT },
  foreground: { fg: [T.foreground], on: SURFACES_DEFAULT },
  'card-foreground': { fg: [T['card-foreground']], on: SURFACES_DEFAULT },
  brand: { fg: brands, on: SURFACES_DEFAULT },
  'accent-green': { fg: [T['accent-green']], on: SURFACES_DEFAULT },
  'accent-cyan': { fg: [T['accent-cyan']], on: SURFACES_DEFAULT },
  'accent-amber': { fg: [T['accent-amber']], on: SURFACES_DEFAULT },
  'accent-purple': { fg: [T['accent-purple']], on: SURFACES_DEFAULT },
  destructive: { fg: [T.destructive], on: SURFACES_DEFAULT },
  // Dark text on a light fill: `text-background` sits on `bg-foreground`.
  background: { fg: [T.background], on: ['foreground'] },
  // Pure white / black are measured on the surfaces they pair with; see surfaceHint().
  white: { fg: [[1, 0, 0]], on: SURFACES_DEFAULT },
};

function worstRatio(cls, alpha, hint) {
  const spec = FG[cls];
  if (!spec) return null;
  const on = hint || spec.on;
  const per = {};
  let worst = Infinity, at = '';
  for (const surf of on) {
    const bgTok = surf === 'black' ? [0, 0, 0] : T[surf];
    if (!bgTok) return null;
    let w = Infinity;
    for (const fgTok of spec.fg) {
      const hues = bgTok.hueVaries ? HUES : [bgTok[2]];
      for (const h of hues) w = Math.min(w, ratioBlend(rgbOf(fgTok), alpha, rgbOf(atHue(bgTok, h))));
    }
    per[surf] = w;
    if (w < worst) { worst = w; at = surf; }
  }
  return { r: worst, surface: at, per };
}

// ---- finding sites ----
const SIZE_RE = /(?:^|[\s"'`{(])text-\[(\d+(?:\.\d+)?)px\](?![\w-])/g;
const OPACITY_RE = /(?:^|[\s"'`{(])opacity-(\d{1,3})(?![\w-])/g;
const COLOR_RE = /(?:^|[\s"'`{(])text-([a-z]+(?:-[a-z]+)*)(?:\/(\d{1,3}|\[[0-9.]+\]))?(?![\w\[-])/g;
// text-* utilities that are not colours.
const NOT_COLOR = new Set(['left', 'right', 'center', 'justify', 'start', 'end', 'xs', 'sm', 'base', 'lg', 'xl',
  '2xl', '3xl', '4xl', 'wrap', 'nowrap', 'balance', 'pretty', 'ellipsis', 'clip', 'transparent', 'current', 'inherit']);

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && isSkippedFixtureDir(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '__tests__' && e.name !== '.next') walk(full, out); }
    else if (e.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

// The span of a `className=` value starting at index i (just past `className=`).
function classValueEnd(src, i) {
  const q = src[i];
  if (q === '"' || q === "'") { const j = src.indexOf(q, i + 1); return j === -1 ? i : j + 1; }
  if (q !== '{') return i;
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return j + 1;
  }
  return i;
}

/** [start, end] spans of units that may carry both a size and an alpha. */
function units(src) {
  const spans = [];
  for (const m of src.matchAll(/className=/g)) {
    const s = m.index + m[0].length;
    const e = classValueEnd(src, s);
    if (e > s) spans.push([s, e]);
  }
  const inSpan = i => spans.some(([a, b]) => i >= a && i < b);
  // A size outside any className value: use its own string literal (same line).
  for (const m of src.matchAll(SIZE_RE)) {
    const at = m.index + m[0].length;
    if (inSpan(at)) continue;
    const ls = src.lastIndexOf('\n', at) + 1;
    const le = src.indexOf('\n', at);
    const line = src.slice(ls, le === -1 ? src.length : le);
    const rel = at - ls;
    const q = ['"', "'", '`'].map(c => [c, line.lastIndexOf(c, rel)]).sort((a, b) => b[1] - a[1])[0];
    if (!q || q[1] === -1) continue;
    const end = line.indexOf(q[0], rel);
    spans.push([ls + q[1], ls + (end === -1 ? line.length : end + 1)]);
  }
  return spans;
}

// Files whose one flagged site sits on a surface the three theme tokens do not describe.
const SURFACE_HINTS = { 'components/workout-screen.tsx': ['black'] };
const surfaceHint = rel => SURFACE_HINTS[rel] || null;

// Context a regex cannot read; the row carries it so the table is not taken for more than it is.
const NOTES = {
  'components/home/collection-pen.tsx': 'drawn over a photo with a text-shadow; the surface is not a theme token, so the three theme surfaces are stand-ins',
  'components/workout-screen.tsx': 'on a full-screen `bg-black` interstitial, measured against black',
  'app/session-select/components/week-strip-card.tsx': 'a FUTURE day, inactive by design (also in check-contrast.js OPACITY_EXEMPT); WCAG 1.4.3 exempts it, listed so the table is complete',
};

function scan() {
  const sites = [];
  const files = [];
  for (const r of ['app', 'components']) if (fs.existsSync(path.join(root, r))) walk(path.join(root, r), files);
  files.sort();
  for (const f of files) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    const src = fs.readFileSync(f, 'utf8');
    if (!/text-\[\d/.test(src)) continue;
    const seen = new Set();
    for (const [a, b] of units(src)) {
      const key = a + ':' + b;
      if (seen.has(key)) continue;
      seen.add(key);
      const text = src.slice(a, b);
      const sizes = [...text.matchAll(SIZE_RE)].map(m => parseFloat(m[1]));
      if (!sizes.length || Math.min(...sizes) >= SIZE_FLOOR_PX) continue;
      const size = Math.min(...sizes);
      let opacity = 1, opCls = null;
      for (const m of text.matchAll(OPACITY_RE)) {
        const n = parseInt(m[1], 10);
        if (n > 0 && n < 100) { opacity = n / 100; opCls = m[0].trim().replace(/^[^o]+/, ''); }
      }
      const colours = [];
      for (const m of text.matchAll(COLOR_RE)) {
        if (NOT_COLOR.has(m[1])) continue;
        const cls = m[1];
        let a100 = 1;
        if (m[2]) a100 = m[2].startsWith('[') ? parseFloat(m[2].slice(1, -1)) : parseInt(m[2], 10) / 100;
        colours.push({ cls, alpha: a100, tok: m[0].trim().replace(/^[^t]+/, '') });
      }
      // Only elements that dim their text are in scope.
      const dimmed = colours.filter(c => c.alpha * opacity < 1);
      if (!dimmed.length && opacity < 1) dimmed.push({ cls: 'inherited', alpha: 1, tok: '(inherited colour)' });
      if (!dimmed.length) continue;
      const line = src.slice(0, a + (text.search(SIZE_RE) > 0 ? text.search(SIZE_RE) : 0)).split('\n').length;
      for (const c of dimmed) {
        const eff = c.alpha * opacity;
        const cls = c.cls === 'inherited' ? 'foreground' : c.cls;
        const res = worstRatio(cls, eff, surfaceHint(rel));
        const classes = [`text-[${size}px]`, c.tok, opCls].filter(Boolean).join(' ');
        sites.push({
          rel, line, size, classes, eff, fg: c.cls, ratio: res ? res.r : null, surface: res ? res.surface : null, per: res ? res.per : {},
          unmeasured: !res, note: NOTES[rel] || '',
        });
      }
    }
  }
  return sites;
}

// ---- baseline: failing/unmeasured sites per file, shrink-only ----
const BASELINE = {
  'app/health/health-sections.tsx': 4,
  'app/session-select/components/week-strip-card.tsx': 1, // inactive future day, WCAG-exempt; see NOTES
  'components/activity/background-location-card.tsx': 1,
  'components/admin/calibration-card.tsx': 1,
  'components/config-screen.tsx': 1,
  'components/config/phase-editor.tsx': 1,
  'components/health-metric-sheet.tsx': 1,
  'components/health/body-cards/rhr-hrv-spo2-card.tsx': 1,
  'components/health/body-cards/sleep-card.tsx': 3,
  'components/health/oura-section.tsx': 2,
  'components/health/readiness-breakdown.tsx': 3,
  'components/more/friend-feed.tsx': 1,
  'components/more/trophy-case.tsx': 1,
  'components/nutrition/meal-macro-bars.tsx': 1,
  'components/profile/goal-targets-section.tsx': 1,
  'components/profile/required-info-section.tsx': 1,
  'components/rest-day-card.tsx': 1,
  'components/workout-builder/builder-review.tsx': 2,
  'components/workout-builder/goal-spectrum.tsx': 1,
  'components/workout-screen.tsx': 1,
  'components/workout/active-workout-screen.tsx': 1,
  'components/workout/ai-prescription-card.tsx': 1,
  'components/workout/one-rm-calculator-dialog.tsx': 1,
  'components/workout/pre-workout-screen.tsx': 1,
  'components/workout/time-summary-card.tsx': 2,
};

const sites = scan();
const bad = sites.filter(s => s.unmeasured || s.ratio + 1e-9 < NEED);

if (process.argv.includes('--report')) {
  const f = x => (x === null ? 'n/a' : x.toFixed(2));
  console.log('| file:line | classes | alpha | card | background | muted | verdict (worst surface) |');
  console.log('|---|---|---|---|---|---|---|');
  const cell = (x, k) => (x.per[k] === undefined ? '-' : f(x.per[k]));
  const order = (x, y) => (x.ratio ?? 0) - (y.ratio ?? 0) || x.rel.localeCompare(y.rel);
  for (const x of sites.sort(order)) {
    const v = x.unmeasured ? 'unmeasured' : x.ratio >= NEED ? 'pass' : 'FAIL';
    const only = x.per.foreground !== undefined ? ' (on foreground fill)' : x.per.black !== undefined ? ' (on black)' : '';
    console.log('| ' + x.rel + ':' + x.line + ' | `' + x.classes + '` | ' + Math.round(x.eff * 100) + '% | ' + cell(x, 'card') + ' | ' + cell(x, 'background') + ' | ' + cell(x, 'muted') + ' | ' + v + ' ' + f(x.ratio) + ' on ' + x.surface + only + (x.note ? ' - ' + x.note : '') + ' |');
  }
  console.log('\n' + sites.length + ' dimmed sub-' + SIZE_FLOOR_PX + 'px sites, ' + bad.length + ' below ' + NEED + ':1 or unmeasured.');
  process.exit(0);
}

const counts = {};
for (const s of bad) counts[s.rel] = (counts[s.rel] || 0) + 1;
const grew = [], shrank = [];
for (const rel of new Set([...Object.keys(counts), ...Object.keys(BASELINE)])) {
  const have = counts[rel] || 0, allowed = BASELINE[rel] || 0;
  if (have > allowed) grew.push({ rel, have, allowed });
  else if (have < allowed) shrank.push({ rel, have, allowed });
}
if (grew.length) {
  console.error(`Sub-${SIZE_FLOOR_PX} px text dimmed below ${NEED}:1 (WCAG AA, text under 18 px) in a file that may not add any:`);
  for (const g of grew) {
    console.error(`  ${g.rel}: ${g.have} site(s), baseline ${g.allowed}`);
    for (const s of bad.filter(x => x.rel === g.rel)) {
      console.error(`    line ${s.line}  ${s.classes}  ${s.unmeasured ? 'colour not resolvable' : s.ratio.toFixed(2) + ':1 on --' + s.surface}`);
    }
  }
  console.error('Use full opacity, or the muted floor token proposed in docs/small-text-contrast-audit.md. Do not add to BASELINE.');
  process.exit(1);
}
if (shrank.length) {
  console.error('The baseline can only shrink. Lower these counts in check-small-text-contrast.js BASELINE (delete the row at 0):');
  for (const g of shrank) console.error(`  ${g.rel}: now ${g.have}, baseline ${g.allowed}`);
  process.exit(1);
}
const total = Object.values(BASELINE).reduce((a, b) => a + b, 0);
console.log(`check-small-text-contrast: ${sites.length} dimmed sub-${SIZE_FLOOR_PX}px sites scanned; ${bad.length} below ${NEED}:1 or unmeasured, all in the baseline (${total}); none new.`);
