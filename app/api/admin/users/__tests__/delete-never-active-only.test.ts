import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// issue 2695 — an admin may delete only a signup that never got in. "Has data" is read from the
// tables the account-deletion cascade walks, so this test seeds a real row in one of them and reads
// every outcome back from the database: a refusal that still deleted would pass a status-only test.
const ADMIN = '00000000-0000-4000-8000-0000002695a1'
const NEVER = '00000000-0000-4000-8000-0000002695b2'   // signup that never got in: only seeded defaults
const WAS_IN = '00000000-0000-4000-8000-0000002695c3'  // deactivated, owns a body metric
const PLAIN = '00000000-0000-4000-8000-0000002695d4'

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; isAdmin?: boolean } } }))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => session.current) }))

const canRun = !!process.env.DATABASE_URL

const del = (userId: unknown) => new Request('http://localhost/api/admin/users', {
  method: 'DELETE',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ userId }),
})

describe.skipIf(!canRun)('DELETE /api/admin/users only deletes accounts with nothing under them (issue 2695)', () => {
  let pool: import('pg').Pool
  const exists = async (id: string) =>
    (await pool.query('SELECT 1 FROM users WHERE id = $1', [id])).rowCount === 1
  const ids = [ADMIN, NEVER, WAS_IN, PLAIN]

  async function cleanup() {
    await pool.query('DELETE FROM body_metrics WHERE user_id = ANY($1::uuid[])', [ids])
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids])
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await cleanup()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, is_admin, is_active) VALUES
         ($1, 'del-admin-2695@example.com', 'x', 'Australia/Brisbane', true,  true),
         ($2, 'del-never-2695@example.com', 'x', 'Australia/Brisbane', false, false),
         ($3, 'del-wasin-2695@example.com', 'x', 'Australia/Brisbane', false, false),
         ($4, 'del-plain-2695@example.com', 'x', 'Australia/Brisbane', false, true)`,
      [ADMIN, NEVER, WAS_IN, PLAIN])
    // What `upsertUser` gives every signup, so "never got in" is tested with the seed present.
    const { randomUUID } = await import('node:crypto')
    for (const uid of [NEVER, WAS_IN]) {
      const style = randomUUID()
      await pool.query('INSERT INTO progression_styles (id, user_id, name) VALUES ($1, $2, $3)', [style, uid, 'Hypertrophy'])
      await pool.query('INSERT INTO phase_sets (id, user_id, name, is_default) VALUES ($1, $2, $3, true)', [randomUUID(), uid, 'Baselining'])
    }
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'body_metrics' AND is_nullable = 'NO' AND column_default IS NULL`)
    const cols = rows.map(r => r.column_name as string).filter(c => c !== 'user_id')
    // The generic non-null values the other account fixtures use are enough for this table.
    const values = cols.map(c => /date/.test(c) ? '2026-09-15' : /_at$/.test(c) ? new Date() : 1)
    await pool.query(
      `INSERT INTO body_metrics (user_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})`,
      [WAS_IN, ...values])
  })

  afterAll(async () => { await cleanup() })

  it('deletes a signup whose only rows are the seeded defaults', async () => {
    session.current = { user: { id: ADMIN, isAdmin: true } }
    const { DELETE } = await import('@/app/api/admin/users/route')
    const res = await DELETE(del(NEVER) as never)
    expect(res.status).toBe(200)
    expect(await exists(NEVER)).toBe(false)
  })

  it('409 with a plain message for an account that has data, and nothing is removed', async () => {
    session.current = { user: { id: ADMIN, isAdmin: true } }
    const { DELETE } = await import('@/app/api/admin/users/route')
    const res = await DELETE(del(WAS_IN) as never)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('This account has data under it, so it cannot be deleted here. Deactivate it instead.')
    expect(await exists(WAS_IN)).toBe(true)
    expect((await pool.query('SELECT 1 FROM body_metrics WHERE user_id = $1', [WAS_IN])).rowCount).toBe(1)
    expect((await pool.query('SELECT 1 FROM progression_styles WHERE user_id = $1', [WAS_IN])).rowCount).toBe(1)
  })

  it('an account with data is refused even when it is active', async () => {
    await pool.query('UPDATE users SET is_active = true WHERE id = $1', [WAS_IN])
    session.current = { user: { id: ADMIN, isAdmin: true } }
    const { DELETE } = await import('@/app/api/admin/users/route')
    expect((await DELETE(del(WAS_IN) as never)).status).toBe(409)
    expect(await exists(WAS_IN)).toBe(true)
  })

  it('self-delete is still refused (400), before the data check', async () => {
    session.current = { user: { id: ADMIN, isAdmin: true } }
    const { DELETE } = await import('@/app/api/admin/users/route')
    expect((await DELETE(del(ADMIN) as never)).status).toBe(400)
    expect(await exists(ADMIN)).toBe(true)
  })

  it('403 for a non-admin and nothing is deleted', async () => {
    session.current = { user: { id: PLAIN, isAdmin: true } }
    const { DELETE } = await import('@/app/api/admin/users/route')
    expect((await DELETE(del(WAS_IN) as never)).status).toBe(403)
    expect(await exists(WAS_IN)).toBe(true)
  })

  it('a real signup, as upsertUser creates it, holds no data and is deletable', async () => {
    const { getRepository } = await import('@/lib/data')
    const repo = await getRepository()
    const email = 'del-real-signup-2695@example.com'
    await pool.query('DELETE FROM users WHERE email = $1', [email])
    const u = await repo.upsertUser({ email, name: null, oauthSub: null } as never, false)
    expect(u.isActive).toBe(false)
    expect((await repo.usersWithData([u.id])).size).toBe(0)
    session.current = { user: { id: ADMIN, isAdmin: true } }
    const { DELETE } = await import('@/app/api/admin/users/route')
    expect((await DELETE(del(u.id) as never)).status).toBe(200)
    expect(await exists(u.id)).toBe(false)
  })

  it('GET marks hasData only on inactive users that have data', async () => {
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [WAS_IN])
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, is_active) VALUES ($1, 'del-never2-2695@example.com', 'x', 'Australia/Brisbane', false)
       ON CONFLICT (id) DO NOTHING`, [NEVER])
    session.current = { user: { id: ADMIN, isAdmin: true } }
    const { GET } = await import('@/app/api/admin/users/route')
    const res = await GET(new Request('http://localhost/api/admin/users?limit=200') as never)
    const { users } = await res.json() as { users: { id: string; hasData: boolean }[] }
    const by = (id: string) => users.find(u => u.id === id)
    expect(by(WAS_IN)?.hasData).toBe(true)
    expect(by(NEVER)?.hasData).toBe(false)
    expect(by(ADMIN)?.hasData).toBe(false)
  })
})
