#!/usr/bin/env node
// An icon-only control with no accessible name is announced as "button" and nothing else. Six of
// them were live when the 2026-08-08 mobile-UI review looked (Q-162), and the class recurs because
// it is invisible: the icon carries the meaning perfectly well on screen, so nothing looks wrong.
//
// This is the mechanical version. It reads JSX rather than a rendered page, so it is a heuristic —
// deliberately a narrow one. It flags only the unambiguous shape:
//
//     <button …>            with no text, no aria-label/aria-labelledby/title,
//       <SomeIcon … />      and exactly one self-closing icon-like child
//     </button>
//
// A button containing text, an expression, or anything but a lone icon element is left alone, so a
// name supplied by a `<label for>`, a child span, or a prop cannot be mistaken for a missing one.
// Under-reporting is the intended failure mode: a check that cries wolf gets exempted into
// uselessness, and the live-DOM audit in the PR that added this is what catches the rest.
'use strict';
const fs = require('fs');
const path = require('path');
const { stripComments } = require('./lib/strip-comments');

const ROOTS = ['app', 'components'];

/** Attributes that give an element a name outright. `asChild` hands naming to the child. */
const NAMING_ATTR = /\b(aria-label|aria-labelledby|title|asChild)[=\s>]/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue;
      walk(p, out);
    } else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/**
 * Every `<button …>` / `<Button …>` opening tag, with its attribute text.
 *
 * Walks to the tag's own closing `>` while tracking brace depth and string state, so a `>` inside
 * `{() => …}`, inside a quoted attribute, or inside a template literal does not end the tag. This
 * replaces a `[^>]*?` character class that ended the tag at the first `>` it met (PS-34).
 */
function openingTags(src) {
  const out = [];
  const re = /<(button|Button)(?=[\s/>])/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 0;
    let quote = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === '\\') { i++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '{') { depth++; continue; }
      if (c === '}') { depth--; continue; }
      if (c === '>' && depth === 0) break;
    }
    if (i >= src.length) continue;             // unterminated tag — not ours to report
    if (src[i - 1] === '/') continue;          // self-closing <button /> has no body
    out.push({
      tag: m[1],
      attrs: src.slice(m.index + m[0].length, i),
      tagEnd: i + 1,
      start: m.index,
    });
  }
  return out;
}

/**
 * The eighteen sites that were already live when PS-34 widened the scan, frozen per file.
 *
 * They are not new. The old attribute regex ended the opening tag at the `>` of `=>`, so every
 * button with an inline-arrow handler was skipped — which is most of them — and the rule reported
 * clean over code it had never parsed. Widening it surfaced all eighteen at once.
 *
 * **Baselined rather than fixed here on purpose.** Every one is in `app/**` or `components/**`,
 * which is Lane B's; a Lane A guard repair does not get to rewrite the surface. LA-62 carries the
 * fix. Shrink-only, per file: a new one fails, and clearing one without lowering the number here
 * also fails, so the list cannot quietly stop shrinking.
 */
const BASELINE = {
  'app/admin/admin-content.tsx': 1,
  'app/profile/[userId]/page.tsx': 1,
  'components/admin/activity-type-manager.tsx': 1,
  'components/admin/exercise-manager.tsx': 1,
  'components/config-screen.tsx': 6,
  'components/config/phase-editor.tsx': 1,
  'components/config/program-editor-sheet.tsx': 1,
  'components/config/style-editor-sheet.tsx': 1,
  'components/more/feedback-sheet.tsx': 1,
  'components/more/manage-friends-sheet.tsx': 3,
  'components/workout/added-weight-toggle.tsx': 1,
};

const offenders = [];
for (const file of ROOTS.flatMap(r => (fs.existsSync(r) ? walk(r) : []))) {
  const src = stripComments(fs.readFileSync(file, 'utf8'));
  // PS-34: the opening tag was matched with `(\s[^>]*?)?>`, whose character class stops at the
  // FIRST `>` — which in `onClick={() => …}` is the arrow's. Every inline-arrow handler therefore
  // truncated `attrs` mid-attribute and threw the rest into `body`, so the `</button>` match failed
  // and the button was skipped entirely. Silently: a button the scan cannot parse looks exactly
  // like a button with no problem, and inline arrows are the common way to write a handler here.
  //
  // A `[^>]` class cannot express "not a `>` unless it is inside braces or a string", so the
  // opening tag is now walked rather than matched.
  for (const open of openingTags(src)) {
    const { tag, attrs, tagEnd } = open;
    if (NAMING_ATTR.test(attrs)) continue;
    const close = src.indexOf(`</${tag}>`, tagEnd);
    if (close === -1) continue;
    const body = src.slice(tagEnd, close);
    const m = { index: open.start };

    const inner = body.trim();
    // Exactly one self-closing element and nothing else — the icon-only shape.
    const loneChild = /^<([A-Z][\w.]*)\b[^>]*\/>$/.exec(inner);
    if (!loneChild) continue;
    // Its own aria-label names the button through the icon.
    if (NAMING_ATTR.test(inner)) continue;

    const line = src.slice(0, m.index).split('\n').length;
    offenders.push(`${file}:${line}  <${loneChild[1]} /> alone in a button with no accessible name`);
  }
}

const perFile = new Map();
for (const o of offenders) {
  const rel = o.slice(0, o.indexOf(':'));
  perFile.set(rel, (perFile.get(rel) ?? 0) + 1);
}

const failures = [];
for (const [rel, count] of perFile) {
  const allowed = BASELINE[rel] ?? 0;
  if (count <= allowed) continue;
  failures.push(allowed === 0
    ? `${rel}: ${count} icon-only button(s) with no accessible name; this file is not in the baseline, so it must have zero.`
    : `${rel}: ${count} icon-only button(s) with no accessible name, over its baseline of ${allowed}.`);
}

// Shrink-only: a file that has been cleaned must leave the list, or the number stops meaning
// anything and the next regression hides inside the slack.
for (const [rel, allowed] of Object.entries(BASELINE)) {
  const count = perFile.get(rel) ?? 0;
  if (count < allowed) {
    failures.push(`${rel}: ${count} icon-only button(s) against a baseline of ${allowed}. Lower it to ${count} (or remove the row) in this PR.`);
  }
}

if (failures.length) {
  console.error('Icon-only control with no accessible name (WCAG 4.1.2):');
  for (const f of failures) console.error(`  ${f}`);
  for (const o of offenders) console.error(`    ${o}`);
  console.error('Add aria-label="…" to the button (or a title). A screen reader otherwise announces');
  console.error('it as "button" with nothing to say what it does.');
  process.exit(1);
}
console.log(`check-icon-button-names: OK — ${offenders.length} baselined icon-only button(s), none new. Shrink-only; LA-62 clears them.`);
