// #2478. Walk-detection funnel persistence (migration 202610061648). The route test mocks the
// repo; this proves the insert lands every column, that a retried batch adds nothing, and that the
// rows go with the user.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { DetectionEventWrite } from '@/lib/data/repository'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000002478a'
const DETECTION = '7d1e2f30-4a5b-4c6d-8e9f-a0b1c2d3e4f5'

describe.skipIf(!canRun)('detection_events persistence (#2478)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `detection-${TEST_USER_ID}@example.com`],
    )
    await pool.query(`DELETE FROM detection_events WHERE user_id = $1`, [TEST_USER_ID])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM detection_events WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  const at = new Date(Date.now() - 3_600_000)
  const candidate: DetectionEventWrite = {
    detectionId: DETECTION, kind: 'candidate', gate: 'ring_gait_window', occurredAt: at,
    triggerSource: 'ring', activityType: null, sessionStartAt: null,
    distanceM: null, elapsedSec: null, pointCount: null, avgSpeedMs: null,
  }
  const dismissed: DetectionEventWrite = {
    detectionId: DETECTION, kind: 'dismissed', gate: 'min_distance', occurredAt: new Date(at.getTime() + 600_000),
    triggerSource: null, activityType: 'walk', sessionStartAt: new Date(at.getTime() + 60_000),
    distanceM: 512.25, elapsedSec: 540, pointCount: 33, avgSpeedMs: 0.95,
  }

  it('stores every column, with a server recorded_at', async () => {
    expect(await repo.insertDetectionEvents(TEST_USER_ID, [candidate, dismissed])).toBe(2)
    const { rows } = await pool.query(
      `SELECT detection_id, kind, gate, occurred_at, recorded_at, trigger_source, activity_type,
              session_start_at, distance_m, elapsed_sec, point_count, avg_speed_ms
         FROM detection_events WHERE user_id = $1 ORDER BY occurred_at`,
      [TEST_USER_ID],
    )
    expect(rows).toHaveLength(2)
    const r = rows[1]
    expect(r.detection_id).toBe(DETECTION)
    expect(r.kind).toBe('dismissed')
    expect(r.gate).toBe('min_distance')
    expect(new Date(r.occurred_at).getTime()).toBe(dismissed.occurredAt.getTime())
    expect(new Date(r.session_start_at).getTime()).toBe(dismissed.sessionStartAt!.getTime())
    expect(r.activity_type).toBe('walk')
    expect(r.distance_m).toBe(512.25)
    expect(r.elapsed_sec).toBe(540)
    expect(r.point_count).toBe(33)
    expect(r.avg_speed_ms).toBe(0.95)
    expect(rows[0].trigger_source).toBe('ring')
    expect(rows[0].distance_m).toBeNull()
    expect(Math.abs(new Date(r.recorded_at).getTime() - Date.now())).toBeLessThan(3_600_000)
  })

  it('a retried batch inserts nothing and changes nothing', async () => {
    const retry = { ...dismissed, gate: 'rewritten' }
    expect(await repo.insertDetectionEvents(TEST_USER_ID, [candidate, retry])).toBe(0)
    const { rows } = await pool.query(
      `SELECT gate FROM detection_events WHERE user_id = $1 AND kind = 'dismissed'`, [TEST_USER_ID],
    )
    expect(rows.map(r => r.gate)).toEqual(['min_distance'])
  })

  it('a duplicate inside one batch is skipped, not an error', async () => {
    const offered = { ...candidate, kind: 'offered', gate: 'quality_gates' }
    expect(await repo.insertDetectionEvents(TEST_USER_ID, [offered, offered])).toBe(1)
  })

  it('cascades away with the user', async () => {
    const { rows } = await pool.query(
      `SELECT confdeltype FROM pg_constraint
        WHERE conrelid = 'detection_events'::regclass AND contype = 'f'`,
    )
    expect(rows.map(r => r.confdeltype)).toEqual(['c'])
  })
})
