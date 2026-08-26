#!/usr/bin/env node
// A learning-mode device must not reach the scoring inputs.
//
// The owner's question, 2026-08-26, on adding a second ring (Colmi R09): *"are we sure its data
// will be read only and wont affect scoring of anything I have going?"* This is what makes the
// answer "yes" instead of "we intend to".
//
// **The thing that makes prose insufficient here.** The repo's ranked per-field merge
// (`lib/data/health-source.ts`) governs WRITES — a lower-ranked source cannot overwrite a
// higher-ranked one. It says nothing about reads, and every scoring read is source-blind:
//
//   - `getHrForWindow` (`lib/data/postgres/slices/oura.ts`) selects `oura_heartrate` with NO source
//     predicate and hands the rows to `preferStrapBuckets`, which is an allowlist of exactly one
//     value — `chest_strap` — with everything else falling through untouched. So a row stamped
//     `colmi_ble` would feed the readiness payload and the body-battery window directly.
//   - `listBodyMetrics` / `listSleepSessions` / `getOuraDaily` / `getOuraDailyDerived` read whole
//     rows. `source_map` is per-field provenance for the merge; no read consults it.
//
// Only two reads in the whole repo filter `oura_heartrate` by source, and both are deliberate:
// the rollup (`'ble'`) and the comparison adapter. Ranking therefore cannot deliver isolation.
// Not writing to those tables at all is what delivers it, and this check is what holds that.
//
// **Layer 1 of the guarantee is the type system and costs nothing.** Every shared-table write
// (`upsertBodyMetrics`, `saveSleepSession`, `upsertOuraDaily`, …) takes `source: HealthSource`, a
// closed union built from the `HEALTH_SOURCES` tuple. A learning-mode source that is NOT in that
// tuple cannot be passed to any of them — it is a compile error. This check is layer 2: it catches
// the ways round that (raw `sql`, a direct Drizzle insert, adding the source to the ladder).
//
// Empty baseline, deliberately — same shape as `check-aest-midnight-timezone.js`. There is no
// existing debt to grandfather, so any hit is a regression rather than a number to shrink. The
// check is landed BEFORE the integration on purpose: a guard written after the code is a guard
// that can be argued with.
//
// Reproduce from a shell:
//   grep -rn 'colmi' --include='*.ts' --include='*.tsx' lib app packages | grep -vi 'colmi-ble/'
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// Source families that are in learning mode: ingested, stored, compared, and read by nothing else.
// Add a family here when a new device starts in learning mode; remove it only in the PR that
// deliberately promotes the device, which is the PR where this check SHOULD start failing.
const LEARNING_MODE = [
  { name: 'colmi', ownDirs: ['lib/colmi-ble/', 'components/colmi/'], ownApiPrefix: 'app/api/colmi/' },
];

// The tables whose contents reach a score. Derived by walking the scoring routes' repo calls:
// `lib/health/readiness-payload.ts` (readiness), `app/api/body-battery`, `app/api/health-trends`.
// A learning-mode module naming any of these is the failure this check exists to catch.
const SCORING_TABLES = [
  'oura_heartrate', 'ouraHeartrate',
  'body_metrics', 'bodyMetrics',
  'sleep_sessions', 'sleepSessions',
  'oura_daily', 'ouraDaily',
  'oura_daily_derived', 'ouraDailyDerived',
];

// Writers that would merge a learning-mode row into a shared table.
const SHARED_WRITERS = [
  'upsertBodyMetrics', 'saveSleepSession', 'upsertOuraDaily', 'upsertOuraDailyDerived',
  'upsertOuraHeartrate', 'upsertOuraSleep', 'mergeSet',
];

