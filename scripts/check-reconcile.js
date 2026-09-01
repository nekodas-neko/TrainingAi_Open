#!/usr/bin/env node
// Verifies RECONCILE_TABLES/RECONCILE_COLUMNS (lib/sqlite/migrations.ts) cover every
// table/column any migration ever creates — reconcileSchema() is the real schema
// authority after a partial local-SQLite upgrade, so a gap here silently drops data
// on exactly the devices that most need the reconcile pass (see CLAUDE.md's #85 class).
'use strict';
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'lib', 'sqlite', 'migrations.ts');
const src = fs.readFileSync(file, 'utf8');

const constToTable = {};
for (const m of src.matchAll(/const\s+(\w+)\s*=\s*`CREATE TABLE IF NOT EXISTS (\w+)/g)) {
  constToTable[m[1]] = m[2];
}

const rtMatch = src.match(/export const RECONCILE_TABLES:[^=]*=\s*\[([\s\S]*?)\n\];/);
if (!rtMatch) { console.error('check-reconcile: could not find RECONCILE_TABLES array'); process.exit(1); }
const reconciledTables = new Set();
for (const [, ident] of rtMatch[1].matchAll(/\b(\w+)\b/g)) {
  if (constToTable[ident]) reconciledTables.add(constToTable[ident]);
}
for (const [, table] of rtMatch[1].matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)) {
  reconciledTables.add(table);
}

const rcMatch = src.match(/export const RECONCILE_COLUMNS:[^=]*=\s*\[([\s\S]*?)\n\];/);
if (!rcMatch) { console.error('check-reconcile: could not find RECONCILE_COLUMNS array'); process.exit(1); }
const reconciledColumns = new Set();
for (const [, table, column] of rcMatch[1].matchAll(/table:\s*'([^']+)'\s*,\s*column:\s*'([^']+)'/g)) {
  reconciledColumns.add(`${table}.${column}`);
}

const migIdx = src.indexOf('export const MIGRATIONS');
if (migIdx === -1) { console.error('check-reconcile: could not find MIGRATIONS array'); process.exit(1); }
const migBody = src.slice(migIdx);

// Scratch tables a migration creates, copies into and drops within the same version. They are gone
// by the time reconcileSchema() ever runs, so registering one would make reconcile recreate a table
// nothing reads. Named individually rather than matched by a suffix convention, so adding one is a
// deliberate line in a diff — the check exists because a table missing from RECONCILE_TABLES loses
// data on a partial upgrade, and a pattern-based escape hatch is how that guarantee gets widened by
// accident.
//
// supplement_logs_new (BF-69, local v34): SQLite cannot drop an inline table constraint, so
// removing supplement_logs' whole-day UNIQUE means rebuilding the table through a copy.
const TRANSIENT_TABLES = new Set(['supplement_logs_new']);

const missing = [];
for (const [, table] of migBody.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)) {
  if (TRANSIENT_TABLES.has(table)) {
    // A scratch table must actually be dropped in the same version, or it is not transient and the
    // exemption is hiding a real gap.
    if (!new RegExp(`(DROP TABLE (IF EXISTS )?${table}\\b|ALTER TABLE ${table} RENAME TO)`).test(migBody)) {
      missing.push(`table '${table}' is listed as transient but no migration drops or renames it away`);
    }
    continue;
  }
  if (!reconciledTables.has(table)) missing.push(`table '${table}' created in a migration but missing from RECONCILE_TABLES`);
}
for (const [, ident] of migBody.matchAll(/\b(\w+)\b/g)) {
  if (constToTable[ident] && !reconciledTables.has(constToTable[ident])) {
    missing.push(`table '${constToTable[ident]}' (via ${ident}) created in a migration but missing from RECONCILE_TABLES`);
  }
}
for (const [, table, column] of migBody.matchAll(/ALTER TABLE (\w+) ADD COLUMN (\w+)/g)) {
  if (!reconciledColumns.has(`${table}.${column}`)) {
    missing.push(`column '${column}' on '${table}' added in a migration but missing from RECONCILE_COLUMNS`);
  }
}

const unique = [...new Set(missing)];
if (unique.length) {
  console.error('reconcileSchema() completeness check failed — a partial local-SQLite upgrade could permanently lose this table/column:');
  for (const m of unique) console.error(' - ' + m);
  process.exit(1);
}
console.log(`RECONCILE_TABLES/RECONCILE_COLUMNS completeness OK (${reconciledTables.size} tables, ${reconciledColumns.size} columns tracked).`);
