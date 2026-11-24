// #4119 / #4116 review: the rep-completion read of the next plan (`signals.ts`) runs only while
// `sessionsInPhase > 0`. After a phase move the last workout was trained on the old phase's plan and is not
// counted in the new phase (the one counting rule), so the count is 0 and the first plan of the new phase
// has no missed-reps read: no emergency-deload trigger from it and no per-exercise back-off from it. That is
// pinned here as it is; it is not changed. Once one workout is counted in the phase, the read is back.
import { describe, it, expect } from 'vitest'

const { aggregateSignals } = await import('../signals')

const SESSION = 'ps-4119'
const lastSession = { id: 'ws-last', startedAt: new Date(Date.now() - 2 * 86_400_000), completedAt: new Date(Date.now() - 2 * 86_400_000 + 3_600_000), sessionName: 'Legs' }

function repoWith(sessionsInPhase: number) {
  const target: Record<string, unknown> = {
    getActiveProgramWithStructureStamp: async (u: string, id: string) => ({
      program: await (target.getActiveProgram as (u: string) => unknown)(u),
      structure: await (target.getSessionStructureStamp as ((u: string, id: string) => unknown) | undefined)?.(u, id),
    }),
    getActiveProgram: async () => ({
      id: 'p-1', trainingGoal: 'strength', autoApplyPrescriptions: false, createdAt: new Date(Date.now() - 90 * 86_400_000),
      sessions: [{ id: SESSION, name: 'Legs', exercises: [{ id: 'ex-1', exerciseName: 'Squat', muscleGroups: ['quads'] }], timeBudgetMinutes: 60 }],
    }),
    getSessionPeriodization: async () => ({
      phase: 'intensification', sessionsInPhase, baseline1rm: {}, lastSessionRanPrescription: true,
      prescription: null, prescriptionStatus: 'consumed',
    }),
    getRecentSessionsOfType: async () => [lastSession],
    // the last workout missed reps: 3 of 5 on every set
    getSetLogsForSessions: async () => [1, 2, 3].map(setNumber => ({
      workoutSessionId: 'ws-last', exerciseName: 'Squat', setNumber, rpe: null, reps: 3, intensityPct: 80, setTimeSec: null, plannedReps: 5,
    })),
    getTimingAuditData: async () => ({ sets: [], exercises: [], sessions: [] }),
  }
  return new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop]
      if (/^get(Exercise|Weekly)/.test(prop)) return async () => ({})
      if (/^get(MoodLog|DayCheckin|OuraCloudSwitchDay)$/.test(prop)) return async () => null
      if (/^list(PersonalRecords|Recent1rm)$/.test(prop)) return async () => new Map()
      return async () => []
    },
  }) as never
}

describe('the missed-reps read of the first plan after a phase move (#4119)', () => {
  it('the previous workout is not counted in the new phase (count 0): no missed-reps read, as the code stands', async () => {
    const signals = await aggregateSignals('u-4119', SESSION, repoWith(0), 'Australia/Brisbane')
    expect(signals!.repCompletionRate).toBeNull()
  })

  it('one workout counted in the phase: the read is back and sees the shortfall (3 of 5 = 0.6)', async () => {
    const signals = await aggregateSignals('u-4119', SESSION, repoWith(1), 'Australia/Brisbane')
    expect(signals!.repCompletionRate).toBeCloseTo(0.6, 6)
  })
})
