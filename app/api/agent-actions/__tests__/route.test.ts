// Issue 2381 (part b): the agent key, against a real Postgres.
//
//   · the key: missing, wrong, unconfigured, too short, or a session cookie alone → 401, and nothing
//     reached the repository or the log;
//   · the allow-list and the schema: an unknown job (ring key, re-key, pack, step backfill …), an
//     extra field or a mistyped parameter → 400, nothing logged;
//   · scope: a request for any account but the owner's is refused and logged;
//   · approval: a run that overwrites stored data is refused without one, and runs with one;
//   · each exposed job runs, logs one row, and a second run changes nothing;
//   · the per-job rate limit, the stress job's slot refusal and its poll;
//   · a finished log row cannot be changed.
//
// The log is append-only, so its rows cannot be cleaned up: every assertion filters on this run's
// own actor name.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const OWNER = '00000000-0000-4000-8000-000000238111'
const OTHER = '00000000-0000-4000-8000-000000238112'
const PROGRAM = '00000000-0000-4000-8000-000000238113'
const PROGRAM_SESSION = '00000000-0000-4000-8000-000000238114'
const KEY = 'fake-agent-key-for-tests-only-0123456789abcdef'
const ACTOR = `t-${Math.random().toString(36).slice(2, 8)}`
const APPROVAL = 'https://github.com/nekodas-neko/TrainingAi_Open/issues/2381#issuecomment-1'

// The session path must never be consulted by an agent route.
const authSpy = vi.fn(async () => { throw new Error('auth() must not be called on an agent route') })
vi.mock('@/auth', () => ({ auth: authSpy }))

const repoCalls = { n: 0 }
vi.mock('@/lib/data', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/data')>()
  const counted = async () => { repoCalls.n++; return real.getRepository() }
  return { ...real, getRepository: counted, getRepositoryAsync: counted }
})

