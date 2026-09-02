// BF-69 stage 1 — a day's exposure is an AMOUNT derived from CONTRIBUTIONS.
//
// The old `unique (supplement_id, log_date)` made a day hold exactly one row, which meant two
// doses on one day were last-writer-wins and `unlogSupplement` wiped the day whoever had written
// it. That is silent data loss the moment a second writer exists, and the meal attachment (stage 3)
// is that second writer. These tests are the assertions the plan names: contributions sum, a meal
// logged twice counts twice, and deleting one contribution leaves the other alone.
//
// Runs only against a local dev Postgres — skips in CI's "Tests" job.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000b569'
const DAY = '2026-08-24'

describe.skipIf(!canRun)('supplement contributions (BF-69)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').Repository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER, `bf69-${USER}@example.com`])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM supplements WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM supplements WHERE user_id = $1`, [USER])
  })

  const create = (over: Record<string, unknown> = {}) => repo.createSupplement(USER, {
    name: 'Creatine', dose: '5 g', defaultAmount: 5, unit: 'g',
    reminderEnabled: false, reminderTime: null, sortOrder: 0, active: true, ...over,
  })

  /** What the meal path (stage 3) will write. Inserted directly here because that path is Lane B's
   *  and does not exist yet — the schema half is what this PR is proving. */
  const addMealContribution = async (supplementId: string, amount: number, foodLogId: string) => {
    await pool.query(
      `INSERT INTO supplement_logs (supplement_id, user_id, log_date, amount, unit, dose_text, source, source_ref)
       VALUES ($1, $2, $3, $4, 'g', null, 'meal', $5)`,
      [supplementId, USER, DAY, amount, foodLogId])
  }

  const liveRows = async (supplementId: string) => {
    const { rows } = await pool.query(
      `SELECT amount, source, source_ref FROM supplement_logs
       WHERE supplement_id = $1 AND log_date = $2 AND deleted_at IS NULL
       ORDER BY source, amount`, [supplementId, DAY])
    return rows
  }

  it('a meal dose and a hand-logged dose are two rows, and the day sums them', async () => {
    const sup = await create()
    await repo.logSupplement(sup.id, USER, DAY)
    await addMealContribution(sup.id, 3, '00000000-0000-4000-8000-0000000f0001')

    expect(await liveRows(sup.id)).toHaveLength(2)
    const [today] = (await repo.listSupplements(USER, DAY)).filter(s => s.id === sup.id)
    expect(today.loggedAmount).toMatchObject({ amount: 8, unit: 'g', contributions: 2 })
  })

  // The case the old constraint made impossible, and the reason it had to go rather than be
  // replaced by a narrower one on (supplement_id, log_date, source).
  it('the same meal logged twice counts twice', async () => {
    const sup = await create()
    await addMealContribution(sup.id, 5, '00000000-0000-4000-8000-0000000f0002')
    await addMealContribution(sup.id, 5, '00000000-0000-4000-8000-0000000f0003')

    const [today] = (await repo.listSupplements(USER, DAY)).filter(s => s.id === sup.id)
    expect(today.loggedAmount).toMatchObject({ amount: 10, contributions: 2 })
  })

  // The deletion bug the contribution rows exist to fix. Under the old whole-day row, unticking on
  // the supplements page removed the meal's dose too.
  it('unticking removes only the manual contribution', async () => {
    const sup = await create()
    await repo.logSupplement(sup.id, USER, DAY)
    await addMealContribution(sup.id, 3, '00000000-0000-4000-8000-0000000f0004')

    await repo.unlogSupplement(sup.id, USER, DAY)

    const rows = await liveRows(sup.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ source: 'meal', amount: 3 })
    const [today] = (await repo.listSupplements(USER, DAY)).filter(s => s.id === sup.id)
    expect(today.loggedDose).toBeNull()
    expect(today.loggedAmount).toMatchObject({ amount: 3, contributions: 1 })
  })

  // `loggedToday` is the checked state of the page's tick, and that tick writes and removes exactly
  // the manual row. If a meal's dose turned it on, the control would render checked and then refuse
  // to turn off, because DELETE has no manual contribution to remove.
  it('a meal dose alone does not tick the checkbox, but does register on the day', async () => {
    const sup = await create()
    await addMealContribution(sup.id, 5, '00000000-0000-4000-8000-0000000f0006')

    const [today] = (await repo.listSupplements(USER, DAY)).filter(s => s.id === sup.id)
    expect(today.loggedToday).toBe(false)
    expect(today.loggedDose).toBeNull()
    expect(today.loggedAmount).toMatchObject({ amount: 5, contributions: 1 })
  })

  // The other half of the same invariant: the tick is still idempotent. Without the partial unique
  // index a double-tap, or an outbox mutation replayed after a retry, would record the dose twice.
  it('ticking twice records one manual contribution, not two', async () => {
    const sup = await create()
    await repo.logSupplement(sup.id, USER, DAY)
    await repo.logSupplement(sup.id, USER, DAY)

    expect(await liveRows(sup.id)).toHaveLength(1)
  })

  // A contribution with no amount is a TICK. Reporting it as 0 would be the "unknown coerced to
  // zero" mistake the presence model exists to prevent, one level down.
  it('a day of amount-less ticks reports no amount rather than zero', async () => {
    const sup = await create({ dose: null, defaultAmount: null, unit: null })
    await repo.logSupplement(sup.id, USER, DAY)

    const [today] = (await repo.listSupplements(USER, DAY)).filter(s => s.id === sup.id)
    expect(today.loggedToday).toBe(true)
    // The day HAS a contribution, so `loggedAmount` is present; what is absent is its number.
    expect(today.loggedAmount).toMatchObject({ amount: null, contributions: 1 })
  })

  describe('the presence window', () => {
    it('round-trips through create, patch and the sync delta', async () => {
      const sup = await create({ startedOn: '2026-08-01', dosePrompt: true })
      expect(sup.startedOn).toBe('2026-08-01')
      expect(sup.stoppedOn).toBeNull()
      expect(sup.dosePrompt).toBe(true)

      const patched = await repo.updateSupplement(sup.id, USER, { stoppedOn: '2026-08-30' })
      expect(patched.stoppedOn).toBe('2026-08-30')
      expect(patched.startedOn).toBe('2026-08-01')

      const delta = await repo.getSyncDelta(USER, new Date(0).toISOString())
      const row = (delta.supplements as Record<string, unknown>[]).find(r => r.id === sup.id)
      expect(row).toMatchObject({ startedOn: '2026-08-01', stoppedOn: '2026-08-30', dosePrompt: true })
    })

    it('reaches the sync delta on the log rows as source and sourceRef', async () => {
      const sup = await create()
      await repo.logSupplement(sup.id, USER, DAY)
      await addMealContribution(sup.id, 3, '00000000-0000-4000-8000-0000000f0005')

      const delta = await repo.getSyncDelta(USER, new Date(0).toISOString())
      const rows = (delta.supplementLogs as Record<string, unknown>[])
        .filter(r => r.supplementId === sup.id)
      expect(rows.map(r => r.source).sort()).toEqual(['manual', 'meal'])
      expect(rows.find(r => r.source === 'meal')!.sourceRef).toBe('00000000-0000-4000-8000-0000000f0005')
      expect(rows.find(r => r.source === 'manual')!.sourceRef).toBeNull()
    })
  })
})
