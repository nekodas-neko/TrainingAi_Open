// #2462. Health Connect per-interval movement (migration 202610061624), against a real Postgres.
//
// The route test mocks the repo. This drives the REAL route into the real table — the session is the
// only thing stubbed — and reads the rows back, which is the "prove a non-null value lands" half of
// docs/rules/ai-security-and-integrations.md. Then the repo's own contract: a re-read window is
// idempotent, an edited record replaces its value, every app's overlapping rows are kept, and a read
// is scoped to its user. The last test hands the stored rows to the #2448 input layer's
// `stepCandidates`, which is where the overlap is meant to be resolved.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'

const canRun = !!process.env.DATABASE_URL
const A = '00000000-0000-4000-8000-000000002462'
const B = '00000000-0000-4000-8000-00000000246b'

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: A, timezone: 'Australia/Brisbane' } })) }))

const MIN = 60_000
// Anchored to local midday a day back, so nothing sits near a rolling-window edge or "now".
const T0 = (() => { const d = new Date(Date.now() - 24 * 3_600_000); d.setUTCHours(2, 0, 0, 0); return d.getTime() })()

describe.skipIf(!canRun)('health_connect_intervals (#2462)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    for (const id of [A, B]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `hc-intervals-${id.slice(-4)}@example.com`])
    }
    await pool.query(`DELETE FROM health_connect_intervals WHERE user_id = ANY($1::uuid[])`, [[A, B]])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM health_connect_intervals WHERE user_id = ANY($1::uuid[])`, [[A, B]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[A, B]])
  })

  it('a sync-health POST lands non-null values for every kind, and drops the implausible row', async () => {
    const { POST } = await import('@/app/api/sync-health/route')
    const res = await POST(new NextRequest('http://x/api/sync-health', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ activityIntervals: [
        { kind: 'steps', startMs: T0, endMs: T0 + MIN, value: 96, recordId: 'route-s', origin: 'com.sec.android.app.shealth', device: 'TYPE_WATCH' },
        { kind: 'active_kcal', startMs: T0, endMs: T0 + 5 * MIN, value: 21.4, recordId: 'route-k', origin: 'com.sec.android.app.shealth' },
        { kind: 'cadence_spm', startMs: T0 + 30_000, endMs: T0 + 30_000, value: 112.5, recordId: 'route-c' },
        { kind: 'steps', startMs: T0, endMs: T0 + MIN, value: 9000, recordId: 'route-bad' },
      ] }),
    }))
    expect(res.status).toBe(200)
    expect((await res.json()).intervalsAccepted).toBe(3)

    const { rows } = await pool.query(
      `SELECT kind, record_id, start_at, end_at, value, data_origin, device_type, received_at
         FROM health_connect_intervals WHERE user_id = $1 AND record_id LIKE 'route-%' ORDER BY kind`, [A])
    expect(rows.map(r => [r.kind, r.record_id, r.value, r.data_origin, r.device_type])).toEqual([
      ['active_kcal', 'route-k', 21.4, 'com.sec.android.app.shealth', null],
      ['cadence_spm', 'route-c', 112.5, null, null],
      ['steps', 'route-s', 96, 'com.sec.android.app.shealth', 'TYPE_WATCH'],
    ])
    expect(new Date(rows[2].start_at).getTime()).toBe(T0)
    expect(new Date(rows[2].end_at).getTime()).toBe(T0 + MIN)
    expect(new Date(rows[1].start_at).getTime()).toBe(new Date(rows[1].end_at).getTime())
    for (const r of rows) expect(r.received_at).not.toBeNull()
  })

  it('re-reading the window is idempotent, and an edited record replaces its value', async () => {
    const row = (value: number) => ({
      kind: 'steps' as const, recordId: 'idem', startAt: new Date(T0 + 60 * MIN), endAt: new Date(T0 + 61 * MIN),
      value, dataOrigin: 'com.example', deviceType: 'TYPE_PHONE',
    })
    await repo.upsertHealthConnectIntervals(A, [row(50)])
    const first = await pool.query(`SELECT updated_at FROM health_connect_intervals WHERE user_id = $1 AND record_id = 'idem'`, [A])
    // The same row twice in one batch, and again in a second batch: one row, untouched.
    expect(await repo.upsertHealthConnectIntervals(A, [row(50), row(50)])).toBe(1)
    const again = await pool.query(`SELECT value, updated_at FROM health_connect_intervals WHERE user_id = $1 AND record_id = 'idem'`, [A])
    expect(again.rows).toHaveLength(1)
    expect(again.rows[0].updated_at.getTime()).toBe(first.rows[0].updated_at.getTime())

    await repo.upsertHealthConnectIntervals(A, [row(55)])
    const edited = await pool.query(`SELECT value FROM health_connect_intervals WHERE user_id = $1 AND record_id = 'idem'`, [A])
    expect(edited.rows).toEqual([{ value: 55 }])
  })

  it('keeps every app\'s overlapping rows, and scopes a read to its user', async () => {
    const start = new Date(T0 + 120 * MIN), end = new Date(T0 + 121 * MIN)
    await repo.upsertHealthConnectIntervals(A, [
      { kind: 'steps', recordId: 'phone', startAt: start, endAt: end, value: 80, dataOrigin: 'com.phone', deviceType: 'TYPE_PHONE' },
      { kind: 'steps', recordId: 'watch', startAt: start, endAt: end, value: 95, dataOrigin: 'com.watch', deviceType: 'TYPE_WATCH' },
    ])
    await repo.upsertHealthConnectIntervals(B, [
      { kind: 'steps', recordId: 'phone', startAt: start, endAt: end, value: 7, dataOrigin: 'com.phone', deviceType: null },
    ])
    const a = await repo.getHealthConnectIntervals(A, 'steps', start, end)
    expect(a.map(r => [r.recordId, r.value]).sort()).toEqual([['phone', 80], ['watch', 95]])
    const b = await repo.getHealthConnectIntervals(B, 'steps', start, end)
    expect(b).toEqual([{ kind: 'steps', recordId: 'phone', startAt: start, endAt: end, value: 7, dataOrigin: 'com.phone', deviceType: null }])
    expect(await repo.getHealthConnectIntervals(A, 'active_kcal', start, end)).toEqual([])
  })

  it('the stored rows feed the input layer, which resolves the overlap rather than adding it', async () => {
    const { stepCandidates } = await import('@trainingai/shared/inputs/adapters')
    const start = new Date(T0 + 120 * MIN), end = new Date(T0 + 121 * MIN)
    const rows = await repo.getHealthConnectIntervals(A, 'steps', start, end)
    const candidates = stepCandidates(
      rows.map(r => ({ steps: r.value, startMs: r.startAt.getTime(), endMs: r.endAt.getTime() })), 'device_steps', 'health_connect')
    expect(candidates.reduce((s, c) => s + c.value, 0)).toBe(95)
  })

  it('the table refuses what the route would never send', async () => {
    const bad = [
      [`'distance'`, `'x'`, `now()`, `now()`, `1`],                                    // unknown kind
      [`'steps'`, `' '`, `now()`, `now()`, `1`],                                      // blank record id
      [`'steps'`, `'x'`, `now()`, `now() - interval '1 minute'`, `1`],                // end before start
      [`'steps'`, `'x'`, `now()`, `now()`, `-1`],
      [`'steps'`, `'x'`, `now()`, `now()`, `'Infinity'::double precision`],
      [`'steps'`, `'x'`, `'infinity'::timestamptz`, `'infinity'::timestamptz`, `1`],
    ]
    for (const [kind, id, s, e, v] of bad) {
      await expect(pool.query(
        `INSERT INTO health_connect_intervals (user_id, kind, record_id, start_at, end_at, value) VALUES ($1, ${kind}, ${id}, ${s}, ${e}, ${v})`, [A],
      ), `${kind} ${id} ${s} ${e} ${v}`).rejects.toThrow(/violates check constraint/)
    }
  })

  it('cascades away with the user, and is exposed through claude_ro', async () => {
    const fk = await pool.query(
      `SELECT confdeltype FROM pg_constraint WHERE conrelid = 'health_connect_intervals'::regclass AND contype = 'f'`)
    expect(fk.rows.map(r => r.confdeltype)).toEqual(['c'])
    const { readFileSync } = await import('node:fs')
    expect(readFileSync('lib/data/postgres/claude-ro-views.sql', 'utf8')).toContain('CREATE VIEW claude_ro.health_connect_intervals AS')
  })
})
