'use strict';
// #2489 — the pure half of scripts/check-table-residency.js. Every function here takes source
// text and returns data, so scripts/__tests__/table-residency.test.ts can prove the check still
// looks without touching the real files.

/** Classes a Postgres table can carry in scripts/table-residency.json. docs/data-residency.md
 *  defines each one; a class not listed here is a typo, and the check says so. */
const POSTGRES_CLASSES = [
  'DEVICE-FIRST',
  'SERVER-FIRST MIRROR',
  'HYDRATED MIRROR',
  'HYDRATED MIRROR + OUTBOX',
  'SERVER WRITE, DORMANT DEVICE TABLE',
  'OUTBOX WRITE, SERVER READ',
  'NATIVE DEVICE STORE + SERVER ARCHIVE',
  'SERVER-ONLY',
];
/** Classes that have a device-side copy, so a `local` entry may mirror them. */
const MIRRORED_CLASSES = new Set([
  'DEVICE-FIRST',
  'SERVER-FIRST MIRROR',
  'HYDRATED MIRROR',
  'HYDRATED MIRROR + OUTBOX',
  'SERVER WRITE, DORMANT DEVICE TABLE',
]);
const LOCAL_CLASSES = ['MIRROR', 'DEVICE INFRA'];
const NATIVE_CLASSES = ['NATIVE RAW STORE', 'NATIVE DEVICE-ONLY'];

/** `pgTable('name', …)` declarations in lib/data/postgres/schema.ts, with the facts the doc reads
 *  off each table's own column block. */
