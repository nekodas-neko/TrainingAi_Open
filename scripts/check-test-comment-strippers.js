#!/usr/bin/env node
// LB-160. A source-scanning test that strips comments with a regex pair is reading a file the
// regex has already damaged.
//
// The pair every such test copied — `/\/\*[\s\S]*?\*\//g` and friends — has no idea what a string
// literal is, so the `/` and `*` inside `accept="image/*"` open a comment for it and it deletes
// everything to the next closer. **Measured 2026-09-26:** 11 source files carry that trigger, 4
// test-to-file pairs read one, and the loss ran from 25% to 56% of the file.
// `food-image-write-paths.test.ts` was running two `.not.toMatch` assertions over a source with
// 56% of its bytes gone — the vacuous direction, which a guard cannot report.
//
// `scripts/lib/strip-comments.js` walks string literals properly and is what LA-64 extracted for
// the CI checks. The tests never got it: 37 files had grown their own copy by the time anyone
// counted, which is the argument for a check rather than a paragraph. Prose had already failed —
// CLAUDE.md's own comment-blindness rule is written for the scripts, and the tests copied the
// broken version anyway.
//
// Reproduce the population from a shell, so the number is never one only this file knows:
//   grep -rl 'replace(/\\{\\/\\*' --include='*.test.ts' --include='*.test.tsx' . | grep -v node_modules
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SELF = 'scripts/check-test-comment-strippers.js';

// The comment-stripping regexes seen across the 37 converted files. Matching the REGEX rather than
// the whole chain is what makes this robust to how a file spells the surrounding helper — one
// wrote `const strip =`, another inlined it into a `describe` body.
const STRIP_PATTERNS = [
  /\.replace\(\s*\/\\\{\\\/\\\*\[\\s\\S\]\*\?\\\*\\\/\\\}\/g/,   // {/* ... */}
  /\.replace\(\s*\/\\\/\\\*\[\\s\\S\]\*\?\\\*\\\/\/g/,            // /* ... */
  /\.replace\(\s*\/\(\^\|\[\^:\]\)\\\/\\\/\.\*\$\/gm/,            // (^|[^:])//...$
  /\.replace\(\s*\/\^\\s\*\\\/\\\/\.\*\$\/gm/,                    // ^\s*//...$
  /\.replace\(\s*\/\\\/\\\/\[\^\\n\]\*\/g/,                       // //[^\n]*
];

// Empty on purpose, and it must stay that way: LB-160 converted all 37. A row here would be a file
// that reads its own subject through a stripper that cannot see string literals.
const BASELINE = {};

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === '.next') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.test\.tsx?$/.test(e.name)) out.push(path.relative(ROOT, p));
  }
  return out;
}

const offenders = [];
for (const rel of walk(ROOT, [])) {
  if (rel === SELF) continue;
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const hits = STRIP_PATTERNS.reduce((n, re) => n + (re.test(src) ? 1 : 0), 0);
  if (hits > (BASELINE[rel] ?? 0)) offenders.push([rel, hits, BASELINE[rel] ?? 0]);
}

if (offenders.length) {
  console.error('Test file(s) hand-roll a comment stripper:\n');
  for (const [rel, hits, allowed] of offenders) {
    console.error(`  • ${rel}: ${hits} strip regex(es), allowed ${allowed}`);
  }
  console.error(`
  A regex pair cannot tell a comment from a string, so \`accept="image/*"\` opens one and the
  rest of the file is deleted — silently, which makes a \`.not.toMatch\` pass over source it
  never saw. Use the shared walker instead:

    import { stripComments } from '<rel>/scripts/lib/strip-comments.js'

  It is CommonJS and outside the app's tsconfig, so import it (\`require\` is an eslint error
  under components/**) and do NOT add a @ts-expect-error — the import type-checks, and an
  unused directive fails \`check-test-typecheck\`.`);
  process.exit(1);
}

console.log(`check-test-comment-strippers: OK — no test file hand-rolls a comment stripper (${Object.keys(BASELINE).length} baselined).`);
