#!/usr/bin/env node
// No `JSON.parse` of LLM output (CLAUDE.md: structured output uses a schema, never `JSON.parse` of
// text).
//
// This used to be an inline grep in ci.yml that scanned only `app/api` files importing `@ai-sdk`.
// That is two files today — Coach and one more — because the other AI routes reach the model through
// `lib/ai/instrument` and `lib/ai/stream`, and nothing under `lib/` was looked at at all (RV-179:
// "15 of 16 AI routes and all of lib/ go unscanned"). A reintroduction in any of them passed Custom
// Rules in silence.
//
// What counts as an AI file here is what the repo actually does to call a model, not a list of paths:
// an import from `@ai-sdk/*` or `ai`, an import from `@/lib/ai/*` or `@/lib/ai-chat/*` (the wrappers
// every route uses), or a call to `generateText` / `generateObject` / `streamText` / `streamObject`.
// Comments are stripped first (`lib/strip-comments`), so a file may quote the banned call in prose.
//
// There is no baseline: the widened scope measured zero hits when this was written, so any hit is a
// regression. A `JSON.parse` in an AI file that genuinely parses something else (a stored column, a
// request body) carries `llm-json-ok: <reason>` in a comment on the same or the previous line, which
// is stated where a reviewer reads it rather than allowed by a row in this file.
//
// `--root <dir>` points the scan elsewhere, for the test that builds a tree of fixtures.
'use strict';
const fs = require('fs');
const path = require('path');
const { readFilesUtf8, runMain } = require('./lib/read-sources');
const { stripComments } = require('./lib/strip-comments');
const { isSkippedFixtureDir } = require('./lib/fixture-dirs');

const DIRS = ['app', 'lib', 'packages'];
const SKIP_DIRS = new Set(['node_modules', '.next', '__tests__']);

const AI_FILE = new RegExp(
  [
    String.raw`from\s+['"](?:@ai-sdk\/[\w-]+|ai)['"]`,
    String.raw`from\s+['"]@\/lib\/ai(?:-chat)?\/`,
    String.raw`\b(?:generateText|generateObject|streamText|streamObject)\s*[(<]`,
  ].join('|'),
);
const OK_MARKER = /llm-json-ok:\s*\S/;

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name) || isSkippedFixtureDir(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** The hits in one file: `[{ line, text }]`, empty when it is not an AI file or has none. */
function findHits(raw) {
  if (!raw.includes('JSON.parse')) return [];
  const code = stripComments(raw);
  if (!AI_FILE.test(code)) return [];
  const rawLines = raw.split('\n');
  const hits = [];
  code.split('\n').forEach((line, i) => {
    if (!line.includes('JSON.parse')) return;
    if (OK_MARKER.test(rawLines[i] ?? '') || OK_MARKER.test(rawLines[i - 1] ?? '')) return;
    hits.push({ line: i + 1, text: line.trim().slice(0, 140) });
  });
  return hits;
}

module.exports = { findHits };

if (require.main === module) {
  const rootArg = process.argv.indexOf('--root');
  const root = rootArg > -1 ? path.resolve(process.argv[rootArg + 1]) : path.resolve(__dirname, '..');
  runMain(async () => {
    const files = DIRS.flatMap((d) => walk(path.join(root, d), []));
    const contents = await readFilesUtf8(files);
    const found = [];
    files.forEach((full, k) => {
      for (const h of findHits(contents[k])) {
        found.push(`${path.relative(root, full).split(path.sep).join('/')}:${h.line}: ${h.text}`);
      }
    });
    if (found.length > 0) {
      console.error('Bare JSON.parse in a file that calls a model — use generateObject / a response schema instead.');
      console.error('If it parses something that is not model output, say so with `// llm-json-ok: <reason>` on or above the line.');
      found.forEach((f) => console.error('  ' + f));
      process.exit(1);
    }
    console.log(`check-llm-json-parse: OK — ${files.length} files scanned, no JSON.parse in a model-calling file.`);
  });
}
