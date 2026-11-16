// #3802: the `clean-owner-history-3802` agent job, through the real route and a real Postgres.
//
// The fixture holds exactly the spec's counts (14 / 3 / 4 / 7 / 4 / 7 / 19), because a write now
// refuses any other plan. Beside each group sit look-alikes that must survive: rows just outside
// group 1's and group 5's windows, an in-progress session, a just-finished empty workout, a real
// workout next to a stub, zero-length sessions not at Brisbane midnight (one at 00:00Z), a short
// midnight start, a midnight start whose only log is after its end, a long session with a late log,
// an activity not on the list, a non-empty zone day, and another account's rows of the same shapes.
// Then:
//   · a dry run reports counts, ids, digests and the record effect, and writes nothing;
//   · a write is refused, writing nothing: without an approval (403), with an approval on another
//     issue or without digests (400), with the same counts but different ids (409 ids_changed), with
//     counts that are not the spec's (409 counts_unexpected);
//   · a statement touching the wrong row count rolls the whole write back;
//   · a write touches exactly the spec's rows, keeps an already-tombstoned child's own deleted_at,
//     decrements the phase counter, lowers and removes the records, and counts what it wrote;
//   · a second run finds 0 everywhere and its write is refused;
//   · a reconcile that throws after commit is listed in the report, and the write still answers.
// Skips where there is no DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { PoolClient } from 'pg'
import {
  ACTIVITY_IDS_3802, SPEC_COUNTS_3802, cleanOwnerHistory3802, type CleanDeps,
} from '@/lib/workout/clean-owner-history-3802'

const canRun = !!process.env.DATABASE_URL
const OWNER = '00000000-0000-4000-8000-000000380201'
const OTHER = '00000000-0000-4000-8000-000000380202'
const KEY = 'fake-agent-key-for-tests-only-3802-0123456789'
const ACTOR = `t3802-${Math.random().toString(36).slice(2, 8)}`
const APPROVAL = 'https://github.com/nekodas-neko/TrainingAi_Open/issues/3802#issuecomment-6885652396'
// The account's stored zone is NOT the spec's, and under it 00:00Z is midnight: the job must still
// read Brisbane midnight, or zeroUtcMidnight would be 3a and utcMidnightLong 3b.
const STORED_TZ = 'UTC'
const PRESS = 'Clean3802 Press'
const SQUAT = 'Clean3802 Squat'
const SPEC = { ...SPEC_COUNTS_3802 }

vi.mock('@/auth', () => ({ auth: vi.fn(async () => { throw new Error('auth() must not be called on an agent route') }) }))

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
/** Brisbane is UTC+10 with no DST: local midnight of `day` is 14:00Z the day before. */
const brisbaneMidnight = (day: string) => new Date(new Date(`${day}T00:00:00Z`).getTime() - 10 * 3_600_000)
const plusH = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000).toISOString()

