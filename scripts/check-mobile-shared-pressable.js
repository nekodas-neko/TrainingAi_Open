#!/usr/bin/env node
// Feature code in the native app uses the shared Pressable, never React Native's (#3759).
//
// On 14 Nov about 45 tappable cards and rows under `mobile/src/features` were a bare React Native
// Pressable with no pressed style, so a press changed nothing on screen until the next screen
// arrived, and the ones that did dim used five different opacities. The pressed look now lives in
// `mobile/src/shared/ui/Pressable.tsx` (and `TouchSurface` for a whole card), which every caller
// gets without asking. A file that imports `Pressable` from 'react-native' steps around it, and
// nothing looks wrong when it does, so this check is what keeps the look in one place.
//
// The shared UI folder is not checked: that is where the primitives wrap React Native's.
//
//   node scripts/check-mobile-shared-pressable.js            the repo
//   node scripts/check-mobile-shared-pressable.js --root D   a tree under D (tests)
'use strict';
const fs = require('fs');
const path = require('path');
const { stripComments } = require('./lib/strip-comments');
const { isSkippedFixtureDir } = require('./lib/fixture-dirs');

const FEATURES = 'mobile/src/features';
// An import or re-export of names from 'react-native'; the name list may span lines.
const RN_IMPORT = /\b(?:import|export)\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*['"]react-native['"]/g;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || isSkippedFixtureDir(e.name)) continue;
      walk(p, out);
    } else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Lines in `src` that take the value `Pressable` from 'react-native' (a type import is fine). */
function findViolations(src) {
  const code = stripComments(src);
  const lines = [];
  let m;
  RN_IMPORT.lastIndex = 0;
  while ((m = RN_IMPORT.exec(code))) {
    if (/^\s*(?:import|export)\s+type\b/.test(m[0])) continue;
    const names = m[1].split(',').map((n) => n.trim());
    if (names.some((n) => /^Pressable(\s+as\s+[\w$]+)?$/.test(n)))
      lines.push(code.slice(0, m.index).split('\n').length);
  }
  return lines;
}

function main() {
  const at = process.argv.indexOf('--root');
  const root = at >= 0 ? path.resolve(process.argv[at + 1]) : path.resolve(__dirname, '..');
  const failures = [];
  const files = walk(path.join(root, FEATURES));
  for (const file of files) {
    for (const line of findViolations(fs.readFileSync(file, 'utf8')))
      failures.push(`${path.relative(root, file).split(path.sep).join('/')}:${line}`);
  }
  if (failures.length > 0) {
    console.error("Feature code imports Pressable from 'react-native', which has no pressed look:");
    for (const f of failures) console.error(`  ${f}`);
    console.error('Use the shared one, which dims while pressed:');
    console.error("  import { Pressable } from '../../../shared/ui/Pressable'");
    console.error('or TouchSurface for a whole tappable card. Pass feedback="none" only where a press');
    console.error('already changes how the control looks, or inside a drag.');
    process.exit(1);
  }
  console.log(`check-mobile-shared-pressable: OK — ${files.length} feature files, none imports Pressable from 'react-native'.`);
}

if (require.main === module) main();
module.exports = { findViolations, FEATURES };
