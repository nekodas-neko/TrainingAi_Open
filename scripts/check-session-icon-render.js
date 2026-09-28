#!/usr/bin/env node
// A session's stored icon is never rendered as text (RV-214 ①).
//
// `program_sessions.icon` is a free-text column, so a surface that interpolates it straight into
// JSX prints whatever is in it at whatever size the slot is styled for. When the value is not an
// emoji — an icon NAME, say — that is a WORD. On the recommendation card the slot was `text-3xl`,
// so it drew a 30 px "Dumbbell" beside a 20 px session name: the largest text on the card was not
// the thing being chosen.
//
// `getSessionIcon` (`lib/session-icon.tsx`) already owned the resolution — emoji→Lucide map, then
// palette position, then `Dumbbell` — and A-7 had already converted one surface, leaving a comment
// claiming *"every other session surface uses getSessionIcon"*. **Three did not.** A claim in a
// comment is not a guarantee, which is the whole reason this is a check.
//
// Render `<SessionGlyph icon={…} palettePosition={…} />`, or call `getSessionIcon` directly. Both
// produce a component, and a component cannot print a word.
'use strict';
const fs = require('fs');
const path = require('path');
const { stripComments } = require('./lib/strip-comments');

const root = path.join(__dirname, '..');
const ROOTS = ['app', 'components'];

/**
 * `{session.icon}` / `{sess?.icon ?? x}` interpolated straight into JSX.
 *
 * **Deliberately keyed on a SESSION-shaped identifier rather than on `.icon`.** The broad version
 * was written first and measured: it flagged four more sites — `swipe-actions`, `capture-actions`,
 * `activity-secondary-metrics`, `deload-explanation` — and **every one of them declares
 * `icon: React.ReactNode`**, so rendering it is correct there. A check cannot tell a string field
 * from a node field by looking at one line, and exempting four correct files by name would teach
 * the next person that an exemption is how you satisfy this. Narrow and honest beats broad and
 * routinely overridden.
 */
const RAW = /\{\s*(?:[A-Za-z_$][\w$]*)?(?:[Ss]ess(?:ion)?[\w$]*)\??\.icon\s*(\?\?[^}]*)?\}/g;

// No exemptions, and that is the point of the narrowing above. If one becomes necessary, list the
// file with the reason — never widen this to silence a correct ReactNode render.
const EXEMPT = new Set([]);

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
    const rel = path.relative(root, file).split(path.sep).join('/');
    if (EXEMPT.has(rel)) continue;
    scanned++;
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    src.split('\n').forEach((line, i) => {
      // A prop (`icon={x.icon}`) hands the value to a component that resolves it; only a bare
      // JSX interpolation renders it.
      if (/\bicon=\{/.test(line)) return;
      for (const m of line.matchAll(RAW)) offenders.push({ rel, line: i + 1, text: m[0] });
    });
  }
}

if (offenders.length > 0) {
  console.error('check-session-icon-render: a stored icon is rendered as TEXT (RV-214).');
  console.error('Use <SessionGlyph icon={…} palettePosition={…} /> or getSessionIcon() — a');
  console.error('component cannot print a word, and the column is free text.');
  for (const o of offenders) console.error(`  ${o.rel}:${o.line}  ${o.text}`);
  process.exit(1);
}

console.log(`check-session-icon-render: ${scanned} .tsx file(s); no stored icon rendered as text.`);
