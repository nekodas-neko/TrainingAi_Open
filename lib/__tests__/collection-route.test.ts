/**
 * LB-60: `replayCollection` shipped with no caller and nothing on the client could assemble a
 * `ReplayInput` — of the four things the fold needs, one was reachable, over a fixed window, for one
 * of the three ladders. This route is that assembly.
 *
 * What is worth pinning is the ASSEMBLY, not the fold — `packages/shared/src/collection/__tests__`
 * already covers the fold. So these assert what the route feeds it: all history rather than a
 * window, the schedule-derived allowance on the ladder that has a schedule, the user's own rest days
 * as `pausedDays`, and the faucet thresholds applied to the right field.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { COLLECTION_RULES_VERSION, STEPS_MAX_REST_GAP } from '@trainingai/shared/collection/ladder'
import { shiftDateStr } from '@trainingai/shared/date-utils'

const listTrainedDayKeys = vi.fn(async () => [] as string[])
const listRestDays = vi.fn(async () => [] as string[])
const getActiveProgram = vi.fn(async () => null as unknown)
// RV-63 — these were `listBodyMetrics`/`listSleepSessions` read in full and projected to `.date`.
// The `> 0` predicate moved into SQL with them, so the two cases below that used to prove it at
// this layer now prove it in `lib/data/postgres/__tests__/rv63-collection-day-keys.test.ts`
// against a real Postgres. The guarantee moved with the code rather than being dropped.
const listStepDayKeys = vi.fn(async () => [] as string[])
const listSleepDayKeys = vi.fn(async () => [] as string[])

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u-1', timezone: 'Australia/Brisbane' } }) }))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({ listTrainedDayKeys, listRestDays, getActiveProgram, listStepDayKeys, listSleepDayKeys }),
}))

import { GET } from '@/app/api/collection/route'

const body = async () => {
  const res = await GET()
  expect(res.status).toBe(200)
  // Replayed from history on every read, so it must never be served stale (ladder.ts's versioning
  // note) — and the cache half of that is the header, not just the version field.
  expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  return res.json() as Promise<{
    collections: Record<'workout' | 'steps' | 'sleep', { stock: number[]; decayEvents: number }>
    rulesVersion: number
    today: string
  }>
}

/** N consecutive days ending `endExclusiveOffset` days before `today`, ascending — so a fixture can
 *  sit clear of the trailing gap that would otherwise decay what the test just spawned. Walked with
 *  `shiftDateStr` rather than epoch arithmetic: the banned UTC-slice is right here by accident and
 *  wrong the moment it is copied somewhere with a local-time date, which is what the rule is for. */
const runTo = (endExclusiveOffset: number, n: number, today: string) => {
  const out: string[] = []
  for (let i = n + endExclusiveOffset; i > endExclusiveOffset; i--) out.push(shiftDateStr(today, -i))
  return out
}

beforeEach(() => {
  for (const m of [listTrainedDayKeys, listRestDays, getActiveProgram, listStepDayKeys, listSleepDayKeys]) m.mockClear()
  listTrainedDayKeys.mockResolvedValue([])
  listRestDays.mockResolvedValue([])
  getActiveProgram.mockResolvedValue(null)
  listStepDayKeys.mockResolvedValue([])
  listSleepDayKeys.mockResolvedValue([])
})

