#!/usr/bin/env node
// A replayed schema must equal a freshly built one (issue 2629).
//
// CI's "Migrations are idempotent" step truncates `schema_migrations` and replays every file against
// the schema it just built. That catches a migration that THROWS the second time. It cannot catch
// one that quietly changes the schema: migration 280 does `ADD COLUMN IF NOT EXISTS vs_yesterday`,
// a later migration renames that column to `vs_normal`, and on replay 280 finds no `vs_yesterday`
// and adds a fresh, empty one. The replay reported 0 failed and left a column a fresh build does not
// have, which then leaked into a regenerated `claude_ro` view as an unrelated hunk.
//
// So the two schemas are compared. This script describes a database's schema as a sorted list of
// lines (columns, constraints, indexes, triggers, functions, views, enums, comments — public and
// claude_ro) and diffs two such lists. Row data is out of scope: seed rows are not schema.
//
//   node scripts/check-schema-replay-diff.js snapshot <file>      describe $DATABASE_URL into <file>
//   node scripts/check-schema-replay-diff.js compare <fresh> <replayed>
//
// Production is unaffected by what this finds: migrations are tracked by filename and never run
// twice there. The cost it removes is a green idempotency step over a schema a fresh build disagrees
// with, and a phantom column in anything generated from a replayed database.
'use strict';
const fs = require('fs');
const { Pool } = require('pg');
const { createHash } = require('crypto');

const SCHEMAS = ['public', 'claude_ro'];

// Each query returns one text column, `line`. They are sorted in JS, so the order Postgres returns
// rows in (and the column order a dropped-and-re-added column changes) cannot make two equal schemas
// differ.
const QUERIES = {
  column: `
    SELECT format('column %s.%s.%s %s%s%s%s', n.nspname, c.relname, a.attname,
             format_type(a.atttypid, a.atttypmod),
             CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END,
             COALESCE(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), ''),
             COALESCE(' COMMENT ' || quote_literal(col_description(c.oid, a.attnum)), '')) AS line
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attnum > 0 AND NOT a.attisdropped
       AND c.relkind IN ('r', 'p', 'v', 'm') AND n.nspname = ANY($1)`,
  table: `
    SELECT format('table %s.%s %s%s', n.nspname, c.relname, c.relkind,
             COALESCE(' COMMENT ' || quote_literal(obj_description(c.oid, 'pg_class')), '')) AS line
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p', 'v', 'm') AND n.nspname = ANY($1)`,
  constraint: `
    SELECT format('constraint %s.%s.%s %s', n.nspname, c.relname, k.conname, pg_get_constraintdef(k.oid)) AS line
      FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ANY($1)`,
  index: `
    SELECT format('index %s', indexdef) AS line FROM pg_indexes WHERE schemaname = ANY($1)`,
  trigger: `
    SELECT format('trigger %s.%s %s', n.nspname, c.relname, pg_get_triggerdef(t.oid)) AS line
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE NOT t.tgisinternal AND n.nspname = ANY($1)`,
  function: `
    SELECT format('function %s.%s(%s) md5=%s', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid),
             md5(pg_get_functiondef(p.oid))) AS line
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = ANY($1) AND p.prokind IN ('f', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')`,
  view: `
    SELECT format('view %s.%s md5=%s', schemaname, viewname, md5(definition)) AS line
      FROM pg_views WHERE schemaname = ANY($1)`,
  enum: `
    SELECT format('enum %s.%s [%s]', n.nspname, t.typname,
             string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)) AS line
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = ANY($1)
     GROUP BY n.nspname, t.typname`,
};

/** The schema of `databaseUrl` as sorted, de-duplicated description lines. */
async function describeSchema(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl })
  try {
    const lines = []
    for (const sql of Object.values(QUERIES)) {
      const { rows } = await pool.query(sql, [SCHEMAS])
      for (const r of rows) lines.push(String(r.line))
    }
    return [...new Set(lines)].sort()
  } finally {
    await pool.end()
  }
}

/** Lines only in `fresh` (`-`, a thing a replay lost) and only in `replayed` (`+`, a thing it added). */
function diffSchemas(fresh, replayed) {
  const f = new Set(fresh)
  const r = new Set(replayed)
  return {
    missingFromReplay: fresh.filter(l => !r.has(l)),
    addedByReplay: replayed.filter(l => !f.has(l)),
  }
}

function digest(lines) {
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 12)
}

module.exports = { describeSchema, diffSchemas, QUERIES, SCHEMAS }

if (require.main === module) {
  const [cmd, a, b] = process.argv.slice(2)
  const main = async () => {
    if (cmd === 'snapshot' && a) {
      if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
      const lines = await describeSchema(process.env.DATABASE_URL)
      fs.writeFileSync(a, lines.join('\n') + '\n')
      console.log(`check-schema-replay-diff: described ${lines.length} schema objects (${digest(lines)}) into ${a}`)
      return
    }
    if (cmd === 'compare' && a && b) {
      const read = p => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)
      const fresh = read(a)
      const replayed = read(b)
      // A comparison of two empty descriptions would pass and mean nothing.
      if (fresh.length < 100) throw new Error(`the fresh description has only ${fresh.length} objects — it did not describe the schema`)
      const { missingFromReplay, addedByReplay } = diffSchemas(fresh, replayed)
      if (missingFromReplay.length === 0 && addedByReplay.length === 0) {
        console.log(`check-schema-replay-diff: OK — a replayed schema equals a fresh build (${fresh.length} objects, ${digest(fresh)}).`)
        return
      }
      console.error('A replayed schema differs from a freshly built one: a migration changes the schema when run a second time.')
      console.error('Guard it so the second run is a no-op (see 280_day_checkin_vs_yesterday.sql for the shape).')
      for (const l of missingFromReplay) console.error(`  - only in the fresh build:  ${l}`)
      for (const l of addedByReplay) console.error(`  + only after the replay:    ${l}`)
      process.exit(1)
    }
    console.error('usage: check-schema-replay-diff.js snapshot <file> | compare <fresh> <replayed>')
    process.exit(2)
  }
  main().catch(err => { console.error(err); process.exit(1) })
}
