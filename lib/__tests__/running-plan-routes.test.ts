/**
 * PS-39 — the running-plan family: `running-plan` (read and create), `…/override`,
 * `…/run-type-stats` and `…/runs/[id]`.
 *
 * Batched because of one pairing that only holds across two of them: **the override writes today's
 * run, and the GET must not undo it.** Both halves carry a live incident in their own comments —
 *
 *   · Recomputing on read would silently flip the display back to the framework's original pick on
 *     the very next reload, defeating the point of overriding. The GET trusts a persisted row whose
 *     rationale carries the override marker and never recomputes.
 *   · A `max-age` response header let the browser serve its own stale GET without reaching the
 *     handler, so an override looked like it "reverted" on reload inside the same 60-second window.
 *     Every path answers `private, no-store`.
 *
 * — and neither is visible in a single route's response. The other two round out the surface: what
 * counts toward a run-type average, and which id wins when a PATCH names one.
 *
 * The prescription engine (`prescribeNextRun`, `prescribeOverride`, `assembleInputs`,
 * `resolveSnapshot`, `resolvePushContext`) is mocked — it has its own tests, and mocking it is what
 * lets these cases assert on the ROUTE's decisions. `computeRunTypeStats`, `weeklyZoneTargets`,
 * `targetsForRunType`, `defaultFrameworkForGoal` and `CARDIO_GOALS` are real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OVERRIDE_RATIONALE_PREFIX } from '@trainingai/shared/running/prescription'
import { todayInTz } from '@trainingai/shared/date-utils'

type Row = Record<string, unknown>

const getActiveRunningPlan = vi.fn(async (_u: string) => runningPlan() as Row | null)
const saveRunningPlan = vi.fn(async (_u: string, p: Row) => ({ id: 'plan-1', ...p }) as Row)
const getPrescribedRuns = vi.fn(async (_u: string, _f: string, _t: string) => [] as Row[])
const upsertPrescribedRun = vi.fn(async (_u: string, r: Row) => r as Row)
const updatePrescribedRun = vi.fn(async (_u: string, _id: string, _p: Row) => ({ id: 'run-1', status: 'completed' }) as Row | null)
const listActivityLogs = vi.fn(async (_u: string, _f: string, _t: string) => [] as Row[])

const prescribeNextRun = vi.fn((..._a: unknown[]) => ({
  prescription: prescription(), gateAction: 'proceed', gateReasons: ['fresh'],
}) as Row)
const prescribeOverride = vi.fn((_c: unknown, _g: unknown, base: Row) => ({
  prescription: base, gateAction: 'proceed', gateReasons: [],
}) as Row)
const assembleInputs = vi.fn(async (..._a: unknown[]) => ({ ctx: {}, gate: {} }) as Row)
const resolveSnapshot = vi.fn(async (..._a: unknown[]) => fitness() as Row)
const resolvePushContext = vi.fn(async (..._a: unknown[]) => ({ isPush: false, bestDistanceKm: null }) as Row)

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  // Built inside the returned function: `vi.mock` is hoisted above the consts above.
  const repo = async () => ({
    getActiveRunningPlan, saveRunningPlan, getPrescribedRuns, upsertPrescribedRun,
    updatePrescribedRun, listActivityLogs,
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('@trainingai/shared/running/prescription', async (orig) => ({
  ...(await orig() as object),
  prescribeNextRun: (...a: unknown[]) => prescribeNextRun(...a),
  prescribeOverride: (c: unknown, g: unknown, b: Row) => prescribeOverride(c, g, b),
}))
vi.mock('@trainingai/shared/running/assemble-plan-context', () => ({
  assembleInputs: (...a: unknown[]) => assembleInputs(...a),
  resolveSnapshot: (...a: unknown[]) => resolveSnapshot(...a),
  resolvePushContext: (...a: unknown[]) => resolvePushContext(...a),
}))

import { GET as readPlan, POST as createPlan } from '@/app/api/running-plan/route'
import { POST as overrideRun } from '@/app/api/running-plan/override/route'
import { GET as runTypeStats } from '@/app/api/running-plan/run-type-stats/route'
import { PATCH as patchRun } from '@/app/api/running-plan/runs/[id]/route'

const RUN = '00000000-0000-4000-8000-000000000a01'
const LOG = '00000000-0000-4000-8000-000000000b01'
const OTHER_RUN = '00000000-0000-4000-8000-000000000c01'

const fitness = (over: Row = {}) => ({
  restingHr: 50, maxHr: 190, weeklyBaseMinutes: 150, ...over,
})

const runningPlan = (over: Row = {}) => ({
  id: 'plan-1', userId: 'u-1', goalKind: 'heart_health', frameworkKey: 'zone2',
  targetDistanceKm: null, targetDate: null, timePerSessionMinutes: null, isActive: true, ...over,
})

const prescription = (over: Row = {}) => ({
  type: 'easy', durationMin: 40, distanceKm: 6,
  targets: { zoneIds: [2], hrLowBpm: 120, hrHighBpm: 140 },
  rationale: 'Steady aerobic work.', frameworkKey: 'zone2', ...over,
})

const storedRun = (over: Row = {}) => ({
  id: RUN, planId: 'plan-1', date: '2026-09-08', runType: 'easy', durationMin: 40,
  distanceKm: 6, targetHrLow: 120, targetHrHigh: 140, targetZoneIds: [2],
  rationale: 'Steady aerobic work.', gateAction: 'proceed', status: 'pending',
  activityLogId: null, ...over,
})

const send = (
  handler: (req: never, ctx: never) => Promise<Response>,
  url: string, method: string, body: unknown, params?: Row,
) => handler(new Request(`http://localhost${url}`, {
  method, headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
}) as never, (params ? { params: Promise.resolve(params) } : undefined) as never)

const post = (body: unknown) => send(createPlan as never, '/api/running-plan', 'POST', body)
const override = (body: unknown) => send(overrideRun as never, '/api/running-plan/override', 'POST', body)
const patch = (body: unknown, id = RUN) =>
  send(patchRun as never, `/api/running-plan/runs/${id}`, 'PATCH', body, { id })

let seq = 0
const freshUser = (over: { timezone?: string } = {}) => {
  sessionUser = { id: `u-${++seq}`, timezone: 'Australia/Brisbane', ...over }
}

beforeEach(() => {
  vi.clearAllMocks()
  freshUser()
  getActiveRunningPlan.mockResolvedValue(runningPlan())
  saveRunningPlan.mockImplementation(async (_u: string, p: Row) => ({ id: 'plan-1', ...p }))
  getPrescribedRuns.mockResolvedValue([])
  upsertPrescribedRun.mockImplementation(async (_u: string, r: Row) => r)
  updatePrescribedRun.mockResolvedValue({ id: RUN, status: 'completed' })
  listActivityLogs.mockResolvedValue([])
  prescribeNextRun.mockReturnValue({ prescription: prescription(), gateAction: 'proceed', gateReasons: ['fresh'] })
  prescribeOverride.mockImplementation((_c: unknown, _g: unknown, base: Row) =>
    ({ prescription: base, gateAction: 'proceed', gateReasons: [] }))
  assembleInputs.mockResolvedValue({ ctx: {}, gate: {} })
  resolveSnapshot.mockResolvedValue(fitness())
  resolvePushContext.mockResolvedValue({ isPush: false, bestDistanceKm: null })
})

describe('GET /api/running-plan', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await readPlan()).status).toBe(401)
  })

  it('answers an empty plan rather than an error when none is active', async () => {
    getActiveRunningPlan.mockResolvedValue(null)
    const res = await readPlan()
    expect(await res.json()).toEqual({ plan: null, prescription: null })
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  // A max-age header let the browser serve its own stale GET without reaching the handler, so an
  // override looked like it "reverted" on reload inside the same 60-second window.
  it('never lets any path be HTTP-cached', async () => {
    expect((await readPlan()).headers.get('Cache-Control')).toBe('private, no-store')

    getPrescribedRuns.mockResolvedValue([storedRun({ rationale: `${OVERRIDE_RATIONALE_PREFIX}an easy run today.` })])
    expect((await readPlan()).headers.get('Cache-Control')).toBe('private, no-store')

    expect((await override({ runType: 'easy', durationMin: 30 })).headers.get('Cache-Control'))
      .toBe('private, no-store')
  })

  // Recomputing here would silently flip the display back to the framework's original pick on the
  // very next reload, defeating the point of overriding.
  it('trusts a persisted override instead of recomputing over it', async () => {
    const overridden = storedRun({
      runType: 'tempo', durationMin: 25, distanceKm: null,
      rationale: `${OVERRIDE_RATIONALE_PREFIX}a tempo run today.`,
    })
    getPrescribedRuns.mockResolvedValue([overridden])

    const body = await (await readPlan()).json()
    expect(prescribeNextRun).not.toHaveBeenCalled()
    expect(body.prescription).toMatchObject({ type: 'tempo', durationMin: 25, distanceKm: null })
    expect(body.run).toEqual(overridden)
    // The gate already ran once at override time; its outcome is persisted, its reasons are not.
    expect(body.gateAction).toBe('proceed')
    expect(body.gateReasons).toEqual([])
  })

  it('recomputes when today\'s row is the framework\'s own pick', async () => {
    getPrescribedRuns.mockResolvedValue([storedRun()])
    const body = await (await readPlan()).json()
    expect(prescribeNextRun).toHaveBeenCalledTimes(1)
    expect(body.gateReasons).toEqual(['fresh'])
  })

  // Its status may already be completed or skipped — clobbering it would revert the user's action.
  it('never overwrites today\'s existing row', async () => {
    getPrescribedRuns.mockResolvedValue([storedRun({ status: 'completed', activityLogId: LOG })])
    const body = await (await readPlan()).json()
    expect(upsertPrescribedRun).not.toHaveBeenCalled()
    expect(body.run.status).toBe('completed')
  })

  it('creates today\'s row when there is none, so completion has a stable id', async () => {
    await readPlan()
    expect(upsertPrescribedRun).toHaveBeenCalledTimes(1)
    expect(upsertPrescribedRun.mock.calls[0][1]).toMatchObject({ status: 'pending', activityLogId: null })
  })

  it('raises a push session\'s distance above the block\'s best, and says why', async () => {
    resolvePushContext.mockResolvedValue({ isPush: true, bestDistanceKm: 8 })
    const body = await (await readPlan()).json()
    expect(body.isPushSession).toBe(true)
    expect(body.prescription.distanceKm).toBe(8.16)   // 8 × 1.02
    expect(body.prescription.rationale).toContain('8.00 km')
  })

  it('leaves the prescribed distance alone when it already beats the best', async () => {
    resolvePushContext.mockResolvedValue({ isPush: true, bestDistanceKm: 3 })
    const body = await (await readPlan()).json()
    expect(body.prescription.distanceKm).toBe(6)      // the framework's own, not 3.06
  })

  it('rate-limits the twenty-first read in the minute', async () => {
    for (let i = 0; i < 20; i++) expect((await readPlan()).status).toBe(200)
    expect((await readPlan()).status).toBe(429)
  })
})

describe('POST /api/running-plan — create', () => {
  it('rejects an unknown key and an out-of-range session length', async () => {
    // Q-464: the one client sends exactly the named fields.
    expect((await post({ goalKind: 'speed', userId: 'someone-else' })).status).toBe(400)
    expect((await post({ goalKind: 'jogging' })).status).toBe(400)
    expect((await post({ timePerSessionMinutes: 181 })).status).toBe(400)
    expect((await post({ targetDistanceKm: -5 })).status).toBe(400)
    expect(saveRunningPlan).not.toHaveBeenCalled()
  })

  it('derives the framework from the goal, and lets an explicit one win', async () => {
    await post({ goalKind: 'speed' })
    const derived = (saveRunningPlan.mock.calls[0][1] as Row).frameworkKey
    expect(derived).toBeTruthy()

    saveRunningPlan.mockClear()
    await post({ goalKind: 'speed', frameworkKey: 'custom_block' })
    expect((saveRunningPlan.mock.calls[0][1] as Row).frameworkKey).toBe('custom_block')
  })

  it('validates the target date, storing null rather than a date-shaped string that is not a day', async () => {
    // Both separators are accepted (the client's `localDateString()` emits slashes). The stored
    // FORM is deliberately not asserted here — the route uses `normalizeDateParam`, which returns
    // the slash form, against a Postgres `date` column; see LA-79.
    await post({ goalKind: 'distance_event', targetDistanceKm: 21.1, targetDate: '2026/12/01' })
    expect((saveRunningPlan.mock.calls[0][1] as Row).targetDate).toMatch(/^2026[-/]12[-/]01$/)

    saveRunningPlan.mockClear()
    await post({ goalKind: 'distance_event', targetDate: '2026-13-45' })
    expect((saveRunningPlan.mock.calls[0][1] as Row).targetDate).toBeNull()
  })

  it('starts the plan active with today\'s run pending', async () => {
    await post({ goalKind: 'endurance' })
    expect((saveRunningPlan.mock.calls[0][1] as Row).isActive).toBe(true)
    expect(upsertPrescribedRun.mock.calls[0][1]).toMatchObject({ status: 'pending', activityLogId: null })
  })

  it('refuses an oversized body', async () => {
    expect((await post({ goalKind: 'speed', frameworkKey: 'x'.repeat(256 * 1024) })).status).toBe(413)
  })
})

describe('POST /api/running-plan/override', () => {
  it('refuses without a session and 404s with no active plan', async () => {
    sessionUser = null
    expect((await override({ runType: 'easy', durationMin: 30 })).status).toBe(401)

    freshUser()
    getActiveRunningPlan.mockResolvedValue(null)
    expect((await override({ runType: 'easy', durationMin: 30 })).status).toBe(404)
    expect(upsertPrescribedRun).not.toHaveBeenCalled()
  })

  it('accepts only the two fields the client sends, within bounds', async () => {
    for (const bad of [
      { runType: 'sprint', durationMin: 30 },
      { runType: 'easy', durationMin: 5 },
      { runType: 'easy', durationMin: 121 },
      { runType: 'easy', durationMin: 30, userId: 'someone-else' },
      { runType: 'easy' },
    ]) {
      expect((await override(bad)).status).toBe(400)
    }
    expect(upsertPrescribedRun).not.toHaveBeenCalled()
  })

  // The user is choosing structure, not a distance goal, so there is no framework-derived distance.
  it('marks a manual pick with the override rationale and no distance target', async () => {
    await override({ runType: 'tempo', durationMin: 25 })
    const written = upsertPrescribedRun.mock.calls[0][1] as Row
    expect(written.runType).toBe('tempo')
    expect(written.durationMin).toBe(25)
    expect(written.distanceKm).toBeNull()
    expect(written.rationale).toContain(OVERRIDE_RATIONALE_PREFIX)
    expect(written.rationale).toContain('a tempo run')
    expect(written.date).toBe(todayInTz('Australia/Brisbane'))
  })

  // Picking a different structure supersedes an earlier skip: overriding re-commits to running.
  it('resets the status to pending even when today was already skipped', async () => {
    getPrescribedRuns.mockResolvedValue([storedRun({ status: 'skipped', activityLogId: LOG })])
    await override({ runType: 'easy', durationMin: 30 })
    const written = upsertPrescribedRun.mock.calls[0][1] as Row
    expect(written.status).toBe('pending')
    // The same row, and its linked activity, are kept rather than a duplicate created.
    expect(written.id).toBe(RUN)
    expect(written.activityLogId).toBe(LOG)
  })

  it('shares its rate-limit budget with the plan read, since both recompute the same thing', async () => {
    for (let i = 0; i < 20; i++) expect((await override({ runType: 'easy', durationMin: 30 })).status).toBe(200)
    expect((await override({ runType: 'easy', durationMin: 30 })).status).toBe(429)
    expect((await readPlan()).status).toBe(429)
  })
})

describe('GET /api/running-plan/run-type-stats', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await runTypeStats()).status).toBe(401)
  })

  // Run type is only known for runs completed through the prescribed-run flow; a freeform run has
  // no type recorded anywhere, so it cannot contribute.
  it('counts only completed runs that are linked to an activity', async () => {
    getPrescribedRuns.mockResolvedValue([
      storedRun({ id: 'r1', runType: 'easy', status: 'completed', activityLogId: LOG }),
      storedRun({ id: 'r2', runType: 'tempo', status: 'completed', activityLogId: null }),
      storedRun({ id: 'r3', runType: 'long', status: 'skipped', activityLogId: LOG }),
      storedRun({ id: 'r4', runType: 'interval', status: 'pending', activityLogId: null }),
    ])
    listActivityLogs.mockResolvedValue([{ id: LOG, distanceKm: 6, avgPaceSecPerKm: 330, avgHr: 145 }])
    const body = await (await runTypeStats()).json()
    // Every run type is a key; what varies is whether anything counted toward it.
    expect(body.easy).toMatchObject({ count: 1, avgDistanceKm: 6, avgPaceSecPerKm: 330, avgHr: 145 })
    expect(body.tempo.count).toBe(0)     // completed but linked to no activity
    expect(body.long.count).toBe(0)      // linked, but skipped
    expect(body.interval.count).toBe(0)  // neither
  })

  // Both reads are best-effort: a stats panel is not worth a 500.
  it('degrades to empty rather than failing when a read throws', async () => {
    getPrescribedRuns.mockRejectedValue(new Error('timeout'))
    listActivityLogs.mockRejectedValue(new Error('timeout'))
    const res = await runTypeStats()
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('looks back three years from today in the caller\'s timezone', async () => {
    freshUser({ timezone: 'Etc/GMT-14' })
    await runTypeStats()
    const [, from, to] = getPrescribedRuns.mock.calls[0]
    expect(to).toBe(todayInTz('Etc/GMT-14'))
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
    expect(days).toBe(1095)
  })
})

describe('PATCH /api/running-plan/runs/[id]', () => {
  it('refuses without a session and on a malformed id', async () => {
    sessionUser = null
    expect((await patch({ status: 'completed' })).status).toBe(401)

    freshUser()
    expect((await patch({ status: 'completed' }, 'not-a-uuid')).status).toBe(400)
    expect(updatePrescribedRun).not.toHaveBeenCalled()
  })

  it('accepts only completed or skipped', async () => {
    for (const bad of [{ status: 'pending' }, { status: 'done' }, {}]) {
      expect((await patch(bad)).status).toBe(400)
    }
    expect(updatePrescribedRun).not.toHaveBeenCalled()
  })

  // The id is taken from the PATH and spread over the body, so a body-supplied one cannot redirect
  // the write to another run.
  it('writes to the run the path names, not one the body names', async () => {
    await patch({ status: 'completed', id: OTHER_RUN, activityLogId: LOG })
    const [userId, id, patchArg] = updatePrescribedRun.mock.calls[0] as [string, string, Row]
    expect(id).toBe(RUN)
    expect(userId).toBe(sessionUser!.id)
    expect(patchArg).toEqual({ status: 'completed', activityLogId: LOG })
  })

  it('clears the activity link when none is given', async () => {
    await patch({ status: 'skipped' })
    expect((updatePrescribedRun.mock.calls[0][2] as Row).activityLogId).toBeNull()
  })

  it('404s a run that is not the caller\'s', async () => {
    updatePrescribedRun.mockResolvedValue(null)
    expect((await patch({ status: 'completed' })).status).toBe(404)
  })
})
