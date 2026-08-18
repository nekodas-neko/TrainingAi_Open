import { describe, it, expect } from 'vitest'
import { resolveFailedOutboxIds, MAX_MUTATION_ATTEMPTS, nextRetryDelayMs, serverBackoffMs, buildWorkoutLogPayload, omitNullFields } from '../sync-helpers'
import { ActivityLogBody } from '@trainingai/shared/validation/activity-log'

const chunk = [
  { id: 'ob-1', domain: 'food_logs', date: '2026-07-01' },
  { id: 'ob-2', domain: 'food_logs', date: '2026-07-01' },
  { id: 'ob-3', domain: 'food_logs', date: '2026-07-01' },
  { id: 'ob-4', domain: 'body_metrics', date: '2026-07-01' },
]

describe('resolveFailedOutboxIds', () => {
  it('fails only the exact row when the server echoes an id', () => {
    const failed = resolveFailedOutboxIds(chunk, [
      { id: 'ob-2', domain: 'food_logs', date: '2026-07-01', error: 'FK ownership check failed' },
    ])
    expect([...failed.keys()]).toEqual(['ob-2'])
    expect(failed.get('ob-2')).toEqual({ error: 'FK ownership check failed', retryable: false })
  })

  // Q-475: `retryable` marks a server that could not write, not a mutation that must not be.
  it('carries the server\'s retryable flag through, per row', () => {
    const failed = resolveFailedOutboxIds(chunk, [
      { id: 'ob-1', domain: 'food_logs', date: '2026-07-01', error: 'Error: Failed query: insert …', retryable: true },
      { id: 'ob-2', domain: 'food_logs', date: '2026-07-01', error: 'FK ownership check failed' },
    ])
    expect(failed.get('ob-1')?.retryable).toBe(true)
    expect(failed.get('ob-2')?.retryable).toBe(false)
  })

  it('defaults retryable to false, so a server that does not send it keeps the old bounded-retry behaviour', () => {
    const failed = resolveFailedOutboxIds(chunk, [
      { id: 'ob-2', domain: 'food_logs', date: '2026-07-01', error: 'boom' },
    ])
    expect(failed.get('ob-2')?.retryable).toBe(false)
  })

  it('carries retryable through the legacy domain:date fallback too', () => {
    const failed = resolveFailedOutboxIds(chunk, [
      { domain: 'food_logs', date: '2026-07-01', error: 'db down', retryable: true },
    ])
    expect([...failed.values()].every(f => f.retryable)).toBe(true)
  })

  it('falls back to domain:date for old servers that omit the id', () => {
    const failed = resolveFailedOutboxIds(chunk, [
      { domain: 'food_logs', date: '2026-07-01', error: 'boom' },
    ])
    // Degraded legacy behaviour: all three same-key food logs retained, the
    // unrelated body_metrics row still confirms.
    expect([...failed.keys()].sort()).toEqual(['ob-1', 'ob-2', 'ob-3'])
    expect(failed.has('ob-4')).toBe(false)
  })

  it('returns an empty map when there are no errors', () => {
    expect(resolveFailedOutboxIds(chunk, []).size).toBe(0)
  })
})

describe('nextRetryDelayMs', () => {
  it('backs off exponentially: 30s, 2m, 8m, 32m', () => {
    expect(nextRetryDelayMs(1)).toBe(30_000)
    expect(nextRetryDelayMs(2)).toBe(120_000)
    expect(nextRetryDelayMs(3)).toBe(480_000)
    expect(nextRetryDelayMs(4)).toBe(1_920_000)
  })
  it('caps at one hour', () => {
    expect(nextRetryDelayMs(10)).toBe(3_600_000)
  })
  it('dead-letters at five attempts', () => {
    expect(MAX_MUTATION_ATTEMPTS).toBe(5)
  })
})

describe('serverBackoffMs', () => {
  it('backs off 30s, 1m, 2m … on consecutive 5xx responses', () => {
    expect(serverBackoffMs(1)).toBe(30_000)
    expect(serverBackoffMs(2)).toBe(60_000)
    expect(serverBackoffMs(3)).toBe(120_000)
  })
  it('caps at ten minutes', () => {
    expect(serverBackoffMs(8)).toBe(600_000)
  })
})

