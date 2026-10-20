// #3081 — a value Oura adds keeps its document, and a session Oura deletes leaves our tables.
//
// Against a real Postgres (skips without DATABASE_URL). Oura is not called: documents are built from
// the spec-shaped fixtures and written through `writeOuraCloudData`, the path the webhook and backfill
// use, and the delete through `handleOuraWebhookEvent` with no token involved.
//   - a sleep period with a type Oura added is stored as sent and is a night on its own, but beside a
//     `long_sleep` it never joins the night;
//   - a workout with a new intensity lands, the value stored as null, and the report carries counts
//     and field names only, never the value;
//   - a deleted session is removed for that user, and another account's session with the same id stays.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { FIXTURES, sleepPeriod } from '@/lib/oura/cloud/__tests__/fixtures'

const reportServerError = vi.fn()
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003081'
const OTHER = '00000000-0000-4000-8000-000000013081'
const NEW = 'a_value_oura_added'
// `oura_workouts.id` is Oura's id and a global key, so the fixture's id would collide with other suites'.
const WORKOUT = 'wo-3081'

describe.skipIf(!canRun)('Oura documents with a new value, and session deletes (#3081)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    for (const [id, email] of [[USER, 'issue-3081@example.com'], [OTHER, 'issue-3081-other@example.com']]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`, [id, email])
    }
  })
  afterAll(async () => { if (canRun) await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER, OTHER]]) })
  beforeEach(async () => {
    for (const t of ['sleep_sessions', 'oura_cloud_sleep_periods', 'body_metrics', 'oura_workouts', 'oura_sessions', 'oura_tokens']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = ANY($1)`, [[USER, OTHER]])
    }
    reportServerError.mockReset()
    const { resetOuraCloudReportThrottle } = await import('@/lib/oura/cloud/report')
    resetOuraCloudReportThrottle()
  })

  async function write(userId: string, ...docs: { type: string; doc: Record<string, unknown> }[]) {
    const { mapOuraDocuments, parseOuraDocument } = await import('@/lib/oura/cloud/documents')
    const { writeOuraCloudData } = await import('@/lib/oura/cloud/ingest')
    const parsed = docs.map(d => parseOuraDocument(d.type as never, d.doc))
    expect(parsed.every(Boolean), 'every document parses').toBe(true)
    return writeOuraCloudData(repo, userId, mapOuraDocuments(parsed as never), repo)
  }
  const reports = () => reportServerError.mock.calls.map(c => (c[0] as Error).message)
  const settle = () => new Promise(r => setTimeout(r, 30))

  it('a sleep period with a new type is stored as sent, and is the night when it is the only period', async () => {
    await write(USER, { type: 'sleep', doc: { ...sleepPeriod, type: NEW } })
    expect((await pool.query(`SELECT sleep_type FROM oura_cloud_sleep_periods WHERE user_id = $1`, [USER])).rows).toEqual([{ sleep_type: NEW }])
    const nights = await repo.listSleepSessions(USER, sleepPeriod.day, sleepPeriod.day)
    expect(nights.map(n => [n.ouraId, n.ouraSleepType])).toEqual([['sl-1', NEW]])
  })

  it('beside a long_sleep, a period with a new type never joins the night', async () => {
    const { nightForDate } = await import('@trainingai/shared/health/sleep-night')
    // A 35-minute period ending 40 minutes before the main night starts: within one night's reach.
    await write(USER,
      { type: 'sleep', doc: { ...sleepPeriod, id: 'odd', type: NEW, bedtime_start: '2026-10-09T21:15:00+10:00', bedtime_end: '2026-10-09T21:50:00+10:00', total_sleep_duration: 1500, time_in_bed: 2100 } },
      { type: 'sleep', doc: sleepPeriod },
    )
    const sessions = await repo.listSleepSessions(USER, sleepPeriod.day, sleepPeriod.day)
    expect(sessions.map(s => s.ouraId).sort()).toEqual(['odd', 'sl-1'])
    const night = nightForDate(sessions, sleepPeriod.day, 'Australia/Brisbane')!
    expect(night.windows.map(w => w.ouraId)).toEqual(['sl-1'])
    // HRV and resting HR come from the main period only.
    const vitals = (await pool.query(`SELECT hrv_ms FROM body_metrics WHERE user_id = $1 AND date = $2`, [USER, sleepPeriod.day])).rows[0]
    expect(vitals?.hrv_ms).toBe(sleepPeriod.average_hrv)
  })

  it('a workout with a new intensity lands with it as null, and the report carries counts only', async () => {
    const counts = await write(USER, { type: 'workout', doc: { ...FIXTURES.workout, id: WORKOUT, intensity: NEW } }, { type: 'session', doc: { ...FIXTURES.session, type: NEW } })
    expect(counts).toMatchObject({ workouts: 1, sessions: 1 })
    expect((await pool.query(`SELECT intensity FROM oura_workouts WHERE user_id = $1`, [USER])).rows).toEqual([{ intensity: null }])
    expect((await pool.query(`SELECT session_type FROM oura_sessions WHERE user_id = $1`, [USER])).rows).toEqual([{ session_type: null }])
    await settle()
    expect(reports()).toEqual([
      'oura_cloud document:unknown-value: values outside the pinned spec, documents kept: workout.intensity ×1, session.type ×1',
    ])
    expect(reports().join(' ')).not.toContain(NEW)
  })

  it('reports nothing when every value is on the list', async () => {
    await write(USER, { type: 'workout', doc: { ...FIXTURES.workout, id: WORKOUT } }, { type: 'sleep', doc: { ...sleepPeriod, sleep_analysis_reason: 'background_sleep_analysis' } })
    await settle()
    expect(reports()).toEqual([])
    expect((await pool.query(`SELECT sleep_analysis_reason FROM oura_cloud_sleep_periods WHERE user_id = $1`, [USER])).rows)
      .toEqual([{ sleep_analysis_reason: 'background_sleep_analysis' }])
  })

  it("a deleted session leaves this user's table, and another account's session with the same id stays", async () => {
    await write(USER, { type: 'session', doc: FIXTURES.session })
    await write(OTHER, { type: 'session', doc: FIXTURES.session })
    const { handleOuraWebhookEvent } = await import('@/lib/oura/cloud/webhook')
    const deps = {
      // The real repository, routing the test's Oura account to USER (a spread would drop its methods).
      repo: Object.assign(Object.create(repo), { getUserIdByOuraUserId: async (id: string) => (id === 'oura-3081' ? USER : null) }),
      config: { clientId: 'c', clientSecret: 's', redirectUri: 'https://example.com/cb' },
    }
    const del = { event_type: 'delete' as const, data_type: 'session', object_id: FIXTURES.session.id, user_id: 'oura-3081' }
    expect(await handleOuraWebhookEvent(deps, del)).toEqual({ result: 'deleted', rows: 1 })
    // Oura retries a delivery; the second is a no-op.
    expect(await handleOuraWebhookEvent(deps, del)).toEqual({ result: 'deleted', rows: 0 })
    const left = (await pool.query(`SELECT user_id FROM oura_sessions WHERE oura_id = $1 AND user_id = ANY($2)`, [FIXTURES.session.id, [USER, OTHER]])).rows
    expect(left).toEqual([{ user_id: OTHER }])
  })
})
