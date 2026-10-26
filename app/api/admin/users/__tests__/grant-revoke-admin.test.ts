import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

// `PATCH /api/admin/users` grant-admin / revoke-admin (#3368). Nothing else sets `is_admin`, so this
// is the whole auth surface for it. Each outcome is read back from the database: a refusal that
// still wrote would pass a status-only test.
const OWNER = '00000000-0000-4000-8000-00000336800f'
const ADMIN = '00000000-0000-4000-8000-00000336801a'
const IDLE = '00000000-0000-4000-8000-0000033680d4'
const OTHER = '00000000-0000-4000-8000-00000336802b'
const PLAIN = '00000000-0000-4000-8000-00000336803c'
const UNKNOWN = '00000000-0000-4000-8000-00000336809f'

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; isAdmin?: boolean } } }))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => session.current) }))

const asUser = (id: string) => { session.current = { user: { id, isAdmin: true } } }

const canRun = !!process.env.DATABASE_URL

function patch(body: unknown) {
  return new Request('http://localhost/api/admin/users', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe.skipIf(!canRun)('PATCH /api/admin/users grant-admin and revoke-admin', () => {
  let pool: import('pg').Pool
  const isAdmin = async (id: string) =>
    (await pool.query<{ is_admin: boolean }>('SELECT is_admin FROM users WHERE id = $1', [id])).rows[0]?.is_admin

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[OWNER, ADMIN, OTHER, PLAIN, IDLE]])
    // The limiter keeps its counts in the database across runs; start this file's keys at zero.
    await pool.query(`DELETE FROM rate_limits WHERE key LIKE 'admin-users-patch:00000000-0000-4000-8000-0000033680%'`)
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, is_admin, is_active) VALUES
         ($1, 'grant-owner-3368@example.com', 'x', 'Australia/Brisbane', true,  true),
         ($2, 'grant-admin-3368@example.com', 'x', 'Australia/Brisbane', true,  true),
         ($3, 'grant-other-3368@example.com', 'x', 'Australia/Brisbane', false, true),
         ($4, 'grant-plain-3368@example.com', 'x', 'Australia/Brisbane', false, true),
         ($5, 'grant-idle-3368@example.com',  'x', 'Australia/Brisbane', false, false)`,
      [OWNER, ADMIN, OTHER, PLAIN, IDLE])
  })

  beforeEach(async () => {
    vi.stubEnv('CLAUDE_RO_OWNER_USER_ID', OWNER)
    await pool.query('UPDATE users SET is_admin = (id = ANY($1::uuid[])), is_active = (id <> $3) WHERE id = ANY($2::uuid[])',
      [[OWNER, ADMIN], [OWNER, ADMIN, OTHER, PLAIN, IDLE], IDLE])
    asUser(ADMIN)
  })

  afterAll(async () => {
    vi.unstubAllEnvs()
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[OWNER, ADMIN, OTHER, PLAIN, IDLE]])
  })

  it('an admin grants admin to another user, and the row changes', async () => {
    const { PATCH } = await import('@/app/api/admin/users/route')
    const res = await PATCH(patch({ userId: OTHER, action: 'grant-admin' }) as never)
    expect(res.status).toBe(200)
    expect(await isAdmin(OTHER)).toBe(true)
  })

  it('the owner revokes another admin, and the row changes', async () => {
    asUser(OWNER)
    await pool.query('UPDATE users SET is_admin = true WHERE id = $1', [OTHER])
    const { PATCH } = await import('@/app/api/admin/users/route')
    const res = await PATCH(patch({ userId: OTHER, action: 'revoke-admin' }) as never)
    expect(res.status).toBe(200)
    expect(await isAdmin(OTHER)).toBe(false)
  })

  it('refuses to revoke the signed-in admin, who stays admin', async () => {
    const { PATCH } = await import('@/app/api/admin/users/route')
    const res = await PATCH(patch({ userId: ADMIN, action: 'revoke-admin' }) as never)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Cannot remove admin from yourself' })
    expect(await isAdmin(ADMIN)).toBe(true)
  })

  it('the owner cannot remove their own admin either', async () => {
    asUser(OWNER)
    const { PATCH } = await import('@/app/api/admin/users/route')
    expect((await PATCH(patch({ userId: OWNER, action: 'revoke-admin' }) as never)).status).toBe(400)
    expect(await isAdmin(OWNER)).toBe(true)
  })

  it('a non-owner admin cannot revoke anyone, the owner included, and nothing changes', async () => {
    await pool.query('UPDATE users SET is_admin = true WHERE id = $1', [OTHER])
    const { PATCH } = await import('@/app/api/admin/users/route')
    for (const target of [OWNER, OTHER]) {
      const res = await PATCH(patch({ userId: target, action: 'revoke-admin' }) as never)
      expect(res.status).toBe(403)
    }
    expect(await isAdmin(OWNER)).toBe(true)
    expect(await isAdmin(OTHER)).toBe(true)
  })

  it('refuses every revoke when the owner cannot be resolved, the owner included', async () => {
    for (const k of ['CLAUDE_RO_OWNER_USER_ID', 'ADMIN_EXPORT_USER_ID', 'WEBHOOK_USER_ID']) vi.stubEnv(k, '')
    await pool.query('UPDATE users SET is_admin = true WHERE id = $1', [OTHER])
    asUser(OWNER)
    const { PATCH } = await import('@/app/api/admin/users/route')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await PATCH(patch({ userId: OTHER, action: 'revoke-admin' }) as never)
    expect(res.status).toBe(403)
    // A broken setting says so, instead of telling the owner they are not the owner.
    expect((await res.json()).error).toMatch(/not configured/)
    // One refusal, one warning: the owner lookup itself stays quiet.
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
    expect(await isAdmin(OTHER)).toBe(true)
  })

  it('a plain non-owner admin is told only the owner can remove admin', async () => {
    await pool.query('UPDATE users SET is_admin = true WHERE id = $1', [OTHER])
    asUser(OTHER)
    const { PATCH } = await import('@/app/api/admin/users/route')
    const res = await PATCH(patch({ userId: OWNER, action: 'revoke-admin' }) as never)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Only the owner can remove admin')
  })

  it('a malformed owner setting fails closed like an unset one', async () => {
    vi.stubEnv('CLAUDE_RO_OWNER_USER_ID', 'not-a-uuid')
    asUser(OWNER)
    await pool.query('UPDATE users SET is_admin = true WHERE id = $1', [OTHER])
    const { PATCH } = await import('@/app/api/admin/users/route')
    expect((await PATCH(patch({ userId: OTHER, action: 'revoke-admin' }) as never)).status).toBe(403)
  })

  it('an owner setting that names no user switches nothing off: a non-owner still cannot deactivate the real owner', async () => {
    vi.stubEnv('CLAUDE_RO_OWNER_USER_ID', UNKNOWN)
    const { PATCH } = await import('@/app/api/admin/users/route')
    const res = await PATCH(patch({ userId: OWNER, action: 'deactivate' }) as never)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/not configured/)
    const stillActive = (await pool.query<{ is_active: boolean }>('SELECT is_active FROM users WHERE id = $1', [OWNER])).rows[0]?.is_active
    expect(stillActive).toBe(true)
  })

  it('an owner setting that names a non-admin counts as unresolved', async () => {
    vi.stubEnv('CLAUDE_RO_OWNER_USER_ID', PLAIN)
    await pool.query('UPDATE users SET is_admin = true WHERE id = $1', [OTHER])
    const { PATCH } = await import('@/app/api/admin/users/route')
    expect((await PATCH(patch({ userId: OWNER, action: 'deactivate' }) as never)).status).toBe(403)
    expect((await PATCH(patch({ userId: OTHER, action: 'deactivate' }) as never)).status).toBe(403)
    expect(await isAdmin(OTHER)).toBe(true)
  })

  it('a demoted owner is still protected: another admin cannot deactivate them', async () => {
    await pool.query('UPDATE users SET is_admin = false WHERE id = $1', [OWNER])
    const { PATCH } = await import('@/app/api/admin/users/route')
    const res = await PATCH(patch({ userId: OWNER, action: 'deactivate' }) as never)
    expect(res.status).toBe(403)
    // The named owner is protected, and the message is the plain one: the setting is fine, the caller is not the owner.
    expect((await res.json()).error).toBe('Only the owner can deactivate this account')
    const stillActive = (await pool.query<{ is_active: boolean }>('SELECT is_active FROM users WHERE id = $1', [OWNER])).rows[0]?.is_active
    expect(stillActive).toBe(true)
  })

  it('an upper-case copy of your own id is still you: no self deactivation or self revoke', async () => {
    asUser(OWNER)
    const { PATCH } = await import('@/app/api/admin/users/route')
    for (const action of ['deactivate', 'revoke-admin']) {
      expect((await PATCH(patch({ userId: OWNER.toUpperCase(), action }) as never)).status).toBe(400)
    }
    const row = (await pool.query<{ is_active: boolean; is_admin: boolean }>('SELECT is_active, is_admin FROM users WHERE id = $1', [OWNER])).rows[0]
    expect(row).toEqual({ is_active: true, is_admin: true })
  })

  it('a non-owner admin cannot deactivate the owner; the owner can deactivate a non-owner admin', async () => {
    const { PATCH } = await import('@/app/api/admin/users/route')
    expect((await PATCH(patch({ userId: OWNER, action: 'deactivate' }) as never)).status).toBe(403)
    const active = async (id: string) =>
      (await pool.query<{ is_active: boolean }>('SELECT is_active FROM users WHERE id = $1', [id])).rows[0]?.is_active
    expect(await active(OWNER)).toBe(true)
    asUser(OWNER)
    expect((await PATCH(patch({ userId: ADMIN, action: 'deactivate' }) as never)).status).toBe(200)
    expect(await active(ADMIN)).toBe(false)
  })

  it('with no resolvable owner, no admin account can be deactivated', async () => {
    for (const k of ['CLAUDE_RO_OWNER_USER_ID', 'ADMIN_EXPORT_USER_ID', 'WEBHOOK_USER_ID']) vi.stubEnv(k, '')
    await pool.query('UPDATE users SET is_admin = true WHERE id = $1', [OTHER])
    const { PATCH } = await import('@/app/api/admin/users/route')
    expect((await PATCH(patch({ userId: OTHER, action: 'deactivate' }) as never)).status).toBe(403)
    expect((await PATCH(patch({ userId: PLAIN, action: 'deactivate' }) as never)).status).toBe(200)
  })

  it('a demoted admin loses the ability to act inside the transaction (the acting row is re-checked)', async () => {
    await pool.query('UPDATE users SET is_admin = false WHERE id = $1', [ADMIN])
    const { getRepository } = await import('@/lib/data')
    const repo = await getRepository()
    const out = await repo.setUserAdmin({ actingAdminId: ADMIN, targetUserId: OTHER, makeAdmin: true, ownerId: OWNER })
    expect(out).toEqual({ ok: false, reason: 'actor-not-admin' })
    expect(await isAdmin(OTHER)).toBe(false)
  })

  it('grant-admin needs an active target: 400, and nothing changes', async () => {
    const { PATCH } = await import('@/app/api/admin/users/route')
    const res = await PATCH(patch({ userId: IDLE, action: 'grant-admin' }) as never)
    expect(res.status).toBe(400)
    expect(await isAdmin(IDLE)).toBe(false)
  })

  it('grant and revoke each write one audit row in the same transaction, and a refusal writes none', async () => {
    const { PATCH } = await import('@/app/api/admin/users/route')
    // The log is append-only, so the test reads only what this test wrote.
    const since = (await pool.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0].now
    const rows = async () => (await pool.query<{ job: string; actor: string; target_user_id: string; outcome: string }>(
      `SELECT job, actor, target_user_id, outcome FROM agent_action_log
        WHERE target_user_id = $1 AND job IN ('admin-grant-admin','admin-revoke-admin') AND started_at >= $2
        ORDER BY started_at`, [OTHER, since])).rows
    expect((await PATCH(patch({ userId: OTHER, action: 'grant-admin' }) as never)).status).toBe(200)
    asUser(ADMIN)
    expect((await PATCH(patch({ userId: OTHER, action: 'revoke-admin' }) as never)).status).toBe(403)
    asUser(OWNER)
    expect((await PATCH(patch({ userId: OTHER, action: 'revoke-admin' }) as never)).status).toBe(200)
    expect(await rows()).toEqual([
      { job: 'admin-grant-admin', actor: `admin:${ADMIN}`, target_user_id: OTHER, outcome: 'succeeded' },
      { job: 'admin-revoke-admin', actor: `admin:${OWNER}`, target_user_id: OTHER, outcome: 'succeeded' },
    ])
  })

  it('a grant that changes nothing (already admin, or yourself) succeeds without an audit row', async () => {
    const { PATCH } = await import('@/app/api/admin/users/route')
    const since = (await pool.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0].now
    const audited = async () => (await pool.query(
      `SELECT 1 FROM agent_action_log WHERE job IN ('admin-grant-admin','admin-revoke-admin')
          AND target_user_id = ANY($1::uuid[]) AND started_at >= $2`, [[ADMIN, OWNER], since])).rows.length
    // ADMIN is already admin and grants themself; OWNER is already admin and ADMIN grants them.
    expect((await PATCH(patch({ userId: ADMIN, action: 'grant-admin' }) as never)).status).toBe(200)
    expect((await PATCH(patch({ userId: OWNER, action: 'grant-admin' }) as never)).status).toBe(200)
    expect(await isAdmin(ADMIN)).toBe(true)
    expect(await isAdmin(OWNER)).toBe(true)
    expect(await audited()).toBe(0)
  })

  it('429 once an admin exceeds the rate limit', async () => {
    const { PATCH } = await import('@/app/api/admin/users/route')
    await pool.query('UPDATE users SET is_admin = true WHERE id = $1', [OTHER])
    asUser(OTHER)   // its own limiter key, so the other tests' requests don't count
    let last = 0
    for (let i = 0; i < 40 && last !== 429; i++) {
      last = (await PATCH(patch({ userId: PLAIN, action: 'activate' }) as never)).status
    }
    expect(last).toBe(429)
  })

  it('403 for a non-admin, even with a stale isAdmin claim, and nothing changes', async () => {
    session.current = { user: { id: PLAIN, isAdmin: true } }
    const { PATCH } = await import('@/app/api/admin/users/route')
    const res = await PATCH(patch({ userId: PLAIN, action: 'grant-admin' }) as never)
    expect(res.status).toBe(403)
    expect(await isAdmin(PLAIN)).toBe(false)
  })

  it('401 without a session', async () => {
    session.current = null
    const { PATCH } = await import('@/app/api/admin/users/route')
    const res = await PATCH(patch({ userId: OTHER, action: 'grant-admin' }) as never)
    expect(res.status).toBe(401)
    expect(await isAdmin(OTHER)).toBe(false)
  })

  it('404 for an id that matches no user', async () => {
    const { PATCH } = await import('@/app/api/admin/users/route')
    expect((await PATCH(patch({ userId: UNKNOWN, action: 'grant-admin' }) as never)).status).toBe(404)
    asUser(OWNER)   // only the owner gets as far as the lookup on a revoke
    expect((await PATCH(patch({ userId: UNKNOWN, action: 'revoke-admin' }) as never)).status).toBe(404)
  })

  it('400 for an unknown action or a missing user id', async () => {
    const { PATCH } = await import('@/app/api/admin/users/route')
    expect((await PATCH(patch({ userId: OTHER, action: 'make-root' }) as never)).status).toBe(400)
    expect((await PATCH(patch({ action: 'grant-admin' }) as never)).status).toBe(400)
    expect(await isAdmin(OTHER)).toBe(false)
  })
})
