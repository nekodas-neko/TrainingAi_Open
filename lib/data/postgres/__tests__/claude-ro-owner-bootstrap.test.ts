// Q-456's second half. The owner's user id left the committed views and became a runtime setting,
// which is fail-closed — an unconfigured role reads ZERO rows — and that is the right direction and
// a terrible thing to need a human for on every fresh database.
//
// This configures it at boot from the environment, so a deploy configures itself. These tests are
// the reason to trust that: an unconfigured role becomes configured, a wrong-shaped value is
// refused rather than interpolated into DDL, and an unset environment leaves the fail-closed state
// alone rather than guessing.
//
// Runs only against a real local dev Postgres — skips cleanly in CI.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const ROLE = 'claude_readonly'
const OWNER = 'e9703c9c-8afe-4bd8-9ac0-ebef5b687a14'

describe.skipIf(!canRun)('bootstrapClaudeRoOwner', () => {
  let pool: import('pg').Pool
  let bootstrapClaudeRoOwner: () => Promise<void>
  const env = { ...process.env }

  const setting = async () => {
    const { rows } = await pool.query(
      `SELECT s.setconfig FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
       WHERE r.rolname = $1`, [ROLE])
    return (rows[0]?.setconfig as string[] | undefined)
      ?.find(c => c.startsWith('app.claude_ro_owner='))?.split('=')[1]
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    ;({ bootstrapClaudeRoOwner } = await import('@/lib/data/postgres/claude-ro-owner'))
    await pool.query(`DROP ROLE IF EXISTS ${ROLE}`).catch(() => {})
    await pool.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD 'bootstrap_test_pw'`)
  })

  afterAll(async () => {
    await pool.query(`DROP ROLE IF EXISTS ${ROLE}`).catch(() => {})
    process.env = env
  })

  beforeEach(async () => {
    process.env = { ...env }
    delete process.env.CLAUDE_RO_OWNER_USER_ID
    delete process.env.ADMIN_EXPORT_USER_ID
    delete process.env.WEBHOOK_USER_ID
    await pool.query(`ALTER ROLE ${ROLE} RESET app.claude_ro_owner`)
  })

  it('configures an unconfigured role — the manual step this removes', async () => {
    expect(await setting()).toBeUndefined()
    process.env.CLAUDE_RO_OWNER_USER_ID = OWNER
    await bootstrapClaudeRoOwner()
    expect(await setting()).toBe(OWNER)
  })

  it('prefers the dedicated variable over the two it falls back to', async () => {
    // The fallbacks are the same person by construction, but the audit scope should be able to
    // differ from them without editing code.
    process.env.CLAUDE_RO_OWNER_USER_ID = OWNER
    process.env.ADMIN_EXPORT_USER_ID = '11111111-1111-1111-1111-111111111111'
    process.env.WEBHOOK_USER_ID = '22222222-2222-2222-2222-222222222222'
    await bootstrapClaudeRoOwner()
    expect(await setting()).toBe(OWNER)
  })

  it('falls back so an already-configured deployment needs nothing added', async () => {
    process.env.ADMIN_EXPORT_USER_ID = OWNER
    await bootstrapClaudeRoOwner()
    expect(await setting()).toBe(OWNER)

    await pool.query(`ALTER ROLE ${ROLE} RESET app.claude_ro_owner`)
    delete process.env.ADMIN_EXPORT_USER_ID
    process.env.WEBHOOK_USER_ID = OWNER
    await bootstrapClaudeRoOwner()
    expect(await setting()).toBe(OWNER)
  })

  it('leaves the role alone when nothing is configured — fail-closed, not guessed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await bootstrapClaudeRoOwner()
    expect(await setting()).toBeUndefined()
    // Announced rather than mysterious: a session reading an empty audit result needs to be able to
    // tell "unconfigured role" from "production is quiet".
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ZERO rows'))
    warn.mockRestore()
  })

  it('refuses a value that is not a uuid rather than interpolating it', async () => {
    // `ALTER ROLE … SET` takes no bind parameter, so this regex IS the safety boundary. The
    // injection attempt is the case that matters, not the typo.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const bad of ["not-a-uuid", "'; DROP ROLE claude_readonly; --", '', '  ']) {
      process.env.CLAUDE_RO_OWNER_USER_ID = bad
      await bootstrapClaudeRoOwner()
      expect(await setting(), `accepted ${JSON.stringify(bad)}`).toBeUndefined()
    }
    // And the role it was asked to drop is still there.
    const { rows } = await pool.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [ROLE])
    expect(rows).toHaveLength(1)
    error.mockRestore()
  })

  it('is quiet when the setting is already correct', async () => {
    process.env.CLAUDE_RO_OWNER_USER_ID = OWNER
    await bootstrapClaudeRoOwner()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    await bootstrapClaudeRoOwner()          // second boot, nothing changed
    expect(info).not.toHaveBeenCalled()
    expect(await setting()).toBe(OWNER)
    info.mockRestore()
  })
})
