import { sql } from 'drizzle-orm'
import type { getDb } from '../client'
import { resolveClaudeRoOwner } from '../claude-ro-owner'

type Db = ReturnType<typeof getDb>
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/**
 * #2120 — deleting an account. The ONE write path: the user's own `DELETE /api/account` and the
 * admin console's `DELETE /api/admin/users` both reach it through `repo.deleteAccount`.
 *
 * **The schema's foreign keys decide what goes, not a list in this file.** Every table that holds a
 * user's data hangs off `users` through an `ON DELETE CASCADE` chain, so one `DELETE FROM users`
 * takes all of it — soft-deleted rows included, which matters because the export map deliberately
 * filters those out (`SOFT_DELETED`) and a deletion must not. Walking `export-map.ts` table by table
 * instead would have to re-derive the FK order Postgres already knows, and would still miss the
 * tables the export excludes but which plainly belong to the user (`oura_raw_samples`,
 * `applied_mutations`, `feedback_submissions`, `oura_tokens`, …). The export map is the test's
 * oracle instead: `account-deletion.test.ts` reads every `EXPORTED` scope back and requires zero rows.
 *
 * What the cascade cannot reach is the complement below, and the same test requires it to match
 * the live schema exactly — a table added outside the cascade fails the suite until it is classified
 * here. That is the "exhaustive by construction" property `export-map.ts` has, applied to deletion.
 *
 * One transaction. A failure anywhere rolls back everything, so a half-deleted account cannot
 * exist; the caller reports the failure and the account is exactly as it was.
 */
export const OUTSIDE_THE_CASCADE: Record<string, { disposition: 'anonymised' | 'purged' | 'not-user-data'; how: string }> = {
  // Owner, 2026-09-24: keep both, with the link to the person severed. Their FKs are SET NULL.
  ai_call_log: { disposition: 'anonymised', how: 'user_id SET NULL by its FK; token and latency counts stay' },
  error_events: { disposition: 'anonymised', how: 'user_id SET NULL by its FK; fault telemetry stays' },
  // A custom exercise is already in the catalogue every account reads, and other accounts' programs
  // and logs may name it. SET NULL by its FK (migration 202610060645).
  exercise_library: { disposition: 'anonymised', how: 'created_by SET NULL; the exercise stays in the shared catalogue' },
  // #2381. The record of what an agent did to their data must outlive them, and the table is
  // append-only (its trigger lets the FK unlink a row and nothing else). Holds no personal data.
  agent_action_log: { disposition: 'anonymised', how: 'target_user_id SET NULL by its FK; job, actor, approval link, times and counts stay' },

  // Owner, 2026-09-24: purged, because `sql_text` can carry the user's data and nulling a column
  // does not anonymise a payload. It has no user column, so "theirs" is defined below.
  db_query_log: { disposition: 'purged', how: 'every row when they are the claude_ro audit subject, else rows whose text names their id or email' },
  rate_limits: { disposition: 'purged', how: 'keys naming their id or email' },
  invited_emails: { disposition: 'purged', how: 'their own email address' },
  email_normalisation_preimage: { disposition: 'purged', how: 'rows recording their email address' },

  activity_types: { disposition: 'not-user-data', how: 'shipped catalogue' },
  dietary_restrictions: { disposition: 'not-user-data', how: 'shipped catalogue' },
  exercise_gif_cache: { disposition: 'not-user-data', how: 'media cache keyed by exercise name' },
  exercise_media: { disposition: 'not-user-data', how: 'shipped exercise media' },
  schema_migrations: { disposition: 'not-user-data', how: 'migration ledger' },
  seasons: { disposition: 'not-user-data', how: 'global season definitions' },
}

export interface AccountDeletionResult {
  /** False when no user row matched or the deletion was refused — nothing was changed. */
  deleted: boolean
  /** True when `onlyIfNoData` was set and the account holds data, so nothing was changed (issue 2695). */
  refusedHasData?: boolean
  /** Rows kept with the user unlinked. */
  anonymised: { aiCallLog: number; errorEvents: number; authoredExercises: number }
  /** Rows outside the cascade removed because they named this user. */
  purged: { dbQueryLog: number; rateLimits: number; invitedEmails: number; emailPreimage: number }
}

const NOT_FOUND: AccountDeletionResult = {
  deleted: false,
  anonymised: { aiCallLog: 0, errorEvents: 0, authoredExercises: 0 },
  purged: { dbQueryLog: 0, rateLimits: 0, invitedEmails: 0, emailPreimage: 0 },
}