describe.skipIf(!canRun)('clean-owner-history-3802 (#3802)', () => {
  let pool: import('pg').Pool
  let route: typeof import('../route')
  let rl: typeof import('@/lib/rate-limit')
  let repo: import('@/lib/data/repository').WorkoutRepository
  let ids: Record<string, string> = {}
  let programSessionId = ''

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
  const dryDigests = async () => (await post({ dryRun: true })).body.report.digests
  const lastLog = async () => (await pool.query(
    `SELECT outcome, approval_ref, affected_rows::int AS affected_rows, error FROM agent_action_log
     WHERE actor = $1 ORDER BY started_at DESC, id DESC LIMIT 1`, [ACTOR])).rows[0]
  const deps = (over: Partial<CleanDeps> = {}): CleanDeps => ({
    connect: () => pool.connect(),
    reconcilePersonalRecord: (u, n) => repo.reconcilePersonalRecord(u, n),
    bestQualifyingPersonalRecord: (u, n, o) => repo.bestQualifyingPersonalRecord(u, n, o),
    ...over,
  })

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
      sp: await q(`SELECT user_id, sessions_in_phase FROM session_periodization WHERE user_id = ANY($1) ORDER BY id`),
    })
  }

  async function session(key: string, user: string, startedAt: string, completedAt: string | null, sessionId: string | null = null) {
    const r = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at, session_id) VALUES ($1, '#3802', $2, $3, $4) RETURNING id`,
      [user, startedAt, completedAt, sessionId])
    ids[key] = r.rows[0].id
    return ids[key]
  }
  async function log(sessionKey: string, loggedAt: string, opts: { rm?: number; deleted?: boolean; name?: string; deadSetAt?: string } = {}) {
    const r = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, volume, logged_at, deleted_at)
       VALUES ($1, $2, $3, 100, $4, $5) RETURNING id`,
      [ids[sessionKey], opts.name ?? PRESS, opts.rm ?? 50, loggedAt, opts.deleted ? loggedAt : null])
    await pool.query(`INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps) VALUES ($1, 1, 40, 5), ($1, 2, 40, 5)`, [r.rows[0].id])
    if (opts.deadSetAt) {
      await pool.query(`INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, deleted_at) VALUES ($1, 3, 40, 5, $2)`, [r.rows[0].id, opts.deadSetAt])
    }
    return r.rows[0].id as string
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
    await pool.query(`DELETE FROM programs WHERE user_id = ANY($1)`, [[OWNER, OTHER]]) // cascades the periodization row
  }

  async function seed() {
    ids = {}
    const prog = (await pool.query(`INSERT INTO programs (user_id, name) VALUES ($1, '#3802') RETURNING id`, [OWNER])).rows[0].id
    programSessionId = (await pool.query(
      `INSERT INTO program_sessions (program_id, name, position) VALUES ($1, '#3802', 1) RETURNING id`, [prog])).rows[0].id
    await pool.query(
      `INSERT INTO session_periodization (user_id, program_session_id, phase_started_at, sessions_in_phase) VALUES ($1, $2, '2026-01-01T00:00:00Z', 3)`,
      [OWNER, programSessionId])

    // 1 (14): never finished, in the window 26 May – 3 Jul (Brisbane). The two edges, one with logs
    // (a record cites it), and eleven more.
    await session('g1First', OWNER, brisbaneMidnight('2026-05-26').toISOString(), null)
    await session('g1Last', OWNER, plusH(brisbaneMidnight('2026-07-04'), -1 / 60), null) // 3 Jul 23:59 local
    await session('g1Logged', OWNER, '2026-06-02T08:00:00Z', null)
    ids.g1PressLog = await log('g1Logged', '2026-06-02T08:20:00Z', { rm: 100, deadSetAt: '2026-06-02T09:00:00Z' })
    await log('g1Logged', '2026-06-02T08:30:00Z', { rm: 60, name: SQUAT })
    for (let i = 0; i < 11; i++) await session(`g1n${i}`, OWNER, `2026-06-${String(5 + i).padStart(2, '0')}T08:00:00Z`, null)
    await session('g1Before', OWNER, plusH(brisbaneMidnight('2026-05-26'), -1 / 60), null) // survives: 25 May local
    await session('g1After', OWNER, brisbaneMidnight('2026-07-04').toISOString(), null)     // survives: 4 Jul local
    await session('inProgress', OWNER, hoursAgo(1), null)                                   // survives: an hour old

    // 2 (3): finished, no live log. One is a program session (the phase counter goes down); one has
    // only a log tombstoned long ago, whose own deleted_at must survive.
    await session('g2Program', OWNER, '2026-06-20T08:00:00Z', '2026-06-20T09:00:00Z', programSessionId)
    await session('g2DeadLog', OWNER, '2026-06-21T08:00:00Z', '2026-06-21T09:00:00Z')
    ids.deadLog = await log('g2DeadLog', '2026-06-21T08:10:00Z', { deleted: true })
    await session('g2Third', OWNER, '2026-06-22T08:00:00Z', '2026-06-22T09:00:00Z')
    await session('g2Fresh', OWNER, hoursAgo(2), hoursAgo(1))                     // survives: finished an hour ago
    await session('realBeside', OWNER, '2026-06-20T10:00:00Z', '2026-06-20T11:00:00Z') // survives: a real workout
    await log('realBeside', '2026-06-20T10:15:00Z', { rm: 80 })

    // 3a (4): zero length at Brisbane midnight, each with a log (so not also group 2).
    for (let i = 0; i < 4; i++) {
      const at = brisbaneMidnight(`2026-05-0${3 + i}`).toISOString()
      await session(`g3a${i}`, OWNER, at, at)
      await log(`g3a${i}`, at)
    }
    await session('zeroEvening', OWNER, '2026-05-08T10:00:00Z', '2026-05-08T10:00:00Z') // survives: 20:00 local
    await log('zeroEvening', '2026-05-08T10:00:00Z')
    await session('zeroUtcMidnight', OWNER, '2026-05-09T00:00:00Z', '2026-05-09T00:00:00Z') // survives: 00:00Z is 10:00 local
    await log('zeroUtcMidnight', '2026-05-09T00:00:00Z')

    // 3b (7): Brisbane-midnight start, longer than 6 h. The first has two logs (the earlier wins).
    await session('g3b', OWNER, '2026-05-24T14:00:00Z', '2026-05-25T03:00:00Z')
    await log('g3b', '2026-05-25T02:00:00Z')
    await log('g3b', '2026-05-25T01:30:00Z')
    for (let i = 0; i < 6; i++) {
      const m = brisbaneMidnight(`2026-05-${String(12 + i).padStart(2, '0')}`)
      await session(`g3b${i}`, OWNER, m.toISOString(), plusH(m, 10))
      await log(`g3b${i}`, plusH(m, 9))
    }
    await session('midnightShort', OWNER, '2026-05-27T14:00:00Z', '2026-05-27T19:00:00Z') // survives: 5 h
    await log('midnightShort', '2026-05-27T15:00:00Z')
    await session('logAfterEnd', OWNER, '2026-05-28T14:00:00Z', '2026-05-28T21:00:00Z')  // survives: its only log is after the end
    await log('logAfterEnd', '2026-05-28T22:00:00Z')
    await session('utcMidnightLong', OWNER, '2026-05-30T00:00:00Z', '2026-05-30T08:00:00Z') // survives: 8 h from 10:00 local
    await log('utcMidnightLong', '2026-05-30T01:00:00Z')

    // 3c (4): 11 h long, every log at or before completed_at - 10 h.
    await session('g3c', OWNER, '2026-05-10T08:00:00Z', '2026-05-10T19:00:00Z')
    await log('g3c', '2026-05-10T08:10:00Z')
    await log('g3c', '2026-05-10T08:50:00Z')
    for (let i = 0; i < 3; i++) {
      await session(`g3c${i}`, OWNER, `2026-05-2${i}T08:00:00Z`, `2026-05-2${i}T19:00:00Z`)
      await log(`g3c${i}`, `2026-05-2${i}T09:00:00Z`) // exactly completed_at - 10 h: "at or before"
    }
    await session('longLateLog', OWNER, '2026-05-11T08:00:00Z', '2026-05-11T19:00:00Z') // survives: a log at 18:00Z
    await log('longLateLog', '2026-05-11T08:10:00Z')
    await log('longLateLog', '2026-05-11T18:00:00Z')

    // The other account: the same shapes, all must survive.
    await session('otherG1', OTHER, '2026-05-26T08:00:00Z', null)
    await session('otherG2', OTHER, '2026-06-20T08:00:00Z', '2026-06-20T09:00:00Z')
    await session('otherG3b', OTHER, '2026-05-24T14:00:00Z', '2026-05-25T03:00:00Z')
    await log('otherG3b', '2026-05-25T01:30:00Z')

    // 4 (7): every named id is the owner's; one owner row is not named.
    for (let i = 0; i < ACTIVITY_IDS_3802.length; i++) ids[`act${i}`] = await activity(ACTIVITY_IDS_3802[i], OWNER, '2026-06-17')
    ids.actKept = await activity(null, OWNER, '2026-09-24')

    // 5 (19): every day 3 – 21 Jun empty. 2 Jun (outside the window), a non-empty day and the other
    // account's empty day survive.
    for (let d = 3; d <= 21; d++) await zone(OWNER, `2026-06-${String(d).padStart(2, '0')}`)
    await zone(OWNER, '2026-06-02')
    await zone(OWNER, '2026-06-22', 600)
    await zone(OTHER, '2026-06-03')

    // PRESS: the record cites the dead session's 100; the best live log is 80 → lowered.
    // SQUAT: its only log is in a tombstoned session → removed.
    await pool.query(
      `INSERT INTO personal_records (user_id, exercise_name, estimated_1rm, achieved_at)
       VALUES ($1, $2, 100, '2026-06-02T08:20:00Z'), ($1, $3, 60, '2026-06-02T08:30:00Z')`,
      [OWNER, PRESS, SQUAT])
  }

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    route = await import('../route')
    rl = await import('@/lib/rate-limit')
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    for (const id of [OWNER, OTHER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone, is_admin, is_active)
         VALUES ($1, $2, 'x', $3, true, true) ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone`,
        [id, `clean-3802-${id.slice(-4)}@example.com`, STORED_TZ])
    }
    await clean()
    await seed()
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

  const G1 = () => ['g1First', ...Array.from({ length: 11 }, (_, i) => `g1n${i}`), 'g1Logged', 'g1Last']
  const G2 = ['g2Program', 'g2DeadLog', 'g2Third']

  it('a dry run reports the spec\'s counts, ids, digests and record effect, and writes nothing', async () => {
    const before = await snapshot()
    const { status, body } = await post({ dryRun: true })
    expect(status).toBe(200)
    const r = body.report
    expect(r.counts).toEqual(SPEC)
    expect(r.matchesSpec).toBe(true)
    for (const g of Object.keys(SPEC)) expect(r.digests[g]).toMatch(/^[0-9a-f]{64}$/)
    expect([...r.groups['1'].ids].sort()).toEqual(G1().map(k => ids[k]).sort())
    expect(r.groups['2'].ids).toEqual(G2.map(k => ids[k]))
    expect(r.groups['3a'].ids).toEqual([0, 1, 2, 3].map(i => ids[`g3a${i}`]))
    expect(r.groups['3b'].changes[0]).toEqual({ id: ids.g3b0, startedAt: { before: '2026-05-11T14:00:00.000Z', after: '2026-05-11T23:00:00.000Z' } })
    expect(r.groups['3b'].changes.find((c: { id: string }) => c.id === ids.g3b))
      .toEqual({ id: ids.g3b, startedAt: { before: '2026-05-24T14:00:00.000Z', after: '2026-05-25T01:30:00.000Z' } })
    expect(r.groups['3c'].changes[0]).toEqual({ id: ids.g3c, completedAt: { before: '2026-05-10T19:00:00.000Z', after: '2026-05-10T09:00:00.000Z' } })
    expect([...r.groups['4'].ids].sort()).toEqual([...ACTIVITY_IDS_3802].sort())
    expect(r.groups['5'].days).toHaveLength(19)
    expect(r.groups['5'].days[0]).toBe('2026-06-03')
    expect(r.groups['5'].days[18]).toBe('2026-06-21')
    expect(r.overlaps).toEqual([])
    // Live children: g1Logged's 2 logs and 4 live sets (its dead set not counted), each 3a's log and
    // 2 sets, and g2DeadLog's 2 live sets under its already-dead log.
    expect(r.childLogs).toEqual({ exerciseLogs: 6, setLogs: 14 })
    expect(r.personalRecords).toEqual({ exercises: 2, lower: 1, remove: 1, unchanged: 0, add: 0, raise: 0 })
    expect(r.written).toBeUndefined()
    // Ids and counts only: no titles or exercise names anywhere in the answer.
    expect(JSON.stringify(body)).not.toMatch(/Walk|Clean3802|#3802/)
    expect(await snapshot()).toBe(before)
    expect(await lastLog()).toMatchObject({ outcome: 'succeeded', affected_rows: 0 })
  })

  it('a named activity that is another account\'s is not the owner\'s to tombstone', async () => {
    await pool.query(`UPDATE activity_logs SET user_id = $1 WHERE id = $2`, [OTHER, ACTIVITY_IDS_3802[1]])
    try {
      const { body } = await post({ dryRun: true })
      expect(body.report.counts['4']).toBe(6)
      expect(body.report.groups['4'].ids).not.toContain(ACTIVITY_IDS_3802[1])
      expect(body.report.matchesSpec).toBe(false)
    } finally {
      await pool.query(`UPDATE activity_logs SET user_id = $1 WHERE id = $2`, [OWNER, ACTIVITY_IDS_3802[1]])
    }
  })

  it('a write without an approval is refused with 403, logged, and writes nothing', async () => {
    const digests = await dryDigests()
    const before = await snapshot()
    const { status } = await post({ dryRun: false, digests })
    expect(status).toBe(403)
    expect(await lastLog()).toMatchObject({ outcome: 'refused', approval_ref: null })
    expect(await snapshot()).toBe(before)
  })

  it('the approval must be the comment on issue #3802 that records the owner\'s yes', async () => {
    const digests = await dryDigests()
    const before = await snapshot()
    for (const approval of [
      'https://github.com/nekodas-neko/TrainingAi_Open/issues/3801#issuecomment-6885652396',
      'https://github.com/nekodas-neko/TrainingAi_Open/pull/3802#issuecomment-6885652396',
      'https://github.com/nekodas-neko/TrainingAi_Open/issues/38020#issuecomment-6885652396',
      // Another comment on #3802, such as an agent's own, is not the owner's yes.
      'https://github.com/nekodas-neko/TrainingAi_Open/issues/3802#issuecomment-6887184628',
    ]) {
      const { status, body } = await post({ dryRun: false, digests }, { approval })
      expect(status, approval).toBe(400)
      expect(JSON.stringify(body.issues)).toMatch(/issue #3802/)
    }
    expect(await snapshot()).toBe(before)
  })

  it('a write needs the dry run\'s digests', async () => {
    const { status } = await post({ dryRun: false }, { approval: APPROVAL })
    expect(status).toBe(400)
  })

  it('refuses, writing nothing, when a group has the same count but different rows', async () => {
    const digests = await dryDigests()
    // Swap one group-1 row for another: 14 still, but not the 14 the dry run listed.
    await pool.query(`UPDATE workout_sessions SET deleted_at = now() WHERE id = $1`, [ids.g1n0])
    const swapped = await session('g1Swap', OWNER, '2026-06-30T08:00:00Z', null)
    try {
      const before = await snapshot()
      const { status, body } = await post({ dryRun: false, digests }, { approval: APPROVAL })
      expect(status).toBe(409)
      expect(body).toMatchObject({ error: 'ids_changed', groups: ['1'], found: SPEC })
      expect(await lastLog()).toMatchObject({ outcome: 'refused', error: 'ids_changed', approval_ref: APPROVAL })
      expect(await snapshot()).toBe(before)
    } finally {
      await pool.query(`DELETE FROM workout_sessions WHERE id = $1`, [swapped])
      await pool.query(`UPDATE workout_sessions SET deleted_at = NULL WHERE id = $1`, [ids.g1n0])
    }
  })

  it('refuses, writing nothing, when the counts are not the spec\'s', async () => {
    const extra = await session('g1Extra', OWNER, '2026-06-30T08:00:00Z', null)
    try {
      const digests = await dryDigests() // even a fresh dry run's digests: the counts are wrong
      const before = await snapshot()
      const { status, body } = await post({ dryRun: false, digests }, { approval: APPROVAL })
      expect(status).toBe(409)
      expect(body).toMatchObject({ error: 'counts_unexpected', expected: SPEC, found: { ...SPEC, '1': 15 } })
      expect(await lastLog()).toMatchObject({ outcome: 'refused', error: 'counts_unexpected' })
      expect(await snapshot()).toBe(before)
    } finally {
      await pool.query(`DELETE FROM workout_sessions WHERE id = $1`, [extra])
    }
  })

  it('rolls the whole write back when a statement touches a different row count', async () => {
    const digests = await dryDigests()
    const before = await snapshot()
    // A client whose activity tombstone reports one row fewer than it touched: by then the
    // re-timings and session tombstones have run in the same transaction.
    const lying = (): Promise<PoolClient> => pool.connect().then(real => ({
      query: async (text: string, params?: unknown[]) => {
        const r = await real.query(text, params)
        return typeof text === 'string' && text.trim().startsWith('UPDATE activity_logs') ? { ...r, rowCount: (r.rowCount ?? 0) - 1 } : r
      },
      release: () => real.release(),
    }) as unknown as PoolClient)
    await expect(cleanOwnerHistory3802(deps({ connect: lying }), OWNER, { dryRun: false, digests }))
      .rejects.toThrow(/4: touched 6 rows, planned 7/)
    expect(await snapshot()).toBe(before)
  })

  it('a write changes exactly the spec\'s rows and counts what it wrote', async () => {
    const digests = await dryDigests()
    const { status, body } = await post({ dryRun: false, digests }, { approval: APPROVAL })
    expect(status).toBe(200)
    expect(body.report.written).toEqual({
      sessionsRetimed: 11, sessionsTombstoned: 21, exerciseLogsTombstoned: 6, setLogsTombstoned: 14,
      phaseCountersDecremented: 1, activitiesTombstoned: 7, zoneDaysDeleted: 19,
      personalRecords: { reconciled: 2, lowered: 1, removed: 1, failed: [] },
    })
    expect(await lastLog()).toMatchObject({ outcome: 'succeeded', approval_ref: APPROVAL, affected_rows: 58, error: null })

    const ws = Object.fromEntries((await pool.query(
      `SELECT id, started_at, completed_at, deleted_at, updated_at FROM workout_sessions WHERE user_id = ANY($1)`, [[OWNER, OTHER]]))
      .rows.map(r => [r.id, r]))
    const dead = [...G1(), ...G2, 'g3a0', 'g3a1', 'g3a2', 'g3a3']
    const retimed = ['g3b', ...[0, 1, 2, 3, 4, 5].map(i => `g3b${i}`), 'g3c', 'g3c0', 'g3c1', 'g3c2']
    const alive = [...retimed, 'g1Before', 'g1After', 'inProgress', 'g2Fresh', 'realBeside', 'zeroEvening', 'zeroUtcMidnight',
      'midnightShort', 'logAfterEnd', 'utcMidnightLong', 'longLateLog', 'otherG1', 'otherG2', 'otherG3b']
    for (const k of dead) expect(ws[ids[k]].deleted_at, k).not.toBeNull()
    for (const k of alive) expect(ws[ids[k]].deleted_at, k).toBeNull()
    // Every write bumps updated_at, so the delta pull carries it to the phones.
    for (const k of [...dead, ...retimed]) expect(Date.now() - ws[ids[k]].updated_at.getTime(), k).toBeLessThan(60_000)
    expect(ws[ids.g3b].started_at.toISOString()).toBe('2026-05-25T01:30:00.000Z')
    expect(ws[ids.g3b].completed_at.toISOString()).toBe('2026-05-25T03:00:00.000Z')
    expect(ws[ids.g3c].completed_at.toISOString()).toBe('2026-05-10T09:00:00.000Z')
    expect(ws[ids.g3c].started_at.toISOString()).toBe('2026-05-10T08:00:00.000Z')
    expect(ws[ids.otherG3b].started_at.toISOString()).toBe('2026-05-24T14:00:00.000Z')
    expect(ws[ids.logAfterEnd].started_at.toISOString()).toBe('2026-05-28T14:00:00.000Z')
    expect(ws[ids.utcMidnightLong].started_at.toISOString()).toBe('2026-05-30T00:00:00.000Z')
    expect(ws[ids.longLateLog].completed_at.toISOString()).toBe('2026-05-11T19:00:00.000Z')

    // The children went with their sessions, and a child already tombstoned kept its own deleted_at.
    const liveChildren = (await pool.query(
      `SELECT count(*)::int AS n FROM exercise_logs el LEFT JOIN set_logs sl ON sl.exercise_log_id = el.id
       WHERE el.workout_session_id = ANY($1::uuid[]) AND (el.deleted_at IS NULL OR sl.deleted_at IS NULL)`,
      [dead.map(k => ids[k])])).rows[0].n
    expect(liveChildren).toBe(0)
    const deadLog = (await pool.query(`SELECT deleted_at FROM exercise_logs WHERE id = $1`, [ids.deadLog])).rows[0]
    expect(deadLog.deleted_at.toISOString()).toBe('2026-06-21T08:10:00.000Z')
    const deadSet = (await pool.query(`SELECT deleted_at FROM set_logs WHERE exercise_log_id = $1 AND set_number = 3`, [ids.g1PressLog])).rows[0]
    expect(deadSet.deleted_at.toISOString()).toBe('2026-06-02T09:00:00.000Z')

    // The completed program session counted in the phase, so the counter goes down by one.
    const sp = (await pool.query(`SELECT sessions_in_phase FROM session_periodization WHERE user_id = $1`, [OWNER])).rows[0]
    expect(sp.sessions_in_phase).toBe(2)

    const al = Object.fromEntries((await pool.query(
      `SELECT id, deleted_at, deleted_reason FROM activity_logs WHERE user_id = ANY($1)`, [[OWNER, OTHER]])).rows.map(r => [r.id, r]))
    for (const id of ACTIVITY_IDS_3802) expect(al[id]).toMatchObject({ deleted_reason: 'app' })
    for (const id of ACTIVITY_IDS_3802) expect(al[id].deleted_at).not.toBeNull()
    expect(al[ids.actKept]).toMatchObject({ deleted_at: null, deleted_reason: null })

    const zm = (await pool.query(`SELECT user_id, day::text AS day FROM daily_zone_minutes WHERE user_id = ANY($1) ORDER BY user_id, day`, [[OWNER, OTHER]])).rows
    // #3850: the job then drops the cached days its retimed and tombstoned rows covered, so the
    // non-zero 22 Jun row goes too while it is still inside HR retention; past it, it is kept.
    const { zoneRetentionCutoff } = await import('@/lib/data/postgres/slices/oura')
    const { todayInTz } = await import('@trainingai/shared/date-utils')
    const jun22Kept = '2026-06-22' < zoneRetentionCutoff(todayInTz(STORED_TZ))
    expect(zm).toEqual([
      { user_id: OWNER, day: '2026-06-02' },
      ...(jun22Kept ? [{ user_id: OWNER, day: '2026-06-22' }] : []),
      { user_id: OTHER, day: '2026-06-03' },
    ])

    // PRESS follows the best live log; SQUAT had none left.
    const pr = (await pool.query(`SELECT exercise_name, estimated_1rm FROM personal_records WHERE user_id = $1 ORDER BY exercise_name`, [OWNER])).rows
    expect(pr.map(r => [r.exercise_name, Number(r.estimated_1rm)])).toEqual([[PRESS, 80]])
  })

  it('a second run finds nothing to do, and its write is refused', async () => {
    const zero = { '1': 0, '2': 0, '3a': 0, '3b': 0, '3c': 0, '4': 0, '5': 0 }
    const dry = await post({ dryRun: true })
    expect(dry.body.report.counts).toEqual(zero)
    expect(dry.body.report.matchesSpec).toBe(false)
    const before = await snapshot()
    const { status, body } = await post({ dryRun: false, digests: dry.body.report.digests }, { approval: APPROVAL })
    expect(status).toBe(409)
    expect(body.error).toBe('counts_unexpected')
    expect(await snapshot()).toBe(before)
  })

  it('a reconcile that throws after commit is listed in the report, and the write still answers', async () => {
    await clean()
    await seed()
    const dry = await cleanOwnerHistory3802(deps(), OWNER, { dryRun: true })
    if (!dry.ok) throw new Error('dry run refused')
    let calls = 0
    const result = await cleanOwnerHistory3802(deps({
      reconcilePersonalRecord: async (u, n) => {
        if (calls++ === 0) throw Object.assign(new Error(`connection lost while reconciling ${n}`), { code: '57P01' })
        return repo.reconcilePersonalRecord(u, n)
      },
    }), OWNER, { dryRun: false, digests: dry.report.digests })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.report.written?.sessionsTombstoned).toBe(21)
    expect(result.report.written?.personalRecords.reconciled).toBe(1)
    expect(result.report.written?.personalRecords.failed).toEqual([{ error: '57P01' }])
    // The failure carries a code, never the exercise's name.
    expect(JSON.stringify(result.report)).not.toMatch(/Clean3802/)
    // The rows are written: a re-plan finds nothing left.
    const again = await cleanOwnerHistory3802(deps(), OWNER, { dryRun: true })
    expect(again.ok && again.report.counts['1']).toBe(0)
  })
})
