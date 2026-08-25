#!/usr/bin/env node
/**
 * Generates the `claude_ro` view-schema migration — the read-only surface Claude sessions can query
 * (see docs/superpowers/plans/2026-07-26-claude-readonly-prod-db-access.md).
 *
 * The security model is DEFAULT-DENY: nothing is readable unless a view exists for it. Re-run this
 * after adding tables, and commit the regenerated migration:
 *
 *   CLAUDE_RO_OWNER_USER_ID=<uuid> node scripts/generate-claude-ro-views.js \\
 *     > lib/data/postgres/migrations/<NEXT-FREE-NUMBER>_claude_ro_views_<reason>.sql
 *
 * ALWAYS a NEW migration number — never overwrite an already-committed one. `ensureSchema` tracks
 * applied migrations by FILENAME, so editing a file that has already run in production means the
 * runner skips it and the change never takes effect (this exact mistake shipped once: the row-scoping
 * fix silently did nothing until it was re-issued as its own file).
 *
 * Reads the live local schema, so the generated views always match reality rather than a hand-kept
 * list that drifts. Requires the local dev DB (pnpm db:local).
 */
const { Client } = require('pg')

// Columns that must never leave the database. Verified against the live schema 2026-07-26 with a
// broad pattern scan (passw|secret|token|refresh|screenshot|credential|api_key|auth|endpoint|
// p256|salt|hash|cookie|session) rather than from memory — that scan is what caught
// oura_tokens.webhook_signing_key (and, until Q-285 deleted them, three push_subscriptions
// columns), which a hand-written
// list had missed. Re-run that scan when adding tables.
const DENY = {
  users: ['password_hash'],
  oura_tokens: ['personal_access_token', 'access_token', 'refresh_token', 'webhook_signing_key'],
  feedback_submissions: ['screenshot_data'],
  // Q-396. A base64 thumbnail has no audit value and every row carries one, so a SELECT * over this
  // view would return kilobytes per meal for nothing. The size stand-in below is strictly MORE
  // useful than the value: this feature's whole stated risk is the 16 KB cap slipping unnoticed —
  // nothing fails loudly, the outbox just gets slower — so a queryable byte count is the tripwire.
  saved_meals: ['image_data_uri'],
  // All three together ARE the Web Push credential — holding them lets anyone push to the device.
}

// Presence/size stand-ins for denied columns, so an audit can still answer "is a token configured?"
// or "how big is that screenshot?" without the value itself.
const DERIVED = {
  oura_tokens: [
    '(t.personal_access_token IS NOT NULL) AS has_pat',
    '(t.access_token IS NOT NULL) AS has_oauth_access',
    '(t.refresh_token IS NOT NULL) AS has_oauth_refresh',
    '(t.webhook_signing_key IS NOT NULL) AS has_webhook_key',
  ],
  feedback_submissions: ['octet_length(t.screenshot_data) AS screenshot_bytes'],
  saved_meals: ['octet_length(t.image_data_uri) AS image_bytes'],
}


