#!/usr/bin/env node
// Every model call goes through the logged wrapper, under a section named in the settings table.
//
// #3752. `lib/ai/instrument.ts` owns the model, thinking level, retries, time limit, pause switch,
// dev call budget and the `ai_call_log` row. A call that reaches the SDK another way gets none of it:
// no log row, no dev budget, no pause. The admin picture tool was exactly that, on the same key and
// balance as the live app, and wrote nothing. Two rules:
//
//   1. `generateObject`, `generateText` and `streamText` may be called only inside a logged wrapper
//      (`loggedGenerateObject`, `loggedGenerateText`, `loggedStreamText`, `withAiLogging`), and every
//      wrapper call names a `section:` that is a key of `AI_SECTIONS` in `lib/ai/instrument.ts`.
//      The file that defines the wrappers is the one place the SDK is called bare.
//   2. `@google/genai` may be imported only by `lib/exercise-image-gen.ts` (the one non-language-model
//      call, which logs itself under its own section).
//
// The table's keys are read from `instrument.ts`'s text, so adding a section there is the only step.
// A section written as a variable cannot be checked and is refused: write the literal (a ternary of
// literals is fine). Comments are stripped first, so a file may quote a banned call in prose.
//
// `--root <dir>` points the scan elsewhere, for the test that builds a tree of fixtures.
'use strict';
const fs = require('fs');
const path = require('path');
const { readFilesUtf8, runMain } = require('./lib/read-sources');
const { stripComments } = require('./lib/strip-comments');
const { isSkippedFixtureDir } = require('./lib/fixture-dirs');

const DIRS = ['app', 'lib', 'packages', 'components'];
const SKIP_DIRS = new Set(['node_modules', '.next', '__tests__']);
const INSTRUMENT = 'lib/ai/instrument.ts';
const GENAI_ALLOWED = 'lib/exercise-image-gen.ts';

