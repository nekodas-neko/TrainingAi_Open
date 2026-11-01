// #3369 (e) — a write in flight during an admin reset either finishes first (and is wiped by it) or
// starts after it (and is refused). Nothing lands in the fresh account.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const U = '00000000-0000-4000-8000-0000003369a9'
const A = '00000000-0000-4000-8000-0000003369aa'
const email = (id: string) => `barrier-${id.slice(-4)}@example.com`

describe.skipIf(!canRun)('withUserWriteBarrier and a reset', () => {
  let pool: import('pg').Pool
  let barrier: typeof import('../user-write-barrier')
  let slice: typeof import('../slices/account-deletion')
  let db: ReturnType<typeof import('../client').getDb>

  const metrics = async () =>
    (await pool.query('SELECT count(*)::int AS n FROM body_metrics WHERE user_id = $1', [U])).rows[0].n as number
  const write = (date: string) =>
    pool.query(`INSERT INTO body_metrics (user_id, date, weight_kg) VALUES ($1, $2, 80)`, [U, date])
  const reset = () => slice.resetAccountData(db, U, {
    guard: { actingAdminId: A, ownerId: A, confirmEmail: email(U) },
    audit: { job: 'admin-reset-user-data', actor: `admin:${A}` },
    auditSubjectIds: [],
  } as never)

  beforeAll(async () => {
    const client = await import('../client')
    pool = client.getPool(); db = client.getDb()
    barrier = await import('../user-write-barrier')
    slice = await import('../slices/account-deletion')
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[U, A]])
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, is_admin, is_active) VALUES
         ($1, $3, 'x', 'Australia/Brisbane', false, true), ($2, $4, 'x', 'Australia/Brisbane', true, true)`,
      [U, A, email(U), email(A)])
  })
  afterAll(async () => { if (canRun) await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[U, A]]) })

  it('runs the write for a sign-in the account has no cut-off against', async () => {
    const out = await barrier.withUserWriteBarrier(U, Math.floor(Date.now() / 1000), async () => { await write('2026-09-01'); return 'done' })
    expect(out).toBe('done')
    expect(await metrics()).toBe(1)
  })

  it('a reset waits for a write already in flight, and wipes what it wrote', async () => {
    let release!: () => void
    const held = new Promise<void>(r => { release = r })
    let started!: () => void
    const inside = new Promise<void>(r => { started = r })
    const inflight = barrier.withUserWriteBarrier(U, Math.floor(Date.now() / 1000), async () => {
      await write('2026-09-02'); started(); await held; await write('2026-09-03'); return 'late'
    })
    await inside
    let resetDone = false
    const resetting = reset().then(r => { resetDone = true; return r })
    await new Promise(r => setTimeout(r, 400))
    expect(resetDone, 'the reset is queued behind the in-flight write').toBe(false)
    release()
    expect(await inflight).toBe('late')
    expect((await resetting).deleted).toBe(true)
    expect(await metrics(), 'both writes made before the reset commit are gone').toBe(0)
  })

  it('a write that starts after the reset, from a sign-in older than it, is refused and writes nothing', async () => {
    const before = Math.floor(Date.now() / 1000) - 3600
    const out = await barrier.withUserWriteBarrier(U, before, async () => { await write('2026-09-04'); return 'wrote' })
    expect(out).toBe(barrier.CUT_OFF)
    expect(await metrics()).toBe(0)
  })

  it('a sign-in after the reset is allowed', async () => {
    const out = await barrier.withUserWriteBarrier(U, Math.floor(Date.now() / 1000) + 5, async () => { await write('2026-09-05'); return 'ok' })
    expect(out).toBe('ok')
  })

  it('a user that does not exist is refused', async () => {
    expect(await barrier.withUserWriteBarrier('00000000-0000-4000-8000-0000003369ff', 1, async () => 'x')).toBe(barrier.CUT_OFF)
  })

  it('releases the lock and the connection when the write throws', async () => {
    await expect(barrier.withUserWriteBarrier(U, Math.floor(Date.now() / 1000) + 5, async () => { throw new Error('boom') })).rejects.toThrow('boom')
    // A reset can take the lock straight away, so the shared lock did not leak.
    const t0 = Date.now()
    await reset()
    expect(Date.now() - t0).toBeLessThan(5000)
  })
})
