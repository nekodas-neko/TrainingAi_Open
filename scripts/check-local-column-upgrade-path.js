#!/usr/bin/env node
// A column added to a local `CREATE TABLE IF NOT EXISTS` body never reaches a device that already
// has the table. `CREATE TABLE IF NOT EXISTS` is a no-op when the table exists, and `reconcileSchema()`
// only adds columns named explicitly in `RECONCILE_COLUMNS` — so the column exists on fresh installs
// and is missing forever on upgraded ones. Every INSERT naming it then throws
// "table X has no column named Y", which is the #85 class CLAUDE.md records as having killed the
// local DB on Android twice.
//
// `check-reconcile.js` does NOT cover this: it scans `ALTER TABLE … ADD COLUMN` statements, so a
// column that only ever appears inside a CREATE TABLE body is invisible to it. This check closes
// that gap.
//
// **Verified clean when written (2026-08-09):** a full-history sweep of all 41 commits touching
// `migrations.ts` found zero columns added to a CREATE TABLE body after their table first existed
// without a paired ALTER or RECONCILE_COLUMNS row. This check exists to keep it at zero, not to
// burn anything down — which is why there is no grandfather list.
//
// **Honest limit:** the baseline below is a committed file, so it can be regenerated to launder a
// missing upgrade path. That is the same limit every grandfather list in `scripts/` has, and the
// same mitigation applies — the regeneration shows up in the diff as an explicit act. The check
// makes the omission loud and names the fix; it does not make it impossible.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const MIGRATIONS = path.join(root, 'lib', 'sqlite', 'migrations.ts');
const BASELINE = path.join(__dirname, 'local-schema-baseline.json');

const src = fs.readFileSync(MIGRATIONS, 'utf8');

function parseDDL(text) {
  const out = {};
  for (const m of text.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\)`/g)) {
    const cols = [];
    for (const line of m[2].split('\n')) {
      const c = line.match(/^\s*(\w+)\s+(TEXT|INTEGER|REAL|BLOB|NUMERIC)/i);
      if (c) cols.push(c[1]);
    }
    out[m[1]] = cols;
  }
  return out;
}

const current = parseDDL(src);

if (process.argv.includes('--write')) {
  const sorted = {};
  for (const t of Object.keys(current).sort()) sorted[t] = current[t];
  fs.writeFileSync(BASELINE, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`local-schema-baseline.json written (${Object.keys(sorted).length} tables).`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  console.error(`check-local-column-upgrade-path: ${path.relative(root, BASELINE)} is missing. Generate it with:`);
  console.error('  node scripts/check-local-column-upgrade-path.js --write');
  process.exit(1);
}
const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));

// Columns already delivered to existing installs.
const reachable = new Set();
const rcMatch = src.match(/export const RECONCILE_COLUMNS:[^=]*=\s*\[([\s\S]*?)\n\];/);
if (!rcMatch) { console.error('check-local-column-upgrade-path: could not find RECONCILE_COLUMNS'); process.exit(1); }
for (const m of rcMatch[1].matchAll(/table:\s*'([^']+)'\s*,\s*column:\s*'([^']+)'/g)) reachable.add(`${m[1]}.${m[2]}`);
for (const m of src.matchAll(/ALTER TABLE (\w+) ADD COLUMN (\w+)/g)) reachable.add(`${m[1]}.${m[2]}`);

const stranded = [];
const drifted = [];

for (const [table, cols] of Object.entries(current)) {
  const known = baseline[table];
  if (!known) continue; // brand-new table — every device creates it fresh, nothing to reconcile
  for (const col of cols) {
    if (known.includes(col)) continue;
    if (reachable.has(`${table}.${col}`)) continue;
    stranded.push(`${table}.${col}`);
  }
}

for (const table of Object.keys(baseline)) {
  if (!current[table]) drifted.push(`table '${table}' is in the baseline but no longer has a CREATE TABLE — regenerate the baseline`);
}

if (stranded.length) {
  console.error('Column added to a local CREATE TABLE body with no upgrade path — it will exist on fresh installs and be MISSING FOREVER on devices that already have the table:');
  for (const s of stranded) console.error(`  ${s}`);
  console.error('');
  console.error('Fix: add BOTH, in this PR —');
  console.error("  1. a RECONCILE_COLUMNS row: { table: '…', column: '…', ddl: `ALTER TABLE … ADD COLUMN …` }");
  console.error('  2. the same ALTER in a new versioned MIGRATIONS entry (ADD COLUMN is not idempotent; RECONCILE_COLUMNS is the real authority after a partial upgrade)');
  console.error('Then refresh the baseline: node scripts/check-local-column-upgrade-path.js --write');
  process.exit(1);
}

if (drifted.length) {
  console.error('Local schema baseline is stale:');
  for (const d of drifted) console.error(`  ${d}`);
  console.error('Refresh it: node scripts/check-local-column-upgrade-path.js --write');
  process.exit(1);
}

const tables = Object.keys(current).length;
console.log(`check-local-column-upgrade-path: every local column reaches upgraded devices (${tables} tables checked).`);
