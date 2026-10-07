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
 *
 * #2427: lines that are not a table read (a `repo.<method>()` call in full-export.ts, today only
 * `goals`) were outside every list, so this check could not see them. They are now declared in
 * `DERIVED_DOMAINS` and held to it below.
 */
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const read = p => readFileSync(join(root, p), 'utf8')

/**
 * Pure: every problem with the classification, given the three sources. Exported so the cases in
 * scripts/__tests__/export-coverage.test.ts keep proving the check still looks.
 */
function findProblems({ schema, map, fullExport }) {
  const schemaTables = new Set([...schema.matchAll(/pgTable\(\s*['"]([a-z_]+)['"]/g)].map(m => m[1]))

  // Each record's keys, read from its own block so a name in one cannot be credited to the other.
  function blockOf(constName) {
    const start = map.indexOf(`export const ${constName}`)
    if (start === -1) throw new Error(`${constName} not found in lib/export/export-map.ts`)
    const rest = map.slice(start)
    const end = rest.indexOf('\n}\n')
    if (end === -1) throw new Error(`could not find the end of ${constName}`)
    return rest.slice(0, end)
  }
  const keysOf = constName => new Set([...blockOf(constName).matchAll(/^ {2}([a-z_]+):/gm)].map(m => m[1]))

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
    const parts = schema.split(/pgTable\(\s*['"]([a-z_]+)['"]/)
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

  // #2427: lines that are not a table read. A repo call can read any table, an EXCLUDED one
  // included, so every `repo.<method>(` call and every literal `domain:` in full-export.ts must be
  // declared in DERIVED_DOMAINS; every declared entry must still be called; and every table a
  // derived line is built from must itself be EXPORTED, so a derived line never reaches around an
  // exclusion.
  const derived = new Map()
  for (const m of blockOf('DERIVED_DOMAINS').matchAll(/^ {2}([a-z_]+):\s*\{(.*)\},?\s*$/gm)) {
    const repoCall = /repoCall:\s*['"](\w+)['"]/.exec(m[2])?.[1] ?? null
    const sources = /sourceTables:\s*\[([^\]]*)\]/.exec(m[2])?.[1]
    derived.set(m[1], {
      repoCall,
      sourceTables: sources == null ? [] : [...sources.matchAll(/['"]([a-z_]+)['"]/g)].map(x => x[1]),
    })
  }
  for (const key of [...keysOf('DERIVED_DOMAINS')].sort()) {
    if (!derived.has(key)) problems.push(`  ${key} — DERIVED_DOMAINS entry must be on one line as { repoCall, sourceTables, reason }`)
  }
  const repoCalls = new Set([...fullExport.matchAll(/\brepo\.(\w+)\s*\(/g)].map(m => m[1]))
  const declaredCalls = new Set([...derived.values()].map(d => d.repoCall))
  for (const call of [...repoCalls].sort()) {
    if (!declaredCalls.has(call)) {
      problems.push(`  repo.${call}() — called in full-export.ts but not declared in DERIVED_DOMAINS`)
    }
  }
  const literalDomains = new Set([...fullExport.matchAll(/\bdomain:\s*['"]([A-Za-z_]+)['"]/g)].map(m => m[1]))
  literalDomains.delete('_manifest')
  for (const domain of [...literalDomains].sort()) {
    if (!derived.has(domain)) {
      problems.push(`  ${domain} — written as a domain in full-export.ts but not declared in DERIVED_DOMAINS`)
    }
  }
  for (const [domain, d] of [...derived].sort()) {
    if (!d.repoCall) problems.push(`  ${domain} — DERIVED_DOMAINS entry has no repoCall`)
    else if (!repoCalls.has(d.repoCall)) problems.push(`  ${domain} — DERIVED_DOMAINS names repo.${d.repoCall}() but full-export.ts no longer calls it`)
    if (d.sourceTables.length === 0) problems.push(`  ${domain} — DERIVED_DOMAINS entry names no sourceTables`)
    for (const t of d.sourceTables) {
      if (!exported.has(t)) problems.push(`  ${domain} — built from ${t}, which is not in EXPORTED`)
    }
    if (exported.has(domain) || excluded.has(domain)) problems.push(`  ${domain} — DERIVED_DOMAINS key collides with a table name`)
  }

  return {
    problems,
    summary: `${schemaTables.size} tables: ${exported.size} exported, ${excluded.size} excluded with a reason, `
      + `${softListed.size} soft-delete filtered, ${derived.size} derived line(s) declared.`,
  }
}

module.exports = { findProblems }

if (require.main === module) {
  const { problems, summary } = findProblems({
    schema: read('lib/data/postgres/schema.ts'),
    map: read('lib/export/export-map.ts'),
    fullExport: read('lib/export/full-export.ts'),
  })
  if (problems.length) {
    console.error('Export coverage (Q-288, #2427) — every table must be exported or excluded with a reason, and every non-table line declared:\n')
    console.error(problems.join('\n'))
    console.error('\nClassify it in EXPORTED (with a scope), EXCLUDED (with a written reason) or DERIVED_DOMAINS in lib/export/export-map.ts.')
    process.exit(1)
  }
  console.log(`Export coverage OK — ${summary}`)
}
