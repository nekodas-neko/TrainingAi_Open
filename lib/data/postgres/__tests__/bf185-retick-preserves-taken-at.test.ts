// BF-185 — un-ticking and re-ticking a dose must not rewrite the time it was taken.
//
// Measured on the owner's Retatrutide row 2026-09-20: one untick and re-tick moved `taken_at`
// 10:46:33 → 11:21:13, 35 minutes, on an injection that happened once. `created_at` did not move,
// so the row knew when it was first written and reported the last tap instead. Nothing on screen
// said so; the only way it was found was asking.
//
// It matters because BF-184 exists to correlate dose timing against overnight HR and HRV. A stamp
// that follows the last tap is the one field that analysis cannot tolerate drifting.
//
// This reverses a DOCUMENTED decision rather than fixing an oversight — the old comment argued the
// row is one act of taking it, so a dose corrected between the untick and the re-tick makes the
// second value true. That still holds for the DOSE, which still re-stamps, and the last test here
// is the control that pins it. It does not hold for the TIME, because "I mis-tapped" and "I took it
// just now" are the same two taps and the old rule silently assumed the second.
//
// Runs only against a local dev Postgres — skips in CI's "Tests" job.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000b185'

describe.skipIf(!canRun)('a re-tick keeps the time the dose was taken (BF-185)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER, `bf185-${USER}@example.com`])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM supplements WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM supplements WHERE user_id = $1`, [USER])
  })

  const create = () => repo.createSupplement(USER, {
    name: 'Retatrutide', dose: '2 mg', defaultAmount: 2, unit: 'mg',
    reminderEnabled: false, reminderTime: null, sortOrder: 0, active: true,
  })

  const stampOf = async (supplementId: string, date: string): Promise<Date | null> => {
    const { rows } = await pool.query(
      `SELECT taken_at FROM supplement_logs
       WHERE supplement_id = $1 AND log_date = $2 AND source = 'manual'`, [supplementId, date])
    return rows[0]?.taken_at ?? null
  }

  const DATE = '2026-09-20'

  // The entry's own verification step, and the whole point of the change.
  it('an untick and re-tick leaves the original stamp alone', async () => {
    const sup = await create()
    await repo.logSupplement(sup.id, USER, DATE)
    const first = await stampOf(sup.id, DATE)
    expect(first).toBeInstanceOf(Date)

    await repo.unlogSupplement(sup.id, USER, DATE)
    await repo.logSupplement(sup.id, USER, DATE)

    expect(await stampOf(sup.id, DATE)).toEqual(first)
  })

  // A re-tick with no untick in between — a double-tap, or a replayed outbox mutation. The old
  // code re-stamped here too, which is what made a retried push move the time.
  it('a plain re-log does not move the stamp either', async () => {
    const sup = await create()
    await repo.logSupplement(sup.id, USER, DATE)
    const first = await stampOf(sup.id, DATE)

    await repo.logSupplement(sup.id, USER, DATE)

    expect(await stampOf(sup.id, DATE)).toEqual(first)
  })

  // This is what leaves room for the editable control (the Lane B half, still owed) to say "I
  // dosed at a different time" deliberately. Without it, preserving would make a wrong stamp
  // permanently uncorrectable — which is the objection the entry raises against itself.
  it('a caller that STATES a time still wins over the stored one', async () => {
    const sup = await create()
    await repo.logSupplement(sup.id, USER, DATE)
    const first = await stampOf(sup.id, DATE)

    const corrected = new Date('2026-09-20T09:15:00.000Z')
    await repo.logSupplement(sup.id, USER, DATE, { takenAt: corrected.toISOString() })

    const after = await stampOf(sup.id, DATE)
    expect(after).toEqual(corrected)
    expect(after).not.toEqual(first)
  })

  // The COALESCE arm. Rows written before the column existed carry NULL, and "preserve what is
  // there" must not mean "pin NULL forever" — a re-tick is the one moment such a row can be filled.
  it('fills a stamp that is NULL rather than preserving the emptiness', async () => {
    const sup = await create()
    await repo.logSupplement(sup.id, USER, DATE)
    await pool.query(
      `UPDATE supplement_logs SET taken_at = NULL
       WHERE supplement_id = $1 AND log_date = $2 AND source = 'manual'`, [sup.id, DATE])
    expect(await stampOf(sup.id, DATE)).toBeNull()

    await repo.logSupplement(sup.id, USER, DATE)

    expect(await stampOf(sup.id, DATE)).toBeInstanceOf(Date)
  })

  // CONTROL — the half that must NOT change, asserted so the fix cannot be read as "re-ticking
  // stopped updating the row". The dose still re-stamps on a re-tick, which is the original
  // comment's reasoning and is still correct for a value the owner can genuinely have corrected
  // between the two taps. A version of this fix that froze the whole row would pass every test
  // above and fail this one.
  it('the DOSE still re-stamps on a re-tick, unlike the time', async () => {
    const sup = await create()
    await repo.logSupplement(sup.id, USER, DATE)
    const before = await stampOf(sup.id, DATE)

    await repo.updateSupplement(sup.id, USER, { dose: '4 mg', defaultAmount: 4 })
    await repo.logSupplement(sup.id, USER, DATE)

    const { rows } = await pool.query(
      `SELECT amount, taken_at FROM supplement_logs
       WHERE supplement_id = $1 AND log_date = $2 AND source = 'manual'`, [sup.id, DATE])
    expect(Number(rows[0].amount)).toBe(4)
    expect(rows[0].taken_at).toEqual(before)
  })
})
