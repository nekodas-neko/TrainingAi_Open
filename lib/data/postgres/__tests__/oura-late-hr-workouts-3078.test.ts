// #3078 — Oura Cloud heart rate lands in batches, often hours after a workout was completed and its
// HR stats were computed from a thin series. The catch-up re-reads 6 h behind its newest point and
// re-attributes the completed workouts the points it actually changed overlap; a session whose HR
// fails the #2437 density rule no longer drives the calorie estimate.
//
// Runs against a real Postgres (DATABASE_URL) and skips without one. Oura is mocked at `fetch`.
// Fixtures are anchored to yesterday's local midday, never a hardcoded date.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fromZonedTime } from 'date-fns-tz'
import { OURA_API_BASE, type OuraOAuthConfig } from '@/lib/oura/cloud/config'
import { encryptOuraToken } from '@/lib/oura/cloud/token-cipher'
import { jsonResponse } from '@/lib/oura/cloud/__tests__/fixtures'
import { shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003078'
// Its own Oura account id: `oura_tokens.oura_user_id` is unique, and other files run in parallel.
const OURA_USER = 'oura-user-3078'
const TZ = 'Australia/Brisbane'
const CONFIG: OuraOAuthConfig = { clientId: 'cid', clientSecret: 'csecret', redirectUri: 'http://localhost:3000/api/oura/callback' }
const ws = (n: number) => `00000000-0000-4000-8000-00000000307${n}`

const DAY = shiftDateStr(todayInTz(TZ), -1)
const START = fromZonedTime(`${DAY}T12:00:00`, TZ)
const END = new Date(START.getTime() + 45 * 60_000)
const MIN = 60_000

/** Oura's heart-rate series, answering the requested window from `points`. */
let points: { at: Date; bpm: number }[] = []
const fetchedFrom: string[] = []
function fakeOura(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (!url.href.startsWith(`${OURA_API_BASE}/v2/usercollection/heartrate`)) return new Response('', { status: 404 })
    const from = Date.parse(url.searchParams.get('start_datetime')!)
    const to = Date.parse(url.searchParams.get('end_datetime')!)
    fetchedFrom.push(url.searchParams.get('start_datetime')!)
    const data = points
      .filter(p => p.at.getTime() >= from && p.at.getTime() <= to)
      .map(p => ({ timestamp: p.at.toISOString(), bpm: p.bpm, source: 'workout' }))
    return jsonResponse({ data, next_token: null })
  }) as typeof fetch
}

