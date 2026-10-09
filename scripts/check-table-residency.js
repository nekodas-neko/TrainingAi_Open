#!/usr/bin/env node
// #2489 — every table the app has must say where it lives.
//
// The 2026-08-02 native-convergence review counted 70 `pgTable`s and 37 local tables with no record
// of which store owns each one; two months later it was 101 and 42, still with no record. A table
// added without anyone deciding its residency is how a domain ends up writing locally and reading
// from the server, or hard-deleting on the server with a device mirror that never hears about it.
//
// So the residency list is exhaustive by construction, like `lib/export/export-map.ts`:
// `scripts/table-residency.json` has one entry for every table in
//   - Postgres: each `pgTable` in lib/data/postgres/schema.ts, plus the tables a `.sql` migration
//     or the migration runner creates outside it (rate_limits, db_query_log, schema_migrations);
//   - the JS SQLite store: each `CREATE TABLE` in lib/sqlite/migrations.ts;
//   - native: each `CREATE TABLE` in the Android sources (today OuraRawDb.kt).
// A table with no entry fails, an entry for a table that no longer exists fails, and so does
// docs/data-residency.md when its generated matrix no longer matches the list and the code.
//
// Static parse, no database: it runs in Custom Rules against the schema the branch declares.
//
// **Honest limits.** The list is a committed file, so a table can be waved through with a careless
// class — the same limit every list in scripts/ has; the entry is an explicit line in the diff and
// the doc renders it for review. A local table dropped for good by a later migration still counts
// as present (only the `x_new` → `x` rename idiom is understood), so drop its CREATE too.
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib/table-residency');
const { isSkippedFixtureDir } = require('./lib/fixture-dirs');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const LIST = 'scripts/table-residency.json';
const DOC = 'docs/data-residency.md';
const START = '<!-- residency:generated:start -->';
const END = '<!-- residency:generated:end -->';

