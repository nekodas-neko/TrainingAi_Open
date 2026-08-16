#!/usr/bin/env node
// A backtick inside a backtick-delimited system prompt terminates the template literal.
//
// This has now broken `next build` **three times** in one feature, always the same way and always
// from the same instinct: writing `like this` around a field name because that is how you write it
// everywhere else in the codebase. `tsc` catches it, but only after a full type-check, and the error
// it gives ("',' expected") points at the prompt text rather than at the cause.
//
// This is the two-second version. It reads the SYSTEM template literal in each AI route and fails
// on a stray backtick inside it, naming the line and what to write instead.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = 'app/api';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === 'route.ts') out.push(p);
  }
  return out;
}

const offenders = [];
for (const file of fs.existsSync(ROOT) ? walk(ROOT) : []) {
  const src = fs.readFileSync(file, 'utf8');
  // The literal's END cannot be found by matching to "the next backtick" — that is exactly the
  // character a broken prompt contains, so a non-greedy match stops AT the defect and inspects a
  // body that looks clean. (Written that way first; it passed on a planted defect.) These prompts
  // all close with a backtick at the start of a line, so scan to that instead.
  const OPEN = /const\s+([A-Z][A-Z0-9_]*)\s*=\s*`/g;
  let m;
  while ((m = OPEN.exec(src))) {
    const bodyStart = m.index + m[0].length;
    const closeAt = src.indexOf('\n`', bodyStart);
    if (closeAt === -1) continue;
    const body = src.slice(bodyStart, closeAt);
    if (!body.includes('\n')) continue;       // one-liners are not prompts
    if (body.includes('${')) continue;         // interpolated: a real template, not prose
    const startLine = src.slice(0, bodyStart).split('\n').length;
    body.split('\n').forEach((line, i) => {
      if (line.includes('`')) offenders.push(`${file}:${startLine + i}  ${m[1]} — ${line.trim().slice(0, 70)}`);
    });
    OPEN.lastIndex = closeAt;
  }
}

if (offenders.length) {
  console.error('Backtick inside a backtick-delimited prompt (this terminates the literal):');
  for (const o of offenders) console.error(`  ${o}`);
  console.error('Use "double quotes" around field names in prompt text, not backticks.');
  process.exit(1);
}
console.log('check-prompt-backticks: no stray backticks in an AI route prompt.');
