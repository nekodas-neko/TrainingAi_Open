#!/usr/bin/env node
// Every browser-storage key in the code is classified for sign-out: the account's, or the phone's.
//
// #2453 (2026-10-07): sign-out wiped SQLite against a keep-list (`KEEP_ON_SIGN_OUT`) but browser
// storage only by a `ta_` prefix sweep inside `clearAllCache()`. That left every account key not
// spelled `ta_` behind — measured on `pnpm dev`, the previous account's detected activity rendered
// on the next account's Home — and cleared device settings that were (BLE pairings, the theme).
//
// `lib/sign-out-storage.ts` now clears everything except `DEVICE_STORAGE`, so an unclassified key is
// cleared by default. This check is what makes the classification deliberate rather than accidental,
// in both directions:
//   1. Every storage key found in the code is in `DEVICE_STORAGE` or `ACCOUNT_STORAGE`. A new device
//      setting has to be named to survive; a new account key has to be named so the census stays
//      the place to read what sign-out does.
//   2. Every persisted Zustand store holding account data is reset in memory by
//      `resetAccountStores()` — otherwise a mounted screen's next `set()` writes the whole old state
//      back after the key is removed (pinned in lib/__tests__/sign-out-storage.test.ts).
//
// Keys are found where the code names them: the first argument of `localStorage`/`sessionStorage`
// get/set/removeItem, a `*KEY` / `*PREFIX` constant in a file that touches storage, a Zustand
// `persist` `name:`, and the preference map's `key:` entries. A template literal contributes its
// static head, which must match a listed prefix.
'use strict';
const fs = require('fs');
const path = require('path');
const { relPosix } = require('./lib/repo-path');

const root = path.join(__dirname, '..');
const REGISTRY = 'lib/sign-out-storage.ts';
const PREFS = 'packages/shared/src/user/preferences.ts';
const ROOTS = ['app', 'components', 'lib', 'packages/shared/src'];

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

/** Property names of `export const NAME ... = Object.freeze({ ... })`, quoted or bare. */
function objectKeys(src, name) {
  const start = src.indexOf(`export const ${name}`);
  if (start < 0) throw new Error(`${name} not found`);
  const open = src.indexOf('({', start);
  const close = src.indexOf('\n})', open);
  const body = src.slice(open, close).replace(/\/\/.*$/gm, '');
  const out = [];
  for (const m of body.matchAll(/(?:^|[,{\s])(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:/gm)) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

const registrySrc = read(REGISTRY);
const prefsSrc = read(PREFS);
const device = new Set(objectKeys(registrySrc, 'DEVICE_STORAGE'));
for (const k of objectKeys(prefsSrc, 'DEVICE_LOCAL_PREFERENCES')) device.add(k);
// ACCOUNT_STORAGE spreads UPLOAD_QUEUE_STORAGE in, so its keys are read from their own literal.
const account = new Set([...objectKeys(registrySrc, 'ACCOUNT_STORAGE'), ...objectKeys(registrySrc, 'UPLOAD_QUEUE_STORAGE')]);

function classified(key) {
  for (const list of [device, account]) {
    if (list.has(key)) return true;
    for (const entry of list) {
      // A listed prefix covers a key that starts with it; a template head must BE a listed prefix,
      // or start with one.
      if (key.startsWith(entry) && entry !== key && /[:_-]$|_cache$/.test(entry)) return true;
    }
  }
  return false;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '__tests__', '.next', 'dist', 'migrations'].includes(entry.name)) continue;
      walk(full, out);
      continue;
    }
    if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const literal = String.raw`(?:'([^'\n]+)'|"([^"\n]+)"|\x60([^\x60$\n]*)(\$\{)?)`;
// `sure`: the literal is certainly a storage key (passed to the Storage API, or a persist name).
// A `*KEY` constant is only taken when it is shaped like one of this app's keys.
const pick = (m, i, sure) => ({ key: m[i] ?? m[i + 1] ?? m[i + 2], isPrefix: !!m[i + 3], sure });

const unclassified = [];
const unreset = [];
let files = 0;
let found = 0;

for (const dir of ROOTS) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) continue;
  for (const file of walk(abs)) {
    const rel = relPosix(root, file);
    if (rel === REGISTRY) continue;
    const src = fs.readFileSync(file, 'utf8');
    const persisted = /\bpersist\s*\(/.test(src) && /zustand\/middleware/.test(src);
    if (!/\b(localStorage|sessionStorage)\b/.test(src) && !persisted && rel !== PREFS) continue;
    files++;
    const keys = [];
    for (const m of src.matchAll(new RegExp(String.raw`\b(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*` + literal, 'g'))) keys.push(pick(m, 1, true));
    for (const m of src.matchAll(new RegExp(String.raw`\bconst\s+\w*(?:KEY|PREFIX)\s*=\s*` + literal, 'g'))) keys.push(pick(m, 1, false));
    if (persisted) {
      for (const m of src.matchAll(new RegExp(String.raw`\bname:\s*` + literal, 'g'))) {
        const k = pick(m, 1, true);
        keys.push(k);
        if (account.has(k.key) && !new RegExp(`from ['"]@/${rel.replace(/\.tsx?$/, '')}['"]`).test(registrySrc)) {
          unreset.push(`${rel}: persisted store '${k.key}' holds account data but is not reset by resetAccountStores() in ${REGISTRY}`);
        }
      }
    }
    // The preference map (`key: 'ta_…'`) and key builders (`key: (id) => \`chat_history_${id}\``).
    for (const m of src.matchAll(new RegExp(String.raw`\bkey:\s*(?:\([^)]*\)\s*=>\s*)?` + literal, 'g'))) {
      const k = pick(m, 1, true);
      if (rel === PREFS || /\$\{/.test(m[0]) || /=>/.test(m[0])) keys.push(k);
    }
    for (const { key, isPrefix, sure } of keys) {
      if (!key) continue;
      // A `*KEY` constant is often a cachedFetch key or an id; only this app's storage-key shapes count.
      if (!sure && !/^(ta[_-]|chat_history_)/.test(key)) continue;
      found++;
      if (!classified(key)) unclassified.push(`${rel}: '${key}${isPrefix ? '${…}' : ''}'`);
    }
  }
}

const problems = [...new Set(unclassified)].concat(unreset);
if (problems.length > 0) {
  console.error('Browser-storage keys sign-out does not know about (#2453).');
  console.error(`Classify each in ${REGISTRY}: DEVICE_STORAGE if it describes the phone and must survive a sign-out,`);
  console.error('ACCOUNT_STORAGE if it is the signed-in person\'s (cleared). A persisted store holding account');
  console.error('data must also be added to ACCOUNT_STORES there, so it is reset in memory before its key goes.');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log(`check-sign-out-clears-storage: ${found} key reference(s) in ${files} file(s), all classified (${device.size} device, ${account.size} account).`);
