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
//   2. `@google/genai` (and any subpath of it, such as `@google/genai/web`) may be imported only by
//      `lib/exercise-image-gen.ts` (the one non-language-model call, which logs itself under its own
//      section).
//   3. No route passes its own settings: in the options object of an SDK call, `model`, `maxRetries`
//      and `providerOptions` are refused (they come from `...settings`), and the same for the params
//      of `loggedStreamText`. The first argument of an SDK call must be an object literal, so this can
//      be read. `lib/exercise-image-gen.ts` needs no allowance: it calls `@google/genai`, not an `ai`
//      function, and takes its model and retries from the table.
//   4. `mobile/src` never calls the model. Any import of a provider or `@google/genai` there is
//      refused; `ai` and `@ai-sdk/react` are allowed only for the client chat plumbing in
//      MOBILE_CHAT_NAMES (message types, transport, `Chat`, `useChat`), none of which calls a model.
//
// What counts as an SDK entry point: every model-calling export of the installed `ai` package
// (SDK_FUNCS below). `generateObject`, `generateText`, `streamText` and `streamObject` are matched by
// name anywhere; the rest (`embed`, `rerank`, ...) are common words, so they are matched only when the
// file imports or requires them from `ai` (or from `instrument`, which re-exports some), under any
// alias (`import { generateObject as go }`), through a namespace (`import * as ai from 'ai'`;
// `ai.generateObject(...)`, `const f = ai.generateObject`), or `const { x: y } = require('ai')`. A
// reference to one of them that is not a call (`const f = generateObject`) is held to the same rule as
// a call: it must sit inside a wrapper callback. A call inside a wrapper's first (meta) argument does
// not count as inside the wrapper; only the arguments after it do.
//
// The walk covers app, lib, packages, components, scripts, mobile/src and the root-level files, and
// the .ts .tsx .js .jsx .mjs .cjs .mts .cts extensions. Test files and `__tests__` are skipped.
//
// STILL CANNOT CATCH: a dynamic `import()` or `require()` whose module name is computed; the SDK
// reached through `globalThis` or `eval`; a model call made over plain `fetch` to the Gemini REST
// URL; a call to an SDK function after it was handed through an object or array
// (`const { go } = { go: generateObject }` is seen, `fns[0]()` where `fns` was built elsewhere is
// not); an agent's `.generate()` / `.stream()` (only constructing a `ToolLoopAgent` is checked);
// files outside the directories above; and any call a regex over text cannot tell from prose in a
// template literal.
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

const DIRS = ['app', 'lib', 'packages', 'components', 'scripts', 'mobile/src'];
const SOURCE_EXT = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SKIP_DIRS = new Set(['node_modules', '.next', '__tests__']);
const INSTRUMENT = 'lib/ai/instrument.ts';
const GENAI_ALLOWED = 'lib/exercise-image-gen.ts';

// Every model-calling export of the installed `ai` package (checked against Object.keys(require('ai'))).
const SDK_FUNCS = [
  'generateObject', 'generateText', 'streamText', 'streamObject',
  'embed', 'embedMany', 'rerank', 'ToolLoopAgent', 'Experimental_Agent',
  'generateImage', 'experimental_generateImage', 'experimental_generateSpeech',
  'experimental_generateVideo', 'experimental_transcribe',
];
// Matched by name even with no import: the four the codebase uses, and `streamObject` as in the
// sibling rule check-llm-json-parse.
const BY_NAME = ['generateObject', 'generateText', 'streamText', 'streamObject'];
const BANNED_KEYS = ['model', 'maxRetries', 'providerOptions'];
const MOBILE_CHAT_NAMES = new Set([
  'UIMessage', 'UIMessageChunk', 'DefaultChatTransport', 'lastAssistantMessageIsCompleteWithToolCalls',
  'Chat', 'useChat',
]);
const WRAPPER_CALL = /\b(loggedGenerateObject|loggedGenerateText|loggedStreamText|withAiLogging)\s*[(<]/g;
const GENAI_IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]@google\/genai(?:\/[^'"]*)?['"]/;

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name) || isSkippedFixtureDir(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (isSource(e.name)) out.push(p);
  }
  return out;
}

function isSource(name) {
  return SOURCE_EXT.test(name) && !/\.(?:test|spec)\.[^.]+$/.test(name) && !/\.d\.[cm]?ts$/.test(name);
}

