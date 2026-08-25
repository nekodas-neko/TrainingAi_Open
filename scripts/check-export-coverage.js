#!/usr/bin/env node
/**
 * Q-288: `/api/export` covered 26 of 82 tables and presented as complete. Every table added since
 * the export was written was absent BY ACCIDENT, because coverage lived in two hand-maintained
 * arrays and nothing compared them to the schema.
 *
 * This makes the classification exhaustive by construction: every `pgTable` in schema.ts must be in
 * `EXPORTED` or `EXCLUDED` in lib/export/export-map.ts. A new table cannot be forgotten, only
 * classified — which is the whole fix. Static parse, no database: the check has to run in the
 * Custom Rules job, and against the schema the branch declares rather than whatever a runner
 * happens to have migrated.
 */
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const read = p => readFileSync(join(root, p), 'utf8')

const schemaTables = new Set([...read('lib/data/postgres/schema.ts').matchAll(/pgTable\(\s*['"]([a-z_]+)['"]/g)].map(m => m[1]))
const map = read('lib/export/export-map.ts')

// Each record's keys, read from its own block so a name in one cannot be credited to the other.
function keysOf(constName) {
  const start = map.indexOf(`export const ${constName}`)
  if (start === -1) throw new Error(`${constName} not found in lib/export/export-map.ts`)
  const rest = map.slice(start)
  const end = rest.indexOf('\n}\n')
  if (end === -1) throw new Error(`could not find the end of ${constName}`)
  const body = rest.slice(0, end)
  return new Set([...body.matchAll(/^ {2}([a-z_]+):/gm)].map(m => m[1]))
}

const exported = keysOf('EXPORTED')
const excluded = keysOf('EXCLUDED')

const problems = []

for (const table of [...schemaTables].sort()) {
  const inE = exported.has(table)
  const inX = excluded.has(table)
  if (!inE && !inX) {
    problems.push(`  ${table} — in schema.ts but classified in neither EXPORTED nor EXCLUDED`)
  } else if (inE && inX) {
    problems.push(`  ${table} — classified in BOTH EXPORTED and EXCLUDED`)
  }
}

// The reverse direction: a name in the map that no longer exists is a stale entry pretending to be
// coverage. `rate_limits`, `db_query_log` and `schema_migrations` are real tables created by
// migrations rather than declared in schema.ts, so they are expected here.
const NOT_IN_SCHEMA_TS = new Set(['rate_limits', 'db_query_log', 'schema_migrations'])
for (const table of [...exported, ...excluded].sort()) {
  if (!schemaTables.has(table) && !NOT_IN_SCHEMA_TS.has(table)) {
    problems.push(`  ${table} — classified in export-map.ts but no such pgTable in schema.ts`)
  }
}

// Soft-delete filtering, checked rather than trusted: hand-listing SOFT_DELETED was wrong in both
// directions on the first attempt — two tables invented, thirteen missed — and a missed one means a
// takeout that resurrects content the user deleted.
// Split at each pgTable( and take only up to the next line starting `})` — a greedy block match
// bleeds across tables and credits one table's column to another. Verified against the live
// column catalogue: this parse and `information_schema` agree on all 16.
const schemaSoftDeleted = new Set()
{
  const parts = read('lib/data/postgres/schema.ts').split(/pgTable\(\s*['"]([a-z_]+)['"]/)
  for (let i = 1; i < parts.length; i += 2) {
    const end = parts[i + 1].search(/^\}\)/m)
    const block = end === -1 ? parts[i + 1] : parts[i + 1].slice(0, end)
    if (/timestamp\(\s*['"]deleted_at['"]/.test(block)) schemaSoftDeleted.add(parts[i])
  }
}
const softListed = keysOf('SOFT_DELETED')
for (const table of [...schemaSoftDeleted].sort()) {
  if (exported.has(table) && !softListed.has(table)) {
    problems.push(`  ${table} — declares deleted_at and is exported, but is missing from SOFT_DELETED`)
  }
}
for (const table of [...softListed].sort()) {
  if (!schemaSoftDeleted.has(table)) {
    problems.push(`  ${table} — in SOFT_DELETED but declares no deleted_at column in schema.ts`)
  }
}

if (problems.length) {
  console.error('Export coverage (Q-288) — every table must be exported or excluded with a reason:\n')
  console.error(problems.join('\n'))
  console.error('\nAdd it to EXPORTED (with a scope) or EXCLUDED (with a written reason) in lib/export/export-map.ts.')
  process.exit(1)
}

console.log(`Export coverage OK — ${schemaTables.size} tables: ${exported.size} exported, ${excluded.size} excluded with a reason, ${softListed.size} soft-delete filtered.`)