describe.skipIf(!canRun)('/api/agent-actions (issue 2381)', () => {
  let pool: import('pg').Pool
  let route: typeof import('../route')
  let rl: typeof import('@/lib/rate-limit')

  const post = (body: unknown, headers: Record<string, string> = { authorization: `Bearer ${KEY}` }) =>
    route.POST(new Request('http://localhost/api/agent-actions', {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    }))
  const get = (qs: string, headers: Record<string, string> = { authorization: `Bearer ${KEY}` }) =>
    route.GET(new Request(`http://localhost/api/agent-actions?${qs}`, { headers }))
  const req = (job: string, params: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    ({ job, actor: ACTOR, targetUserId: OWNER, params, ...extra })
  const logRows = async () => (await pool.query(
    `SELECT id, job, outcome, approval_ref, target_user_id, affected_rows::int AS affected_rows, days_moved, error, parameters
     FROM agent_action_log WHERE actor = $1 ORDER BY started_at, id`, [ACTOR])).rows
  const until = async (pred: () => Promise<boolean>) => {
    for (let i = 0; i < 200; i++) { if (await pred()) return; await new Promise(r => setTimeout(r, 25)) }
    throw new Error('timed out')
  }

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    route = await import('../route')
    rl = await import('@/lib/rate-limit')
    for (const [id, admin] of [[OWNER, true], [OTHER, true]] as const) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone, is_admin, is_active)
         VALUES ($1, $2, 'x', 'Australia/Brisbane', $3, true) ON CONFLICT (id) DO NOTHING`,
        [id, `agent-key-${id.slice(-4)}@example.com`, admin])
    }
    await pool.query(
      `INSERT INTO programs (id, user_id, name, is_active, phase_mode) VALUES ($1, $2, 'Issue2381 AI', true, 'ai_dynamic')
       ON CONFLICT (id) DO NOTHING`, [PROGRAM, OWNER])
    await pool.query(
      `INSERT INTO program_sessions (id, program_id, name, position) VALUES ($1, $2, 'Upper', 0) ON CONFLICT (id) DO NOTHING`,
      [PROGRAM_SESSION, PROGRAM])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM oura_redecode_jobs WHERE user_id = ANY($1)`, [[OWNER, OTHER]])
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1)`, [[OWNER, OTHER]])
    await pool.query(`DELETE FROM body_battery_daily WHERE user_id = ANY($1)`, [[OWNER, OTHER]])
    await pool.query(`DELETE FROM programs WHERE id = $1`, [PROGRAM])
    // The log rows stay (append-only); deleting the users unlinks them through the FK.
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[OWNER, OTHER]])
    await pool.query(`DELETE FROM rate_limits WHERE key LIKE 'agent-actions%'`)
  })

  beforeEach(async () => {
    process.env.AGENT_ACTIONS_SECRET = KEY
    process.env.ADMIN_EXPORT_USER_ID = OWNER
    rl._resetRateLimitL1()
    await pool.query(`DELETE FROM rate_limits WHERE key LIKE 'agent-actions%'`)
    repoCalls.n = 0
    authSpy.mockClear()
  })

  describe('the key', () => {
    const body = () => req('backfill-baseline-phase-tag', { dryRun: true })

    it.each([
      ['no Authorization header', {}],
      ['a wrong key', { authorization: 'Bearer not-the-key-not-the-key-not-the-key-000' }],
      ['the key as Basic', { authorization: `Basic ${KEY}` }],
      ['a session cookie and no key', { cookie: 'authjs.session-token=whatever; __Secure-authjs.session-token=x' }],
    ])('refuses %s with 401, before any lookup, and logs nothing', async (_l, headers) => {
      const before = (await logRows()).length
      const res = await post(body(), headers as Record<string, string>)
      expect(res.status).toBe(401)
      expect(repoCalls.n).toBe(0)
      expect(authSpy).not.toHaveBeenCalled()
      expect((await logRows()).length).toBe(before)
    })

    it('refuses everything when AGENT_ACTIONS_SECRET is unset, or too short to be a real key', async () => {
      delete process.env.AGENT_ACTIONS_SECRET
      expect((await post(body())).status).toBe(401)
      expect((await post(body(), { authorization: 'Bearer undefined' })).status).toBe(401)
      process.env.AGENT_ACTIONS_SECRET = 'short'
      expect((await post(body(), { authorization: 'Bearer short' })).status).toBe(401)
      expect((await get('job=stress-backfill&jobId=1')).status).toBe(401)
      expect(repoCalls.n).toBe(0)
    })

    it('refuses when no owner account is configured', async () => {
      delete process.env.ADMIN_EXPORT_USER_ID
      const saved = process.env.WEBHOOK_USER_ID
      delete process.env.WEBHOOK_USER_ID
      try {
        expect((await post(body())).status).toBe(401)
        expect(repoCalls.n).toBe(0)
      } finally {
        if (saved !== undefined) process.env.WEBHOOK_USER_ID = saved
      }
    })

    it('rate-limits key attempts per IP before the compare: the right key is refused once tripped', async () => {
      const ip = { 'x-forwarded-for': '203.0.113.81' }
      for (let i = 0; i < 10; i++) await post(body(), { ...ip, authorization: 'Bearer wrong-wrong-wrong-wrong-wrong-wrong' })
      expect((await post(body(), { ...ip, authorization: `Bearer ${KEY}` })).status).toBe(401)
    })
  })

  describe('the allow-list and the schema', () => {
    it.each([
      'clear-key', 'set-key', 'rekey', 'full-resync', 'pack-sealed-frames', 'null-historical-decoded',
      'step-backfill', 'fix-exercise-units', 'delete-user', 'generate-exercise-media', 'redecode', '',
    ])('refuses the job %j with 400 and logs nothing', async (job) => {
      const before = (await logRows()).length
      const res = await post(req(job, { dryRun: true }, { approval: APPROVAL }))
      expect(res.status).toBe(400)
      expect((await logRows()).length).toBe(before)
    })

    it.each([
      ['an unknown top-level field', req('stress-backfill', { dryRun: true }, { userId: OTHER })],
      ['an unknown parameter', req('stress-backfill', { dryRun: true, allowStepsDecrease: true })],
      ['dryRun left out', req('stress-backfill', {})],
      ['dryRun as a string', req('stress-backfill', { dryRun: 'false' })],
      ['a malformed date', req('rederive-body-battery', { dryRun: true, from: '1 Sept' })],
      ['a non-uuid target', { ...req('stress-backfill', { dryRun: true }), targetUserId: 'me' }],
      ['an actor with spaces', { ...req('stress-backfill', { dryRun: true }), actor: 'Robert Tables' }],
      ['an approval that is not a comment link', req('stress-backfill', { dryRun: true }, { approval: 'yes' })],
    ])('refuses %s with 400', async (_l, body) => {
      expect((await post(body)).status).toBe(400)
    })

    it('refuses a non-JSON body', async () => {
      const res = await route.POST(new Request('http://localhost/api/agent-actions', {
        method: 'POST', headers: { authorization: `Bearer ${KEY}` }, body: 'not json',
      }))
      expect(res.status).toBe(400)
    })
  })

  it('refuses a request for another account, and logs the refusal without linking to that account', async () => {
    const res = await post({ ...req('backfill-baseline-phase-tag', { dryRun: true }), targetUserId: OTHER })
    expect(res.status).toBe(403)
    const last = (await logRows()).at(-1)
    expect(last).toMatchObject({ job: 'backfill-baseline-phase-tag', outcome: 'refused', target_user_id: null })
  })

  describe('rederive-body-battery (#2409)', () => {
    const day = '2026-09-20'
    beforeEach(async () => {
      await pool.query(`DELETE FROM body_battery_daily WHERE user_id = $1`, [OWNER])
      // An old-model, unmeasured day: the recompute (also unmeasured) differs only in model version.
      await pool.query(
        `INSERT INTO body_battery_daily (user_id, date, anchor, anchor_source, end_value, day_min, day_max,
           total_charged, total_drained, resting_hr, hr_max, hr_sample_count, model_version)
         VALUES ($1, $2, 55, 'readiness', 55, 55, 55, 0, 0, 60, 170, 0, 'v1:old')`, [OWNER, day])
    })

    it('refuses a write without approval, and logs the refusal; the stored day is untouched', async () => {
      const res = await post(req('rederive-body-battery', { from: day, to: day, dryRun: false }))
      expect(res.status).toBe(403)
      expect((await logRows()).at(-1)).toMatchObject({ job: 'rederive-body-battery', outcome: 'refused', target_user_id: OWNER })
      const { rows: [r] } = await pool.query(`SELECT model_version FROM body_battery_daily WHERE user_id = $1`, [OWNER])
      expect(r.model_version).toBe('v1:old')
    })

    it('a dry run needs no approval and writes nothing', async () => {
      const res = await post(req('rederive-body-battery', { from: day.replace(/-/g, '/'), to: day, dryRun: true }))
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.report.from).toBe(day)
      expect((await logRows()).at(-1)).toMatchObject({ outcome: 'succeeded', affected_rows: 0, days_moved: 0 })
    })

    it('with approval it writes, logs one row, and a second run changes nothing', async () => {
      const first = await (await post(req('rederive-body-battery', { from: day, to: day, dryRun: false }, { approval: APPROVAL }))).json()
      expect(first.report.summary.written).toBe(1)
      const row1 = (await logRows()).at(-1)
      expect(row1).toMatchObject({ job: 'rederive-body-battery', outcome: 'succeeded', approval_ref: APPROVAL, target_user_id: OWNER, affected_rows: 1, days_moved: 1 })
      expect(row1.parameters).toEqual({ from: day, to: day, dryRun: false })

      const second = await (await post(req('rederive-body-battery', { from: day, to: day, dryRun: false }, { approval: APPROVAL }))).json()
      expect(second.report.summary.written).toBe(0)
      expect(second.report.summary.unchanged).toBe(1)
      expect((await logRows()).at(-1)).toMatchObject({ outcome: 'succeeded', affected_rows: 0, days_moved: 0 })
    })

    it('refuses a range over 31 days as a 400 and logs it as refused', async () => {
      const res = await post(req('rederive-body-battery', { from: '2026-08-01', to: '2026-09-20', dryRun: true }))
      expect(res.status).toBe(400)
      expect((await logRows()).at(-1)).toMatchObject({ outcome: 'refused' })
    })
  })

  describe('backfill-baseline-phase-tag (#2460)', () => {
    let wsOwner: string
    let wsOther: string
    const baseline = async (user: string, programSession: string | null) => {
      const { rows: [ws] } = await pool.query(
        `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at)
         VALUES ($1, $2, 'Issue2381', '2026-09-08T08:00:00+10:00') RETURNING id`, [user, programSession])
      const { rows: [el] } = await pool.query(
        `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, logged_at)
         VALUES ($1, 'Issue2381 Ex', 80, '2026-09-08T08:00:00+10:00') RETURNING id`, [ws.id])
      await pool.query(`INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps) VALUES ($1, 1, 60, 15)`, [el.id])
      return ws.id as string
    }
    const tag = async (id: string) => (await pool.query(`SELECT phase_type FROM workout_sessions WHERE id = $1`, [id])).rows[0].phase_type

    beforeEach(async () => {
      await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1)`, [[OWNER, OTHER]])
      wsOwner = await baseline(OWNER, PROGRAM_SESSION)
      wsOther = await baseline(OTHER, null)
    })

    it('dry run lists, writes nothing; the write tags only the owner; a second write tags nothing', async () => {
      const dry = await (await post(req('backfill-baseline-phase-tag', { dryRun: true }))).json()
      expect(dry.report).toMatchObject({ dryRun: true, predicted: 1, written: 0, dates: ['2026-09-08'] })
      expect(await tag(wsOwner)).toBeNull()

      const write = await (await post(req('backfill-baseline-phase-tag', { dryRun: false }))).json()
      expect(write.report).toMatchObject({ predicted: 1, written: 1 })
      expect(await tag(wsOwner)).toBe('baseline')
      expect(await tag(wsOther)).toBeNull()
      expect((await logRows()).at(-1)).toMatchObject({ job: 'backfill-baseline-phase-tag', outcome: 'succeeded', affected_rows: 1, days_moved: 1, approval_ref: null })

      const again = await (await post(req('backfill-baseline-phase-tag', { dryRun: false }))).json()
      expect(again.report).toMatchObject({ predicted: 0, written: 0 })
      expect((await logRows()).at(-1)).toMatchObject({ outcome: 'succeeded', affected_rows: 0 })
    })

    it('rate-limits each job: the fifth run in a minute is refused and logged', async () => {
      for (let i = 0; i < 4; i++) expect((await post(req('backfill-baseline-phase-tag', { dryRun: true }))).status).toBe(200)
      const res = await post(req('backfill-baseline-phase-tag', { dryRun: true }))
      expect(res.status).toBe(429)
      expect((await logRows()).at(-1)).toMatchObject({ outcome: 'refused' })
    })
  })

  describe('stress-backfill (#2680)', () => {
    beforeEach(async () => {
      await pool.query(`DELETE FROM oura_redecode_jobs WHERE user_id = ANY($1)`, [[OWNER, OTHER]])
    })

    it('starts a job, the poll reports it, and the log row is finished when it ends; a second write adds nothing', async () => {
      for (const dryRun of [true, false, false]) {
        const res = await post(req('stress-backfill', { dryRun }))
        expect(res.status).toBe(202)
        const { actionId, job } = await res.json()
        await until(async () => (await pool.query(`SELECT outcome FROM agent_action_log WHERE id = $1`, [actionId])).rows[0].outcome !== 'running')
        const polled = await (await get(`job=stress-backfill&jobId=${job.jobId}`)).json()
        expect(polled.job.status).toBe('done')
        expect(polled.job.kind).toBe(dryRun ? 'stress-backfill-dry-run' : 'stress-backfill')
        const row = (await pool.query(`SELECT outcome, affected_rows::int AS affected_rows FROM agent_action_log WHERE id = $1`, [actionId])).rows[0]
        // No raw data in the scratch account: nothing to add, on every run.
        expect(row).toEqual({ outcome: 'succeeded', affected_rows: 0 })
      }
    })

    it('is refused with 409 while another kind holds the job slot, and logs the refusal', async () => {
      const repo = await (await import('@/lib/data')).getRepository()
      const { job } = await repo.startRedecodeJob(OWNER, { fullHistory: true, allowStepsDecrease: false, debugDate: null })
      try {
        const res = await post(req('stress-backfill', { dryRun: true }))
        expect(res.status).toBe(409)
        expect((await logRows()).at(-1)).toMatchObject({ job: 'stress-backfill', outcome: 'refused' })
      } finally {
        await repo.finishRedecodeJob(job.id, {}, null)
      }
    })

    it('the poll is owner-scoped and strict', async () => {
      const repo = await (await import('@/lib/data')).getRepository()
      const { job } = await repo.startRedecodeJob(OTHER, { fullHistory: true, stressBackfill: true, dryRun: true })
      await repo.finishRedecodeJob(job.id, {}, null)
      expect((await get(`job=stress-backfill&jobId=${job.id}`)).status).toBe(404)
      expect((await get(`job=stress-backfill&jobId=${job.id}&extra=1`)).status).toBe(400)
      expect((await get('job=redecode&jobId=1')).status).toBe(400)
      expect((await get('job=stress-backfill&jobId=1.5')).status).toBe(400)
      expect((await get(`job=stress-backfill&jobId=${job.id}`, { cookie: 'authjs.session-token=x' })).status).toBe(401)
    })
  })

  describe('rederive-styleless-one-rm (issue 2357)', () => {
    // A styleless log stored with the old 0.97 AMRAP discount (32.5 x 8 → 39.5), a styled log, an
    // edited-down styleless log stored above its re-derived value, and the other account's
    // styleless log. Only the first may move.
    const ids: Record<string, string> = {}
    const log = async (user: string, name: string, est: number, styleName: string | null, sets: [number, number][], plannedPct: number | null = null) => {
      const { rows: [ws] } = await pool.query(
        `INSERT INTO workout_sessions (user_id, session_name, started_at)
         VALUES ($1, 'Issue2357', '2026-09-10T08:00:00+10:00') RETURNING id`, [user])
      const { rows: [el] } = await pool.query(
        `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, target_80, style_name, logged_at)
         VALUES ($1, $2, $3, $4, $5, '2026-09-10T08:30:00+10:00') RETURNING id`, [ws.id, name, est, est * 0.8, styleName])
      for (const [i, [w, r]] of sets.entries()) {
        await pool.query(
          `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, intensity_pct, planned_pct) VALUES ($1, $2, $3, $4, 1, $5)`,
          [el.id, i + 1, w, r, plannedPct])
      }
      return el.id as string
    }
    const est = async (id: string) => Number((await pool.query(`SELECT estimated_1rm FROM exercise_logs WHERE id = $1`, [id])).rows[0].estimated_1rm)

    beforeEach(async () => {
      await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1)`, [[OWNER, OTHER]])
      ids.styleless = await log(OWNER, 'Issue2357 Curl', 39.5, null, [[32.5, 8], [32.5, 8], [32.5, 8]])
      ids.styled = await log(OWNER, 'Issue2357 Press', 50, 'Hypertrophy', [[40, 8]], 75)
      ids.higher = await log(OWNER, 'Issue2357 Row', 90, null, [[50, 5]])
      ids.other = await log(OTHER, 'Issue2357 Curl', 39.5, null, [[32.5, 8]])
    })

    it('a write without approval is refused; a dry run writes nothing; with approval it writes once', async () => {
      expect((await post(req('rederive-styleless-one-rm', { dryRun: false }))).status).toBe(403)
      expect(await est(ids.styleless)).toBe(39.5)

      const dry = await (await post(req('rederive-styleless-one-rm', { dryRun: true }))).json()
      expect(dry.report.summary).toMatchObject({ wouldWrite: 1, wouldLower: 1, written: 0, daysMoved: 1 })
      expect(dry.report.sample).toEqual([expect.objectContaining({ exerciseLogId: ids.styleless, before: 39.5, after: 40.75 })])
      expect(await est(ids.styleless)).toBe(39.5)

      const write = await (await post(req('rederive-styleless-one-rm', { dryRun: false }, { approval: APPROVAL }))).json()
      expect(write.report.summary).toMatchObject({ written: 1, remaining: 0 })
      expect((await logRows()).at(-1)).toMatchObject({ job: 'rederive-styleless-one-rm', outcome: 'succeeded', approval_ref: APPROVAL, affected_rows: 1, days_moved: 1 })
      expect(await est(ids.styleless)).toBe(40.75)
      expect(await est(ids.styled)).toBe(50)
      expect(await est(ids.higher)).toBe(90)
      expect(await est(ids.other)).toBe(39.5)
      const { rows: sets } = await pool.query(`SELECT intensity_pct FROM set_logs WHERE exercise_log_id = $1`, [ids.styleless])
      expect(sets.map(s => Number(s.intensity_pct))).toEqual([79.8, 79.8, 79.8])

      const again = await (await post(req('rederive-styleless-one-rm', { dryRun: false }, { approval: APPROVAL }))).json()
      expect(again.report.summary).toMatchObject({ wouldWrite: 0, written: 0 })
      expect((await logRows()).at(-1)).toMatchObject({ outcome: 'succeeded', affected_rows: 0, days_moved: 0 })
    })

    it('refuses an unknown parameter', async () => {
      expect((await post(req('rederive-styleless-one-rm', { dryRun: true, limit: 5 }))).status).toBe(400)
    })
  })

  it('a finished log row cannot be changed or deleted', async () => {
    await post(req('backfill-baseline-phase-tag', { dryRun: true }))
    const last = (await logRows()).at(-1)
    await expect(pool.query(`UPDATE agent_action_log SET affected_rows = 999 WHERE id = $1`, [last.id])).rejects.toThrow()
    await expect(pool.query(`DELETE FROM agent_action_log WHERE id = $1`, [last.id])).rejects.toThrow()
  })
})
