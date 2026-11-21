/**
 * #3779 — the walking plan's server half: it measures the days, judges weeks that have ended, and
 * marks a walked day done itself, with no screen open (#3801 item 4). Run in two timezones.
 *
 * Every fixture is derived from `todayInTz(tz)` and placed at LOCAL MIDDAY on its day, so no test
 * hardcodes one side of a rolling window and none straddles a midnight. The repository is an
 * in-memory fake; the heart-rate profile is fixed so the moderate floor is 112 bpm
 * (60 + 40% × (190 − 60)).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fromZonedTime } from 'date-fns-tz'
import { shiftDateStr, todayInTz, weekStartForDay } from '@trainingai/shared/date-utils'
import { walkingWeekStatus } from '@trainingai/shared/running/walking-plan'
import { firstJudgedWeek, MINUTES_CEILING_PLUS, parseWalkingState, setMinutesCeiling } from '@trainingai/shared/running/walking-plan'

vi.mock('@trainingai/shared/health/hr-profile', async (orig) => ({
  ...(await orig() as object),
  resolveHrProfile: async () => ({ maxHr: 190, restingHr: 60 }),
}))

import {
  applyWalkingChoice, resetWalkingSettleThrottle, settleWalkingPlan, settleWalkingPlanSoon, walkingPlanStartDate, WALK_DAY_RUN_TYPE, WALKING_STATE_KEY,
} from '../walking-plan-service'
import { heartHealthDays } from '../heart-health-service'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- an in-memory fake of loosely-shaped rows
type Row = Record<string, any>
const USER = 'u-1'

function fakeRepo(tz: string, opts: { planStart: string; stepsGoal?: number | null }) {
  const midday = (date: string) => fromZonedTime(`${date}T12:00:00`, tz)
  const db = {
    plan: {
      id: 'plan-w', userId: USER, goalKind: 'walking', frameworkKey: 'walking-heart-health', fitnessSnapshot: {} as Row,
      targetDistanceKm: null, targetDate: null, timePerSessionMinutes: null, isActive: true,
      createdAt: midday(opts.planStart), updatedAt: midday(opts.planStart),
    } as Row,
    metrics: [] as Row[],
    logs: [] as Row[],
    rest: [] as string[],
    checkins: [] as Row[],
    moods: [] as Row[],
    hr: [] as { timestamp: Date; bpm: number; source: string | null }[],
    runs: [] as Row[],
    snapshotWrites: 0,
    snapshotConflicts: 0,
    /** Runs once, just before the next snapshot write is checked: another process's write. */
    beforeNextSnapshotWrite: null as null | (() => void),
  }
  const inRange = (d: string, f: string, t: string) => d >= f && d <= t
  const repo = {
    getActiveRunningPlan: vi.fn(async () => (db.plan.isActive ? { ...db.plan } : null)),
    getUserById: vi.fn(async () => ({ id: USER, timezone: tz, activityLevel: null })),
    getUserGoals: vi.fn(async () => ({ stepsGoal: opts.stepsGoal ?? null })),
    listBodyMetrics: vi.fn(async (_u: string, f: string, t: string) => db.metrics.filter((m) => inRange(m.date, f, t))),
    listActivityLogs: vi.fn(async (_u: string, f: string, t: string) => db.logs.filter((l) => inRange(l.date, f, t))),
    listRestDays: vi.fn(async (_u: string, f: string, t: string) => db.rest.filter((d) => inRange(d, f, t))),
    listDayCheckins: vi.fn(async (_u: string, f: string, t: string) => db.checkins.filter((c) => inRange(c.logDate, f, t))),
    listMoodLogs: vi.fn(async (_u: string, f: string, t: string) => db.moods.filter((m) => inRange(m.logDate, f, t))),
    getHrForWindow: vi.fn(async (_u: string, from: Date, to: Date) => db.hr.filter((r) => r.timestamp >= from && r.timestamp <= to)),
    updateRunningPlanSnapshot: vi.fn(async (_u: string, id: string, snap: Row, o: { ifUpdatedAt?: Date } = {}) => {
      const hook = db.beforeNextSnapshotWrite
      db.beforeNextSnapshotWrite = null
      hook?.()
      if (id !== db.plan.id) return null
      if (o.ifUpdatedAt && o.ifUpdatedAt.getTime() !== db.plan.updatedAt.getTime()) { db.snapshotConflicts++; return null }
      db.snapshotWrites++
      db.plan.fitnessSnapshot = JSON.parse(JSON.stringify(snap))
      db.plan.updatedAt = new Date(db.plan.updatedAt.getTime() + 1)
      return { ...db.plan }
    }),
    getPrescribedRuns: vi.fn(async (_u: string, f: string, t: string, o: { includeDeleted?: boolean } = {}) => db.runs
      .filter((r) => inRange(r.date, f, t) && (o.includeDeleted || r.deletedAt == null))
      .map((r) => (o.includeDeleted ? { ...r, deletedAt: r.deletedAt ?? null } : { ...r }))),
    upsertPrescribedRun: vi.fn(async (_u: string, r: Row) => {
      const row = { ...r, userId: USER, completedAs: null, updatedAt: new Date() }
      db.runs = db.runs.filter((x) => !(x.planId === r.planId && x.date === r.date))
      db.runs.push(row)
      return { ...row }
    }),
    updatePrescribedRun: vi.fn(async (_u: string, id: string, patch: Row, o: { onlyIfPending?: boolean } = {}) => {
      const row = db.runs.find((r) => r.id === id)
      if (!row) return null
      if (o.onlyIfPending && (row.status !== 'pending' || row.deletedAt != null)) return null
      Object.assign(row, patch)
      return { ...row }
    }),
  }
  const log = (date: string, over: Row = {}) => {
    db.logs.push({
      id: `log-${date}-${db.logs.length}`, userId: USER, date, activityType: 'treadmill', title: 'Treadmill',
      startTime: '12:00', endTime: '12:30', durationMin: 30, distanceKm: 2.5, createdAt: new Date(), ...over,
    })
  }
  const steps = (date: string, n: number) => { db.metrics.push({ date, steps: n }) }
  /** Dense heart rate (one reading a minute) across local midday to 12:30 on `date`. */
  const denseHr = (date: string, bpm: number) => {
    const from = midday(date).getTime()
    for (let m = 0; m <= 30; m++) db.hr.push({ timestamp: new Date(from + m * 60_000), bpm, source: 'oura_cloud' })
  }
  return { db, repo: repo as never, log, steps, denseHr }
}

