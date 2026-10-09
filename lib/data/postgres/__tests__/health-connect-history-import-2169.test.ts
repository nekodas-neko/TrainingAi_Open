// issue 2169 (migration 202610081422), against a real Postgres.
//
// Drives the REAL routes into the real tables - the session is the only thing stubbed - and reads
// the rows back. Three things the mocked route tests cannot prove:
//   1. the progress row only ever moves OLDER (the `LEAST` in the writer), and is per account;
//   2. an imported day and a later live sync of the same day merge into ONE body_metrics row and ONE
//      sleep session - the ranked-merge path, so a later live sync cannot double-count;
//   3. an imported window's old heart-rate and interval rows really land, and an ordinary sync's do not.
//
// Runs only against a real local dev Postgres - skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'

const canRun = !!process.env.DATABASE_URL
const A = '00000000-0000-4000-8000-000000002169'
const B = '00000000-0000-4000-8000-00000000216b'
const TZ = 'Australia/Brisbane'

const who = vi.hoisted(() => ({ id: '00000000-0000-4000-8000-000000002169' }))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: who.id, timezone: 'Australia/Brisbane' } })) }))

const DAY = 86_400_000

describe.skipIf(!canRun)('Health Connect history import (issue 2169)', () => {
  let pool: import('pg').Pool
  let sync: typeof import('@/app/api/sync-health/route').POST
  let progress: typeof import('@/app/api/health-connect/history-import/route')
  let shiftDateStr: typeof import('@trainingai/shared/date-utils').shiftDateStr
  let today: string

  const syncPost = (body: unknown) => sync(new NextRequest('http://x/api/sync-health', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
  const savePost = (oldestDate: string) => progress.POST(new NextRequest('http://x/api/health-connect/history-import', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ oldestDate }),
  }))

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    sync = (await import('@/app/api/sync-health/route')).POST
    progress = await import('@/app/api/health-connect/history-import/route')
    const du = await import('@trainingai/shared/date-utils')
    shiftDateStr = du.shiftDateStr
    today = du.todayInTz(TZ)
    for (const id of [A, B]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
         ON CONFLICT (id) DO NOTHING`, [id, `hc-history-${id.slice(-4)}@example.com`, TZ])
    }
    await clean()
  })

  async function clean() {
    const ids = [[A, B]]
    await pool.query(`DELETE FROM health_connect_history_import WHERE user_id = ANY($1::uuid[])`, ids)
    await pool.query(`DELETE FROM body_metrics WHERE user_id = ANY($1::uuid[])`, ids)
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = ANY($1::uuid[])`, ids)
    await pool.query(`DELETE FROM health_connect_intervals WHERE user_id = ANY($1::uuid[])`, ids)
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = ANY($1::uuid[])`, ids)
  }

  afterAll(async () => {
    if (!canRun) return
    await clean()
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[A, B]])
  })

  it('the progress row starts empty, stores a day, and only ever moves older', async () => {
    who.id = A
    expect(await (await progress.GET()).json()).toEqual({ oldestDate: null })

    const d1 = shiftDateStr(today, -60)
    const d2 = shiftDateStr(today, -90)
    expect(await (await savePost(d1)).json()).toEqual({ oldestDate: d1 })
    expect(await (await savePost(d2)).json()).toEqual({ oldestDate: d2 })
    // a late or replayed request with a NEWER day cannot walk the cursor forward
    expect(await (await savePost(d1)).json()).toEqual({ oldestDate: d2 })
    expect(await (await progress.GET()).json()).toEqual({ oldestDate: d2 })
    // the same day again is a no-op
    expect(await (await savePost(d2)).json()).toEqual({ oldestDate: d2 })
  })

  it('is per account: another user starts empty and cannot see or move this user\'s day', async () => {
    who.id = B
    expect(await (await progress.GET()).json()).toEqual({ oldestDate: null })
    const dB = shiftDateStr(today, -45)
    expect(await (await savePost(dB)).json()).toEqual({ oldestDate: dB })
    who.id = A
    expect(await (await progress.GET()).json()).toEqual({ oldestDate: shiftDateStr(today, -90) })
    const rows = (await pool.query(`SELECT user_id FROM health_connect_history_import ORDER BY 1`)).rows
    expect(rows.map(r => r.user_id)).toEqual([A, B])
  })

  it('an imported day and a later live sync of the same day are ONE body_metrics row and ONE sleep session', async () => {
    who.id = A
    const day = shiftDateStr(today, -50)
    const sleepStart = new Date(Date.parse(`${day}T00:00:00Z`) - 4 * 3_600_000).toISOString()
    const sleepEnd = new Date(Date.parse(`${day}T00:00:00Z`) + 3 * 3_600_000).toISOString()
    const payload = {
      dailyMetrics: [{ date: day, steps: 8123, weightKg: 81.4 }],
      sleepRecords: [{ date: day, sleepStart, sleepEnd, durationHours: 7 }],
    }

    // the import window, then the same day again as a live sync would send it - twice
    expect((await syncPost({ ...payload, historyFrom: shiftDateStr(day, -10) })).status).toBe(200)
    expect((await syncPost(payload)).status).toBe(200)
    expect((await syncPost({ ...payload, historyFrom: shiftDateStr(day, -10) })).status).toBe(200)

    const bm = (await pool.query(`SELECT steps, weight_kg FROM body_metrics WHERE user_id = $1 AND date = $2`, [A, day])).rows
    expect(bm).toEqual([{ steps: 8123, weight_kg: 81.4 }])
    const sl = (await pool.query(`SELECT duration_hours FROM sleep_sessions WHERE user_id = $1 AND date = $2`, [A, day])).rows
    expect(sl).toHaveLength(1)
    expect(sl[0].duration_hours).toBe(7)
  })

  it('an imported window lands old heart rate and interval rows; an ordinary sync drops them', async () => {
    who.id = A
    const at = Date.now() - 80 * DAY
    const interval = { kind: 'steps', startMs: at, endMs: at + 60_000, value: 90, recordId: 'hist-1' }
    const hr = { at, bpm: 64 }

    const plain = await (await syncPost({ heartRateSamples: [hr], activityIntervals: [interval] })).json()
    expect(plain.heartRateAccepted).toBe(0)
    expect(plain.intervalsAccepted).toBe(0)

    const from = shiftDateStr(today, -85)
    const imported = await (await syncPost({ historyFrom: from, heartRateSamples: [hr], activityIntervals: [interval] })).json()
    expect(imported.heartRateAccepted).toBe(1)
    expect(imported.intervalsAccepted).toBe(1)

    const iv = (await pool.query(`SELECT value FROM health_connect_intervals WHERE user_id = $1 AND record_id = 'hist-1'`, [A])).rows
    expect(iv).toEqual([{ value: 90 }])
    const hrRows = (await pool.query(`SELECT bpm FROM oura_heartrate WHERE user_id = $1 AND timestamp = $2`, [A, new Date(at)])).rows
    expect(hrRows).toEqual([{ bpm: 64 }])
  })
})