/**
 * A heavy account cascades through hundreds of thousands of ring rows in ONE statement, and the
 * pool's 15 s `statement_timeout` is sized for request queries. `SET LOCAL` ends with the
 * transaction, so nothing else inherits it.
 */
const DELETION_STATEMENT_TIMEOUT = '120s'

const count = (r: { rowCount?: number | null; rows: unknown[] }) => r.rowCount ?? r.rows.length

/**
 * A regex matching `email` as a whole address inside free text, never as part of a longer one: a
 * substring test would let `a@b.co` purge rows about `ja@b.co` or `a@b.com`. The boundary class is
 * every character an address can contain. Only regex metacharacters are escaped — `@`, `-`, `_` and
 * `%` are literal outside a bracket expression.
 */
export function emailBoundaryPattern(email: string): string {
  const escaped = email.replace(/[.+*?^$()[\]{}|\\]/g, c => `\\${c}`)
  return `(^|[^a-z0-9._%+-])${escaped}($|[^a-z0-9._%+-])`
}

/**
 * Who the `claude_ro` audit views are scoped to. Read from the role setting the views actually use
 * as well as from the variables `bootstrapClaudeRoOwner` sets it from, because a setting written by
 * an earlier boot survives a later one with the variable unset. Either source naming the user is
 * enough: every `db_query_log` row is then a query over their data.
 */
async function auditSubjects(tx: Tx): Promise<Set<string>> {
  const subjects = new Set<string>()
  const fromEnv = resolveClaudeRoOwner()?.owner
  if (fromEnv) subjects.add(fromEnv.toLowerCase())
  const { rows } = await tx.execute<{ owner: string | null }>(sql`
    SELECT substr(c, length('app.claude_ro_owner=') + 1) AS owner
    FROM pg_db_role_setting s
    JOIN pg_roles r ON r.oid = s.setrole
    CROSS JOIN LATERAL unnest(s.setconfig) AS c
    WHERE r.rolname = 'claude_readonly' AND c LIKE 'app.claude_ro_owner=%'`)
  for (const r of rows) if (r.owner) subjects.add(r.owner.toLowerCase())
  return subjects
}

/**
 * issue 2695 — what a signup holds the moment it exists, which must not count as "data under the
 * account". `upsertUser` seeds every new user with progression styles and the built-in phase sets
 * (`is_default = true`); their child rows (`style_sets`, `program_phases`) hang off those two. These
 * are the only direct children of `users` a signup that never got in can have. `null` means the
 * whole table is seeded; a string is the condition that picks out rows the person made themselves.
 */
const SIGNUP_SEEDED_ROOTS = new Map<string, string | null>([
  ['progression_styles', null],
  ['phase_sets', 'is_default = false'],
])

/**
 * issue 2695 — which of these accounts hold data. "Data" is what `deleteAccount` removes through the
 * cascade: every table whose foreign key to `users` is `ON DELETE CASCADE`, read from the live
 * schema the way the deletion test reads it (`cascadeClosure`), so a table added later is covered
 * without touching a list here. A row in any deeper table implies a row in one of these direct
 * children, so checking the direct children is complete. Tables kept with the user unlinked
 * (`ON DELETE SET NULL`) are not data under the account. Fails closed: if the schema read finds no
 * cascade table at all it throws rather than answer "no data".
 */
export async function usersWithData(db: Db | Tx, userIds: readonly string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set()
  const { rows: fks } = await db.execute<{ tbl: string; col: string; bare: string }>(sql`
    SELECT format('%I', cl.relname) AS tbl, format('%I', a.attname) AS col, cl.relname::text AS bare
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_class pc ON pc.oid = con.confrelid
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
    WHERE con.contype = 'f' AND con.confdeltype = 'c' AND array_length(con.conkey, 1) = 1
      AND pc.relname = 'users' AND pc.relnamespace = 'public'::regnamespace
      AND cl.relnamespace = 'public'::regnamespace
    ORDER BY cl.relname`)
  if (fks.length === 0) throw new Error('usersWithData: no cascade foreign keys to users found')
  const ids = sql`ARRAY[${sql.join(userIds.map(u => sql`${u}`), sql`, `)}]::uuid[]`
  const parts = fks.flatMap(({ tbl, col, bare }) => {
    const seeded = SIGNUP_SEEDED_ROOTS.get(bare)
    if (seeded === null) return []
    // Identifiers come from the catalogue through format('%I'); the ids are bound parameters.
    const extra = seeded ? sql` AND ${sql.raw(seeded)}` : sql``
    return [sql`SELECT ${sql.raw(col)}::text AS uid FROM ${sql.raw(tbl)} WHERE ${sql.raw(col)} = ANY(${ids})${extra}`]
  })
  const { rows } = await db.execute<{ uid: string }>(sql`SELECT DISTINCT uid FROM (${sql.join(parts, sql` UNION ALL `)}) t`)
  return new Set(rows.map(r => r.uid))
}

