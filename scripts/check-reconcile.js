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

const missing = [];
for (const [, table] of migBody.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)) {
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