function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && isSkippedFixtureDir(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some(x => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

function gatherCode() {
  const pgTables = L.extractPgTables(read('lib/data/postgres/schema.ts'));
  const migDir = path.join(root, 'lib/data/postgres/migrations');
  const migrationFiles = fs.readdirSync(migDir).filter(f => f.endsWith('.sql'))
    .map(name => ({ name, text: fs.readFileSync(path.join(migDir, name), 'utf8') }));
  const migrationOnly = L.extractMigrationOnlyTables(migrationFiles, pgTables, [read('lib/data/postgres/client.ts')]);
  const local = L.extractLocalTables(read('lib/sqlite/migrations.ts'));
  const nativeFiles = walk(path.join(root, 'android/app/src/main'), ['.kt', '.java'])
    .map(p => ({ name: path.relative(root, p).split(path.sep).join('/'), text: fs.readFileSync(p, 'utf8') }));
  const native = L.extractNativeTables(nativeFiles);
  return {
    pgTables,
    migrationOnly,
    code: { postgres: [...pgTables.keys(), ...migrationOnly], local, native: [...native.keys()] },
    nativeFiles: native,
  };
}

const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** The generated half of docs/data-residency.md. Deterministic: sorted, no dates. */
function render(list, g) {
  const exp = L.exportStatus(read('lib/export/export-map.ts'));
  const del = L.deletionStatus(read('lib/data/postgres/slices/account-deletion.ts'));
  const pg = list.postgres;
  const deviceCopy = {};
  for (const [t, e] of Object.entries(list.local)) if (e.class === 'MIRROR') deviceCopy[e.mirrors] = `\`${t}\``;
  for (const [t, e] of Object.entries(list.native)) if (e.archive) deviceCopy[e.archive] = `native \`${t}\``;

  const out = [];
  const counts = {};
  for (const e of Object.values(pg)) counts[e.class] = (counts[e.class] ?? 0) + 1;
  out.push(`**${Object.keys(pg).length} Postgres tables** (${g.pgTables.size} \`pgTable\` in schema.ts + ${g.migrationOnly.length} created outside it), ` +
    `**${Object.keys(list.local).length} JS SQLite tables**, **${Object.keys(list.native).length} native tables**.`);
  out.push('');
  out.push('| class | Postgres tables |');
  out.push('|---|---|');
  for (const c of L.POSTGRES_CLASSES) out.push(`| ${c} | ${counts[c] ?? 0} |`);
  out.push('');
  out.push('### Postgres');
  out.push('');
  out.push('`tombstone` = has `deleted_at`. `export` = `lib/export/export-map.ts`. `account deletion` = what `DELETE /api/account` does to it (`cascade` = removed through the `users` foreign-key chain; otherwise its `OUTSIDE_THE_CASCADE` disposition).');
  out.push('');
  out.push('| table | class | device copy | tombstone | export | account deletion | writer → reader |');
  out.push('|---|---|---|---|---|---|---|');
  for (const t of Object.keys(pg).sort()) {
    const e = pg[t];
    const facts = g.pgTables.get(t);
    const tomb = facts ? (facts.tombstone ? 'yes' : '—') : '—';
    out.push(`| \`${t}\` | ${e.class} | ${deviceCopy[t] ?? '—'} | ${tomb} | ${exp(t)} | ${del(t)} | ${cell(e.note)} |`);
  }
  out.push('');
  out.push('### JS SQLite, device-only tables');
  out.push('');
  out.push('The other local tables are the mirrors named in the "device copy" column above. Every local table is wiped by sign-out and account deletion (`signOutAndClearDevice` walks `sqlite_master`).');
  out.push('');
  out.push('| table | class | what it is |');
  out.push('|---|---|---|');
  for (const t of Object.keys(list.local).sort()) {
    const e = list.local[t];
    if (e.class === 'MIRROR') continue;
    out.push(`| \`${t}\` | ${e.class} | ${cell(e.note)} |`);
  }
  out.push('');
  out.push('### Native');
  out.push('');
  out.push('| table | class | source | server archive | what it is |');
  out.push('|---|---|---|---|---|');
  for (const t of Object.keys(list.native).sort()) {
    const e = list.native[t];
    out.push(`| \`${t}\` | ${e.class} | \`${g.nativeFiles.get(t) ?? '?'}\` | ${e.archive ? `\`${e.archive}\`` : '—'} | ${cell(e.note)} |`);
  }
  return out.join('\n');
}

function spliceDoc(doc, body) {
  const a = doc.indexOf(START);
  const b = doc.indexOf(END);
  if (a === -1 || b === -1 || b < a) return null;
  return `${doc.slice(0, a + START.length)}\n${body}\n${doc.slice(b)}`;
}

function main() {
  const list = JSON.parse(read(LIST));
  const g = gatherCode();
  const problems = L.findProblems(g.code, list);

  if (problems.length) {
    console.error(`check-table-residency: ${problems.length} problem(s) with ${LIST}:`);
    for (const p of problems) {
      if (p.kind === 'missing') console.error(`  ${p.section}.${p.table} — a table the code creates has no residency entry`);
      else if (p.kind === 'stale') console.error(`  ${p.section}.${p.table} — has an entry but the code no longer creates it`);
      else if (p.kind === 'bad-class') console.error(`  ${p.section}.${p.table} — unknown class "${p.detail}"`);
      else console.error(`  ${p.section}.${p.table} — ${p.detail}`);
    }
    console.error('');
    console.error('Fix:');
    console.error(`  - A new table: add one line for it to ${LIST} under its store, with a class from ${DOC}`);
    console.error('    ("Classes") and a note saying who writes it and who reads it. Decide residency now —');
    console.error('    server-only, device mirror, or device-first with an outbox — and if it has delete UI and a');
    console.error('    device copy, give it a deleted_at tombstone (docs/rules/offline-first-and-storage.md).');
    console.error(`  - A removed table: delete its line from ${LIST}.`);
    console.error('  - A local MIRROR names the Postgres table it mirrors in "mirrors".');
    console.error(`Then regenerate the doc: node scripts/check-table-residency.js --write`);
    process.exit(1);
  }

  const body = render(list, g);
  const doc = read(DOC);
  const next = spliceDoc(doc, body);
  if (next === null) {
    console.error(`check-table-residency: ${DOC} has lost its ${START} / ${END} markers. Restore them around the generated matrix.`);
    process.exit(1);
  }
  if (process.argv.includes('--write')) {
    if (next !== doc) fs.writeFileSync(path.join(root, DOC), next);
    console.log(`check-table-residency: ${DOC} matrix ${next === doc ? 'already current' : 'regenerated'}.`);
    return;
  }
  if (next.replace(/\r\n/g, '\n') !== doc.replace(/\r\n/g, '\n')) {
    console.error(`check-table-residency: the matrix in ${DOC} no longer matches ${LIST} and the code`);
    console.error('(a table, class, note, tombstone, export or account-deletion fact changed).');
    console.error('Regenerate it and commit the result: node scripts/check-table-residency.js --write');
    process.exit(1);
  }
  const c = g.code;
  console.log(`check-table-residency: every table has a residency entry (${c.postgres.length} Postgres, ${c.local.length} JS SQLite, ${c.native.length} native) and ${DOC} is current.`);
}

if (require.main === module) main();
module.exports = { render, spliceDoc };