// ── Row scoping ───────────────────────────────────────────────────────────────
// Every view is restricted to ONE user. The production database holds several real accounts with
// months of sleep/weight/food data, so an unscoped read surface would expose other people's health
// records — data they cannot consent to on the owner's behalf. Set CLAUDE_RO_OWNER_USER_ID to the
// user whose data the endpoint may read.
//
// Classification is exhaustive by construction: a table that is neither user-scoped, reachable via
// a documented FK path, explicitly global, nor explicitly denied makes the generator FAIL rather
// than silently emitting an unscoped view. That is the same default-deny posture as the column
// withholding — a new table cannot leak by being forgotten.
/**
 * The owner is resolved AT QUERY TIME, not baked in here (Q-456).
 *
 * `fe481797-…` — the owner's production `users.id` — used to be interpolated into every view, and
 * the generated SQL is committed. That put it in **18 tracked files**, and `CLAUDE.md` requires
 * re-running this generator into a new migration whenever a table is added, so the process
 * *re-published it on every schema change*. Invisible while the repo was private; permanent once it
 * was not.
 *
 * It is not a credential — `/api/admin/db-query` needs `CLAUDE_DB_QUERY_SECRET` **and**
 * `requireAdmin`, and no health data, email or name is exposed with it. What it is, is one half of a
 * pair: `WEBHOOK_USER_ID` and `ADMIN_EXPORT_USER_ID` resolve to a user id that is almost certainly
 * this one, so a leak of either secret no longer needs the id guessed.
 *
 * `current_setting` puts it where the role's password already lives — in the database, set
 * out-of-band, never in a committed file:
 *
 *     ALTER ROLE claude_readonly SET app.claude_ro_owner = '<uuid>';
 *
 * **Fail-closed by construction.** The two-argument form returns NULL when the setting is absent,
 * and `user_id = NULL` is never true, so an unconfigured role reads **zero rows** rather than every
 * user's. The one-argument form would throw instead; NULL was chosen because a session hitting the
 * audit endpoint on a fresh database should get an empty result it can diagnose, not a driver error
 * from inside a view.
 */
const OWNER_SQL = "current_setting('app.claude_ro_owner', true)::uuid"

// Still read, and still required — not for the SQL, but for the report line below and for the
// generator's own refusal to run unconfigured. Dropping the requirement would make it easy to
// generate views against a database whose role setting nobody has set, which produces a schema that
// silently returns nothing.
const OWNER = process.env.CLAUDE_RO_OWNER_USER_ID
if (!OWNER) {
  console.error('CLAUDE_RO_OWNER_USER_ID is required — refusing to generate unscoped views.')
  process.exit(1)
}

/** Tables owned transitively: predicate template joining up to a table that carries user_id. */
const VIA = {
  exercise_logs:          t => `EXISTS (SELECT 1 FROM public.workout_sessions p WHERE p.id = ${t}.workout_session_id AND p.user_id = $OWNER)`,
  set_logs:               t => `EXISTS (SELECT 1 FROM public.exercise_logs e JOIN public.workout_sessions p ON p.id = e.workout_session_id WHERE e.id = ${t}.exercise_log_id AND p.user_id = $OWNER)`,
  program_sessions:       t => `EXISTS (SELECT 1 FROM public.programs p WHERE p.id = ${t}.program_id AND p.user_id = $OWNER)`,
  // Scoped through phase_sets, NOT program_id. `program_id` is nullable (migration 024 made it so
  // deliberately) and the modern write path — createPhaseSet / updatePhaseSet, and the 042 seed —
  // inserts phases with only `phase_set_id`. A program_id-only predicate therefore hid EVERY phase
  // row, which is how a 2026-08-05 audit came to report "eight phase sets contain no phases" when
  // the table was fine. The program_id arm stays for any legacy row that still has one.
  program_phases:         t => `EXISTS (SELECT 1 FROM public.phase_sets ps WHERE ps.id = ${t}.phase_set_id AND ps.user_id = $OWNER)`
                              + ` OR EXISTS (SELECT 1 FROM public.programs p WHERE p.id = ${t}.program_id AND p.user_id = $OWNER)`,
  program_volume_targets: t => `EXISTS (SELECT 1 FROM public.programs p WHERE p.id = ${t}.program_id AND p.user_id = $OWNER)`,
  schedules:              t => `EXISTS (SELECT 1 FROM public.programs p WHERE p.id = ${t}.program_id AND p.user_id = $OWNER)`,
  schedule_days:          t => `EXISTS (SELECT 1 FROM public.schedules s JOIN public.programs p ON p.id = s.program_id WHERE s.id = ${t}.schedule_id AND p.user_id = $OWNER)`,
  session_exercises:      t => `EXISTS (SELECT 1 FROM public.program_sessions ps JOIN public.programs p ON p.id = ps.program_id WHERE ps.id = ${t}.session_id AND p.user_id = $OWNER)`,
  style_sets:             t => `EXISTS (SELECT 1 FROM public.progression_styles ps WHERE ps.id = ${t}.style_id AND ps.user_id = $OWNER)`,
  saved_meal_items:       t => `EXISTS (SELECT 1 FROM public.saved_meals sm WHERE sm.id = ${t}.saved_meal_id AND sm.user_id = $OWNER)`,
  // BF-11e. Scoped through the MEAL, not the meal type — both FKs lead to a user and either would
  // scope correctly, but a row is a fact about the meal, and matching `saved_meal_items` above keeps
  // one rule for the two tables that hang off `saved_meals`.
  saved_meal_meal_types:  t => `EXISTS (SELECT 1 FROM public.saved_meals sm WHERE sm.id = ${t}.saved_meal_id AND sm.user_id = $OWNER)`,
  // Meal Plan (Q-186). Variants hang off the plan, and meals off the variant — so the meal
  // predicate is two joins deep. That extra level is exactly where a scoping check gets skipped,
  // which is why it is written out here rather than left to the reader.
  meal_plan_variants:     t => `EXISTS (SELECT 1 FROM public.meal_plans mp WHERE mp.id = ${t}.meal_plan_id AND mp.user_id = $OWNER)`,
  meal_plan_meals:        t => `EXISTS (SELECT 1 FROM public.meal_plan_variants v JOIN public.meal_plans mp ON mp.id = v.meal_plan_id WHERE v.id = ${t}.variant_id AND mp.user_id = $OWNER)`,
  users:                  t => `${t}.id = $OWNER`,
  friendships:            t => `${t}.requester_id = $OWNER OR ${t}.addressee_id = $OWNER`,
}

