// Issue 2236: the backfill of `oura_daytime_stress_buckets` over stored history.
//
// Real Postgres, end to end through `repo.backfillDaytimeStressBuckets`: seeded raw frames (hot
// tier, decoded JSONB), a clock anchor, nightly summaries, a fitted daytime-HRV model. What this
// proves: a dry run writes nothing; a write adds the missing days and only those; a populated day
// is left exactly as it is; a second run adds nothing; a day with no raw data is reported, not
// guessed; a planned/written mismatch rolls the whole transaction back; the raw archive is never
// touched; another user's rows are neither read nor written.
//
// NOT exercised: the real model constants (the ones injected here are a synthetic fixture, so the
// LEVELS are not the production levels), real history, the job slot (see oura-redecode-job.test.ts)
// or the worker. Runs only against a real local dev Postgres, skips in CI.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000002236'
const OTHER = '00000000-0000-4000-8000-000000002237'
const TZ = 'Australia/Brisbane' // +10:00 all year, so a local day is exactly 24 h
const MODEL = { intercept: 3.5, hrCoef: -0.01, tempCoef: 0, residualStd: 0.3, nSamples: 100 }

// One clock anchor: ds ANCHOR_DS is 2026-10-01T00:00Z. ms(ds) = ANCHOR_MS + (ds - ANCHOR_DS) * 100.
const ANCHOR_DS = 100_000_000
const ANCHOR_MS = Date.parse('2026-10-01T00:00:00Z')
const dsOf = (ms: number) => ANCHOR_DS + (ms - ANCHOR_MS) / 100

/** Local-day start for a YYYY-MM-DD in Brisbane (UTC+10). */
const dayStartMs = (day: string) => Date.parse(`${day}T00:00:00+10:00`)
const DAYS = ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14']
const BUCKETS_PER_DAY = 24 // 08:00-20:00 local, one set of frames per 30-minute bucket

