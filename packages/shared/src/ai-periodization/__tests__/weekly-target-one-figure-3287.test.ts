/**
 * #3287 (owner, 26 Oct, option 1): the prescription engine budgets sets against the same
 * phase-scaled weekly target the Training card prints. The stored `targetSetsPerWeek` only says
 * which muscles the program trains. The card and the engine both go through `weeklyVolumeTarget`
 * and `trainedWeekPhases`; the engine adds the session being prescribed to the week's phase mix.
 */
import { describe, it, expect } from 'vitest'
import { weeklyVolumeTarget, trainedWeekPhases } from '../volume-targets'
import { aggregateSignals, type AggregateSignalsOptions } from '../signals'

const TZ = 'Australia/Brisbane'
const USER = 'u-3287'
const SESSION = 'ps-chest'

function repoFor(phase: string, trained: { sessionId: string; phase: string }[]) {
  const target = {
    getActiveProgram: async () => ({
      id: 'p-1', trainingGoal: 'strength', autoApplyPrescriptions: false, startedAt: new Date(Date.now() - 90 * 86_400_000),
      sessions: [{ id: SESSION, name: 'Chest', exercises: [{ id: 'ex-1', exerciseName: 'Bench', muscleGroups: ['chest'] }], timeBudgetMinutes: 60 }],
    }),
    getSessionPeriodization: async () => ({ phase, sessionsInPhase: 2, baseline1rm: {} }),
    reconcileSessionsInPhase: async () => undefined,
    getOuraCloudSwitchDay: async () => null,
    listPersonalRecords: async () => new Map(),
    listPrevious1rm: async () => new Map(),
    // Stored target is the flat seeded value, which must no longer reach the engine.
    listVolumeTargets: async () => [{ muscleGroup: 'chest', targetSetsPerWeek: 14 }],
    getWeeklySetsByMuscleGroup: async () => ({ chest: 0 }),
    listSessionPeriodizationForProgram: async () => [
      { programSessionId: SESSION, phase },
      ...trained.map(t => ({ programSessionId: t.sessionId, phase: t.phase })),
    ],
    getWorkoutSessionsFrom: async () => trained.map(t => ({
      id: `ws-${t.sessionId}`, sessionId: t.sessionId, startedAt: new Date(), exercises: [],
    })),
  }
  return new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop as keyof typeof t]
      if (/^get(Exercise|Weekly)/.test(prop)) return async () => ({})
      if (prop === 'getTimingAuditData') return async () => ({ sets: [], exercises: [], sessions: [] })
      if (/^get(MoodLog|DayCheckin)$/.test(prop)) return async () => null
      return async () => []
    },
  }) as never
}

const targetFor = async (phase: string, trained: { sessionId: string; phase: string }[] = [], options?: AggregateSignalsOptions) =>
  (await aggregateSignals(USER, SESSION, repoFor(phase, trained), TZ, undefined, undefined, options))!.weeklyTargets.chest

describe('the engine reads the Training card\'s weekly target (#3287)', () => {
  it('an accumulation week is unchanged: the landmark MAV, not the stored 14', async () => {
    expect(await targetFor('accumulation')).toBe(weeklyVolumeTarget('strength', 'chest', ['accumulation']))
  })

  it.each([['intensification', 0.8], ['realisation', 0.6], ['deload', 0.5]])('a %s session scales the target by %s', async (phase, mult) => {
    const mav = weeklyVolumeTarget('strength', 'chest', ['accumulation'])
    expect(await targetFor(phase)).toBe(Math.max(1, Math.round(mav * mult)))
    expect(await targetFor(phase)).toBeLessThan(mav)
  })

  it('the week mixes the phases already trained with the session being prescribed', async () => {
    const mix = ['accumulation', 'realisation']
    expect(await targetFor('realisation', [{ sessionId: 'ps-other', phase: 'accumulation' }])).toBe(weeklyVolumeTarget('strength', 'chest', mix))
  })

  it('a review of a trained session leaves its own phase out, so it shows the card\'s figure', async () => {
    // Accumulation, accumulation, then the realisation session being reviewed (already trained, so it is
    // in the trained list as well as being the session's own phase).
    const trained = [
      { sessionId: 'ps-a', phase: 'accumulation' },
      { sessionId: 'ps-b', phase: 'accumulation' },
      { sessionId: SESSION, phase: 'realisation' },
    ]
    const card = weeklyVolumeTarget('strength', 'chest', ['accumulation', 'accumulation', 'realisation'])
    expect(await targetFor('realisation', trained, { includeSessionInWeekMix: false })).toBe(card)
    // The default still adds the session again: the double count the option exists to avoid.
    const doubled = weeklyVolumeTarget('strength', 'chest', ['accumulation', 'accumulation', 'realisation', 'realisation'])
    expect(await targetFor('realisation', trained)).toBe(doubled)
    expect(doubled).toBeLessThan(card)
  })

  it('the card and the engine build the mix with the same helper', () => {
    expect(trainedWeekPhases(['a', null, 'b', 'gone'], new Map([['a', 'deload'], ['b', 'accumulation']]))).toEqual(['deload', 'accumulation'])
  })
})