describe('buildWorkoutLogPayload', () => {
  const session = {
    id: 'ws-9', sessionName: 'Session B', startedAt: '2026-06-30T08:30:00.000Z',
    completedAt: null, updatedAt: '2026-06-30T09:10:00.000Z', deletedAt: null,
    syncStatus: 'pending' as const,
  }
  const exerciseLog = {
    id: 'el-9', workoutSessionId: 'ws-9', exerciseName: 'Squat',
    styleId: 'st-1', styleName: 'Heavy 5s', estimated1rm: 140, target80: 112,
    volume: null, avgReps: null, timeToComplete: 300, muscleGroups: ['quads'],
    loggedAt: '2026-06-30T08:45:00.000Z', interExerciseRestSec: 90,
    updatedAt: '2026-06-30T08:45:00.000Z', deletedAt: null, syncStatus: 'pending' as const,
    sets: [
      { id: 's-2', exerciseLogId: 'el-9', setNumber: 2, weightKg: 120, reps: 5,
        setTimeSec: 40, restTimeSec: 120, intensityPct: null, useFor1rm: true,
        setStartMs: null, setEndMs: null, rpe: 8, updatedAt: '2026-06-30T08:45:00.000Z',
        deletedAt: null, syncStatus: 'pending' as const },
      { id: 's-1', exerciseLogId: 'el-9', setNumber: 1, weightKg: 100, reps: 5,
        setTimeSec: 35, restTimeSec: 90, intensityPct: null, useFor1rm: false,
        setStartMs: null, setEndMs: null, rpe: null, updatedAt: '2026-06-30T08:45:00.000Z',
        deletedAt: null, syncStatus: 'pending' as const },
    ],
  }

  it('rebuilds a schema-valid payload keyed on the original client ids, in set order', () => {
    const { date, payload } = buildWorkoutLogPayload(session, exerciseLog)
    expect(date).toBe('2026-06-30') // the log's own device-local date, not today
    expect(payload.workoutSessionId).toBe('ws-9')
    expect(payload.exerciseLogId).toBe('el-9')
    expect(payload.setLogIds).toEqual(['s-1', 's-2'])
    expect(payload.weights).toEqual([100, 120])
    expect(payload.reps).toEqual([5, 5])
    expect(payload.sets).toBe(2)
    expect(payload.styleId).toBe('st-1')
    // one set has no rpe → omit rpeValues entirely (schema requires ints 5-10)
    expect(payload.rpeValues).toBeUndefined()
  })

  it('includes setStartTimes/setEndTimes when every set has them', () => {
    const withTimes = {
      ...exerciseLog,
      sets: exerciseLog.sets.map(s => ({ ...s, setStartMs: 1000 + s.setNumber, setEndMs: 2000 + s.setNumber })),
    }
    const { payload } = buildWorkoutLogPayload(session, withTimes)
    expect(payload.setStartTimes).toEqual([1001, 1002]) // set order: setNumber 1, 2
    expect(payload.setEndTimes).toEqual([2001, 2002])
  })

  it('omits setTimes/restTimes entirely when only some sets have a value, instead of zero-filling', () => {
    const partial = {
      ...exerciseLog,
      sets: [
        { ...exerciseLog.sets[0], setTimeSec: null, restTimeSec: null },
        exerciseLog.sets[1],
      ],
    }
    const { payload } = buildWorkoutLogPayload(session, partial)
    expect(payload.setTimes).toBeUndefined()
    expect(payload.restTimes).toBeUndefined()
  })

  it('threads sessionId/intensityMode/wasOverride/exerciseDeloaded when present (SYN-6)', () => {
    const deloadSession = { ...session, sessionId: 'ps-1', intensityMode: 'deload', wasOverride: true }
    const deloadedExercise = { ...exerciseLog, exerciseDeloaded: true }
    const { payload } = buildWorkoutLogPayload(deloadSession, deloadedExercise)
    expect(payload.sessionId).toBe('ps-1')
    expect(payload.intensityMode).toBe('deload')
    expect(payload.wasOverride).toBe(true)
    expect(payload.exerciseDeloaded).toBe(true)
  })

  it('omits sessionId/intensityMode/wasOverride/exerciseDeloaded when absent, instead of sending false/null', () => {
    const { payload } = buildWorkoutLogPayload(session, exerciseLog)
    expect(payload.sessionId).toBeUndefined()
    expect(payload.intensityMode).toBeUndefined()
    expect(payload.wasOverride).toBeUndefined()
    expect(payload.exerciseDeloaded).toBeUndefined()
  })

  it('D-3: reconstructs progressionStyle from the local planned snapshot so a replay keeps planned_pct/rest + use_for_1rm', () => {
    const withPlanned = {
      ...exerciseLog,
      sets: [
        { ...exerciseLog.sets[0], plannedPct: 82.5, plannedRestSec: 120, useFor1rm: true },
        { ...exerciseLog.sets[1], plannedPct: 75, plannedRestSec: 90, useFor1rm: false },
      ],
    }
    const { payload } = buildWorkoutLogPayload(session, withPlanned)
    expect(payload.progressionStyle).toEqual([
      { pct: 75, reps: 5, restSec: 90, useFor1rm: false },   // setNumber 1 first
      { pct: 82.5, reps: 5, restSec: 120, useFor1rm: true },
    ])
  })

  it('D-3: omits progressionStyle when a set lacks the planned snapshot (older rows)', () => {
    const { payload } = buildWorkoutLogPayload(session, exerciseLog) // no plannedPct on sets
    expect(payload.progressionStyle).toBeUndefined()
  })

  // Q-14: the server now derives planned_reps from progressionStyle[i].reps, so a replay that
  // re-sent the ACTUAL reps here would record them as the prescription.
  it('Q-14: replays the prescribed rep target, not the reps that were actually performed', () => {
    const withPlanned = {
      ...exerciseLog,
      sets: [
        { ...exerciseLog.sets[0], plannedPct: 82.5, plannedReps: 8, plannedRestSec: 120, useFor1rm: true },
        { ...exerciseLog.sets[1], plannedPct: 75, plannedReps: 6, plannedRestSec: 90, useFor1rm: false },
      ],
    }
    const { payload } = buildWorkoutLogPayload(session, withPlanned)
    expect(payload.progressionStyle).toEqual([
      { pct: 75, reps: 6, restSec: 90, useFor1rm: false },
      { pct: 82.5, reps: 8, restSec: 120, useFor1rm: true },
    ])
  })

  it('Q-14: falls back to the actual reps for rows written before planned_reps existed', () => {
    const withPlanned = {
      ...exerciseLog,
      sets: [
        { ...exerciseLog.sets[0], plannedPct: 82.5, plannedRestSec: 120, useFor1rm: true },
        { ...exerciseLog.sets[1], plannedPct: 75, plannedRestSec: 90, useFor1rm: false },
      ],
    }
    const { payload } = buildWorkoutLogPayload(session, withPlanned)
    // Unchanged from the pre-Q-14 behaviour — an old local row replays exactly as it did before.
    expect(payload.progressionStyle).toEqual([
      { pct: 75, reps: 5, restSec: 90, useFor1rm: false },
      { pct: 82.5, reps: 5, restSec: 120, useFor1rm: true },
    ])
  })
})

