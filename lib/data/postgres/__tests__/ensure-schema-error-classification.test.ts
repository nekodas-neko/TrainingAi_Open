import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isIdempotentMigrationError } from '../client'
import sqlstates from '../idempotent-sqlstates.json'

/**
 * `ensureSchema` re-runs every migration that is not in `schema_migrations`, so on any live
 * database most of those attempts fail on purpose — the object is already there. Until Q-152 those
 * expected failures and a genuine one were printed by the same `console.warn` in the same format,
 * and the genuine one had been stepped over on every boot since the beginning.
 *
 * The real case, reproduced against the local database while writing this: `001_initial.sql`
 * declares `cardio_sessions.user_id TEXT REFERENCES users(id)`, and `002_users_uuid.sql` later
 * turned `users.id` into a `UUID`. Re-applying 001 to an already-migrated database therefore raises
 * **42804** (`datatype_mismatch`) — `foreign key constraint "cardio_sessions_user_id_fkey" cannot be
 * implemented` — which is not an idempotency notice and must not be filed as one.
 */

/** Shape of the errors `pg` raises — only `code` is consulted. */
function pgError(code: string | undefined, message: string): Error & { code?: string } {
  return Object.assign(new Error(message), code === undefined ? {} : { code })
}

describe('isIdempotentMigrationError', () => {
  it('treats re-declaring an existing object as benign', () => {
    const benign: [string, string][] = [
      ['42P07', 'relation "users_email_unique" already exists'],
      ['42710', 'constraint "x_pkey" already exists'],
      ['42701', 'column "source_map" of relation "body_metrics" already exists'],
      ['42P06', 'schema "claude_ro" already exists'],
      ['42723', 'function "touch_updated_at" already exists'],
      ['23505', 'duplicate key value violates unique constraint "exercise_library_name_key"'],
    ]
    for (const [code, message] of benign) {
      expect(isIdempotentMigrationError(pgError(code, message)), code).toBe(true)
    }
  })

  it('does NOT treat the real 001_initial.sql failure as benign', () => {
    const err = pgError(
      '42804',
      'foreign key constraint "cardio_sessions_user_id_fkey" cannot be implemented',
    )
    expect(isIdempotentMigrationError(err)).toBe(false)
  })

  it('does not treat other genuine failures as benign', () => {
    const real: [string, string][] = [
      ['42703', 'column "nope" does not exist'],
      ['42P01', 'relation "nope" does not exist'],
      ['23503', 'insert or update violates foreign key constraint'],
      ['57014', 'canceling statement due to statement timeout'],
      ['42601', 'syntax error at or near "CRATE"'],
    ]
    for (const [code, message] of real) {
      expect(isIdempotentMigrationError(pgError(code, message)), code).toBe(false)
    }
  })

  it('does not treat a codeless error as benign', () => {
    // A connection failure or a thrown string carries no SQLSTATE. Classifying the unknown as
    // benign is how the original bug read: anything that was not understood became a warn.
    expect(isIdempotentMigrationError(pgError(undefined, 'connection terminated'))).toBe(false)
    expect(isIdempotentMigrationError(null)).toBe(false)
    expect(isIdempotentMigrationError(undefined)).toBe(false)
    expect(isIdempotentMigrationError('boom')).toBe(false)
  })
})

/**
 * `scripts/local-db/migrate.js` is the other half of this: plain CommonJS, deliberately no ts-node,
 * and the runner the CI job named **Migration Check** invokes. Its docstring said it mirrored
 * `ensureSchema()` and it did not — it carried no classifier at all, so against a database that
 * already held the objects it called four already-applied migrations *failures*, while
 * `ensureSchema()` read the same four as benign (2026-08-20).
 *
 * The list now lives in one JSON file both read. These two cases are what stop someone re-inlining
 * a second copy of it, which is the only way the runners can disagree again.
 */
describe('the two migration runners classify by the same list', () => {
  const migrateJs = readFileSync(join(__dirname, '../../../../scripts/local-db/migrate.js'), 'utf8')

  it('the standalone runner reads the shared list rather than its own copy', () => {
    expect(migrateJs).toContain('idempotent-sqlstates.json')
    // A hardcoded SQLSTATE in that file would be a second source of truth by definition.
    expect(migrateJs).not.toMatch(/'[0-9][0-9A-Z]{4}'/)
  })

  it('every code in the shared list is one `isIdempotentMigrationError` accepts', () => {
    const codes = Object.keys(sqlstates.codes)
    expect(codes.length).toBeGreaterThan(0)
    for (const code of codes) {
      expect(isIdempotentMigrationError(Object.assign(new Error('x'), { code })), code).toBe(true)
    }
  })
})
