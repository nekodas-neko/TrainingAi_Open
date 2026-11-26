import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// #4141: the admin badge counts accounts waiting for a decision (inactive, nothing under them), the
// same split the console lists as "Pending approval". A deactivated account that has data is not
// counted; a fresh sign-up with only its seeded defaults is. Real rows through the repository.
const NEW_SIGNUP = '00000000-0000-4000-8000-00000414101a'
const DEACTIVATED = '00000000-0000-4000-8000-00000414102b'
const IDS = [NEW_SIGNUP, DEACTIVATED]
const canRun = !!process.env.DATABASE_URL

describe.skipIf(!canRun)('countPendingApprovalUsers (#4141)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const clean = async () => {
    await pool.query('DELETE FROM body_metrics WHERE user_id = ANY($1::uuid[])', [IDS])
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [IDS])
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await clean()
  })
  afterAll(async () => { await clean() })

  it('counts a sign-up with no data and skips a deactivated account that has data', async () => {
    const { randomUUID } = await import('node:crypto')
    const base = await repo.countPendingApprovalUsers()

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, is_admin, is_active) VALUES
         ($1, 'badge-new-4141@example.com', 'x', 'Australia/Brisbane', false, false),
         ($2, 'badge-off-4141@example.com', 'x', 'Australia/Brisbane', false, false)`,
      IDS)
    for (const uid of IDS) {
      await pool.query('INSERT INTO progression_styles (id, user_id, name) VALUES ($1, $2, $3)', [randomUUID(), uid, 'Hypertrophy'])
    }
    // Both inactive, both seeded; only the second has a row of its own.
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'body_metrics' AND is_nullable = 'NO' AND column_default IS NULL`)
    const cols = rows.map(r => r.column_name as string).filter(c => c !== 'user_id')
    const values = cols.map(c => /date/.test(c) ? '2026-09-15' : /_at$/.test(c) ? new Date() : 1)
    await pool.query(
      `INSERT INTO body_metrics (user_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})`,
      [DEACTIVATED, ...values])

    // Two inactive accounts added, one of them with data: the count rises by one, not two.
    expect(await repo.countPendingApprovalUsers()).toBe(base + 1)

    await pool.query('UPDATE users SET is_active = true WHERE id = $1', [NEW_SIGNUP])
    expect(await repo.countPendingApprovalUsers()).toBe(base)
  })

  it('answers the same as the console split (inactive minus usersWithData) in two statements, no ids inlined', async () => {
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, is_admin, is_active) VALUES
         ($1, 'badge-new-4141@example.com', 'x', 'Australia/Brisbane', false, false)
       ON CONFLICT (id) DO UPDATE SET is_active = false`, [NEW_SIGNUP])
    const { rows } = await pool.query('SELECT id::text AS id FROM users WHERE is_active = false')
    const ids = rows.map(r => r.id as string)
    const withData = await repo.usersWithData(ids)
    const expected = ids.filter(id => !withData.has(id)).length

    const seen: string[] = []
    const original = pool.query.bind(pool)
    ;(pool as unknown as { query: unknown }).query = (...args: unknown[]) => {
      const first = args[0] as { text?: string } | string
      seen.push(typeof first === 'string' ? first : first.text ?? '')
      return (original as (...a: unknown[]) => unknown)(...args)
    }
    let count: number
    try { count = await repo.countPendingApprovalUsers() } finally { (pool as unknown as { query: unknown }).query = original }

    expect(count).toBe(expected)
    expect(expected).toBeGreaterThan(0)
    expect(seen.length).toBe(2) // was 3: the inactive-id read, the schema read, the data union
    expect(seen.some(text => text.includes(NEW_SIGNUP))).toBe(false)
  })
})