// Files that consume scoring inputs. A learning-mode import appearing in one of these is the
// other direction of the same leak: not the device writing out, but a score reading in.
const SCORING_CONSUMERS = [
  'lib/health/readiness-payload.ts',
  'app/api/readiness-score/route.ts',
  'app/api/body-battery/route.ts',
  'app/api/health-trends/route.ts',
  'lib/data/health-source.ts',
  'packages/shared/src/health/source-rank.ts',
  'packages/shared/src/health/hr-window-merge.ts',
];

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name === '__tests__') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Blank COMMENTS ONLY, preserving length. String bodies are deliberately kept.
 *
 * The first version of this blanked strings too, copying `check-aest-midnight-timezone.js`, and a
 * probe caught it the same hour: `HEALTH_SOURCES` holds its values as string literals, so the
 * ladder check silently passed against a ladder that HAD been given `'colmi_ble'`. The same blind
 * spot would have hidden the leak that matters most — a raw `sql` insert naming `oura_heartrate`
 * is a string, not an identifier. Comments still go, so prose describing the rule is not a hit.
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      out += ' '.repeat(stop - i); i = stop; continue;
    }
    if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += ' '.repeat(stop - i); i = stop; continue;
    }
    out += src[i]; i += 1;
  }
  return out;
}

const files = [
  ...walk(path.join(root, 'lib')),
  ...walk(path.join(root, 'app')),
  ...walk(path.join(root, 'components')),
  ...walk(path.join(root, 'packages')),
];

const violations = [];

for (const family of LEARNING_MODE) {
  const owned = f => family.ownDirs.some(d => f.includes(d)) || f.includes(family.ownApiPrefix);

  for (const abs of files) {
    const rel = path.relative(root, abs).split(path.sep).join('/');
    const code = stripComments(fs.readFileSync(abs, 'utf8'));

    // (a) The device's own modules must not name a scoring table or call a shared writer.
    if (owned(rel)) {
      for (const t of SCORING_TABLES) {
        if (new RegExp(`\\b${t}\\b`).test(code)) {
          violations.push(`${rel}: learning-mode module names the scoring table \`${t}\``);
        }
      }
      for (const w of SHARED_WRITERS) {
        if (new RegExp(`\\b${w}\\s*\\(`).test(code)) {
          violations.push(`${rel}: learning-mode module calls the shared writer \`${w}()\``);
        }
      }
    }

    // (b) Nothing outside the device's own modules may import them — except the comparison
    //     harness adapters, which is the ONE sanctioned reader and the point of learning mode.
    const SANCTIONED_READER = 'lib/oura-comparison-harness-adapters.ts';
    if (!owned(rel) && rel !== SANCTIONED_READER) {
      for (const d of family.ownDirs) {
        const mod = d.replace(/\/$/, '');
        if (new RegExp(`from\\s+['"]@?/?${mod.replace(/\//g, '\\/')}`).test(fs.readFileSync(abs, 'utf8'))) {
          violations.push(`${rel}: imports the learning-mode module \`${mod}\` (only ${SANCTIONED_READER} may)`);
        }
      }
    }
  }

  // (c) The source ladder must not carry the family. Its absence is what makes a shared write a
  //     compile error, which is a stronger guarantee than anything this script can offer.
  const ladder = path.join(root, 'packages/shared/src/health/source-rank.ts');
  if (fs.existsSync(ladder)) {
    const code = stripComments(fs.readFileSync(ladder, 'utf8'));
    if (new RegExp(family.name, 'i').test(code)) {
      violations.push(
        `packages/shared/src/health/source-rank.ts: \`${family.name}\` is in HEALTH_SOURCES — that ` +
        `promotes it out of learning mode and makes shared-table writes typecheck. Remove it from ` +
        `LEARNING_MODE in this script in the same PR if the promotion is deliberate.`,
      );
    }
  }

  // (d) The scoring consumers must not mention the family at all, in any form.
  for (const relC of SCORING_CONSUMERS) {
    const abs = path.join(root, relC);
    if (!fs.existsSync(abs)) continue;
    const code = stripComments(fs.readFileSync(abs, 'utf8'));
    if (new RegExp(family.name, 'i').test(code)) {
      violations.push(`${relC}: scoring input names \`${family.name}\``);
    }
  }
}

if (violations.length > 0) {
  console.error('Learning-mode isolation broken:\n');
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    '\nA learning-mode device is ingested, stored and compared — and read by nothing that produces\n' +
    'a score. Every scoring read is source-blind (see this file\'s header), so a row in a shared\n' +
    'table IS a scored row regardless of how it is stamped. Keep the device in its own tables.\n',
  );
  process.exit(1);
}

console.log(`Learning-mode isolation holds (${LEARNING_MODE.map(f => f.name).join(', ')}; ${files.length} files scanned).`);