describe.skipIf(!canRun)('stress bucket backfill (issue 2236)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let oura: typeof import('@/lib/data/postgres/slices/oura')
  let stress: typeof import('@/lib/health/daytime-stress')

  const countBuckets = async (user = USER, day?: string) =>
    (await pool.query(
      `SELECT count(*)::int n FROM oura_daytime_stress_buckets WHERE user_id=$1 ${day ? 'AND day=$2' : ''}`,
      day ? [user, day] : [user])).rows[0].n as number
  const countRaw = async () =>
    (await pool.query(`SELECT count(*)::int n FROM oura_raw_samples WHERE user_id=$1`, [USER])).rows[0].n as number

  async function seedFrames(user: string, day: string) {
    const start = dayStartMs(day)
    const rows: unknown[][] = []
    for (let k = 0; k < BUCKETS_PER_DAY; k++) {
      const ms = start + 8 * 3_600_000 + k * 1_800_000 + 300_000
      const ds = dsOf(ms)
      const hr = 60 + (k % 6) * 4
      rows.push([user, ds, 0x46, `46:${ds}`, JSON.stringify({ temps_c: [33.1 + (k % 3) * 0.1] })])
      rows.push([user, ds + 1, 0x50, `50:${ds}`, JSON.stringify({ met: [1.0] })])
      rows.push([user, ds + 2, 0x80, `80:${ds}`, JSON.stringify({ hr_bpm: [hr] })])
    }
    for (const r of rows) {
      await pool.query(
        `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded)
         VALUES ($1,$2,$3,'x',$4,$5)`, r)
    }
  }
  const seedSummary = (user: string, day: string, hrv: number | null = 60, rhr: number | null = 52) =>
    pool.query(
      `INSERT INTO oura_daily_summary (user_id, date, hrv_avg_ms, rhr_low_bpm) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, date) DO NOTHING`, [user, day, hrv, rhr])

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = client.getPool(); db = client.getDb(); repo = await getRepository()
    oura = await import('@/lib/data/postgres/slices/oura')
    stress = await import('@/lib/health/daytime-stress')
    // Synthetic constants: enough for the scoring tail to run, NOT the vendor's tables.
    stress.setDaytimeStressConstants({
      targetLevelLimit: 0.5, scaledLevelLimit: 0.3, ringMetLimit: 1.8,
      stressSaturation: { limits: [40, 80], values: [8, 12] },
      recoverySaturation: { limits: [40, 80], values: [10, 14] },
    } as never)
    for (const id of [USER, OTHER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3) ON CONFLICT (id) DO NOTHING`,
        [id, `stressbf-${id}@example.com`, TZ])
    }
  })

  const reset = async () => {
    for (const t of ['oura_daytime_stress_buckets', 'oura_raw_samples', 'oura_daily_summary', 'oura_ble_clock_anchors', 'oura_daytime_hrv_model']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = ANY($1::uuid[])`, [[USER, OTHER]])
    }
    await pool.query(`INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc) VALUES ($1,$2,$3)`,
      [USER, ANCHOR_DS, new Date(ANCHOR_MS)])
    await pool.query(
      `INSERT INTO oura_daytime_hrv_model (user_id, intercept, hr_coef, temp_coef, residual_std, n_samples)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [USER, MODEL.intercept, MODEL.hrCoef, MODEL.tempCoef, MODEL.residualStd, MODEL.nSamples])
    for (const d of DAYS) { await seedFrames(USER, d); await seedSummary(USER, d) }
  }
  beforeEach(reset)

  afterAll(async () => {
    if (!canRun) return
    for (const t of ['oura_daytime_stress_buckets', 'oura_raw_samples', 'oura_daily_summary', 'oura_ble_clock_anchors', 'oura_daytime_hrv_model']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = ANY($1::uuid[])`, [[USER, OTHER]])
    }
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[USER, OTHER]])
  })

  it('a dry run reports the plan and writes nothing', async () => {
    const rawBefore = await countRaw()
    const r = await repo.backfillDaytimeStressBuckets(USER, TZ, { dryRun: true })
    expect(r.dryRun).toBe(true)
    expect(r.daysConsidered).toBe(DAYS.length)
    expect(r.daysToGain).toBe(DAYS.length)
    expect(r.bucketsToAdd).toBe(DAYS.length * BUCKETS_PER_DAY)
    expect(r.daysSkippedPopulated).toBe(0)
    expect(r.daysCannotCompute).toBe(0)
    expect(r.range).toEqual({ from: DAYS[0], to: DAYS[DAYS.length - 1] })
    expect(r.depth).toEqual({ from: DAYS[0], to: DAYS[DAYS.length - 1] })
    expect(r.gaining.every(g => g.buckets === BUCKETS_PER_DAY)).toBe(true)
    expect(r.bucketsWritten).toBe(0)
    expect(await countBuckets()).toBe(0)
    expect(await countRaw()).toBe(rawBefore)
  })

  it('a write adds the planned buckets, equal to the plan, and leaves the raw archive alone', async () => {
    const rawBefore = await countRaw()
    const plan = await repo.backfillDaytimeStressBuckets(USER, TZ, { dryRun: true })
    const r = await repo.backfillDaytimeStressBuckets(USER, TZ, { dryRun: false })
    expect(r.dryRun).toBe(false)
    expect(r.bucketsWritten).toBe(plan.bucketsToAdd)
    expect(await countBuckets()).toBe(plan.bucketsToAdd)
    for (const d of DAYS) expect(await countBuckets(USER, d)).toBe(BUCKETS_PER_DAY)
    expect(await countRaw()).toBe(rawBefore)
  })

  it('writes the same levels the series builder produces for that day (one definition of the series)', async () => {
    await repo.backfillDaytimeStressBuckets(USER, TZ, { dryRun: false })
    const day = DAYS[1]
    const start = dayStartMs(day)
    const temp: { tsMs: number; valueC: number }[] = []
    const met: { tsMs: number; value: number }[] = []
    const hr: { tsMs: number; bpm: number }[] = []
    for (let k = 0; k < BUCKETS_PER_DAY; k++) {
      const ms = start + 8 * 3_600_000 + k * 1_800_000 + 300_000
      temp.push({ tsMs: ms, valueC: 33.1 + (k % 3) * 0.1 })
      met.push({ tsMs: ms, value: 1.0 })
      hr.push({ tsMs: ms, bpm: 60 + (k % 6) * 4 })
    }
    const tempBaseline = temp.reduce((s, t) => s + t.valueC, 0) / temp.length
    const expected = stress.buildDaytimeStressSeriesFromModel(
      temp, met, hr, { ...MODEL, fittedAt: new Date() },
      { dhrvBaseline: 60, hrBaseline: 52, tempBaseline }, start, start + 86_400_000, [],
    )
    const stored = await oura.listDaytimeStressBuckets(db, USER, day, day)
    // Not vacuous: a full day of buckets, and the levels are not all one value.
    expect(expected).toHaveLength(BUCKETS_PER_DAY)
    expect(new Set(expected.map(e => e.stressLevel.toFixed(6))).size).toBeGreaterThan(1)
    expect(stored).toHaveLength(expected.length)
    stored.forEach((s, i) => {
      expect(s.bucketMid.getTime()).toBe(expected[i].t)
      expect(s.level).toBeCloseTo(expected[i].stressLevel, 9)
    })
  })

  it('skips a day that already has buckets and leaves its rows exactly as they were', async () => {
    const populated = DAYS[2]
    const keep = new Date(dayStartMs(populated) + 9 * 3_600_000 + 15 * 60_000)
    await oura.replaceDaytimeStressBuckets(db, USER, populated, [{ bucketMid: keep, level: 0.123 }])
    const r = await repo.backfillDaytimeStressBuckets(USER, TZ, { dryRun: false })
    expect(r.daysSkippedPopulated).toBe(1)
    expect(r.daysToGain).toBe(DAYS.length - 1)
    expect(r.gaining.map(g => g.day)).not.toContain(populated)
    const rows = await oura.listDaytimeStressBuckets(db, USER, populated, populated)
    expect(rows).toHaveLength(1)
    expect(rows[0].level).toBe(0.123)
    expect(rows[0].bucketMid.getTime()).toBe(keep.getTime())
    expect(await countBuckets()).toBe((DAYS.length - 1) * BUCKETS_PER_DAY + 1)
  })

  it('is idempotent: a second write adds nothing and changes nothing', async () => {
    await repo.backfillDaytimeStressBuckets(USER, TZ, { dryRun: false })
    const snapshot = (await pool.query(
      `SELECT bucket_mid, level, updated_at FROM oura_daytime_stress_buckets WHERE user_id=$1 ORDER BY bucket_mid`, [USER])).rows
    const again = await repo.backfillDaytimeStressBuckets(USER, TZ, { dryRun: false })
    expect(again.bucketsWritten).toBe(0)
    expect(again.bucketsToAdd).toBe(0)
    expect(again.daysToGain).toBe(0)
    expect(again.daysSkippedPopulated).toBe(DAYS.length)
    const after = (await pool.query(
      `SELECT bucket_mid, level, updated_at FROM oura_daytime_stress_buckets WHERE user_id=$1 ORDER BY bucket_mid`, [USER])).rows
    expect(after).toEqual(snapshot)
  })

  it('reports a day it cannot compute with the reason instead of guessing', async () => {
    await seedSummary(USER, '2026-09-08') // a night summary, but no raw frames at all that day
    await seedSummary(USER, '2026-09-09', null, null) // no HRV baseline and no resting HR
    await seedFrames(USER, '2026-09-09')
    const r = await repo.backfillDaytimeStressBuckets(USER, TZ, { dryRun: false })
    expect(r.cannotCompute).toEqual(expect.arrayContaining([
      { day: '2026-09-08', reason: 'no-raw-data' },
      { day: '2026-09-09', reason: 'no-night-hrv-baseline' },
    ]))
    expect(r.daysCannotCompute).toBe(2)
    expect(r.cannotComputeByReason).toEqual({ 'no-raw-data': 1, 'no-night-hrv-baseline': 1 })
    expect(await countBuckets(USER, '2026-09-08')).toBe(0)
    expect(await countBuckets(USER, '2026-09-09')).toBe(0)
    expect(r.daysToGain).toBe(DAYS.length)
  })

  it('reports every day as uncomputable when there is no fitted model', async () => {
    await pool.query(`DELETE FROM oura_daytime_hrv_model WHERE user_id=$1`, [USER])
    const r = await repo.backfillDaytimeStressBuckets(USER, TZ, { dryRun: false })
    expect(r.bucketsWritten).toBe(0)
    expect(r.cannotComputeByReason).toEqual({ 'no-daytime-hrv-model': DAYS.length })
    expect(await countBuckets()).toBe(0)
  })

  it('leaves today to the forward writer', async () => {
    const { todayInTz } = await import('@trainingai/shared/date-utils')
    await seedSummary(USER, todayInTz(TZ))
    const r = await repo.backfillDaytimeStressBuckets(USER, TZ, { dryRun: true })
    expect(r.daysSkippedNotComplete).toBe(1)
    expect(r.daysConsidered).toBe(DAYS.length)
  })

  it('never reads or writes another user: their populated days and frames do not count', async () => {
    await seedSummary(OTHER, DAYS[0])
    await oura.replaceDaytimeStressBuckets(db, OTHER, DAYS[0], [{ bucketMid: new Date(dayStartMs(DAYS[0]) + 36e5), level: 0.5 }])
    const r = await repo.backfillDaytimeStressBuckets(USER, TZ, { dryRun: false })
    expect(r.daysSkippedPopulated).toBe(0) // the other user's populated day is not this user's
    expect(r.daysToGain).toBe(DAYS.length)
    expect(await countBuckets(OTHER)).toBe(1)
  })

  it('rolls the whole transaction back when rows written differ from rows planned', async () => {
    const at = (i: number) => new Date(dayStartMs(DAYS[0]) + 9 * 3_600_000 + i * 1_800_000)
    // Three planned rows, two of them on one instant: the key accepts two, so written (2) != planned (3).
    const rows = [
      { day: DAYS[0], bucketMid: at(0), level: 0.1 },
      { day: DAYS[0], bucketMid: at(1), level: 0.2 },
      { day: DAYS[0], bucketMid: at(1), level: 0.3 },
    ]
    await expect(oura.addMissingDaytimeStressBuckets(db, USER, rows))
      .rejects.toBeInstanceOf(oura.StressBackfillCountMismatchError)
    expect(await countBuckets()).toBe(0)
  })

  it('never overwrites a bucket that appears between the plan and the write', async () => {
    const instant = new Date(dayStartMs(DAYS[0]) + 9 * 3_600_000 + 15 * 60_000)
    // A forward write landed this instant (filed under another day) after the plan was made.
    await oura.replaceDaytimeStressBuckets(db, USER, '2026-09-30', [{ bucketMid: instant, level: 0.9 }])
    await expect(oura.addMissingDaytimeStressBuckets(db, USER, [
      { day: DAYS[0], bucketMid: new Date(instant.getTime() + 1_800_000), level: 0.1 },
      { day: DAYS[0], bucketMid: instant, level: -0.5 },
    ])).rejects.toBeInstanceOf(oura.StressBackfillCountMismatchError)
    const kept = await oura.listDaytimeStressBuckets(db, USER, '2026-09-30', '2026-09-30')
    expect(kept).toHaveLength(1)
    expect(kept[0].level).toBe(0.9)
    expect(await countBuckets()).toBe(1) // the first row rolled back too
  })

  it('plans around an instant that is already stored under another day instead of failing', async () => {
    // The first planned bucket of the first day: 08:00-08:30 local, midpoint 08:15.
    const instant = new Date(dayStartMs(DAYS[0]) + 8 * 3_600_000 + 15 * 60_000)
    await oura.replaceDaytimeStressBuckets(db, USER, '2026-09-30', [{ bucketMid: instant, level: 0.9 }])
    const r = await repo.backfillDaytimeStressBuckets(USER, TZ, { dryRun: false })
    expect(r.bucketsAlreadyPresent).toBe(1)
    expect(r.bucketsWritten).toBe(DAYS.length * BUCKETS_PER_DAY - 1)
    const kept = await oura.listDaytimeStressBuckets(db, USER, '2026-09-30', '2026-09-30')
    expect(kept.map(k => k.level)).toEqual([0.9])
  })
})
