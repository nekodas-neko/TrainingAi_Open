// #3802: the `clean-owner-history-3802` agent job, through the real route and a real Postgres.
//
// Each group's shape is seeded beside look-alikes that must survive: another account's rows (same
// shapes, one of the named activity ids), an in-progress session, a real workout next to a stub, a
// midnight start that is short, a long session with a late log, an activity not on the list, and a
// non-empty zone day. Then:
//   · a dry run reports the counts and ids and writes nothing;
//   · a write without an approval is a 403, logged `refused`, nothing written;
//   · a write whose `expect` no longer holds (a row changed after the dry run) is a 409, logged
//     `refused`, nothing written;
//   · a write touches exactly the spec's rows: tombstones with their logs, the two re-timings, the
//     activities with `deleted_reason = 'app'`, the zone rows deleted, records reconciled;
//   · a second dry run finds 0 in every group, and a write with those zeros writes 0.
// Skips where there is no DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { ACTIVITY_IDS_3802 } from '@/lib/workout/clean-owner-history-3802'

const canRun = !!process.env.DATABASE_URL
const OWNER = '00000000-0000-4000-8000-000000380201'
const OTHER = '00000000-0000-4000-8000-000000380202'
const KEY = 'fake-agent-key-for-tests-only-3802-0123456789'
const ACTOR = `t3802-${Math.random().toString(36).slice(2, 8)}`
const APPROVAL = 'https://github.com/nekodas-neko/TrainingAi_Open/issues/3802#issuecomment-6885652396'
const TZ = 'Australia/Brisbane' // UTC+10, no DST: local midnight is 14:00Z the day before
const PRESS = 'Clean3802 Press'

vi.mock('@/auth', () => ({ auth: vi.fn(async () => { throw new Error('auth() must not be called on an agent route') }) }))