export async function deleteAccount(
  db: Db,
  userId: string,
  opts: { auditSubjectIds?: readonly string[]; onlyIfNoData?: boolean } = {},
): Promise<AccountDeletionResult> {
  return db.transaction(async tx => {
    // The row lock serialises two deletions of the same account, and it makes every concurrent
    // write that references this user wait for the outcome: an FK insert takes KEY SHARE on the
    // users row, which FOR UPDATE blocks. When this commits, those writes fail on the FK rather
    // than recreating rows for an account that no longer exists.
    const { rows: [me] } = await tx.execute<{ email: string }>(sql`SELECT email FROM users WHERE id = ${userId} FOR UPDATE`)
    if (!me) return NOT_FOUND

    // issue 2695: checked AFTER the row lock, so a write that references this user is either already
    // visible here or waits for the outcome and then fails on the FK. The admin route sets this; a
    // person deleting their own account does not.
    if (opts.onlyIfNoData && (await usersWithData(tx, [userId])).has(userId)) {
      return { ...NOT_FOUND, refusedHasData: true }
    }

    await tx.execute(sql.raw(`SET LOCAL statement_timeout = '${DELETION_STATEMENT_TIMEOUT}'`))
    // The food FKs (migration 202610060645) are NO ACTION DEFERRABLE: checked at COMMIT, after the
    // cascade has removed both sides. A reference from ANOTHER account's row survives to COMMIT and
    // fails the whole deletion — closed, never by deleting their row.
    await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`)

    const id = userId.toLowerCase()
    const email = me.email.trim().toLowerCase()
    const subjects = opts.auditSubjectIds
      ? new Set(opts.auditSubjectIds.map(s => s.toLowerCase()))
      : await auditSubjects(tx)

    const { rows: [ai] } = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM ai_call_log WHERE user_id = ${userId}`)
    const { rows: [ee] } = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM error_events WHERE user_id = ${userId}`)
    const { rows: [ex] } = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM exercise_library WHERE created_by = ${userId}`)

    // An empty email would make the boundary pattern match nearly any text, so it matches nothing.
    const pattern = email.length > 0 ? emailBoundaryPattern(email) : null
    const names = (column: string) => {
      const col = sql.raw(`lower(coalesce(${column}, ''))`)
      return pattern
        ? sql`(strpos(${col}, ${id}) > 0 OR ${col} ~ ${pattern})`
        : sql`strpos(${col}, ${id}) > 0`
    }

    const dbQueryLog = await tx.execute(subjects.has(id)
      ? sql`DELETE FROM db_query_log`
      : sql`DELETE FROM db_query_log WHERE ${names('sql_text')} OR ${names('error')}`)
    const nothing = { rowCount: 0, rows: [] }
    const invitedEmails = email
      ? await tx.execute(sql`DELETE FROM invited_emails WHERE lower(trim(email)) = ${email}`)
      : nothing
    const emailPreimage = email
      ? await tx.execute(sql`
          DELETE FROM email_normalisation_preimage
          WHERE lower(trim(old_email)) = ${email} OR lower(trim(new_email)) = ${email}`)
      : nothing

    const gone = await tx.execute(sql`DELETE FROM users WHERE id = ${userId} RETURNING id`)
    if (count(gone) !== 1) throw new Error(`account deletion: expected to delete 1 users row, deleted ${count(gone)}`)

    // Last, so the window in which a concurrent request can write a fresh key for this user is as
    // short as this transaction allows. The route also waits for its own limiter write first. A key
    // that still lands afterwards ages out in the limiter's own two-day prune.
    const rateLimits = await tx.execute(sql`DELETE FROM rate_limits WHERE ${names('key')}`)

    return {
      deleted: true,
      anonymised: { aiCallLog: ai.n, errorEvents: ee.n, authoredExercises: ex.n },
      purged: {
        dbQueryLog: count(dbQueryLog),
        rateLimits: count(rateLimits),
        invitedEmails: count(invitedEmails),
        emailPreimage: count(emailPreimage),
      },
    }
  })
}
