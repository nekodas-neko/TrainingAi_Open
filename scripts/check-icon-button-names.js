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

const offenders = [];
for (const file of ROOTS.flatMap(r => (fs.existsSync(r) ? walk(r) : []))) {
  const src = fs.readFileSync(file, 'utf8');
  // <button …> or <Button …> … </button|Button>, non-greedy, opening tag captured separately.
  const re = /<(button|Button)(\s[^>]*?)?>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = re.exec(src))) {
    const [, , attrs = '', body] = m;
    if (NAMING_ATTR.test(attrs)) continue;

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

if (offenders.length) {
  console.error('Icon-only control with no accessible name (WCAG 4.1.2):');
  for (const o of offenders) console.error(`  ${o}`);
  console.error('Add aria-label="…" to the button (or a title). A screen reader otherwise announces');
  console.error('it as "button" with nothing to say what it does.');
  process.exit(1);
}
console.log('check-icon-button-names: no icon-only control is missing an accessible name.');