function extractPgTables(schema) {
  const hits = [...schema.matchAll(/pgTable\(\s*['"]([a-z_0-9]+)['"]/g)];
  const out = new Map();
  hits.forEach((m, i) => {
    const block = schema.slice(m.index, i + 1 < hits.length ? hits[i + 1].index : schema.length);
    out.set(m[1], {
      tombstone: /['"]deleted_at['"]/.test(block),
      userId: /['"]user_id['"]/.test(block),
    });
  });
  return out;
}

/** Tables Postgres has that schema.ts does not declare: created by a `.sql` migration (and not
 *  dropped by a later one) or by the migration runner itself. `files` is [{ name, text }]; they are
 *  applied in filename order, which is how the runner sorts them. */
function extractMigrationOnlyTables(files, pgTables, extraTexts = []) {
  const live = new Set();
  const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const f of [...sorted, ...extraTexts.map((text, i) => ({ name: `extra-${i}`, text }))]) {
    const text = f.text.replace(/--[^\n]*/g, '');
    const ops = [
      ...[...text.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?"?([a-z_0-9]+)"?\s*\(/gi)].map(m => ({ at: m.index, op: 'create', t: m[1].toLowerCase() })),
      ...[...text.matchAll(/DROP TABLE (?:IF EXISTS )?(?:public\.)?"?([a-z_0-9]+)/gi)].map(m => ({ at: m.index, op: 'drop', t: m[1].toLowerCase() })),
      ...[...text.matchAll(/ALTER TABLE (?:IF EXISTS )?(?:public\.)?"?([a-z_0-9]+)"? RENAME TO "?([a-z_0-9]+)/gi)].map(m => ({ at: m.index, op: 'rename', t: m[1].toLowerCase(), to: m[2].toLowerCase() })),
    ].sort((a, b) => a.at - b.at);
    for (const o of ops) {
      if (o.op === 'create') live.add(o.t);
      else if (o.op === 'drop') live.delete(o.t);
      else if (live.delete(o.t)) live.add(o.to);
    }
  }
  return [...live].filter(t => !pgTables.has(t)).sort();
}

/** Local JS SQLite tables in lib/sqlite/migrations.ts. A table only ever created to be renamed
 *  into place (the `x_new` → `x` rebuild idiom) is not a table a device keeps. */
function extractLocalTables(migrations) {
  const created = new Set([...migrations.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)\s*\(/g)].map(m => m[1]));
  for (const m of migrations.matchAll(/ALTER TABLE (\w+) RENAME TO (\w+)/g)) {
    created.delete(m[1]);
    created.add(m[2]);
  }
  return [...created].sort();
}

/** Native tables: every `CREATE TABLE` in the Android sources. `files` is [{ name, text }]. */
function extractNativeTables(files) {
  const out = new Map();
  for (const f of files) {
    for (const m of f.text.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)\s*\(/g)) out.set(m[1], f.name);
  }
  return out;
}

/** Keys of one top-level `export const NAME: … = { … }` record in lib/export/export-map.ts. */
function recordKeys(src, constName) {
  const start = src.indexOf(`export const ${constName}`);
  if (start === -1) return null;
  const rest = src.slice(start);
  const end = rest.indexOf('\n}\n');
  const block = end === -1 ? rest : rest.slice(0, end);
  const out = new Map();
  for (const m of block.matchAll(/^ {2}([a-z_0-9]+):\s*(.*)$/gm)) out.set(m[1], m[2]);
  return out;
}

function exportStatus(exportMap) {
  const exported = recordKeys(exportMap, 'EXPORTED') ?? new Map();
  const excluded = recordKeys(exportMap, 'EXCLUDED') ?? new Map();
  return table => {
    if (exported.has(table)) return 'exported';
    if (excluded.has(table)) {
      const cat = (excluded.get(table).match(/category:\s*'([^']+)'/) || [])[1];
      return cat ? `excluded (${cat})` : 'excluded';
    }
    return 'unclassified';
  };
}

/** What `DELETE /api/account` does to a table: `OUTSIDE_THE_CASCADE` names the exceptions, and
 *  everything else goes by the `users` cascade (account-deletion.test.ts holds the two together). */
function deletionStatus(accountDeletion) {
  const outside = recordKeys(accountDeletion, 'OUTSIDE_THE_CASCADE') ?? new Map();
  return table => {
    if (!outside.has(table)) return 'cascade';
    return (outside.get(table).match(/disposition:\s*'([^']+)'/) || [])[1] || 'outside cascade';
  };
}

/**
 * Every problem with the residency list, given the tables the code declares. Pure.
 *
 * `code` = { postgres: string[], local: string[], native: string[] }
 * `list` = the parsed scripts/table-residency.json
 */
function findProblems(code, list) {
  const problems = [];
  const sections = [
    ['postgres', POSTGRES_CLASSES],
    ['local', LOCAL_CLASSES],
    ['native', NATIVE_CLASSES],
  ];
  for (const [section, classes] of sections) {
    const entries = list[section] ?? {};
    const declared = new Set(code[section] ?? []);
    for (const t of [...declared].sort()) {
      if (!entries[t]) problems.push({ kind: 'missing', section, table: t });
    }
    for (const t of Object.keys(entries).sort()) {
      if (!declared.has(t)) problems.push({ kind: 'stale', section, table: t });
      const cls = entries[t]?.class;
      if (!classes.includes(cls)) problems.push({ kind: 'bad-class', section, table: t, detail: String(cls) });
    }
  }
  // A local mirror must point at a Postgres entry whose class says the device keeps a copy, and
  // every such Postgres class must be mirrored by exactly the local tables that say so.
  const pg = list.postgres ?? {};
  for (const [t, e] of Object.entries(list.local ?? {})) {
    if (e?.class !== 'MIRROR') continue;
    const target = e.mirrors;
    if (!target || !pg[target]) {
      problems.push({ kind: 'bad-mirror', section: 'local', table: t, detail: `mirrors '${target}', which has no postgres entry` });
    } else if (!MIRRORED_CLASSES.has(pg[target].class)) {
      problems.push({ kind: 'bad-mirror', section: 'local', table: t, detail: `mirrors '${target}', classed ${pg[target].class} (no device copy)` });
    }
  }
  const mirrored = new Set(Object.values(list.local ?? {}).filter(e => e?.class === 'MIRROR').map(e => e.mirrors));
  for (const [t, e] of Object.entries(pg)) {
    if (MIRRORED_CLASSES.has(e?.class) && !mirrored.has(t)) {
      problems.push({ kind: 'bad-mirror', section: 'postgres', table: t, detail: `classed ${e.class} but no local entry mirrors it` });
    }
  }
  return problems;
}

module.exports = {
  POSTGRES_CLASSES,
  LOCAL_CLASSES,
  NATIVE_CLASSES,
  MIRRORED_CLASSES,
  extractPgTables,
  extractMigrationOnlyTables,
  extractLocalTables,
  extractNativeTables,
  exportStatus,
  deletionStatus,
  findProblems,
};