/** Shared catalogue/operational tables that carry no personal health data — readable in full. */
const GLOBAL = new Set([
  'activity_types', 'exercise_library', 'exercise_media', 'exercise_gif_cache',
  'seasons', 'schema_migrations', 'db_query_log',
  // Seeded catalogue of selectable dietary restrictions — labels and synonyms, no personal data.
  // The per-user selections live in `user_dietary_restrictions`, which is user_id-scoped normally.
  'dietary_restrictions',
])

/** Third-party personal data with no audit value — no view is generated at all. */
const DENIED = new Set([
  'invited_emails', // other people's email addresses
  'rate_limits',    // keys embed other users' ids and request timing
])

async function main() {
  const client = new Client({
    connectionString: process.env.LOCAL_DATABASE_URL
      ?? 'postgresql://postgres:postgres@localhost:5433/trainingai_dev',
  })
  await client.connect()

  const { rows } = await client.query(`
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name, c.ordinal_position
  `)
  await client.end()

  const byTable = new Map()
  for (const r of rows) {
    if (!byTable.has(r.table_name)) byTable.set(r.table_name, [])
    byTable.get(r.table_name).push(r.column_name)
  }

  const out = []
  out.push('-- GENERATED by scripts/generate-claude-ro-views.js — do not hand-edit.')
  out.push('-- Read-only view surface for the claude_readonly role (default-deny: a table with no')
  out.push('-- view here is unreadable). Plan: docs/superpowers/plans/2026-07-26-claude-readonly-prod-db-access.md')
  out.push('')
  // Rebuild the schema from scratch every run. CREATE OR REPLACE VIEW leaves behind any view that
  // is no longer generated — so a table moved to DENIED, or a view whose scoping predicate changed
  // shape, would silently keep serving its OLD definition in production. Dropping first makes the
  // committed migration the whole truth. Grants are re-applied at the bottom.
  out.push('DROP SCHEMA IF EXISTS claude_ro CASCADE;')
  out.push('CREATE SCHEMA claude_ro;')
  out.push('')

  let denied = 0
  const skipped = []
  for (const [table, cols] of [...byTable].sort((a, b) => a[0].localeCompare(b[0]))) {
    const deny = DENY[table] ?? []
    const kept = cols.filter(c => !deny.includes(c))
    const derived = DERIVED[table] ?? []
    denied += deny.length

    if (DENIED.has(table)) { skipped.push(table); continue }

    // Exhaustive classification — an unclassified table fails the build rather than shipping
    // an unscoped view.
    const hasUserId = cols.includes('user_id')
    let where = null
    if (hasUserId) where = `t.user_id = ${OWNER_SQL}`
    else if (VIA[table]) where = VIA[table]('t').replace(/\$OWNER/g, OWNER_SQL)
    else if (!GLOBAL.has(table)) {
      console.error(`\nUNCLASSIFIED TABLE: "${table}" has no user_id, no VIA path, and is not in GLOBAL or DENIED.`)
      console.error('Add it to one of those lists in scripts/generate-claude-ro-views.js — refusing to emit an unscoped view.')
      process.exit(1)
    }

    const select = [...kept.map(c => `  t.${quote(c)}`), ...derived.map(d => `  ${d}`)].join(',\n')
    if (deny.length > 0) {
      out.push(`-- ${table}: withholding ${deny.map(d => `"${d}"`).join(', ')}`)
    }
    if (!where) out.push(`-- ${table}: shared reference data, not row-scoped`)
    out.push(
      `CREATE VIEW claude_ro.${quote(table)} AS\nSELECT\n${select}\nFROM public.${quote(table)} t` +
      (where ? `\nWHERE ${where};` : ';'),
    )
    out.push('')
  }

  // Q-530: the export drift gate reads these two at request time to prove no table/column was added
  // without regenerating this migration. Emitted from the SAME DENIED/DENY objects that built the
  // views above — one source, so the meta views cannot drift from what was actually withheld.
  out.push('-- Q-530: the tables this generator deliberately excludes (no view at all).')
  out.push('CREATE VIEW claude_ro._meta_excluded_tables AS')
  out.push('SELECT * FROM (VALUES')
  out.push([...DENIED].map(t => `  (${lit(t)})`).join(',\n'))
  out.push(') AS t(table_name);')
  out.push('')

  out.push('-- Q-530: every column withheld from an emitted view, so a drift check can be column-level.')
  out.push('CREATE VIEW claude_ro._meta_withheld_columns AS')
  const withheldRows = Object.entries(DENY).flatMap(([table, cols]) => cols.map(c => `  (${lit(table)}, ${lit(c)})`))
  out.push('SELECT * FROM (VALUES')
  out.push(withheldRows.join(',\n'))
  out.push(') AS t(table_name, column_name);')
  out.push('')

  // The role is created out-of-band by the owner (it carries a password, which must never live in a
  // committed migration). This migration runs on every cold start via ensureSchema, so the GRANT is
  // guarded: without the guard, a database where the owner has not created the role would fail the
  // migration and take the app down.
  out.push('DO $$')
  out.push('BEGIN')
  out.push("  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'claude_readonly') THEN")
  out.push("    EXECUTE 'GRANT USAGE ON SCHEMA claude_ro TO claude_readonly';")
  out.push("    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA claude_ro TO claude_readonly';")
  out.push("    EXECUTE 'ALTER ROLE claude_readonly SET search_path = claude_ro';")
  out.push('  END IF;')
  out.push('END $$;')

  process.stdout.write(out.join('\n') + '\n')
  process.stderr.write(`[claude-ro] ${byTable.size - skipped.length} views, ${denied} columns withheld, ` +
    `${skipped.length} tables denied (${skipped.join(', ')}), scoped to app.claude_ro_owner\n`)
  process.stderr.write(`[claude-ro] the id is NOT in the output — the role needs it set once, out of band:\n` +
    `           ALTER ROLE claude_readonly SET app.claude_ro_owner = '${OWNER}';\n`)
}

/** A safely-quoted SQL string literal. */
function lit(v) {
  return `'${String(v).replace(/'/g, "''")}'`
}

/** Quote an identifier only when it isn't a plain lowercase snake_case name. */
function quote(id) {
  return /^[a-z_][a-z0-9_]*$/.test(id) ? id : `"${id.replace(/"/g, '""')}"`
}

main().catch(err => { console.error(err); process.exit(1) })