describe.skipIf(!canRun)('clean-owner-history-3802 (#3802)', () => {
  let pool: import('pg').Pool
  let route: typeof import('../route')
  let rl: typeof import('@/lib/rate-limit')
  const ids: Record<string, string> = {}

  const resetLimits = async () => {
    rl._resetRateLimitL1()
    await pool.query(`DELETE FROM rate_limits WHERE key LIKE 'agent-actions%'`)
  }
  const post = async (params: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    await resetLimits()
    const res = await route.POST(new Request('http://localhost/api/agent-actions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ job: 'clean-owner-history-3802', actor: ACTOR, targetUserId: OWNER, params, ...extra }),
    }))
    return { status: res.status, body: await res.json() }
  }
  const lastLog = async () => (await pool.query(
    `SELECT outcome, approval_ref, affected_rows::int AS affected_rows, error FROM agent_action_log
     WHERE actor = $1 ORDER BY started_at DESC, id DESC LIMIT 1`, [ACTOR])).rows[0]

  /** Everything the job could touch, for both accounts, as one comparable value. */
  const snapshot = async () => {
    const users = [OWNER, OTHER]
    const q = async (sql: string) => (await pool.query(sql, [users])).rows
    return JSON.stringify({
      ws: await q(`SELECT id, started_at, completed_at, updated_at, deleted_at FROM workout_sessions WHERE user_id = ANY($1) ORDER BY id`),
      el: await q(`SELECT el.id, el.updated_at, el.deleted_at FROM exercise_logs el JOIN workout_sessions ws ON ws.id = el.workout_session_id WHERE ws.user_id = ANY($1) ORDER BY el.id`),
      sl: await q(`SELECT sl.id, sl.deleted_at FROM set_logs sl JOIN exercise_logs el ON el.id = sl.exercise_log_id JOIN workout_sessions ws ON ws.id = el.workout_session_id WHERE ws.user_id = ANY($1) ORDER BY sl.id`),
      al: await q(`SELECT id, updated_at, deleted_at, deleted_reason FROM activity_logs WHERE user_id = ANY($1) ORDER BY id`),
      zm: await q(`SELECT user_id, day::text FROM daily_zone_minutes WHERE user_id = ANY($1) ORDER BY user_id, day`),
      pr: await q(`SELECT user_id, exercise_name, estimated_1rm FROM personal_records WHERE user_id = ANY($1) ORDER BY user_id, exercise_name`),
    })
  }

  async function session(key: string, user: string, startedAt: string, completedAt: string | null) {
    const r = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at) VALUES ($1, '#3802', $2, $3) RETURNING id`,
      [user, startedAt, completedAt])
    ids[key] = r.rows[0].id
    return ids[key]
  }
  async function log(sessionKey: string, loggedAt: string, opts: { rm?: number; deleted?: boolean } = {}) {
    const r = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, volume, logged_at, deleted_at)
       VALUES ($1, $2, $3, 100, $4, $5) RETURNING id`,
      [ids[sessionKey], PRESS, opts.rm ?? 50, loggedAt, opts.deleted ? loggedAt : null])
    await pool.query(`INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps) VALUES ($1, 1, 40, 5), ($1, 2, 40, 5)`, [r.rows[0].id])
  }
  async function zone(user: string, day: string, z2 = 0) {
    await pool.query(
      `INSERT INTO daily_zone_minutes (user_id, day, zone1_sec, zone2_sec, zone3_sec, zone4_sec, zone5_sec) VALUES ($1, $2, 0, $3, 0, 0, 0)`,
      [user, day, z2])
  }
  async function activity(id: string | null, user: string, date: string) {
    const r = await pool.query(
      `INSERT INTO activity_logs (id, user_id, date, title, duration_min) VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, 'Walk', 30) RETURNING id`,
      [id, user, date])
    return r.rows[0].id as string
  }

  async function clean() {
    await pool.query(`DELETE FROM personal_records WHERE user_id = ANY($1)`, [[OWNER, OTHER]])
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1)`, [[OWNER, OTHER]])
    await pool.query(`DELETE FROM activity_logs WHERE user_id = ANY($1) OR id = ANY($2::uuid[])`, [[OWNER, OTHER], ACTIVITY_IDS_3802])
    await pool.query(`DELETE FROM daily_zone_minutes WHERE user_id = ANY($1)`, [[OWNER, OTHER]])
  }

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    route = await import('../route')
    rl = await import('@/lib/rate-limit')
    for (const id of [OWNER, OTHER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone, is_admin, is_active)
         VALUES ($1, $2, 'x', $3, true, true) ON CONFLICT (id) DO NOTHING`,
        [id, `clean-3802-${id.slice(-4)}@example.com`, TZ])
    }
    await clean()

    // 1: never finished, more than a day old; one empty, one with a log (its record must reconcile).
    await session('g1Empty', OWNER, '2026-05-26T08:00:00Z', null)
    await session('g1Logged', OWNER, '2026-06-02T08:00:00Z', null)
    await log('g1Logged', '2026-06-02T08:20:00Z', { rm: 100 })
    await session('inProgress', OWNER, new Date(Date.now() - 3_600_000).toISOString(), null) // survives: started an hour ago
    // 2: finished, no live log (one never had any, one has only a tombstoned log).
    await session('g2Empty', OWNER, '2026-06-20T08:00:00Z', '2026-06-20T09:00:00Z')
    await session('g2DeadLog', OWNER, '2026-06-21T08:00:00Z', '2026-06-21T09:00:00Z')
    await log('g2DeadLog', '2026-06-21T08:10:00Z', { deleted: true })
    await session('realBeside', OWNER, '2026-06-20T10:00:00Z', '2026-06-20T11:00:00Z') // survives: a real workout next to the stub
    await log('realBeside', '2026-06-20T10:15:00Z', { rm: 80 })
    // 3a: zero length at local midnight (with a log, so it is not also group 2).
    await session('g3a', OWNER, '2026-05-03T14:00:00Z', '2026-05-03T14:00:00Z')
    await log('g3a', '2026-05-03T14:00:00Z')
    // 3b: local-midnight start, 13 h long; the first log is 01:30Z.
    await session('g3b', OWNER, '2026-05-24T14:00:00Z', '2026-05-25T03:00:00Z')
    await log('g3b', '2026-05-25T02:00:00Z')
    await log('g3b', '2026-05-25T01:30:00Z')
    await session('midnightShort', OWNER, '2026-05-27T14:00:00Z', '2026-05-27T19:00:00Z') // survives: 5 h
    await log('midnightShort', '2026-05-27T15:00:00Z')
    // 3c: 11 h long, every log before completed_at - 10 h (09:00Z).
    await session('g3c', OWNER, '2026-05-10T08:00:00Z', '2026-05-10T19:00:00Z')
    await log('g3c', '2026-05-10T08:10:00Z')
    await log('g3c', '2026-05-10T08:50:00Z')
    await session('longLateLog', OWNER, '2026-05-11T08:00:00Z', '2026-05-11T19:00:00Z') // survives: a log at 18:00Z
    await log('longLateLog', '2026-05-11T08:10:00Z')
    await log('longLateLog', '2026-05-11T18:00:00Z')
    // The other account: the same shapes, all must survive.
    await session('otherG1', OTHER, '2026-05-26T08:00:00Z', null)
    await session('otherG2', OTHER, '2026-06-20T08:00:00Z', '2026-06-20T09:00:00Z')
    await session('otherG3b', OTHER, '2026-05-24T14:00:00Z', '2026-05-25T03:00:00Z')
    await log('otherG3b', '2026-05-25T01:30:00Z')

    // 4: two of the named ids are the owner's; a third belongs to the other account; one owner row is not named.
    ids.act1 = await activity(ACTIVITY_IDS_3802[0], OWNER, '2026-09-24')
    ids.act2 = await activity(ACTIVITY_IDS_3802[3], OWNER, '2026-06-17')
    ids.actOther = await activity(ACTIVITY_IDS_3802[1], OTHER, '2026-06-17')
    ids.actKept = await activity(null, OWNER, '2026-09-24')

    // 5: two empty owner days; a non-empty owner day and the other account's empty day survive.
    await zone(OWNER, '2026-06-03')
    await zone(OWNER, '2026-06-21')
    await zone(OWNER, '2026-06-22', 600)
    await zone(OTHER, '2026-06-03')

    // A record that cites the dead session's log (100); the best live log is 80.
    await pool.query(
      `INSERT INTO personal_records (user_id, exercise_name, estimated_1rm, achieved_at) VALUES ($1, $2, 100, '2026-06-02T08:20:00Z')`,
      [OWNER, PRESS])
  })

  afterAll(async () => {
    if (!canRun) return
    await clean()
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[OWNER, OTHER]])
    await pool.query(`DELETE FROM rate_limits WHERE key LIKE 'agent-actions%'`)
  })

  beforeEach(() => {
    process.env.AGENT_ACTIONS_SECRET = KEY
    process.env.ADMIN_EXPORT_USER_ID = OWNER
  })

  const EXPECT = { '1': 2, '2': 2, '3a': 1, '3b': 1, '3c': 1, '4': 2, '5': 2 }

  it('a dry run reports each group\'s count and ids, and writes nothing', async () => {
    const before = await snapshot()
    const { status, body } = await post({ dryRun: true })
    expect(status).toBe(200)
    const r = body.report
    expect(r.counts).toEqual(EXPECT)
    expect(r.groups['1'].ids).toEqual([ids.g1Empty, ids.g1Logged])
    expect(r.groups['2'].ids).toEqual([ids.g2Empty, ids.g2DeadLog])
    expect(r.groups['3a'].ids).toEqual([ids.g3a])
    expect(r.groups['3b'].changes).toEqual([{ id: ids.g3b, startedAt: { before: '2026-05-24T14:00:00.000Z', after: '2026-05-25T01:30:00.000Z' } }])
    expect(r.groups['3c'].changes).toEqual([{ id: ids.g3c, completedAt: { before: '2026-05-10T19:00:00.000Z', after: '2026-05-10T09:00:00.000Z' } }])
    expect(r.groups['4'].ids.sort()).toEqual([ids.act1, ids.act2].sort())
    expect(r.groups['5'].days).toEqual(['2026-06-03', '2026-06-21'])
    expect(r.overlaps).toEqual([])
    // Live children under the tombstones: g1Logged's and g3a's logs (g2DeadLog's is already dead).
    expect(r.childLogs).toEqual({ exerciseLogs: 2, setLogs: 4 })
    expect(r.written).toBeUndefined()
    // Ids only: no titles or names anywhere in the answer.
    expect(JSON.stringify(body)).not.toMatch(/Walk|Clean3802|#3802/)
    expect(await snapshot()).toBe(before)
    expect(await lastLog()).toMatchObject({ outcome: 'succeeded', affected_rows: 0 })
  })

  it('a write without an approval is refused with 403, logged, and writes nothing', async () => {
    const before = await snapshot()
    const { status } = await post({ dryRun: false, expect: EXPECT })
    expect(status).toBe(403)
    expect(await lastLog()).toMatchObject({ outcome: 'refused', approval_ref: null })
    expect(await snapshot()).toBe(before)
  })

  it('a write needs the dry run\'s counts', async () => {
    const { status } = await post({ dryRun: false }, { approval: APPROVAL })
    expect(status).toBe(400)
  })

  it('refuses, writing nothing, when a row changed after the dry run', async () => {
    await zone(OWNER, '2026-06-23') // a new empty day: group 5 is now 3
    try {
      const before = await snapshot()
      const { status, body } = await post({ dryRun: false, expect: EXPECT }, { approval: APPROVAL })
      expect(status).toBe(409)
      expect(body.found).toEqual({ ...EXPECT, '5': 3 })
      expect(await lastLog()).toMatchObject({ outcome: 'refused', error: 'counts_changed', approval_ref: APPROVAL })
      expect(await snapshot()).toBe(before)
    } finally {
      await pool.query(`DELETE FROM daily_zone_minutes WHERE user_id = $1 AND day = '2026-06-23'`, [OWNER])
    }
  })

  it('a write changes exactly the spec\'s rows', async () => {
    const { status, body } = await post({ dryRun: false, expect: EXPECT }, { approval: APPROVAL })
    expect(status).toBe(200)
    expect(body.report.written).toEqual({
      sessionsRetimed: 2, sessionsTombstoned: 5, exerciseLogsTombstoned: 2, setLogsTombstoned: 4,
      activitiesTombstoned: 2, zoneDaysDeleted: 2, personalRecordsReconciled: 1,
    })
    expect(await lastLog()).toMatchObject({ outcome: 'succeeded', approval_ref: APPROVAL, affected_rows: 11 })

    const ws = Object.fromEntries((await pool.query(
      `SELECT id, started_at, completed_at, deleted_at, updated_at FROM workout_sessions WHERE user_id = ANY($1)`, [[OWNER, OTHER]]))
      .rows.map(r => [r.id, r]))
    const dead = ['g1Empty', 'g1Logged', 'g2Empty', 'g2DeadLog', 'g3a']
    const alive = ['inProgress', 'realBeside', 'g3b', 'g3c', 'midnightShort', 'longLateLog', 'otherG1', 'otherG2', 'otherG3b']
    for (const k of dead) expect(ws[ids[k]].deleted_at, k).not.toBeNull()
    for (const k of alive) expect(ws[ids[k]].deleted_at, k).toBeNull()
    // Every write bumps updated_at, so the delta pull carries it to the phones.
    for (const k of [...dead, 'g3b', 'g3c']) expect(Date.now() - ws[ids[k]].updated_at.getTime(), k).toBeLessThan(60_000)
    expect(ws[ids.g3b].started_at.toISOString()).toBe('2026-05-25T01:30:00.000Z')
    expect(ws[ids.g3b].completed_at.toISOString()).toBe('2026-05-25T03:00:00.000Z')
    expect(ws[ids.g3c].completed_at.toISOString()).toBe('2026-05-10T09:00:00.000Z')
    expect(ws[ids.g3c].started_at.toISOString()).toBe('2026-05-10T08:00:00.000Z')
    expect(ws[ids.otherG3b].started_at.toISOString()).toBe('2026-05-24T14:00:00.000Z')
    expect(ws[ids.longLateLog].completed_at.toISOString()).toBe('2026-05-11T19:00:00.000Z')

    // The children went with their sessions, through the app's own delete path.
    const liveChildren = (await pool.query(
      `SELECT count(*)::int AS n FROM exercise_logs el LEFT JOIN set_logs sl ON sl.exercise_log_id = el.id
       WHERE el.workout_session_id = ANY($1::uuid[]) AND (el.deleted_at IS NULL OR sl.deleted_at IS NULL)`,
      [[ids.g1Logged, ids.g3a]])).rows[0].n
    expect(liveChildren).toBe(0)

    const al = Object.fromEntries((await pool.query(
      `SELECT id, deleted_at, deleted_reason FROM activity_logs WHERE user_id = ANY($1)`, [[OWNER, OTHER]])).rows.map(r => [r.id, r]))
    for (const k of ['act1', 'act2']) expect(al[ids[k]]).toMatchObject({ deleted_reason: 'app' })
    for (const k of ['act1', 'act2']) expect(al[ids[k]].deleted_at).not.toBeNull()
    for (const k of ['actOther', 'actKept']) expect(al[ids[k]]).toMatchObject({ deleted_at: null, deleted_reason: null })

    const zm = (await pool.query(`SELECT user_id, day::text AS day FROM daily_zone_minutes WHERE user_id = ANY($1) ORDER BY user_id, day`, [[OWNER, OTHER]])).rows
    expect(zm).toEqual([{ user_id: OWNER, day: '2026-06-22' }, { user_id: OTHER, day: '2026-06-03' }])

    // The record that cited the tombstoned log follows the best live one.
    const pr = (await pool.query(`SELECT estimated_1rm FROM personal_records WHERE user_id = $1 AND exercise_name = $2`, [OWNER, PRESS])).rows
    expect(pr.map(r => Number(r.estimated_1rm))).toEqual([80])
  })

  it('a second run finds nothing to do', async () => {
    const zero = { '1': 0, '2': 0, '3a': 0, '3b': 0, '3c': 0, '4': 0, '5': 0 }
    const dry = await post({ dryRun: true })
    expect(dry.body.report.counts).toEqual(zero)
    const before = await snapshot()
    const { status, body } = await post({ dryRun: false, expect: zero }, { approval: APPROVAL })
    expect(status).toBe(200)
    expect(body.report.written).toMatchObject({ sessionsRetimed: 0, sessionsTombstoned: 0, activitiesTombstoned: 0, zoneDaysDeleted: 0 })
    expect(await lastLog()).toMatchObject({ outcome: 'succeeded', affected_rows: 0 })
    expect(await snapshot()).toBe(before)
  })
})