const SDK_CALL = /\b(generateObject|generateText|streamText)\s*[(<]/g;
const WRAPPER_CALL = /\b(loggedGenerateObject|loggedGenerateText|loggedStreamText|withAiLogging)\s*[(<]/g;
const GENAI_IMPORT = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]@google\/genai['"]/;

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name) || isSkippedFixtureDir(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

/** The section names in `AI_SECTIONS`, read from the text of instrument.ts. */
function readSectionNames(instrumentSource) {
  const code = stripComments(instrumentSource);
  const start = code.search(/export const AI_SECTIONS\s*=\s*\{/);
  if (start < 0) return null;
  const open = code.indexOf('{', start);
  const close = matchClose(code, open);
  if (close < 0) return null;
  const body = code.slice(open + 1, close);
  const names = [];
  // Keys at depth 0 of the table only (an entry's own braces hold the settings, not sections).
  let depth = 0;
  let line = '';
  for (const ch of body) {
    if (ch === '{') depth++;
    if (depth === 0) line += ch;
    if (ch === '}') depth--;
  }
  for (const m of line.matchAll(/(?:^|,)\s*(?:'([\w-]+)'|"([\w-]+)"|([A-Za-z_$][\w$]*))\s*:/g)) {
    names.push(m[1] ?? m[2] ?? m[3]);
  }
  return names;
}

/**
 * Index of the bracket closing the one at `open`, skipping string and template literals; -1 if it
 * never closes. Comments are already stripped.
 */
function matchClose(code, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const stack = [];
  for (let i = open; i < code.length; i++) {
    const ch = code[i];
    if (ch === "'" || ch === '"') {
      i = skipString(code, i, ch);
      continue;
    }
    if (ch === '`') {
      i = skipTemplate(code, i);
      continue;
    }
    if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === ')' || ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

function skipString(code, i, quote) {
  for (let j = i + 1; j < code.length; j++) {
    if (code[j] === '\\') j++;
    else if (code[j] === quote || code[j] === '\n') return j;
  }
  return code.length;
}

function skipTemplate(code, i) {
  for (let j = i + 1; j < code.length; j++) {
    if (code[j] === '\\') j++;
    else if (code[j] === '`') return j;
    else if (code[j] === '$' && code[j + 1] === '{') {
      const end = matchClose(code, j + 1);
      if (end < 0) return code.length;
      j = end;
    }
  }
  return code.length;
}

const lineOf = (code, idx) => code.slice(0, idx).split('\n').length;

/** The text of a wrapper call's `section:` value, up to the comma or brace that ends it. */
function sectionExpression(argText) {
  const m = /\bsection\s*:/.exec(argText);
  if (!m) return null;
  let depth = 0;
  let j = m.index + m[0].length;
  const from = j;
  for (; j < argText.length; j++) {
    const ch = argText[j];
    if (ch === "'" || ch === '"') {
      j = skipString(argText, j, ch);
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) break;
      depth--;
    } else if (ch === ',' && depth === 0) break;
  }
  return argText.slice(from, j).trim();
}

/**
 * The hits in one file: `[{ line, text }]`. `sections` is the table's keys; `rel` the repo-relative
 * path with forward slashes.
 */
function findHits(raw, rel, sections) {
  const hits = [];
  const code = stripComments(raw);

  if (GENAI_IMPORT.test(code) && rel !== GENAI_ALLOWED) {
    const at = code.search(GENAI_IMPORT);
    hits.push({ line: lineOf(code, at), text: `@google/genai is imported only by ${GENAI_ALLOWED}` });
  }
  // The wrappers live here; it is the one file that calls the SDK bare.
  if (rel === INSTRUMENT) return hits;

  const wrappers = [];
  for (const m of code.matchAll(WRAPPER_CALL)) {
    const open = code.indexOf('(', m.index + m[1].length);
    const close = matchClose(code, open);
    if (close < 0) continue;
    wrappers.push({ name: m[1], start: m.index, open, close });
    const section = sectionExpression(code.slice(open + 1, close));
    if (section == null) {
      hits.push({ line: lineOf(code, m.index), text: `${m[1]}(...) names no \`section:\`` });
      continue;
    }
    const literals = [...section.matchAll(/'([^']*)'|"([^"]*)"/g)].map((l) => l[1] ?? l[2]);
    // One literal, or `condition ? 'a' : 'b'` (the condition is any expression without a quote).
    const LIT = String.raw`(?:'[^']*'|"[^"]*")`;
    const shapeOk = new RegExp(`^${LIT}$|^[^'"?]+\\?\\s*${LIT}\\s*:\\s*${LIT}$`).test(section);
    if (literals.length === 0 || !shapeOk) {
      hits.push({ line: lineOf(code, m.index), text: `${m[1]}(...) section must be a string literal from AI_SECTIONS, found \`${section.slice(0, 60)}\`` });
      continue;
    }
    for (const lit of literals) {
      if (!sections.includes(lit)) {
        hits.push({ line: lineOf(code, m.index), text: `section '${lit}' is not in AI_SECTIONS (${INSTRUMENT})` });
      }
    }
  }

  for (const m of code.matchAll(SDK_CALL)) {
    // A declaration or import mentioning the name is not a call: those have no `(` straight after.
    const inside = wrappers.some((w) => m.index > w.open && m.index < w.close);
    if (!inside) {
      hits.push({ line: lineOf(code, m.index), text: `${m[1]}( called outside a logged wrapper (loggedGenerateObject / loggedGenerateText / loggedStreamText)` });
    }
  }
  return hits;
}

module.exports = { findHits, readSectionNames };

if (require.main === module) {
  const rootArg = process.argv.indexOf('--root');
  const root = rootArg > -1 ? path.resolve(process.argv[rootArg + 1]) : path.resolve(__dirname, '..');
  runMain(async () => {
    const instrumentPath = path.join(root, INSTRUMENT);
    const sections = fs.existsSync(instrumentPath) ? readSectionNames(fs.readFileSync(instrumentPath, 'utf8')) : null;
    if (!sections || sections.length === 0) {
      console.error(`check-ai-call-sites: could not read AI_SECTIONS from ${INSTRUMENT} — the table moved or changed shape.`);
      process.exit(1);
    }
    const files = DIRS.flatMap((d) => walk(path.join(root, d), []));
    const contents = await readFilesUtf8(files);
    const found = [];
    files.forEach((full, k) => {
      const rel = path.relative(root, full).split(path.sep).join('/');
      for (const h of findHits(contents[k], rel, sections)) found.push(`${rel}:${h.line}: ${h.text}`);
    });
    if (found.length > 0) {
      console.error('Model calls must go through a logged wrapper under a section from AI_SECTIONS (lib/ai/instrument.ts):');
      found.forEach((f) => console.error('  ' + f));
      process.exit(1);
    }
    console.log(`check-ai-call-sites: OK — ${files.length} files scanned, ${sections.length} sections, every model call is wrapped and named.`);
  });
}