/** The source files directly in the repo root (middleware.ts, auth.ts, config files), not below it. */
function rootFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isFile() && isSource(e.name)).map((e) => path.join(root, e.name));
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

/** `[{ text, start }]`: `text` split at the commas that sit at bracket depth 0, `start` its offset in `text`. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let j = 0; j < text.length; j++) {
    const ch = text[j];
    if (ch === "'" || ch === '"') j = skipString(text, j, ch);
    else if (ch === '`') j = skipTemplate(text, j);
    else if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push({ text: text.slice(from, j), start: from });
      from = j + 1;
    }
  }
  parts.push({ text: text.slice(from), start: from });
  return parts.filter((p) => p.text.trim() !== '');
}

/**
 * The entries of an object literal's text (`{ a: 1, b }`): `[{ key, value }]`. `key` is null for a
 * spread, and `'<computed>'` for a computed key that is not a plain string. Null if `text` is not an
 * object literal.
 */
function objectEntries(text) {
  const t = text.trim();
  if (!t.startsWith('{') || matchClose(t, 0) !== t.length - 1) return null;
  return splitTopLevel(t.slice(1, -1)).map(({ text: e }) => {
    const entry = e.trim();
    if (entry.startsWith('...')) return { key: null, value: entry.slice(3) };
    const m = /^(?:'([^']*)'|"([^"]*)"|\[\s*(?:'([^']*)'|"([^"]*)")\s*\]|(\[)|(?:async\s+|get\s+|set\s+)?([A-Za-z_$][\w$]*))\s*(.*)$/s.exec(entry);
    if (!m) return { key: '<computed>', value: entry };
    if (m[5]) return { key: '<computed>', value: entry };
    const key = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[6];
    const rest = m[7];
    return { key, value: rest.startsWith(':') ? rest.slice(1).trim() : rest };
  });
}

/** The text of a wrapper call's `section:` value (top level of its first argument). */
function sectionExpression(metaText) {
  const entries = objectEntries(metaText);
  if (!entries) return null;
  const e = entries.find((x) => x.key === 'section');
  return e ? e.value.trim() : null;
}

/** Where the generic arguments `<...>` after an identifier end (index just past the `>`), or `from`. */
function skipGenerics(code, from) {
  let i = from;
  while (/\s/.test(code[i] ?? '')) i++;
  if (code[i] !== '<') return from;
  let depth = 0;
  for (; i < code.length; i++) {
    if (code[i] === '<') depth++;
    else if (code[i] === '>' && code[i - 1] !== '=') {
      depth--;
      if (depth === 0) return i + 1;
    } else if (code[i] === ';') break;
  }
  return from;
}

/**
 * How this file reaches the SDK: local name -> exported name for named imports (aliases included),
 * the identifiers bound to the whole module, the import/export statements' spans (their names are
 * not uses), and direct hits for a re-export.
 */
function readSdkBindings(code) {
  const locals = new Map();
  const namespaces = new Set();
  const spans = [];
  const reexports = [];
  const isSdkModule = (spec) => spec === 'ai' || spec.startsWith('ai/') || /(?:^|\/)instrument$/.test(spec);
  const CLAUSE = String.raw`(?:[\w$]+\s*,\s*)?(?:\*(?:\s*as\s+[\w$]+)?|\{[^}]*\}|[\w$]+)`;
  const stmt = new RegExp(String.raw`\b(import|export)\s+(type\s+)?(${CLAUSE})\s*from\s*['"]([^'"]+)['"]`, 'g');
  for (const m of code.matchAll(stmt)) {
    const [whole, kind, typeOnly, clause, spec] = m;
    spans.push([m.index, m.index + whole.length]);
    if (!isSdkModule(spec) || typeOnly) continue;
    if (kind === 'export') {
      if (clause.startsWith('*') && !/as\s/.test(clause) || SDK_FUNCS.some((f) => new RegExp(String.raw`\b${f}\b`).test(clause))) {
        reexports.push(m.index);
      }
      continue;
    }
    const ns = /\*\s*as\s+([\w$]+)/.exec(clause);
    if (ns) namespaces.add(ns[1]);
    const named = /\{([^}]*)\}/.exec(clause);
    if (named) {
      for (const part of named[1].split(',')) {
        const mm = /^\s*(type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/.exec(part);
        if (mm && !mm[1] && SDK_FUNCS.includes(mm[2])) locals.set(mm[3] ?? mm[2], mm[2]);
      }
    }
  }
  const SPEC = String.raw`(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)`;
  for (const m of code.matchAll(new RegExp(String.raw`\b(?:const|let|var)\s+([\w$]+)\s*=\s*(?:await\s+)?${SPEC}`, 'g'))) {
    if (isSdkModule(m[2])) namespaces.add(m[1]);
  }
  for (const m of code.matchAll(new RegExp(String.raw`\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:await\s+)?${SPEC}`, 'g'))) {
    if (!isSdkModule(m[2])) continue;
    for (const part of m[1].split(',')) {
      const mm = /^\s*([\w$]+)(?:\s*:\s*([\w$]+))?/.exec(part);
      if (mm && SDK_FUNCS.includes(mm[1])) locals.set(mm[2] ?? mm[1], mm[1]);
    }
  }
  return { locals, namespaces, spans, reexports };
}

