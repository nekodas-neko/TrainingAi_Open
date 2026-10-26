import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

// `PATCH /api/admin/users` grant-admin / revoke-admin (#3368). Nothing else sets `is_admin`, so this
// is the whole auth surface for it. Each outcome is read back from the database: a refusal that
// still wrote would pass a status-only test.
const ADMIN = '00000000-0000-4000-8000-00000336801a'
const OTHER = '00000000-0000-4000-8000-00000336802b'
const PLAIN = '00000000-0000-4000-8000-00000336803c'
const UNKNOWN = '00000000-0000-4000-8000-00000336809f'

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; isAdmin?: boolean } } }))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => session.current) }))

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
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[ADMIN, OTHER, PLAIN]])
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, is_admin, is_active) VALUES
         ($1, 'grant-admin-3368@example.com', 'x', 'Australia/Brisbane', true,  true),
         ($2, 'grant-other-3368@example.com', 'x', 'Australia/Brisbane', false, true),
         ($3, 'grant-plain-3368@example.com', 'x', 'Australia/Brisbane', false, true)`,
      [ADMIN, OTHER, PLAIN])
  })

  beforeEach(async () => {
    await pool.query('UPDATE users SET is_admin = (id = $1) WHERE id = ANY($2::uuid[])', [ADMIN, [ADMIN, OTHER, PLAIN]])
    session.current = { user: { id: ADMIN, isAdmin: true } }
  })

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[ADMIN, OTHER, PLAIN]])
  })

  it('an admin grants admin to another user, and the row changes', async () => {
    const { PATCH } = await import('@/app/api/admin/users/route')
    const res = await PATCH(patch({ userId: OTHER, action: 'grant-admin' }) as never)
    expect(res.status).toBe(200)
    expect(await isAdmin(OTHER)).toBe(true)
  })

  it('an admin revokes another admin, and the row changes', async () => {
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
    expect((await PATCH(patch({ userId: UNKNOWN, action: 'revoke-admin' }) as never)).status).toBe(404)
  })

  it('400 for an unknown action or a missing user id', async () => {
    const { PATCH } = await import('@/app/api/admin/users/route')
    expect((await PATCH(patch({ userId: OTHER, action: 'make-root' }) as never)).status).toBe(400)
    expect((await PATCH(patch({ action: 'grant-admin' }) as never)).status).toBe(400)
    expect(await isAdmin(OTHER)).toBe(false)
  })
})