describe.skipIf(!canRun)('late Oura heart rate re-attributes workouts (#3078)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const savedKey = process.env.OURA_TOKEN_KEY

  beforeAll(async () => {
    process.env.OURA_TOKEN_KEY = 'k'.repeat(48)
    pool = (await import('@/lib/data/postgres/client')).getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3) ON CONFLICT (id) DO NOTHING`,
      [USER, 'issue-3078@example.com', TZ])
  })
  afterAll(async () => {
    process.env.OURA_TOKEN_KEY = savedKey
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER]) // cascades every table below
  })

  beforeEach(async () => {
    for (const t of ['workout_hr_stats', 'set_hr_stats', 'oura_heartrate', 'oura_tokens']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [USER])
    }
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    await repo.saveOuraCloudTokens(USER, {
      accessToken: encryptOuraToken('acc', USER, 'access_token'),
      refreshToken: encryptOuraToken('ref', USER, 'refresh_token'),
      expiresAt: new Date(Date.now() + 86_400_000), scope: 'extapi:heartrate extapi:workout', ouraUserId: OURA_USER,
    })
    points = []
    fetchedFrom.length = 0
    vi.stubGlobal('fetch', fakeOura())
  })
  afterEach(() => vi.unstubAllGlobals())

  const addSession = (id: string, start: Date, end: Date | null, deleted = false) => pool.query(
    `INSERT INTO workout_sessions (id, user_id, session_name, started_at, completed_at, deleted_at) VALUES ($1, $2, 'Push', $3, $4, $5)`,
    [id, USER, start, end, deleted ? new Date() : null])
  const stats = async (id: string) => (await pool.query(
    `SELECT avg_bpm, readings_count FROM workout_hr_stats WHERE workout_session_id = $1`, [id])).rows[0] ?? null

  it('lists only completed, live sessions whose HR window overlaps, oldest first and bounded', async () => {
    await addSession(ws(1), START, END)
    await addSession(ws(2), new Date(START.getTime() - 3 * 60 * MIN), new Date(START.getTime() - 2 * 60 * MIN))
    await addSession(ws(3), START, null)
    await addSession(ws(4), START, END, true)
    await addSession(ws(5), new Date(START.getTime() - 26 * 60 * MIN), new Date(START.getTime() - 25 * 60 * MIN))
    // The window touches the first session only through its 10-minute recovery pad.
    const pad = await repo.listCompletedSessionsOverlapping(USER, new Date(END.getTime() + 9 * MIN), new Date(END.getTime() + 60 * MIN), 20)
    expect(pad.map(s => s.id)).toEqual([ws(1)])
    const day = await repo.listCompletedSessionsOverlapping(USER, new Date(START.getTime() - 4 * 60 * MIN), END, 20)
    expect(day.map(s => s.id)).toEqual([ws(2), ws(1)])
    expect((await repo.listCompletedSessionsOverlapping(USER, new Date(START.getTime() - 4 * 60 * MIN), END, 1)).map(s => s.id)).toEqual([ws(2)])
  })

  it('a batch Oura stamps behind the newest stored point is read, and the workout it covers is refreshed, idempotently', async () => {
    const { catchUpOuraCloudHeartRate } = await import('@/lib/oura/cloud/webhook')
    const { reattributeWorkoutsHrInWindow } = await import('@/lib/workout/post-completion-hr')
    await addSession(ws(1), START, END)
    // At completion only two scattered points had landed: the stats are computed from those.
    await repo.upsertOuraCloudHeartrate(USER, [
      { timestamp: new Date(START.getTime() + 5 * MIN), bpm: 90 },
      { timestamp: new Date(START.getTime() + 30 * MIN), bpm: 95 },
    ], TZ)
    expect(await reattributeWorkoutsHrInWindow(repo, USER, START, END, TZ)).toBe(1)
    expect(await stats(ws(1))).toEqual({ avg_bpm: 93, readings_count: 2 })
    // A later sync stored a point two hours after the workout; the workout's own batch arrives after it.
    const newest = new Date(END.getTime() + 2 * 60 * MIN)
    await repo.upsertOuraCloudHeartrate(USER, [{ timestamp: newest, bpm: 60, context: 'workout' }], TZ)
    for (let t = START.getTime(); t <= END.getTime(); t += MIN) points.push({ at: new Date(t), bpm: 120 })
    points.push({ at: newest, bpm: 60 })

    const spans: [string, string][] = []
    const deps = {
      repo, config: CONFIG,
      workoutHr: (u: string, f: Date, to: Date, tz: string) => { spans.push([f.toISOString(), to.toISOString()]); return reattributeWorkoutsHrInWindow(repo, u, f, to, tz) },
    }
    const now = newest.getTime() + 30 * MIN
    expect(await catchUpOuraCloudHeartRate(deps, USER, now)).toBe(points.length)
    expect(fetchedFrom[0]).toBe(new Date(newest.getTime() - 6 * 60 * MIN).toISOString())
    // Re-attributed over the points that changed: the workout's batch, not the stored point after it.
    expect(spans).toEqual([[START.toISOString(), END.toISOString()]])
    const after = await stats(ws(1))
    expect(after.readings_count).toBe(46)
    expect(after.avg_bpm).toBe(120)

    // Again: the re-read changes nothing, so nothing is re-attributed.
    expect(await catchUpOuraCloudHeartRate(deps, USER, now + 10 * MIN)).toBe(points.length)
    expect(spans).toHaveLength(1)
    expect(await stats(ws(1))).toEqual(after)
  })

  it('upsertOuraCloudHeartrate says which points it actually changed', async () => {
    const pts = [0, 5, 10].map(m => ({ timestamp: new Date(START.getTime() + m * MIN), bpm: 70 }))
    expect(await repo.upsertOuraCloudHeartrate(USER, pts, TZ)).toEqual({ offered: 3, changed: 3, changedFrom: pts[0].timestamp, changedTo: pts[2].timestamp })
    expect(await repo.upsertOuraCloudHeartrate(USER, pts, TZ)).toEqual({ offered: 3, changed: 0, changedFrom: null, changedTo: null })
    const revised = [{ ...pts[1], bpm: 72 }, pts[2]]
    expect(await repo.upsertOuraCloudHeartrate(USER, revised, TZ)).toEqual({ offered: 2, changed: 1, changedFrom: pts[1].timestamp, changedTo: pts[1].timestamp })
  })

  // The gate holds the sources #2437 gates (Health Connect, Apple Health) and, since #3114, Oura Cloud.
  // The ring's BLE and the strap keep their average, as on `main`.
  it('a sparse Health Connect or Oura Cloud session falls back to METs; a dense Oura workout, sparse ring BLE and a dense strap keep HR', async () => {
    const hour = 60 * MIN
    const starts = [0, 1, 2, 3].map(i => new Date(START.getTime() + i * 2 * hour))
    const ouraWorkout = new Date(START.getTime() + 8 * hour)
    for (const [i, st] of [...starts, ouraWorkout].entries()) await addSession(ws(i + 1), st, new Date(st.getTime() + 71 * MIN))
    // 21 points over 71 minutes, gaps up to 19 minutes: a high enough average rate, but not the ring's cadence.
    const gaps = [...Array(19).fill((71 - 19) / 19), 19]
    const sparseAt = (st: Date) => {
      let t = st.getTime()
      const out = [new Date(t)]
      for (const g of gaps) { t += g * MIN; out.push(new Date(Math.round(t))) }
      return out
    }
    const insert = (times: Date[], source: string) => pool.query(
      `INSERT INTO oura_heartrate (user_id, timestamp, bpm, source) SELECT $1, unnest($2::timestamptz[]), 100, $3`,
      [USER, times, source])
    await insert(sparseAt(starts[0]), 'health_connect')
    await insert(sparseAt(starts[1]), 'ble')
    await repo.upsertOuraCloudHeartrate(USER, sparseAt(starts[2]).map(timestamp => ({ timestamp, bpm: 100 })), TZ)
    await pool.query(
      `INSERT INTO oura_heartrate (user_id, timestamp, bpm, source)
       SELECT $1, ts, 130, 'chest_strap' FROM generate_series($2::timestamptz, $3::timestamptz, interval '1 second') ts`,
      [USER, starts[3], new Date(starts[3].getTime() + 71 * MIN)])
    // An Oura-app workout: a reading every 5 seconds.
    await repo.upsertOuraCloudHeartrate(USER, Array.from({ length: 71 * 12 + 1 }, (_, k) => ({ timestamp: new Date(ouraWorkout.getTime() + k * 5000), bpm: 130 })), TZ)
    for (const i of [1, 2, 3, 5]) {
      await repo.upsertWorkoutHrStats(USER, ws(i), { avgBpm: 100, peakBpm: 120, hrr1Best: null, workoutHrvMs: null, readingsCount: 21, source: null })
    }
    await repo.upsertWorkoutHrStats(USER, ws(4), { avgBpm: 130, peakBpm: 160, hrr1Best: null, workoutHrvMs: null, readingsCount: 4261, source: 'chest_strap' })
    const got = await repo.getAvgBpmBySession(USER, [ws(1), ws(2), ws(3), ws(4), ws(5)])
    expect([...got.keys()].sort()).toEqual([ws(2), ws(4), ws(5)])
  })

  it('a session past HR retention keeps its snapshot: there is no series left to check', async () => {
    const old = new Date(Date.now() - 200 * 86_400_000)
    await addSession(ws(3), old, new Date(old.getTime() + 45 * MIN))
    await repo.upsertWorkoutHrStats(USER, ws(3), { avgBpm: 125, peakBpm: 150, hrr1Best: null, workoutHrvMs: null, readingsCount: 2700, source: 'chest_strap' })
    expect([...(await repo.getAvgBpmBySession(USER, [ws(3)])).entries()]).toEqual([[ws(3), 125]])
  })
})