/** Pin the clock (Date only; timers stay real) to local midday on `date` in `tz`. */
function pinClock(tz: string, date: string) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(fromZonedTime(`${date}T12:00:00`, tz))
}

describe.each(['Australia/Brisbane', 'America/Los_Angeles'])('the walking plan on the server, in %s', (tz) => {
  let today: string
  let thisMonday: string
  let lastMonday: string
  beforeEach(() => {
    // Thursday of the current local week: last week is past its two-day grace, whatever day the
    // suite runs on. Derived from the clock, then pinned, so both sides of every window agree.
    const thursday = shiftDateStr(weekStartForDay(todayInTz(tz)), 3)
    pinClock(tz, thursday)
    today = todayInTz(tz)
    thisMonday = weekStartForDay(today)
    lastMonday = shiftDateStr(thisMonday, -7)
    resetWalkingSettleThrottle()
  })
  afterEach(() => { vi.useRealTimers() })

  it('sets its starting targets from the person\'s own history, and stores them on the plan', async () => {
    const f = fakeRepo(tz, { planStart: today })
    // 28 days before the start: steps of 6,200 to 7,100, median 6,650 → 7,000.
    for (let i = 1; i <= 28; i++) f.steps(shiftDateStr(today, -i), 6200 + (i % 10) * 100)
    // The four full weeks before the plan's first week: 70 min each (2 × 35-min walks at 5 km/h) → 70.
    const firstMonday = weekStartForDay(today)
    for (let w = 1; w <= 4; w++) {
      f.log(shiftDateStr(firstMonday, -7 * w + 1), { durationMin: 35, endTime: '12:35', distanceKm: 35 / 60 * 5 })
      f.log(shiftDateStr(firstMonday, -7 * w + 3), { durationMin: 35, endTime: '12:35', distanceKm: 35 / 60 * 5 })
    }
    const view = await settleWalkingPlan(f.repo, USER, tz)
    expect(view!.start).toMatchObject({ steps: 7000, stepsBasis: 'median', minutes: 70, minutesBasis: 'median', date: today })
    expect(view!.targets).toMatchObject({ stepsPerDay: 7000, activeMinutesPerWeek: 70, activeMinutesPerDay: 10, stepsCeiling: 12_000, minutesCeiling: 150 })
    const stored = parseWalkingState(f.db.plan.fitnessSnapshot[WALKING_STATE_KEY])
    expect(stored?.stepsTarget).toBe(7000)
    expect(stored?.nextWeekToJudge).toBe(firstJudgedWeek(today))
  })

  it('the person\'s own steps goal is the start when they set one', async () => {
    const f = fakeRepo(tz, { planStart: today, stepsGoal: 9200 })
    f.steps(shiftDateStr(today, -1), 3000)
    const view = await settleWalkingPlan(f.repo, USER, tz)
    expect(view!.targets.stepsPerDay).toBe(9200)
    expect(view!.start.stepsBasis).toBe('own_goal')
  })

  it('marks a walked day done with no screen open, from a treadmill walk with no heart rate', async () => {
    const f = fakeRepo(tz, { planStart: today })
    f.log(today) // 30 min at 5 km/h, no heart rate: rule 2 by speed
    const view = await settleWalkingPlan(f.repo, USER, tz)
    const row = f.db.runs.find((r) => r.date === today)!
    expect(row).toMatchObject({ runType: WALK_DAY_RUN_TYPE, planId: 'plan-w', status: 'completed', completedAs: 'walk' })
    expect(row.activityLogId).toBe(f.db.logs[0].id)
    const day = view!.week.days.find((d) => d.date === today)!
    expect(day).toMatchObject({ activeMinutes: 30, minutesMet: true, done: true, basis: 'speed', status: 'completed', isToday: true })
  })

  it('counts from heart rate when it is dense, and says so', async () => {
    const f = fakeRepo(tz, { planStart: today })
    f.log(today, { distanceKm: 1.5 }) // 3 km/h: the speed rule alone would count nothing
    f.denseHr(today, 125)
    const view = await settleWalkingPlan(f.repo, USER, tz)
    const day = view!.week.days.find((d) => d.date === today)!
    expect(day).toMatchObject({ activeMinutes: 30, basis: 'heart_rate', done: true })
    expect(view!.week.activeMinutesBasis).toBe('heart_rate')
  })

  it('the week carries its status (rule B), computed from the same measured days', async () => {
    const f = fakeRepo(tz, { planStart: today })
    const view = await settleWalkingPlan(f.repo, USER, tz)
    const expected = walkingWeekStatus({
      weekStart: view!.week.from, today, startDate: view!.start.date,
      minutesTarget: view!.targets.activeMinutesPerWeek, days: view!.week.days,
    })
    expect(expected).not.toBeNull()
    expect(view!.week.status).toEqual(expected)
    // And an older client reading the block still finds every field it had.
    expect(view!.week).toMatchObject({ from: expect.any(String), daysDone: expect.any(Number) })
  })

  it('a day done by steps alone is completed without an activity link', async () => {
    const f = fakeRepo(tz, { planStart: today, stepsGoal: 8000 })
    f.steps(today, 8400)
    await settleWalkingPlan(f.repo, USER, tz)
    expect(f.db.runs.find((r) => r.date === today)).toMatchObject({ status: 'completed', activityLogId: null, completedAs: 'walk' })
  })

  it('leaves a rest day and a sick day out: no row, never done', async () => {
    // Started last Monday, so this week and last are both the plan's.
    const f = fakeRepo(tz, { planStart: lastMonday, stepsGoal: 8000 })
    const rest = shiftDateStr(lastMonday, 2)
    const sick = shiftDateStr(lastMonday, 3)
    f.db.rest.push(rest)
    f.db.checkins.push({ logDate: sick, phase: 'morning', illnessContext: 'sick' })
    f.steps(rest, 20_000)
    f.steps(sick, 20_000)
    await settleWalkingPlan(f.repo, USER, tz)
    expect(f.db.runs.find((r) => r.date === rest)).toBeUndefined()
    expect(f.db.runs.find((r) => r.date === sick)).toBeUndefined()
    const judged = parseWalkingState(f.db.plan.fitnessSnapshot[WALKING_STATE_KEY])!.weeks.find((w) => w.weekStart === lastMonday)!
    expect(judged.countedDays).toBe(5)
    expect(judged.stepDaysMet).toBe(0)
  })

  it('judges last week once it has ended, raising the minutes it met', async () => {
    const f = fakeRepo(tz, { planStart: lastMonday, stepsGoal: 8000 })
    for (let i = 0; i < 7; i++) { f.log(shiftDateStr(lastMonday, i)); f.steps(shiftDateStr(lastMonday, i), i < 5 ? 8500 : 3000) }
    const view = await settleWalkingPlan(f.repo, USER, tz)
    const s = parseWalkingState(f.db.plan.fitnessSnapshot[WALKING_STATE_KEY])!
    expect(s.weeks).toHaveLength(1)
    expect(s.weeks[0]).toMatchObject({ weekStart: lastMonday, minutesTarget: 60, activeMinutes: 210, minutesMet: true, stepDaysMet: 5, stepsMet: true })
    expect(s.minutesTarget).toBe(75)
    expect(s.stepsTarget).toBe(8000) // one qualifying week of two
    expect(s.stepsStreak).toBe(1)
    expect(s.nextWeekToJudge).toBe(thisMonday)
    expect(view!.history).toHaveLength(1)
    // Last week's days were completed at last week's levels.
    expect(f.db.runs.filter((r) => r.date < thisMonday && r.status === 'completed')).toHaveLength(7)
    expect(f.db.runs.find((r) => r.date === lastMonday)!.durationMin).toBe(9) // ceil(60 / 7)
  })

  it('is idempotent: a second pass judges nothing again, adds no row and writes no state', async () => {
    const f = fakeRepo(tz, { planStart: lastMonday })
    f.log(lastMonday)
    await settleWalkingPlan(f.repo, USER, tz)
    const rows = f.db.runs.length
    const writes = f.db.snapshotWrites
    await settleWalkingPlan(f.repo, USER, tz)
    expect(f.db.runs.length).toBe(rows)
    expect(f.db.snapshotWrites).toBe(writes)
    expect(parseWalkingState(f.db.plan.fitnessSnapshot[WALKING_STATE_KEY])!.weeks).toHaveLength(1)
  })

  it('never takes a completion back, and a skipped day stays skipped', async () => {
    const f = fakeRepo(tz, { planStart: today })
    f.db.runs.push({ id: 'r-skip', planId: 'plan-w', date: today, runType: WALK_DAY_RUN_TYPE, status: 'skipped', activityLogId: null })
    f.log(today)
    await settleWalkingPlan(f.repo, USER, tz)
    expect(f.db.runs.find((r) => r.id === 'r-skip')!.status).toBe('skipped')
  })

  it('does nothing for a running plan', async () => {
    const f = fakeRepo(tz, { planStart: today })
    f.db.plan.goalKind = 'heart_health'
    f.db.plan.frameworkKey = 'zone2-base'
    expect(await settleWalkingPlan(f.repo, USER, tz)).toBeNull()
    expect(f.db.runs).toHaveLength(0)
  })

  it('the running plan\'s heart-health rule never judges a walking day', async () => {
    const f = fakeRepo(tz, { planStart: today })
    await settleWalkingPlan(f.repo, USER, tz)
    expect(f.db.runs).toHaveLength(1)
    expect(await heartHealthDays(f.repo, USER, tz, today, today, { maxHr: 190, restingHr: 60 })).toEqual([])
  })

  it('settles after data lands at once, and folds a burst into one more settle at the end of the minute', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(fromZonedTime(`${today}T12:00:00`, tz))
    const f = fakeRepo(tz, { planStart: today })
    f.log(today, { distanceKm: 1.5 }) // 3 km/h: nothing counts until the heart rate lands
    const flush = async () => { for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r)) }
    const t = Date.now()
    settleWalkingPlanSoon(f.repo, USER, tz, t) // the activity lands
    await flush()
    expect(f.db.runs.find((r) => r.date === today)?.status).toBe('pending')
    f.denseHr(today, 125) // the Oura webhook's heart-rate catch-up, a second later
    settleWalkingPlanSoon(f.repo, USER, tz, t + 1000)
    settleWalkingPlanSoon(f.repo, USER, tz, t + 2000)
    await flush()
    expect(f.db.runs.find((r) => r.date === today)?.status).toBe('pending') // inside the window
    await vi.advanceTimersByTimeAsync(60_000)
    await flush()
    expect(f.db.runs.find((r) => r.date === today)?.status).toBe('completed') // the trailing run saw it
    const reads = (f.repo as unknown as { getActiveRunningPlan: { mock: { calls: unknown[] } } }).getActiveRunningPlan.mock.calls.length
    expect(reads).toBe(4) // two runs, each a check and the settle's own read: the third call folded in
  })

  describe('a week is re-judged until two days after its Sunday', () => {
    it('Sunday\'s steps landing on Monday, after a first settle, change the verdict; after the grace they do not', async () => {
      const f = fakeRepo(tz, { planStart: lastMonday, stepsGoal: 8000 })
      for (let i = 0; i < 6; i++) f.steps(shiftDateStr(lastMonday, i), i < 4 ? 8500 : 3000)
      // Monday of this week: last week has just ended.
      pinClock(tz, thisMonday)
      const first = await settleWalkingPlan(f.repo, USER, tz)
      expect(first!.history.at(-1)).toMatchObject({ weekStart: lastMonday, stepDaysMet: 4, stepsMet: false, provisional: true })
      expect(parseWalkingState(f.db.plan.fitnessSnapshot[WALKING_STATE_KEY])!.weeks).toHaveLength(0) // nothing frozen

      // Sunday's steps sync later on Monday.
      f.steps(shiftDateStr(lastMonday, 6), 9000)
      const second = await settleWalkingPlan(f.repo, USER, tz)
      expect(second!.history.at(-1)).toMatchObject({ stepDaysMet: 5, stepsMet: true, provisional: true })

      // Wednesday: frozen with what was there.
      pinClock(tz, shiftDateStr(thisMonday, 2))
      await settleWalkingPlan(f.repo, USER, tz)
      const frozen = parseWalkingState(f.db.plan.fitnessSnapshot[WALKING_STATE_KEY])!
      expect(frozen.weeks.at(-1)).toMatchObject({ weekStart: lastMonday, stepDaysMet: 5, stepsMet: true })
      expect(frozen.stepsStreak).toBe(1)

      // A late correction to Monday's steps on Thursday changes nothing stored or shown.
      f.db.metrics = f.db.metrics.filter((m) => m.date !== lastMonday)
      f.steps(lastMonday, 1000)
      pinClock(tz, shiftDateStr(thisMonday, 3))
      const late = await settleWalkingPlan(f.repo, USER, tz)
      expect(late!.history.at(-1)).toMatchObject({ stepDaysMet: 5, stepsMet: true })
      expect(late!.history.at(-1)!.provisional).toBeUndefined()
      expect(parseWalkingState(f.db.plan.fitnessSnapshot[WALKING_STATE_KEY])).toEqual(frozen)
    })
  })

  describe('no write is lost', () => {
    it('a settle queued behind the person\'s choice reads the plan after it, so the choice stands', async () => {
      const f = fakeRepo(tz, { planStart: lastMonday })
      await settleWalkingPlan(f.repo, USER, tz)
      const choice = applyWalkingChoice(f.repo, USER, tz, (s) => setMinutesCeiling(s, MINUTES_CEILING_PLUS))
      settleWalkingPlanSoon(f.repo, USER, tz) // its plan read happens while the choice holds the lock
      const queued = settleWalkingPlan(f.repo, USER, tz)
      expect((await choice).ok).toBe(true)
      await queued
      await vi.waitFor(() => expect(f.db.snapshotWrites).toBeGreaterThan(0))
      await new Promise((r) => setTimeout(r, 20))
      expect(parseWalkingState(f.db.plan.fitnessSnapshot[WALKING_STATE_KEY])!.minutesCeiling).toBe(MINUTES_CEILING_PLUS)
    })

    it('another process writing between the read and the write: the write is refused, re-read and redone once', async () => {
      const f = fakeRepo(tz, { planStart: lastMonday })
      f.log(lastMonday)
      // Another server process stores the "heart health plus" choice just before this settle writes.
      f.db.beforeNextSnapshotWrite = () => {
        f.db.plan.fitnessSnapshot = { other: 'kept', [WALKING_STATE_KEY]: { ...(f.db.plan.fitnessSnapshot[WALKING_STATE_KEY] ?? {}) } }
        f.db.plan.updatedAt = new Date(f.db.plan.updatedAt.getTime() + 5)
      }
      await settleWalkingPlan(f.repo, USER, tz)
      expect(f.db.snapshotConflicts).toBe(1)
      expect(f.db.snapshotWrites).toBe(1)
      expect(f.db.plan.fitnessSnapshot.other).toBe('kept')
      expect(parseWalkingState(f.db.plan.fitnessSnapshot[WALKING_STATE_KEY])!.weeks.map((w) => w.weekStart)).toEqual([lastMonday])
    })

    it('a choice that loses the race to another process is re-applied to what that process stored', async () => {
      const f = fakeRepo(tz, { planStart: lastMonday })
      await settleWalkingPlan(f.repo, USER, tz)
      const stored = parseWalkingState(f.db.plan.fitnessSnapshot[WALKING_STATE_KEY])!
      f.db.beforeNextSnapshotWrite = () => {
        f.db.plan.fitnessSnapshot = { [WALKING_STATE_KEY]: { ...stored, stepsTarget: stored.stepsTarget + 500 } }
        f.db.plan.updatedAt = new Date(f.db.plan.updatedAt.getTime() + 5)
      }
      const r = await applyWalkingChoice(f.repo, USER, tz, (s) => setMinutesCeiling(s, MINUTES_CEILING_PLUS))
      expect(r.ok).toBe(true)
      const after = parseWalkingState(f.db.plan.fitnessSnapshot[WALKING_STATE_KEY])!
      expect([after.minutesCeiling, after.stepsTarget]).toEqual([MINUTES_CEILING_PLUS, stored.stepsTarget + 500])
    })

    it('a day skipped after the settle read it stays skipped', async () => {
      const f = fakeRepo(tz, { planStart: today })
      f.db.runs.push({ id: 'r-1', planId: 'plan-w', date: today, runType: WALK_DAY_RUN_TYPE, status: 'pending', activityLogId: null })
      f.log(today)
      const repo = f.repo as unknown as { getPrescribedRuns: { mockImplementationOnce: (fn: (...a: unknown[]) => unknown) => void } }
      repo.getPrescribedRuns.mockImplementationOnce(async () => {
        const copy = f.db.runs.map((r) => ({ ...r, deletedAt: null }))
        f.db.runs.find((r) => r.id === 'r-1')!.status = 'skipped' // the person's skip lands mid-settle
        return copy
      })
      await settleWalkingPlan(f.repo, USER, tz)
      expect(f.db.runs.find((r) => r.id === 'r-1')!.status).toBe('skipped')
    })

    it('a walk day the person deleted is never recreated or rewritten', async () => {
      const f = fakeRepo(tz, { planStart: today })
      f.db.runs.push({ id: 'r-del', planId: 'plan-w', date: today, runType: WALK_DAY_RUN_TYPE, status: 'pending', activityLogId: null, deletedAt: new Date() })
      f.log(today)
      await settleWalkingPlan(f.repo, USER, tz)
      await settleWalkingPlan(f.repo, USER, tz)
      expect((f.repo as unknown as { upsertPrescribedRun: { mock: { calls: unknown[] } } }).upsertPrescribedRun.mock.calls).toHaveLength(0)
      expect(f.db.runs).toHaveLength(1)
      expect(f.db.runs[0]).toMatchObject({ id: 'r-del', status: 'pending' })
    })
  })
})

describe('the plan\'s weeks are the user\'s local weeks', () => {
  // One instant, both sides fixed: Monday 07:00 in Los Angeles is Tuesday 01:00 in Brisbane.
  const created = new Date('2026-11-09T15:00:00Z')
  it('the start day is the local day the plan was made', () => {
    expect(walkingPlanStartDate({ createdAt: created }, 'America/Los_Angeles')).toBe('2026-11-09')
    expect(walkingPlanStartDate({ createdAt: created }, 'Australia/Brisbane')).toBe('2026-11-10')
  })
  it('so the first judged week differs: that Monday in Los Angeles, the next in Brisbane', () => {
    expect(firstJudgedWeek(walkingPlanStartDate({ createdAt: created }, 'America/Los_Angeles'))).toBe('2026-11-09')
    expect(firstJudgedWeek(walkingPlanStartDate({ createdAt: created }, 'Australia/Brisbane'))).toBe('2026-11-16')
  })
})
