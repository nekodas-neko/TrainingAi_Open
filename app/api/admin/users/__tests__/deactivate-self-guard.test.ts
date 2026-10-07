import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

// #2383 item 3 — `PATCH /api/admin/users {action: 'deactivate'}` had no self-guard. Deactivation
// sends the user to `/pending` on their next request and only an admin can undo it, so the admin's
// own row was one tap from a lock-out. DELETE already refused "yourself"; PATCH now runs the same
// check, and refuses before anything is written. Every outcome is read back from the database,
// not from the status alone: a refusal that still wrote would pass a status-only test.
const ADMIN = '00000000-0000-4000-8000-00000238301a'
const OTHER = '00000000-0000-4000-8000-00000238302b'
const PLAIN = '00000000-0000-4000-8000-00000238303c'

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

describe.skipIf(!canRun)('PATCH /api/admin/users refuses to deactivate the signed-in admin', () => {
  let pool: import('pg').Pool
  const isActive = async (id: string) =>
    (await pool.query<{ is_active: boolean }>('SELECT is_active FROM users WHERE id = $1', [id])).rows[0]?.is_active

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[ADMIN, OTHER, PLAIN]])
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, is_admin, is_active) VALUES
         ($1, 'deact-admin-2383@example.com', 'x', 'Australia/Brisbane', true,  true),
         ($2, 'deact-other-2383@example.com', 'x', 'Australia/Brisbane', false, true),
         ($3, 'deact-plain-2383@example.com', 'x', 'Australia/Brisbane', false, true)`,
      [ADMIN, OTHER, PLAIN])
  })

  beforeEach(async () => {
    await pool.query('UPDATE users SET is_active = true WHERE id = ANY($1::uuid[])', [[ADMIN, OTHER, PLAIN]])
  })

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[ADMIN, OTHER, PLAIN]])
  })

  it('401 without a session, and nothing changes', async () => {
    session.current = null
    const { PATCH } = await import('@/app/api/admin/users/route')
    const res = await PATCH(patch({ userId: OTHER, action: 'deactivate' }) as never)
    expect(res.status).toBe(401)
    expect(await isActive(OTHER)).toBe(true)
  })

  it('403 for a signed-in user who is not an admin, even with a stale isAdmin claim', async () => {
    session.current = { user: { id: PLAIN, isAdmin: true } }
    const { PATCH } = await import('@/app/api/admin/users/route')
    const res = await PATCH(patch({ userId: OTHER, action: 'deactivate' }) as never)
    expect(res.status).toBe(403)
    expect(await isActive(OTHER)).toBe(true)
  })

  it('400 "Cannot deactivate yourself" for the admin\'s own id, and the row stays active', async () => {
    session.current = { user: { id: ADMIN, isAdmin: true } }
    const { PATCH } = await import('@/app/api/admin/users/route')
    const res = await PATCH(patch({ userId: ADMIN, action: 'deactivate' }) as never)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Cannot deactivate yourself' })
    expect(await isActive(ADMIN)).toBe(true)
  })

  it('the same shape DELETE has always answered for self, from the same helper', async () => {
    session.current = { user: { id: ADMIN, isAdmin: true } }
    const { DELETE } = await import('@/app/api/admin/users/route')
    const res = await DELETE(new Request('http://localhost/api/admin/users', {
      method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: ADMIN }),
    }) as never)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Cannot delete yourself' })
    expect(await isActive(ADMIN)).toBe(true)
  })

  it('activating yourself is not refused: it changes nothing a signed-in admin could lose', async () => {
    session.current = { user: { id: ADMIN, isAdmin: true } }
    const { PATCH } = await import('@/app/api/admin/users/route')
    const res = await PATCH(patch({ userId: ADMIN, action: 'activate' }) as never)
    expect(res.status).toBe(200)
    expect(await isActive(ADMIN)).toBe(true)
  })

  // The positive control: without it, a route that refused everything would pass the tests above.
  it('deactivates another user, and the write lands', async () => {
    session.current = { user: { id: ADMIN, isAdmin: true } }
    const { PATCH } = await import('@/app/api/admin/users/route')
    const res = await PATCH(patch({ userId: OTHER, action: 'deactivate' }) as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(await isActive(OTHER)).toBe(false)
    expect(await isActive(ADMIN)).toBe(true)
  })
})
