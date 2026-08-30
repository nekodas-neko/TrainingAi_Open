// BF-3 gap 1 — the dose belongs on the LOG, or editing it rewrites history.
//
// `supplements.dose` is free text on the DEFINITION and `supplement_logs` carried no dose at all, so
// titrating 2 mg → 4 mg → 8 mg made every past log retroactively read 8 mg. For a drug whose entire
// clinical story is the escalation schedule, the escalation is exactly what was destroyed — and it
// could not be reconstructed, because nothing recorded it. The owner is about to start retatrutide,
// which is what made this the urgent half of the entry.
//
// The first test is the one that matters: log at one dose, change the dose, and check the old log
// still reads what it read. Everything else is the chain that has to carry it.
//
// Runs only against a local dev Postgres — skips in CI's "Tests" job.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000b503'
const OTHER = '00000000-0000-4000-8000-00000000b504'

describe.skipIf(!canRun)('the dose is stamped on the log (BF-3)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').Repository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    for (const id of [USER, OTHER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `bf3-${id}@example.com`])
    }
  })

  afterAll(async () => {
    if (!canRun) return
    for (const id of [USER, OTHER]) {
      await pool.query(`DELETE FROM supplements WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM users WHERE id = $1`, [id])
    }
  })

  beforeEach(async () => {
    for (const id of [USER, OTHER]) await pool.query(`DELETE FROM supplements WHERE user_id = $1`, [id])
  })

  const create = (over: Record<string, unknown> = {}, userId = USER) => repo.createSupplement(userId, {
    name: 'Retatrutide', dose: '2 mg', reminderEnabled: false, reminderTime: null,
    sortOrder: 0, active: true, ...over,
  })

  const logRow = async (supplementId: string, date: string) => {
    const { rows } = await pool.query(
      `SELECT amount, unit, dose_text FROM supplement_logs WHERE supplement_id = $1 AND log_date = $2`,
      [supplementId, date])
    return rows[0]
  }

  // The entry's own definition of done, and the reason it was urgent.
  it('a titration does not rewrite what earlier logs say', async () => {
    const sup = await create({ dose: '2 mg', defaultAmount: 2, unit: 'mg' })
    await repo.logSupplement(sup.id, USER, '2026-08-24')
    await repo.logSupplement(sup.id, USER, '2026-08-31')

    // The dose goes up. Under the old model this alone changed both logs.
    await repo.updateSupplement(sup.id, USER, { dose: '4 mg', defaultAmount: 4 })
    await repo.logSupplement(sup.id, USER, '2026-09-07')

    expect(await logRow(sup.id, '2026-08-24')).toMatchObject({ amount: 2, unit: 'mg', dose_text: '2 mg' })
    expect(await logRow(sup.id, '2026-08-31')).toMatchObject({ amount: 2, unit: 'mg', dose_text: '2 mg' })
    expect(await logRow(sup.id, '2026-09-07')).toMatchObject({ amount: 4, unit: 'mg', dose_text: '4 mg' })
  })

  // The half that makes this work today rather than after a data-entry chore: every existing
  // supplement has only free text, so `dose_text` is what freezes their history with no UI change.
  it('freezes a free-text dose, for the supplements that have only one', async () => {
    const sup = await create({ dose: '1 scoop', defaultAmount: null, unit: null })
    await repo.logSupplement(sup.id, USER, '2026-08-24')
    await repo.updateSupplement(sup.id, USER, { dose: '2 scoops' })

    expect(await logRow(sup.id, '2026-08-24')).toMatchObject({ amount: null, unit: null, dose_text: '1 scoop' })
  })

  it('takes an explicit dose over the definition’s', async () => {
    const sup = await create({ dose: '2 mg', defaultAmount: 2, unit: 'mg' })
    // What a mutation queued before a titration replays as.
    await repo.logSupplement(sup.id, USER, '2026-08-24', { amount: 1.5, unit: 'mg', doseText: '1.5 mg' })
    expect(await logRow(sup.id, '2026-08-24')).toMatchObject({ amount: 1.5, dose_text: '1.5 mg' })
  })

  it('stores nothing rather than guessing, for a supplement with no dose at all', async () => {
    const sup = await create({ dose: null, defaultAmount: null, unit: null })
    await repo.logSupplement(sup.id, USER, '2026-08-24')
    expect(await logRow(sup.id, '2026-08-24')).toMatchObject({ amount: null, unit: null, dose_text: null })
  })

  // Re-ticking the same day is one act of taking it, so the second value wins — a dose corrected
  // between the untick and the re-tick is the true one.
  it('re-stamps when the same day is logged again', async () => {
    const sup = await create({ dose: '2 mg', defaultAmount: 2, unit: 'mg' })
    await repo.logSupplement(sup.id, USER, '2026-08-24')
    await repo.unlogSupplement(sup.id, USER, '2026-08-24')
    await repo.updateSupplement(sup.id, USER, { dose: '4 mg', defaultAmount: 4 })
    await repo.logSupplement(sup.id, USER, '2026-08-24')

    expect(await logRow(sup.id, '2026-08-24')).toMatchObject({ amount: 4, dose_text: '4 mg' })
  })

  describe('what the screen reads', () => {
    it('reports the LOGGED dose, not the definition’s current one', async () => {
      const sup = await create({ dose: '2 mg', defaultAmount: 2, unit: 'mg' })
      await repo.logSupplement(sup.id, USER, '2026-08-24')
      await repo.updateSupplement(sup.id, USER, { dose: '4 mg', defaultAmount: 4 })

      const [row] = await repo.listSupplements(USER, '2026-08-24')
      expect(row.loggedToday).toBe(true)
      expect(row.loggedDose).toEqual({ amount: 2, unit: 'mg', doseText: '2 mg' })
      // …while the definition reads what you would take now. Both are true and they differ, which
      // is the distinction the whole entry rests on.
      expect(row.defaultAmount).toBe(4)
      expect(row.dose).toBe('4 mg')
    })

    it('has no logged dose on a day it was not taken', async () => {
      const sup = await create()
      await repo.logSupplement(sup.id, USER, '2026-08-24')
      const [row] = await repo.listSupplements(USER, '2026-08-25')
      expect(row.loggedToday).toBe(false)
      expect(row.loggedDose).toBeNull()
    })
  })

  describe('the chain', () => {
    it('carries the dose in the sync delta, on the log and the definition', async () => {
      const sup = await create({ dose: '2 mg', defaultAmount: 2, unit: 'mg' })
      await repo.logSupplement(sup.id, USER, '2026-08-24')

      const delta = await repo.getSyncDelta(USER, new Date(0))
      const def = (delta.supplements as { id: string; defaultAmount?: number; unit?: string }[]).find(r => r.id === sup.id)
      expect(def).toMatchObject({ defaultAmount: 2, unit: 'mg' })

      const log = (delta.supplementLogs as { supplementId: string; amount?: number; doseText?: string }[])
        .find(r => r.supplementId === sup.id)
      expect(log).toMatchObject({ amount: 2, doseText: '2 mg' })
    })

    // Where a new column on a synced table normally gets half-done, and the case the offline push
    // exists for: the device recorded 2 mg, the definition says 4 mg by the time it drains.
    it('stores what the pushed mutation recorded, not the definition’s dose now', async () => {
      const sup = await create({ dose: '4 mg', defaultAmount: 4, unit: 'mg' })
      const res = await repo.pushMutations(USER, [{
        id: 'm1', domain: 'supplement_logs', date: '2026-08-24',
        payload: { supplementId: sup.id, logDate: '2026-08-24', amount: 2, unit: 'mg', doseText: '2 mg' },
      }])
      expect(res.errors).toEqual([])
      expect(await logRow(sup.id, '2026-08-24')).toMatchObject({ amount: 2, dose_text: '2 mg' })
    })

    // An older client sends no dose, and must keep working.
    it('falls back to the definition for a push with no dose', async () => {
      const sup = await create({ dose: '4 mg', defaultAmount: 4, unit: 'mg' })
      const res = await repo.pushMutations(USER, [{
        id: 'm2', domain: 'supplement_logs', date: '2026-08-24',
        payload: { supplementId: sup.id, logDate: '2026-08-24' },
      }])
      expect(res.errors).toEqual([])
      expect(await logRow(sup.id, '2026-08-24')).toMatchObject({ amount: 4, dose_text: '4 mg' })
    })

    it('carries the structured dose through a pushed supplement definition', async () => {
      const { randomUUID } = await import('node:crypto')
      const id = randomUUID()
      const res = await repo.pushMutations(USER, [{
        id: 'm3', domain: 'supplements', date: '2026-08-24',
        payload: { id, name: 'Creatine', dose: '5 g', defaultAmount: 5, unit: 'g', sortOrder: 0, active: true },
      }])
      expect(res.errors).toEqual([])
      const [row] = await repo.listSupplements(USER, '2026-08-24')
      expect(row).toMatchObject({ name: 'Creatine', defaultAmount: 5, unit: 'g' })
    })
  })

  it("never stamps another user's definition", async () => {
    const mine = await create({ dose: '2 mg', defaultAmount: 2, unit: 'mg' })
    await create({ dose: '99 mg', defaultAmount: 99, unit: 'mg' }, OTHER)
    await expect(repo.logSupplement(mine.id, OTHER, '2026-08-24')).rejects.toThrow()
    await repo.logSupplement(mine.id, USER, '2026-08-24')
    expect(await logRow(mine.id, '2026-08-24')).toMatchObject({ amount: 2 })
  })
})