describe('omitNullFields', () => {
  it('drops only null-valued keys, keeping undefined/falsy/zero values intact', () => {
    const out = omitNullFields({ a: 1, b: null, c: 0, d: '', e: false, f: undefined, g: 'x' })
    expect(out).toEqual({ a: 1, c: 0, d: '', e: false, f: undefined, g: 'x' })
    expect('b' in out).toBe(false)
  })

  // Regression for the 2026-07-23 on-device bug: guided-walk/activity saves reuse the
  // local SQLite record's nullable shape directly as the queueMutation payload, but the
  // server's Zod schema declares those same fields .optional() (rejects null outright,
  // invalidating the whole payload — CLAUDE.md's documented "broke every food save"
  // class). omitNullFields is the fix; prove it against the REAL server schema.
  it('makes a guided-walk-shaped payload (all-null optionals) pass ActivityLogBody', () => {
    const rawPayload = {
      id: 'al-1', activityType: 'walk', title: 'Interval walk',
      durationMin: 20, distanceKm: null, steps: null,
      avgHr: null, maxHr: null,
      startTime: '07:00', endTime: '07:20', notes: null,
      routePolyline: null, splits: null, bestEfforts: null, paceSeries: null,
      avgPaceSecPerKm: null, elevationGainM: null, elevationLossM: null,
      date: '2026-07-23',
    }
    expect(ActivityLogBody.safeParse(rawPayload).success).toBe(false) // reproduces the bug
    expect(ActivityLogBody.safeParse(omitNullFields(rawPayload)).success).toBe(true) // the fix
  })

  it('makes a GPS-activity-shaped payload (some real values, some null) pass ActivityLogBody', () => {
    const rawPayload = {
      id: 'al-2', activityType: 'run', title: 'Morning run', date: '2026-07-23',
      durationMin: 30, distanceKm: 5.2, steps: 6000, avgHr: 150, maxHr: 172,
      startTime: '06:00', endTime: '06:30', notes: 'felt good',
      routePolyline: 'enc123', splits: null, bestEfforts: null, paceSeries: null,
      avgPaceSecPerKm: 346, elevationGainM: null, elevationLossM: null,
    }
    expect(ActivityLogBody.safeParse(rawPayload).success).toBe(false) // reproduces the bug
    const parsed = ActivityLogBody.safeParse(omitNullFields(rawPayload))
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.distanceKm).toBe(5.2) // real values survive
  })
})