const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nextNonSpace = (code, i) => { while (/\s/.test(code[i] ?? '')) i++; return i; };
const prevNonSpace = (code, i) => { while (i >= 0 && /\s/.test(code[i])) i--; return i; };

/**
 * Every place the SDK is used: `[{ index, name, end }]` where `end` is just past the identifier (and
 * member) so the caller can look for a `(`. Calls by name, uses of an import alias (called or not),
 * `ns.fn` through a namespace, a bare namespace passed around, and `(await import('ai')).fn`.
 */
function findSdkUses(code, bindings) {
  const uses = new Map();
  const add = (index, name, end) => { if (!uses.has(index)) uses.set(index, { index, name, end }); };
  const blanked = (() => {
    let c = code;
    for (const [a, z] of bindings.spans) c = c.slice(0, a) + c.slice(a, z).replace(/[^\n]/g, ' ') + c.slice(z);
    return c;
  })();

  for (const m of blanked.matchAll(new RegExp(String.raw`\b(${BY_NAME.join('|')})\s*[(<]`, 'g'))) {
    add(m.index, m[1], m.index + m[1].length);
  }
  for (const [local, name] of bindings.locals) {
    for (const m of blanked.matchAll(new RegExp(String.raw`(?<![.\w$])${escapeRe(local)}(?![\w$])`, 'g'))) {
      const before = blanked.slice(0, m.index);
      if (/\btypeof\s*$/.test(before)) continue;
      const after = nextNonSpace(blanked, m.index + local.length);
      const prev = prevNonSpace(blanked, m.index - 1);
      if (blanked[after] === ':' && blanked[after + 1] !== ':' && (blanked[prev] === '{' || blanked[prev] === ',')) continue; // an object key
      add(m.index, name, m.index + local.length);
    }
  }
  for (const ns of bindings.namespaces) {
    for (const m of blanked.matchAll(new RegExp(String.raw`(?<![.\w$])${escapeRe(ns)}(?![\w$])`, 'g'))) {
      if (/\btypeof\s*$/.test(blanked.slice(0, m.index))) continue;
      const end = m.index + ns.length;
      const at = nextNonSpace(blanked, end);
      const member = /^\??\.\s*([\w$]+)/.exec(blanked.slice(at)) ?? /^\[\s*['"]([\w$]+)['"]\s*\]/.exec(blanked.slice(at));
      if (!member) {
        add(m.index, `${ns} (the whole module)`, end);
      } else if (SDK_FUNCS.includes(member[1])) {
        add(m.index, member[1], at + member[0].length);
      }
    }
  }
  const chained = new RegExp(String.raw`(?:require|import)\s*\(\s*['"]ai['"]\s*\)\s*\)?\s*\.\s*(${SDK_FUNCS.join('|')})\b`, 'g');
  for (const m of blanked.matchAll(chained)) add(m.index, m[1], m.index + m[0].length);
  return [...uses.values()].sort((x, y) => x.index - y.index);
}

/** `mobile/src` never calls the model; only the client chat plumbing may import these packages. */
function findMobileHits(code) {
  const hits = [];
  const bad = (idx, text) => hits.push({ line: lineOf(code, idx), text });
  const CLAUSE = String.raw`(?:[\w$]+\s*,\s*)?(?:\*(?:\s*as\s+[\w$]+)?|\{[^}]*\}|[\w$]+)`;
  const stmt = new RegExp(String.raw`\b(?:import|export)\s+(type\s+)?(${CLAUSE})\s*from\s*['"]([^'"]+)['"]`, 'g');
  for (const m of code.matchAll(stmt)) {
    const [, typeOnly, clause, spec] = m;
    const isAi = spec === 'ai' || spec.startsWith('ai/') || spec.startsWith('@ai-sdk/');
    if (!isAi) continue;
    const chatOk = spec === 'ai' || spec === '@ai-sdk/react';
    if (!chatOk) { bad(m.index, `mobile/src must not import '${spec}': the app never calls the model`); continue; }
    if (typeOnly && spec === 'ai') continue;
    const named = /\{([^}]*)\}/.exec(clause);
    const rest = clause.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim();
    const names = named ? named[1].split(',').map((p) => /^\s*(?:type\s+)?([\w$]+)/.exec(p)?.[1]).filter(Boolean) : [];
    const typeNames = named ? named[1].split(',').filter((p) => /^\s*type\s/.test(p)).length : 0;
    if (rest || (named && names.some((n, k) => !MOBILE_CHAT_NAMES.has(n) && !(typeNames && /^\s*type\s/.test(named[1].split(',')[k] ?? ''))))) {
      bad(m.index, `mobile/src may import only ${[...MOBILE_CHAT_NAMES].join(', ')} from '${spec}' (client chat plumbing); found \`${clause.replace(/\s+/g, ' ').slice(0, 60)}\``);
    }
  }
  for (const m of code.matchAll(/\b(?:require|import)\s*\(\s*['"](ai|ai\/[^'"]*|@ai-sdk\/[^'"]+)['"]/g)) {
    bad(m.index, `mobile/src must not load '${m[1]}' with require() or import(): the app never calls the model`);
  }
  return hits;
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
  if (rel.startsWith('mobile/src/')) hits.push(...findMobileHits(code));

  const wrappers = [];
  for (const m of code.matchAll(WRAPPER_CALL)) {
    const open = code.indexOf('(', m.index + m[1].length);
    const close = matchClose(code, open);
    if (close < 0) continue;
    const args = splitTopLevel(code.slice(open + 1, close));
    // Only what follows the first (meta) argument counts as inside the wrapper.
    const secondAt = args.length > 1 ? open + 1 + args[1].start : close;
    wrappers.push({ name: m[1], start: m.index, open, close, secondAt });
    const meta = args[0]?.text ?? '';
    const section = sectionExpression(meta);
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
    // The stream wrapper takes the call's params directly, and must not carry its own settings either.
    if (m[1] === 'loggedStreamText' && args[1]) {
      const entries = objectEntries(args[1].text);
      for (const e of entries ?? []) {
        if (BANNED_KEYS.includes(e.key)) hits.push({ line: lineOf(code, m.index), text: `${m[1]}(...) passes its own \`${e.key}\`: settings come from AI_SECTIONS` });
      }
    }
  }

  const bindings = readSdkBindings(code);
  for (const at of bindings.reexports) {
    hits.push({ line: lineOf(code, at), text: 'an SDK function is re-exported here; only lib/ai/instrument.ts may do that' });
  }
  for (const use of findSdkUses(code, bindings)) {
    const line = lineOf(code, use.index);
    const inside = wrappers.some((w) => use.index > w.secondAt && use.index < w.close);
    const after = nextNonSpace(code, skipGenerics(code, use.end));
    const isCall = code[after] === '(';
    if (!inside) {
      hits.push({ line, text: `${use.name}${isCall ? '(' : ''} ${isCall ? 'called' : 'used'} outside a logged wrapper callback (loggedGenerateObject / loggedGenerateText / loggedStreamText)` });
    }
    if (!isCall) continue;
    const close = matchClose(code, after);
    if (close < 0) continue;
    const first = splitTopLevel(code.slice(after + 1, close))[0]?.text ?? '';
    const entries = objectEntries(first);
    if (!entries) {
      hits.push({ line, text: `${use.name}( takes its options as a literal object, so the rule can read them; found \`${first.trim().slice(0, 40)}\`` });
      continue;
    }
    for (const e of entries) {
      if (e.key === '<computed>') hits.push({ line, text: `${use.name}( has a computed option key, which the rule cannot read` });
      else if (BANNED_KEYS.includes(e.key)) hits.push({ line, text: `${use.name}( passes its own \`${e.key}\`: settings come from AI_SECTIONS via the wrapper's \`...settings\`` });
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
    const files = [...rootFiles(root), ...DIRS.flatMap((d) => walk(path.join(root, d), []))];
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
