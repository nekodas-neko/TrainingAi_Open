import { sql } from 'drizzle-orm'
import type { getDb } from '../client'
import { resolveClaudeRoOwner } from '../claude-ro-owner'

type Db = ReturnType<typeof getDb>

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

  // Owner, 2026-09-24: purged, because `sql_text` can carry the user's data and nulling a column
  // does not anonymise a payload. It has no user column, so "theirs" is defined below.
  db_query_log: { disposition: 'purged', how: 'every row when they are the claude_ro audit subject, else rows whose text names their id or email' },
  rate_limits: { disposition: 'purged', how: 'keys containing their id or email' },
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
  /** False when no user row matched — nothing was changed. */
  deleted: boolean
  /** Rows kept with the user unlinked. */
  anonymised: { aiCallLog: number; errorEvents: number; authoredExercises: number }
  /** Rows outside the cascade removed because they named this user. */
  purged: { dbQueryLog: number; rateLimits: number; invitedEmails: number; emailPreimage: number }
}

/**
 * A heavy account cascades through hundreds of thousands of ring rows in ONE statement, and the
 * pool's 15 s `statement_timeout` is sized for request queries. `SET LOCAL` ends with the
 * transaction, so nothing else inherits it.
 */
const DELETION_STATEMENT_TIMEOUT = '120s'

const count = (r: { rowCount?: number | null; rows: unknown[] }) => r.rowCount ?? r.rows.length

export async function deleteAccount(
  db: Db,
  userId: string,
  opts: { auditSubjectId?: string | null } = {},
): Promise<AccountDeletionResult> {
  const auditSubjectId = opts.auditSubjectId !== undefined ? opts.auditSubjectId : resolveClaudeRoOwner()?.owner ?? null
  const isAuditSubject = !!auditSubjectId && auditSubjectId.toLowerCase() === userId.toLowerCase()

  return db.transaction(async tx => {
    const none: AccountDeletionResult = {
      deleted: false,
      anonymised: { aiCallLog: 0, errorEvents: 0, authoredExercises: 0 },
      purged: { dbQueryLog: 0, rateLimits: 0, invitedEmails: 0, emailPreimage: 0 },
    }
    // The row lock also serialises two concurrent deletions of the same account.
    const { rows: [me] } = await tx.execute<{ email: string }>(sql`SELECT email FROM users WHERE id = ${userId} FOR UPDATE`)
    if (!me) return none

    await tx.execute(sql.raw(`SET LOCAL statement_timeout = '${DELETION_STATEMENT_TIMEOUT}'`))
    // The food FKs (migration 202610060645) are NO ACTION DEFERRABLE: checked at COMMIT, after the
    // cascade has removed both sides. A reference from ANOTHER account's row survives to COMMIT and
    // fails the whole deletion — closed, never by deleting their row.
    await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`)

    const email = me.email.trim().toLowerCase()
    const id = userId.toLowerCase()

    const { rows: [ai] } = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM ai_call_log WHERE user_id = ${userId}`)
    const { rows: [ee] } = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM error_events WHERE user_id = ${userId}`)
    const { rows: [ex] } = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM exercise_library WHERE created_by = ${userId}`)

    // `length(...) > 0` guards: strpos(x, '') is 1, so an empty needle would match every row.
    const names = (col: ReturnType<typeof sql.raw>) => sql`(
      strpos(lower(coalesce(${col}, '')), ${id}) > 0
      OR (length(${email}) > 0 AND strpos(lower(coalesce(${col}, '')), ${email}) > 0)
    )`
    const dbQueryLog = await tx.execute(isAuditSubject
      ? sql`DELETE FROM db_query_log`
      : sql`DELETE FROM db_query_log WHERE ${names(sql.raw('sql_text'))} OR ${names(sql.raw('error'))}`)
    const invitedEmails = await tx.execute(sql`DELETE FROM invited_emails WHERE lower(trim(email)) = ${email}`)
    const emailPreimage = await tx.execute(sql`
      DELETE FROM email_normalisation_preimage
      WHERE lower(trim(old_email)) = ${email} OR lower(trim(new_email)) = ${email}`)

    const gone = await tx.execute(sql`DELETE FROM users WHERE id = ${userId} RETURNING id`)
    if (count(gone) !== 1) throw new Error(`account deletion: expected to delete 1 users row, deleted ${count(gone)}`)

    // Last, so the window in which a concurrent request can write a fresh key for this user is as
    // short as this transaction allows. The route also waits for its own limiter write first.
    const rateLimits = await tx.execute(sql`DELETE FROM rate_limits WHERE ${names(sql.raw('key'))}`)

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
