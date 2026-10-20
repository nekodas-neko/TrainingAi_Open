// #3079 — the statements behind re-scoring a night Oura changed, against a real Postgres.
//
// - `clearNightDerivedScores` nulls only the named pillar's columns, and says whether it changed a row;
// - `releaseBodyBatteryAnchor` un-freezes only a `readiness` anchor;
// - `oura_cloud_daily.updated_at` moves only when a written value changed, which is what the
//   training-stress re-check reads (`getOuraCloudMetChangedAt`);
// - `listOuraCloudConnectedUserIds` finds a live OAuth connection;
// - end to end: an Oura delete of today's night, bracketed by `withNightRescore`, clears the day's
//   stored sleep score and readiness.
//
// Fixtures are built from today's local date and anchored at local times inside the day (dates rule).
// Skips without DATABASE_URL.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { todayInTz, shiftDateStr, dateStrMidnightInTz } from '@trainingai/shared/date-utils'
import { encryptOuraToken } from '@/lib/oura/cloud/token-cipher'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003079'
const TZ = 'Australia/Brisbane'
const HOUR = 3_600_000

describe.skipIf(!canRun)('Oura late data re-scores its day (#3079)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const savedKey = process.env.OURA_TOKEN_KEY
  const today = todayInTz(TZ)

  beforeAll(async () => {
    process.env.OURA_TOKEN_KEY = 'k'.repeat(48)
    pool = (await import('@/lib/data/postgres/client')).getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3) ON CONFLICT (id) DO NOTHING`,
      [USER, 'issue-3079@example.com', TZ])
  })

  afterAll(async () => {
    process.env.OURA_TOKEN_KEY = savedKey
    if (canRun) await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    for (const t of ['oura_daily_derived', 'body_battery_daily', 'oura_cloud_daily', 'sleep_sessions', 'oura_cloud_sleep_periods', 'oura_tokens']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [USER])
    }
  })

  const derivedRow = async (day: string) =>
    (await pool.query(`SELECT sleep_score, sleep_contributors, readiness_score, readiness_contributors, activity_score, model_versions
                         FROM oura_daily_derived WHERE user_id = $1 AND day = $2`, [USER, day])).rows[0]

  it('clears only the named pillar, and reports whether it changed anything', async () => {
    await repo.upsertOuraDailyDerived(USER, today, {
      sleepScore: 80, sleepContributors: { efficiency: 90 }, readinessScore: 70, readinessContributors: { hrv: 1 }, activityScore: 60,
    })
    expect(await repo.clearNightDerivedScores(USER, today, { sleep: true, readiness: false })).toBe(true)
    let row = await derivedRow(today)
    expect(row.sleep_score).toBeNull()
    expect(row.sleep_contributors).toBeNull()
    expect(row.readiness_score).toBe(70)
    expect(row.activity_score).toBe(60)
    // Nothing left to clear: no change.
    expect(await repo.clearNightDerivedScores(USER, today, { sleep: true, readiness: false })).toBe(false)
    expect(await repo.clearNightDerivedScores(USER, today, { sleep: false, readiness: true })).toBe(true)
    row = await derivedRow(today)
    expect(row.readiness_score).toBeNull()
    expect(row.activity_score).toBe(60)
  })

  // #3086: the illness radar's fields are stored beside readiness from the same night, so they go
  // with it, and a day holding only them still counts as changed.
  it('clears the illness fields with readiness, never with sleep alone', async () => {
    const illness = { illnessFlag: 'elevated', illnessScore: 70, illnessBiomarkers: { rhr: { z: 2 } } }
    await repo.upsertOuraDailyDerived(USER, today, { sleepScore: 80, readinessScore: 60, ...illness })
    const flags = async () => (await pool.query(
      `SELECT illness_flag, illness_score, illness_biomarkers FROM oura_daily_derived WHERE user_id = $1 AND day = $2`, [USER, today])).rows[0]
    expect(await repo.clearNightDerivedScores(USER, today, { sleep: true, readiness: false })).toBe(true)
    expect(await flags()).toEqual({ illness_flag: 'elevated', illness_score: 70, illness_biomarkers: { rhr: { z: 2 } } })
    expect(await repo.clearNightDerivedScores(USER, today, { sleep: false, readiness: true })).toBe(true)
    expect(await flags()).toEqual({ illness_flag: null, illness_score: null, illness_biomarkers: null })

    await repo.upsertOuraDailyDerived(USER, today, illness)
    expect(await repo.clearNightDerivedScores(USER, today, { sleep: false, readiness: true })).toBe(true)
    expect((await flags()).illness_flag).toBeNull()
  })

  it('releases a readiness anchor and leaves a provisional one alone', async () => {
    const base = { anchor: 72, endValue: 50, dayMin: 40, dayMax: 72, totalCharged: 0, totalDrained: 22, restingHr: 52, hrMax: 180, hrMaxObserved: null, hrSampleCount: 300, modelVersion: 'v7' }
    await repo.upsertBodyBatteryDaily(USER, { ...base, date: today, anchorSource: 'readiness' })
    await repo.upsertBodyBatteryDaily(USER, { ...base, date: shiftDateStr(today, -1), anchorSource: 'sleep' })
    expect(await repo.releaseBodyBatteryAnchor(USER, today)).toBe(true)
    expect(await repo.releaseBodyBatteryAnchor(USER, shiftDateStr(today, -1))).toBe(false)
    const rows = (await pool.query(`SELECT date::text, anchor_source FROM body_battery_daily WHERE user_id = $1 ORDER BY date`, [USER])).rows
    expect(rows).toEqual([{ date: shiftDateStr(today, -1), anchor_source: 'sleep' }, { date: today, anchor_source: 'default' }])
  })

  it("moves oura_cloud_daily.updated_at only when a value changed, and reports MET's change", async () => {
    const day = shiftDateStr(today, -1)
    const met = { interval: 60, items: [1.1, 1.2, 1.3], timestamp: `${day}T04:00:00.000+10:00` }
    const stamp = async () => (await pool.query(`SELECT updated_at FROM oura_cloud_daily WHERE user_id = $1 AND date = $2`, [USER, day])).rows[0].updated_at as Date
    await repo.upsertOuraCloudDaily(USER, [{ date: day, met, class5Min: '111' }])
    const first = await stamp()
    await pool.query(`SELECT pg_sleep(0.05)`)
    await repo.upsertOuraCloudDaily(USER, [{ date: day, met, class5Min: '111' }])
    expect((await stamp()).getTime()).toBe(first.getTime())
    await repo.upsertOuraCloudDaily(USER, [{ date: day, met: { ...met, items: [1.1, 1.2, 2.4] }, class5Min: '111' }])
    const changed = await stamp()
    expect(changed.getTime()).toBeGreaterThan(first.getTime())
    expect(await repo.getOuraCloudMetChangedAt(USER, shiftDateStr(day, -1), day)).toEqual([{ date: day, changedAt: changed }])
  })

  it('lists a live OAuth connection', async () => {
    await repo.saveOuraCloudTokens(USER, {
      accessToken: encryptOuraToken('acc', USER, 'access_token'),
      refreshToken: encryptOuraToken('ref', USER, 'refresh_token'),
      expiresAt: new Date(Date.now() + 86_400_000), scope: 'extapi:daily', ouraUserId: 'oura-3079',
    })
    expect(await repo.listOuraCloudConnectedUserIds()).toContain(USER)
  })

  it("an Oura delete of today's night clears today's sleep score and readiness", async () => {
    const { withNightRescore } = await import('@/lib/health/rescore-nights')
    const nights = Array.from({ length: 10 }, (_, i) => {
      const date = shiftDateStr(today, -9 + i)
      const mid = dateStrMidnightInTz(date, TZ).getTime()
      return {
        ouraId: `cloud-3079-${date}`, date, sleepStart: new Date(mid - 1.5 * HOUR), sleepEnd: new Date(mid + 6.5 * HOUR),
        durationHours: 7.4, deepSleepHours: 1.4, remSleepHours: 1.6, lightSleepHours: 4.4, awakHours: 0.6, efficiency: 90,
      }
    })
    await repo.upsertOuraCloudSleep(USER, nights)
    await repo.upsertOuraDailyDerived(USER, today, { sleepScore: 81, readinessScore: 73, activityScore: 55 })

    const tombstoned = await withNightRescore(repo, USER, () => repo.tombstoneOuraCloudSleep(USER, [`cloud-3079-${today}`]))

    expect(tombstoned).toBe(1)
    const row = await derivedRow(today)
    expect(row.sleep_score).toBeNull()
    expect(row.readiness_score).toBeNull()
    expect(row.activity_score).toBe(55)
  })

  // ── #3085 review ────────────────────────────────────────────────────────────────────────────

  /** Ten plain nights before `date`, so the scored night has baselines. */
  function history(date: string) {
    return Array.from({ length: 10 }, (_, i) => {
      const d = shiftDateStr(date, -10 + i)
      const mid = dateStrMidnightInTz(d, TZ).getTime()
      return {
        ouraId: `cloud-3085-${d}`, date: d, sleepStart: new Date(mid - 1.5 * HOUR), sleepEnd: new Date(mid + 6.5 * HOUR),
        durationHours: 7.4, deepSleepHours: 1.4, remSleepHours: 1.6, lightSleepHours: 4.4, awakHours: 0.6, efficiency: 90,
      }
    })
  }

  /** 19 Oct's shape on `date`: a 20-minute `sleep` 23:05–23:25, then the `long_sleep` 00:02–06:46. */
  function nineteenthShape(date: string, fragmentType: string) {
    const mid = dateStrMidnightInTz(date, TZ).getTime()
    const fragment = { start: new Date(mid - 55 * 60_000), end: new Date(mid - 35 * 60_000) }
    const main = { start: new Date(mid + 2 * 60_000), end: new Date(mid + 6 * HOUR + 46 * 60_000) }
    const sleep = [
      { ouraId: `frag-3085-${date}`, date, sleepStart: fragment.start, sleepEnd: fragment.end, durationHours: 0.25, lightSleepHours: 0.25, awakHours: 0.08, efficiency: 75 },
      { ouraId: `main-3085-${date}`, date, sleepStart: main.start, sleepEnd: main.end, durationHours: 6.07, deepSleepHours: 1.2, remSleepHours: 1.5, lightSleepHours: 3.37, awakHours: 0.67, efficiency: 90, onsetLatencySec: 600 },
    ]
    const period = (ouraId: string, w: { start: Date; end: Date }, sleepType: string) => ({
      ouraId, day: date, bedtimeStart: w.start, bedtimeEnd: w.end, sleepType, heartRate: null, hrv: null, sleepPhase30Sec: null,
      movement30Sec: null, sleepAlgorithmVersion: null, lowBatteryAlert: null, sleepAnalysisReason: null, period: null, ringId: null,
    })
    return { sleep, periods: [period(`frag-3085-${date}`, fragment, fragmentType), period(`main-3085-${date}`, main, 'long_sleep')] }
  }

  const noWrites = { daily: [], body: [], sleep: [], deletedSleepIds: [], retypedSleepIds: [], workouts: [], sleepPeriods: [], cloudDaily: [], sessions: [] }

  /** The score the readiness read's own scorer gives `date` from what is stored now, types included. */
  async function scoredFromStore(date: string) {
    const { scoreNightForDate } = await import('@/lib/health/rescore-nights')
    return scoreNightForDate(await repo.listSleepSessions(USER, shiftDateStr(date, -40), today), date, TZ)?.score ?? null
  }

  it("a finished day's night arriving late is scored with its periods' types (the 19 Oct shape)", async () => {
    const { writeOuraCloudData } = await import('@/lib/oura/cloud/ingest')
    const yesterday = shiftDateStr(today, -1)
    await repo.upsertOuraCloudSleep(USER, history(yesterday))
    const { sleep, periods } = nineteenthShape(yesterday, 'sleep')

    await writeOuraCloudData(repo, USER, { ...noWrites, sleep, sleepPeriods: periods }, repo)

    const stored = (await derivedRow(yesterday))?.sleep_score
    expect(stored).toEqual(expect.any(Number))
    expect(stored).toBe(await scoredFromStore(yesterday))
    // The fragment really is held out: the night the scorer sees starts at the long_sleep.
    const sessions = await repo.listSleepSessions(USER, yesterday, yesterday)
    expect(sessions.find(x => x.ouraId === `frag-3085-${yesterday}`)?.ouraSleepType).toBe('sleep')
  })

  it("a write that only retypes a period re-scores the night", async () => {
    const { writeOuraCloudData } = await import('@/lib/oura/cloud/ingest')
    const yesterday = shiftDateStr(today, -1)
    await repo.upsertOuraCloudSleep(USER, history(yesterday))
    // First seen with the fragment typed as part of the night...
    const first = nineteenthShape(yesterday, 'long_sleep')
    await writeOuraCloudData(repo, USER, { ...noWrites, sleep: first.sleep, sleepPeriods: first.periods }, repo)
    const before = (await derivedRow(yesterday))?.sleep_score
    // ...then Oura retypes it; only the period row changes.
    await writeOuraCloudData(repo, USER, { ...noWrites, sleepPeriods: nineteenthShape(yesterday, 'sleep').periods }, repo)

    const after = (await derivedRow(yesterday))?.sleep_score
    expect(after).toBe(await scoredFromStore(yesterday))
    expect(after).not.toBe(before)
  })

  it('two sleep writes for one user never interleave their read, write and re-score', async () => {
    const { withNightRescore } = await import('@/lib/health/rescore-nights')
    const events: string[] = []
    const logged = new Proxy(repo, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver)
        if (prop === 'listSleepSessions') return (...a: Parameters<typeof repo.listSleepSessions>) => { events.push('read'); return repo.listSleepSessions(...a) }
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const write = (tag: string) => async () => {
      events.push(`${tag}:start`)
      await new Promise(r => setTimeout(r, 120))
      events.push(`${tag}:end`)
    }
    await Promise.all([withNightRescore(logged, USER, write('A')), withNightRescore(logged, USER, write('B'))])
    expect(events.join(',')).toMatch(/^read,(A|B):start,\1:end,read,read,(A|B):start,\2:end,read$/)
  })

  it('a holder on another connection (another replica) makes the write wait for it', async () => {
    const { withUserLock } = await import('@/lib/data/postgres/user-lock')
    const key = `oura-sleep-write:${USER}`
    const other = await pool.connect()
    try {
      await other.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [key])
      let ran = false
      const run = withUserLock(pool, key, async () => { ran = true }, { waitMs: 5_000, pollMs: 20 })
      await new Promise(r => setTimeout(r, 200))
      expect(ran).toBe(false)
      await other.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key])
      await run
      expect(ran).toBe(true)
    } finally {
      other.release()
    }
  })

  // #3099: a day keeps counting as "had an Oura night" after Oura deletes it.
  it('lists days that hold a tombstoned Oura Cloud night, never a live one, a ring or a manual one', async () => {
    const d = shiftDateStr(today, -2)
    const mid = dateStrMidnightInTz(d, TZ).getTime()
    await repo.upsertOuraCloudSleep(USER, [{ ouraId: `cloud-3099-${d}`, date: d, sleepStart: new Date(mid - HOUR), sleepEnd: new Date(mid + 6 * HOUR), durationHours: 7 }])
    await repo.tombstoneOuraCloudSleep(USER, [`cloud-3099-${d}`])
    const ring = shiftDateStr(today, -3)
    const rmid = dateStrMidnightInTz(ring, TZ).getTime()
    await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, oura_id, manual_entry)
       VALUES ($1, $2, $3, $4, 7, $5, false)`, [USER, ring, new Date(rmid - HOUR), new Date(rmid + 6 * HOUR), `ble:3099-${ring}`])
    // A live Oura nap on another day is not a deleted night (#3104 review).
    const nap = shiftDateStr(today, -4)
    const nmid = dateStrMidnightInTz(nap, TZ).getTime()
    await repo.upsertOuraCloudSleep(USER, [{ ouraId: `nap-3099-${nap}`, date: nap, sleepStart: new Date(nmid + 13 * HOUR), sleepEnd: new Date(nmid + 13.7 * HOUR), durationHours: 0.6 }])
    expect(await repo.listDeletedOuraCloudSleepDates(USER, shiftDateStr(today, -7), today, TZ)).toEqual([d])
  })

  // ── #3106 review: a deleted or rest-retyped NAP is not a deleted night ─────────────────────────

  /** One Oura period on `date`, from local clock times (hours after local midnight; negative = the evening before). */
  function period(id: string, date: string, startH: number, endH: number, type: string) {
    const mid = dateStrMidnightInTz(date, TZ).getTime()
    const start = new Date(mid + startH * HOUR), end = new Date(mid + endH * HOUR)
    const sleep = { ouraId: id, date, sleepStart: start, sleepEnd: end, durationHours: endH - startH - 0.3, efficiency: 90 }
    const p = {
      ouraId: id, day: date, bedtimeStart: start, bedtimeEnd: end, sleepType: type, heartRate: null, hrv: null, sleepPhase30Sec: null,
      movement30Sec: null, sleepAlgorithmVersion: null, lowBatteryAlert: null, sleepAnalysisReason: null, period: null, ringId: null,
    }
    return { sleep, period: p }
  }
  const frozenAnchor = async () => {
    const base = { anchor: 72, endValue: 50, dayMin: 40, dayMax: 72, totalCharged: 0, totalDrained: 22, restingHr: 52, hrMax: 180, hrMaxObserved: null, hrSampleCount: 300, modelVersion: 'v7' }
    await repo.upsertBodyBatteryDaily(USER, { ...base, date: today, anchorSource: 'readiness' })
  }
  const anchorSource = async () => (await pool.query(`SELECT anchor_source FROM body_battery_daily WHERE user_id = $1 AND date = $2`, [USER, today])).rows[0]?.anchor_source

  it.each([['deleted'], ['retyped to rest']])("a nap Oura %s before the night arrives does not keep the anchor frozen", async how => {
    const { writeOuraCloudData } = await import('@/lib/oura/cloud/ingest')
    await repo.upsertOuraCloudSleep(USER, history(today))
    const nap = period(`nap-3106-${today}`, today, 13, 13.7, 'sleep')
    await writeOuraCloudData(repo, USER, { ...noWrites, sleep: [nap.sleep], sleepPeriods: [nap.period] }, repo)
    if (how === 'deleted') await writeOuraCloudData(repo, USER, { ...noWrites, deletedSleepIds: [nap.sleep.ouraId] }, repo)
    else await writeOuraCloudData(repo, USER, { ...noWrites, retypedSleepIds: [nap.sleep.ouraId], sleepPeriods: [{ ...nap.period, sleepType: 'rest' }] }, repo)
    await frozenAnchor()

    const night = period(`night-3106-${today}`, today, -1.5, 6.5, 'long_sleep')
    await writeOuraCloudData(repo, USER, { ...noWrites, sleep: [night.sleep], sleepPeriods: [night.period] }, repo)

    expect(await anchorSource()).toBe('default')
  })

  it('a deleted real night that is re-created keeps the anchor frozen (a revision, #3099)', async () => {
    const { writeOuraCloudData } = await import('@/lib/oura/cloud/ingest')
    await repo.upsertOuraCloudSleep(USER, history(today))
    const night = period(`night-3106-${today}`, today, -1.5, 6.5, 'long_sleep')
    await writeOuraCloudData(repo, USER, { ...noWrites, sleep: [night.sleep], sleepPeriods: [night.period] }, repo)
    await frozenAnchor()
    await writeOuraCloudData(repo, USER, { ...noWrites, deletedSleepIds: [night.sleep.ouraId] }, repo)
    await writeOuraCloudData(repo, USER, { ...noWrites, sleep: [night.sleep], sleepPeriods: [night.period] }, repo)

    expect(await anchorSource()).toBe('readiness')
  })
})