describe('GET /api/collection assembles what the fold needs', () => {
  it('returns all three ladders and the rules version', async () => {
    const json = await body()
    expect(Object.keys(json.collections).sort()).toEqual(['sleep', 'steps', 'workout'])
    expect(json.rulesVersion).toBe(COLLECTION_RULES_VERSION)
  })

  it('reads the workout days over ALL history, not a window', async () => {
    // A windowed read replays a partial history into a wrong answer — the reason `/api/streak-data`
    // could not have been reused for this.
    await body()
    expect(listTrainedDayKeys).toHaveBeenCalledWith('u-1', 'Australia/Brisbane')
    expect(listTrainedDayKeys.mock.calls[0]).toHaveLength(2)
  })

  it('spawns one cat per trained day', async () => {
    const json0 = await body()
    const today = json0.today
    listTrainedDayKeys.mockResolvedValue(runTo(0, 3, today))

    const json = await body()
    // Three consecutive days, no gap: three bottom-tier, nothing merged, nothing lost.
    expect(json.collections.workout.stock[0]).toBe(3)
    expect(json.collections.workout.decayEvents).toBe(0)
  })

  it('passes the user\'s chosen rest days through as pausedDays', async () => {
    const json0 = await body()
    const today = json0.today
    // Two trained days a week apart. Unexcused that is six chargeable rest days and the collection
    // decays; with every day between them marked rest, none of them is chargeable.
    const days = [runTo(0, 1, today)[0], runTo(7, 1, today)[0]].sort()
    listTrainedDayKeys.mockResolvedValue(days)

    const withoutRest = await body()
    expect(withoutRest.collections.workout.decayEvents).toBeGreaterThan(0)

    listRestDays.mockResolvedValue(runTo(1, 6, today))
    const withRest = await body()
    expect(withRest.collections.workout.decayEvents).toBe(0)
  })

  it('excuses the confirmed early-deload week, so a prescribed deload costs no cats', async () => {
    // LA-76. The mechanic's own argument is that decaying compliance turns it against the user, and
    // a deload the app asked for is compliance. `confirm-early-deload` stamps a dated 7-day span on
    // the program, and that span is the ONLY dated record of a deload in the schema — a deload
    // PHASE is measured in cycles, so it has no interval to read.
    const json0 = await body()
    const today = json0.today
    const days = [runTo(0, 1, today)[0], runTo(7, 1, today)[0]].sort()
    listTrainedDayKeys.mockResolvedValue(days)

    expect((await body()).collections.workout.decayEvents).toBeGreaterThan(0)

    // The week starting six days back covers every day between those two sessions.
    getActiveProgram.mockResolvedValue({ earlyDeloadWeekStart: shiftDateStr(today, -6) })
    expect((await body()).collections.workout.decayEvents).toBe(0)
  })

  it('does not excuse a deload week that has already ended', async () => {
    // The span is seven days and then it stops. Without that bound a single confirmed deload would
    // excuse every gap after it forever, which is the failure mode of pausing on a scalar flag
    // rather than a dated window.
    const json0 = await body()
    const today = json0.today
    listTrainedDayKeys.mockResolvedValue([runTo(0, 1, today)[0], runTo(7, 1, today)[0]].sort())
    getActiveProgram.mockResolvedValue({ earlyDeloadWeekStart: shiftDateStr(today, -60) })

    expect((await body()).collections.workout.decayEvents).toBeGreaterThan(0)
  })

  /**
   * RV-63 — this used to seed metric rows and assert the route spawned a cat for a LOW day
   * (400 steps, 3.5 h), proving there is no threshold above "recorded". The predicate now lives in
   * SQL, so what this layer can still prove is that the route spawns one cat per day it is GIVEN
   * and invents no bar of its own. The threshold half is asserted against a real Postgres in
   * `rv63-collection-day-keys.test.ts`.
   *
   * Measured before any of this was wired: only 35 of the owner's 130 step-days reach 8,000
   * (avg 5,646), so a threshold would decay the steps ladder most weeks.
   */
  it('spawns one cat per day it is given, with no threshold of its own', async () => {
    const today = (await body()).today
    const [d1, d2] = runTo(0, 2, today)
    listStepDayKeys.mockResolvedValue([d1, d2])
    listSleepDayKeys.mockResolvedValue([d1, d2])

    const json = await body()
    expect(json.collections.steps.stock[0]).toBe(2)
    expect(json.collections.sleep.stock[0]).toBe(2)
  })

  it('spawns nothing when the reads return no recorded days', async () => {
    listStepDayKeys.mockResolvedValue([])
    listSleepDayKeys.mockResolvedValue([])

    const json = await body()
    expect(json.collections.steps.stock[0]).toBe(0)
    expect(json.collections.sleep.stock[0]).toBe(0)
  })

  it('uses the rest-gap constants ladder.ts already exports, not a new copy of the number', async () => {
    // A third `2` in a third file is the One Formula, One Place defect this repo keeps fixing — and
    // it is what the first draft of this route shipped, because the engine's field comment says
    // "a constant for steps and sleep" and the constant was never grepped for.
    const json0 = await body()
    const today = json0.today
    // A gap one wider than the allowance decays exactly once.
    const days = [runTo(0, 1, today)[0], runTo(STEPS_MAX_REST_GAP + 2, 1, today)[0]].sort()
    listStepDayKeys.mockResolvedValue(days)

    const json = await body()
    expect(json.collections.steps.decayEvents).toBe(1)
  })

  it('takes the workout allowance from the schedule, not the unscheduled constant', async () => {
    const json0 = await body()
    const today = json0.today
    // A weekly schedule training Mon/Wed/Fri allows a two-day gap; the unscheduled fallback is one.
    // Same two trained days three days apart: allowed under the schedule, a decay without it.
    const days = [runTo(0, 1, today)[0], runTo(3, 1, today)[0]].sort()
    listTrainedDayKeys.mockResolvedValue(days)

    const unscheduled = await body()

    getActiveProgram.mockResolvedValue({
      schedule: {
        type: 'weekly',
        days: [
          { dayOfWeek: 1, sessionId: 's1' }, { dayOfWeek: 3, sessionId: 's1' }, { dayOfWeek: 5, sessionId: 's1' },
        ],
      },
    })
    const scheduled = await body()

    expect(scheduled.collections.workout.decayEvents).toBeLessThan(unscheduled.collections.workout.decayEvents)
  })
})
