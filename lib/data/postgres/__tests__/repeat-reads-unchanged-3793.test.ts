// #3793 — database reads that repeated or fetched more than they used. None of the changes may move a
// result, so each is held to the answer it gave before: the same inputs go through the new path and
// through the previous one (kept verbatim here as the reference), and the outputs must be equal.
// Where a memo now answers, the reference is the direct read with the memos off, compared after every
// write that is meant to clear it. Each memo is also shown to be in use: a write it is not told about
// stays unseen until its drop, which is the dependency its comment names.
//
// Runs against a real Postgres (DATABASE_URL) and skips without one. Synthetic rows only.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { midnightDaysAgoInTz, shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'
import { metricsInDateRange } from '@trainingai/shared/health/metrics-in-date-range'
import { setUserReadMemosEnabled } from '@/lib/data/postgres/user-read-memo'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003793'
const OTHER = '00000000-0000-4000-8000-000000013793'
const TZ = 'Australia/Brisbane'
const HOUR = 3_600_000
const DAY = 24 * HOUR

describe.skipIf(!canRun)('#3793: the same reads give the same answers', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let repo: import('@/lib/data/repository').WorkoutRepository
  let oura: typeof import('@/lib/data/postgres/slices/oura')
  let tokens: typeof import('@/lib/data/postgres/slices/oura-cloud-tokens')
  let programs: typeof import('@/lib/data/postgres/slices/programs')
  let s: typeof import('@/lib/data/postgres/schema')

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool(); db = client.getDb()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    oura = await import('@/lib/data/postgres/slices/oura')
    tokens = await import('@/lib/data/postgres/slices/oura-cloud-tokens')
    programs = await import('@/lib/data/postgres/slices/programs')
    s = await import('@/lib/data/postgres/schema')
    for (const [id, email] of [[USER, 'issue-3793@example.com'], [OTHER, 'issue-3793-other@example.com']]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3) ON CONFLICT (id) DO UPDATE SET timezone = $3`,
        [id, email, TZ])
    }
  })
  afterAll(async () => {
    setUserReadMemosEnabled(null)
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER, OTHER]]) // cascades every table below
  })
  beforeEach(async () => {
    setUserReadMemosEnabled(true)
    for (const t of ['oura_ble_clock_anchors', 'oura_raw_samples', 'oura_tokens', 'oura_ble_battery_poll',
      'workout_hr_stats', 'oura_heartrate', 'programs', 'body_metrics']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = ANY($1)`, [[USER, OTHER]])
    }
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1)`, [[USER, OTHER]])
    await pool.query(`UPDATE users SET timezone = $2 WHERE id = $1`, [USER, TZ])
  })

  /** `fn` with the memos off: the read exactly as it ran before #3793. Turns them back on (empty). */
  async function direct<T>(fn: () => Promise<T>): Promise<T> {
    setUserReadMemosEnabled(false)
    try { return await fn() } finally { setUserReadMemosEnabled(true) }
  }

  // ── ① clock offsets ─────────────────────────────────────────────────────────────────────────
  describe('① the clock offsets', () => {
    const anchor = (user: string, i: number, epoch: number, createdAt?: Date) => pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc, epoch, observed_source, created_at)
       VALUES ($1, $2, $3, $4, 'drain', COALESCE($5, now()))`,
      [user, 1_000_000 + i * 600, new Date(Date.UTC(2026, 8, 1) + i * 61_000 + (i % 7) * 900), epoch, createdAt ?? null])
    const plain = (c: import('@/lib/oura-ble/clock').ClockOffsets) => ({ epoch: c.epoch, offsets: [...c.offsets].sort((a, b) => a[0] - b[0]) })
    const viaMemo = async (user = USER) => plain(await oura.getOuraClockOffsets(db, user))
    const viaDirect = (user = USER) => direct(async () => plain(await oura.getOuraClockOffsets(db, user)))

    it('answers as the direct read, before and after a new anchor row', async () => {
      expect(await viaMemo()).toEqual({ epoch: null, offsets: [] })
      for (let i = 0; i < 40; i++) await anchor(USER, i, i < 25 ? 0 : 1)
      for (let i = 0; i < 12; i++) await anchor(OTHER, i, 0)
      const first = await viaMemo()
      expect(await viaMemo()).toEqual(first) // the kept answer
      expect(first).toEqual(await viaDirect())
      expect(first.epoch).toBe(1)
      // Another user's answer is never this one's.
      expect(await viaMemo(OTHER)).toEqual(await viaDirect(OTHER))
      expect(await viaMemo(OTHER)).not.toEqual(first)
      await viaMemo()
      await anchor(USER, 40, 2) // a new newest row moves the key
      const second = await viaMemo()
      expect(second).toEqual(await viaDirect())
      expect(second.epoch).toBe(2)
    })

    it('a row written out of created_at order is seen only once the insert path drops the entry', async () => {
      for (let i = 0; i < 10; i++) await anchor(USER, i, 0)
      const before = await viaMemo()
      await anchor(USER, 99, 3, new Date(Date.now() - DAY)) // not the newest by created_at: the key holds
      expect(await viaMemo()).toEqual(before)
      oura.dropOuraClockOffsets(USER)
      expect(await viaMemo()).toEqual(await viaDirect())
      expect((await viaMemo()).epoch).toBe(3)
    })

    it('the raw-frame insert, which writes the anchor, drops it', async () => {
      await repo.insertOuraRawSamples(USER, [{ ringTimestampDs: 5_000_000, tag: 0x46, eventName: 'TEST', bodyHex: '00' }])
      const first = await viaMemo()
      expect(first).toEqual(await viaDirect())
      await anchor(USER, 1, 4, new Date(Date.now() - DAY))
      await repo.insertOuraRawSamples(USER, [{ ringTimestampDs: 5_100_000, tag: 0x46, eventName: 'TEST', bodyHex: '01' }])
      expect(await viaMemo()).toEqual(await viaDirect())
    })
  })

  // ── ② workout HR density ─────────────────────────────────────────────────────────────────────
  describe('② the calorie gate reads only the rows it keeps', () => {
    /** The query as it was before #3793, verbatim, and its filter. */
    async function previous(userId: string, sessionIds: string[]): Promise<Map<string, number>> {
      if (sessionIds.length === 0) return new Map()
      const rows = await db
        .select({
          id: s.workoutHrStats.workoutSessionId, avgBpm: s.workoutHrStats.avgBpm, completedAt: s.workoutSessions.completedAt,
          hrDense: s.workoutHrStats.hrDense, span: oura.workoutHrSpanSql(userId),
        })
        .from(s.workoutHrStats)
        .innerJoin(s.workoutSessions, eq(s.workoutSessions.id, s.workoutHrStats.workoutSessionId))
        .where(and(eq(s.workoutHrStats.userId, userId), inArray(s.workoutHrStats.workoutSessionId, sessionIds)))
      const usable = (r: (typeof rows)[number]) =>
        r.avgBpm != null && r.completedAt != null && (r.hrDense ?? oura.workoutHrSpanVerdict(r.span) ?? true)
      return new Map(rows.filter(usable).map(r => [r.id, r.avgBpm as number]))
    }

    it('returns exactly what the previous query returned', async () => {
      const start = new Date(Date.now() - 2 * DAY)
      const ids = [1, 2, 3, 4, 5, 6, 7].map(n => `00000000-0000-4000-8000-0000037930${n}0`)
      const at = (i: number, min: number) => new Date(start.getTime() + i * 3 * HOUR + min * 60_000)
      const session = async (i: number, completed: boolean, avgBpm: number | null, hrDense: boolean | null = null) => {
        await pool.query(
          `INSERT INTO workout_sessions (id, user_id, session_name, started_at, completed_at) VALUES ($1, $2, 'Push', $3, $4)`,
          [ids[i], USER, at(i, 0), completed ? at(i, 60) : null])
        await pool.query(
          `INSERT INTO workout_hr_stats (workout_session_id, user_id, avg_bpm, peak_bpm, readings_count, source, hr_dense)
           VALUES ($1, $2, $3, 150, 60, 'health_connect', $4)`, [ids[i], USER, avgBpm, hrDense])
      }
      const series = (i: number, stepMin: number, source: string) => pool.query(
        `INSERT INTO oura_heartrate (user_id, timestamp, bpm, source)
         SELECT $1, ts, 110, $4 FROM generate_series($2::timestamptz, $3::timestamptz, make_interval(mins => $5)) ts
         ON CONFLICT (user_id, timestamp) DO NOTHING`, [USER, at(i, 0), at(i, 60), source, stepMin])
      await session(0, true, 120); await series(0, 1, 'health_connect')        // dense gated: kept
      await session(1, true, 121); await series(1, 30, 'health_connect')       // sparse gated: METs
      await session(2, true, null); await series(2, 1, 'health_connect')       // no average
      await session(3, false, 123); await series(3, 1, 'health_connect')       // in progress
      await session(4, true, 124)                                               // no series: snapshot stands
      await session(5, true, 125, false); await series(5, 1, 'health_connect') // frozen sparse
      await session(6, true, 126); await series(6, 30, 'ble')                  // ungated source: kept
      const now = await oura.getAvgBpmBySession(db, USER, ids)
      expect(now).toEqual(await previous(USER, ids))
      expect([...now.keys()].sort()).toEqual([ids[0], ids[4], ids[6]].sort())
      expect(await oura.getAvgBpmBySession(db, USER, ids.slice(2, 4))).toEqual(new Map())
      expect(await oura.getAvgBpmBySession(db, OTHER, ids)).toEqual(await previous(OTHER, ids))
    })
  })

  // ── ③ ring battery ───────────────────────────────────────────────────────────────────────────
  describe('③ the ring battery history', () => {
    /** The battery query as it was before #3793, verbatim. */
    async function previous(userId: string, from: Date, to: Date) {
      const detailFrom = new Date(to.getTime() - oura.RING_BATTERY_DETAIL_MS)
      const { rows } = await db.execute<{ measured_at: Date; percent: number; charging: boolean | null }>(sql`
        SELECT measured_at, percent,
               CASE WHEN rn = 1 THEN hour_charging ELSE charging END AS charging
          FROM (
            SELECT measured_at, percent, charging, prev_percent, next_percent,
                   bool_or(charging) OVER (PARTITION BY hr) AS hour_charging,
                   row_number() OVER (PARTITION BY hr ORDER BY measured_at DESC) AS rn
              FROM (
                SELECT measured_at, percent, charging,
                       date_trunc('hour', measured_at, 'UTC') AS hr,
                       lag(percent) OVER (ORDER BY measured_at) AS prev_percent,
                       lead(percent) OVER (ORDER BY measured_at) AS next_percent
                  FROM oura_ble_battery_poll
                 WHERE user_id = ${userId} AND measured_at >= ${from.toISOString()}::timestamptz
                   AND measured_at <= ${to.toISOString()}::timestamptz
              ) w
          ) x
         WHERE measured_at >= ${detailFrom.toISOString()}::timestamptz
            OR rn = 1
            OR charging IS TRUE
            OR percent > prev_percent
            OR next_percent > percent
         ORDER BY measured_at ASC`)
      return rows.map(r => ({ tsMs: new Date(r.measured_at).getTime(), percent: Number(r.percent), charging: r.charging }))
    }

    /** A reading every `stepMin` minutes from `fromMs` to `toMs`: a slow drain with a charge every
     *  third day, partly reported as charging, so every arm of the filter has rows to keep. */
    const seed = (user: string, fromMs: number, toMs: number, stepMin: number, source: string | null = null) => pool.query(
      `INSERT INTO oura_ble_battery_poll (user_id, measured_at, percent, charging, source)
       SELECT $1, ts,
              CASE WHEN (extract(epoch FROM ts)::bigint / 3600) % 72 < 2 THEN 40 + ((extract(epoch FROM ts)::bigint / 600) % 12) * 5
                   ELSE 95 - ((extract(epoch FROM ts)::bigint / 3600) % 72) END,
              CASE WHEN (extract(epoch FROM ts)::bigint / 3600) % 72 < 2 AND (extract(epoch FROM ts)::bigint / 600) % 3 = 0 THEN true
                   WHEN (extract(epoch FROM ts)::bigint / 600) % 5 = 0 THEN NULL ELSE false END,
              $5
         FROM generate_series($2::timestamptz, $3::timestamptz, make_interval(mins => $4)) ts`,
      [user, new Date(fromMs), new Date(toMs), stepMin, source])

    const window = (to: Date) => midnightDaysAgoInTz(TZ, 119, to)

    it('the kept older part plus the live rest is the previous answer, as time moves and rows arrive', async () => {
      const t0 = new Date()
      const from = window(t0)
      await seed(USER, from.getTime() - DAY, t0.getTime() - 60_000, 17)
      await seed(OTHER, from.getTime(), t0.getTime() - 60_000, 41)
      const check = async (to: Date) => {
        const got = await oura.getRingBatteryReadings(db, USER, window(to), to)
        expect(got).toEqual(await previous(USER, window(to), to))
        return got
      }
      const first = await check(t0)
      expect(first.length).toBeGreaterThan(500)
      await check(t0) // the kept part answering

      // A Bluetooth poll, stamped now, then later reads: the detail cut moves past the kept edge.
      await repo.insertOuraBatteryPoll(USER, 55, false)
      await check(new Date())
      for (const ahead of [HOUR + 7 * 60_000, 5 * HOUR, 20 * HOUR]) {
        const to = new Date(Date.now() + ahead)
        if (window(to).getTime() !== from.getTime()) continue // a later local day is a new key anyway
        await check(to)
      }

      // Oura Cloud readings dated inside the kept part, through its own insert: the entry goes.
      await oura.insertOuraCloudBatteryReadings(db, USER, [
        { measuredAt: new Date(t0.getTime() - 50 * DAY + 123_000), percent: 99, charging: null },
        { measuredAt: new Date(t0.getTime() - 2 * DAY - 2 * HOUR + 7_000), percent: 100, charging: true },
      ])
      await check(new Date())

      // Another user's history is not this one's.
      expect(await oura.getRingBatteryReadings(db, OTHER, from, t0)).toEqual(await previous(OTHER, from, t0))
    })

    it('a row written behind its back is unseen until the drop, which is why the insert drops', async () => {
      const t0 = new Date()
      await seed(USER, window(t0).getTime(), t0.getTime() - 60_000, 23)
      const before = await oura.getRingBatteryReadings(db, USER, window(t0), t0)
      await pool.query(`INSERT INTO oura_ble_battery_poll (user_id, measured_at, percent, charging) VALUES ($1, $2, 100, true)`,
        [USER, new Date(t0.getTime() - 40 * DAY + 1_000)])
      expect(await oura.getRingBatteryReadings(db, USER, window(t0), t0)).toEqual(before)
      setUserReadMemosEnabled(true) // empties the memos, as a drop would
      expect(await oura.getRingBatteryReadings(db, USER, window(t0), t0)).toEqual(await previous(USER, window(t0), t0))
    })

    it('with no reading after the kept edge it reads directly, and still matches', async () => {
      const t0 = new Date()
      await seed(USER, window(t0).getTime(), t0.getTime() - 4 * DAY, 29) // the ring off for four days
      for (let i = 0; i < 2; i++) {
        expect(await oura.getRingBatteryReadings(db, USER, window(t0), t0)).toEqual(await previous(USER, window(t0), t0))
      }
      await repo.insertOuraBatteryPoll(USER, 30, false)
      const to = new Date()
      expect(await oura.getRingBatteryReadings(db, USER, window(to), to)).toEqual(await previous(USER, window(to), to))
    })

    it('an empty table reads empty', async () => {
      const t0 = new Date()
      expect(await oura.getRingBatteryReadings(db, USER, window(t0), t0)).toEqual([])
    })
  })

  // ── ⑤ the active program ─────────────────────────────────────────────────────────────────────
  describe('⑤ the active program', () => {
    const previous = async (userId: string) => {
      const all = await programs.listPrograms(db, userId)
      return all.find(p => p.isActive) ?? all[0] ?? null
    }
    const program = async (name: string, active: boolean, daysAgo: number) => {
      const { rows: [p] } = await pool.query(
        `INSERT INTO programs (user_id, name, is_active, created_at) VALUES ($1, $2, $3, now() - make_interval(days => $4)) RETURNING id`,
        [USER, name, active, daysAgo])
      for (let i = 0; i < 3; i++) {
        const { rows: [ps] } = await pool.query(
          `INSERT INTO program_sessions (program_id, name, position) VALUES ($1, $2, $3) RETURNING id`, [p.id, `${name} ${i}`, i])
        for (let j = 0; j < 2; j++) {
          await pool.query(`INSERT INTO session_exercises (session_id, exercise_name, position) VALUES ($1, $2, $3)`,
            [ps.id, `Lift ${i}.${j}`, j])
        }
      }
      return p.id as string
    }

    it('is the program the full list chose, in every arrangement', async () => {
      expect(await programs.getActiveProgram(db, USER)).toBeNull()
      expect(await previous(USER)).toBeNull()
      await program('Old', false, 30)
      expect(await programs.getActiveProgram(db, USER)).toEqual(await previous(USER)) // none active: the oldest
      await program('Newer', false, 10)
      expect(await programs.getActiveProgram(db, USER)).toEqual(await previous(USER))
      const active = await program('Active', true, 5)
      const chosen = await programs.getActiveProgram(db, USER)
      expect(chosen).toEqual(await previous(USER))
      expect(chosen?.id).toBe(active)
      expect(chosen?.sessions).toHaveLength(3)
      expect(chosen?.sessions[0].exercises).toHaveLength(2)
      await program('Also active, older', true, 20) // two active: the older of them
      expect(await programs.getActiveProgram(db, USER)).toEqual(await previous(USER))
      expect(await programs.getActiveProgram(db, OTHER)).toBeNull()
    })
  })

  // ── ⑥ the Oura switch day ────────────────────────────────────────────────────────────────────
  describe('⑥ the Oura switch day', () => {
    const viaMemo = (user = USER) => tokens.getOuraCloudSwitchDay(db, user)
    const viaDirect = (user = USER) => direct(() => tokens.getOuraCloudSwitchDay(db, user))
    const enc = (v: string) => v as import('@/lib/oura/cloud/token-cipher').EncryptedOuraToken
    const save = (user: string) => tokens.saveOuraCloudTokens(db, user, {
      accessToken: enc('a'), refreshToken: enc('r'), expiresAt: new Date(Date.now() + HOUR), scope: null,
    })

    it('answers as the direct read after every write it depends on', async () => {
      const same = async () => expect(await viaMemo()).toBe(await viaDirect())
      await same() // no connection
      expect(await viaMemo()).toBeNull()
      await save(USER)
      await same() // the connection's own day
      expect(await viaMemo()).toBe(todayInTz(TZ))
      await pool.query(`UPDATE oura_tokens SET created_at = now() - interval '9 days' WHERE user_id = $1`, [USER])
      await save(USER) // a refresh rewrites the row
      await same()
      expect(await viaMemo()).toBe(shiftDateStr(todayInTz(TZ), -9))
      await repo.insertOuraRawSamples(USER, [{ ringTimestampDs: 7_000_000, tag: 0x46, eventName: 'TEST', bodyHex: '02' }])
      await same() // the newest frame's day
      await repo.updateUserProfile(USER, { timezone: 'Pacific/Kiritimati' })
      await same() // dated in the new zone
      await save(OTHER)
      await pool.query(`UPDATE oura_tokens SET created_at = now() - interval '3 days' WHERE user_id = $1`, [OTHER])
      tokens.dropOuraCloudSwitchDay(OTHER)
      expect(await viaMemo(OTHER)).toBe(await viaDirect(OTHER))
      expect(await viaMemo(OTHER)).not.toBe(await viaMemo())
      await tokens.deleteOuraCloudTokens(db, USER)
      await same() // disconnected: no switch
      expect(await viaMemo()).toBeNull()
    })

    it('a write it is not told about is unseen until the drop', async () => {
      await save(USER)
      const before = await viaMemo()
      await pool.query(`UPDATE oura_tokens SET created_at = now() - interval '5 days' WHERE user_id = $1`, [USER])
      expect(await viaMemo()).toBe(before)
      tokens.dropOuraCloudSwitchDay(USER)
      expect(await viaMemo()).toBe(await viaDirect())
      expect(await viaMemo()).not.toBe(before)
    })
  })

  // ── ⑦ the cardio week's body metrics ─────────────────────────────────────────────────────────
  describe('⑦ one body-metrics read, sliced', () => {
    it('each slice is what its own read returned, rows and order', async () => {
      const today = todayInTz(TZ)
      for (let back = 0; back < 70; back++) {
        if (back % 4 === 3) continue // gaps, so a slice edge can fall on a missing day
        await pool.query(
          `INSERT INTO body_metrics (user_id, date, weight_kg, resting_heart_rate, steps) VALUES ($1, $2, $3, $4, $5)`,
          [USER, shiftDateStr(today, -back), 80 + back / 10, 50 + (back % 9), 1000 * back])
      }
      await pool.query(`UPDATE body_metrics SET deleted_at = now() WHERE user_id = $1 AND date = $2`, [USER, shiftDateStr(today, -5)])
      const windows: [string, string][] = [
        [shiftDateStr(today, -3), today], [shiftDateStr(today, -28), today],
        [shiftDateStr(today, -30), today], [shiftDateStr(today, -60), shiftDateStr(today, -30)],
        [today, today], [shiftDateStr(today, -2), shiftDateStr(today, -3)],
      ]
      const lo = windows.map(w => w[0]).sort()[0]
      const wide = await repo.listBodyMetrics(USER, lo, today)
      for (const [from, to] of windows) {
        expect(metricsInDateRange(wide, from, to), `${from}..${to}`).toEqual(await repo.listBodyMetrics(USER, from, to))
      }
    })
  })
})
