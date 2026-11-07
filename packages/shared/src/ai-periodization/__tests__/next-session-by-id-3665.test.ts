import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { computeAiDynamicNextSession, type AiDynamicInput } from '../ai-dynamic'
import { loggedAsSession, programSessionFor } from '../../workout/session-identity'
import type { ProgramSession } from '../../types/program'

// Issue 3665: the next-session pick matched history by name, so renaming Lower to Legs the day
// after training it made Legs look never done and recommended it again.

const session = (id: string, name: string, position: number): ProgramSession => ({
  id, programId: 'prog', name, position, timeBudgetMinutes: 60,
  exercises: [{
    id: `ex-${id}`, sessionId: id, exerciseName: `${id} lift`,
    muscleGroups: [id], position: 0, exerciseRole: 'primary',
  }],
})
// Anchored to local midday in Brisbane, so "today" never straddles midnight.
const NOW = Date.parse('2026-11-04T12:00:00+10:00')
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000)

const base: Omit<AiDynamicInput, 'sessions' | 'history'> = {
  muscleAssignments: {}, muscleRecovery: [], soreMuscles: [], readinessScore: 80,
  temperatureDeviation: null, timezone: 'Australia/Brisbane', reminderEnabled: false,
  reminderTime: null, sleepTrend: null, energyLevel: null, hrvTrend: null, illnessFlag: null,
  stressHighMinutes: null,
}

// What `workout_sessions` holds: the name at the time, and the program session's id.
const history: AiDynamicInput['history'] = [
  { sessionName: 'Lower', programSessionId: 'lower', startedAt: hoursAgo(26), hasExercises: true },
  { sessionName: 'Pull', programSessionId: 'pull', startedAt: hoursAgo(50), hasExercises: true },
  { sessionName: 'Upper', programSessionId: 'upper', startedAt: hoursAgo(74), hasExercises: true },
]

describe('next session matches history by session id (issue 3665)', () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
  afterAll(() => { vi.useRealTimers() })

  it('a session renamed after it was trained is not recommended again', () => {
    const before = [session('upper', 'Upper', 0), session('lower', 'Lower', 1), session('pull', 'Pull', 2)]
    expect(computeAiDynamicNextSession({ ...base, sessions: before, history }).session?.id).toBe('upper')
    const renamed = [session('upper', 'Upper', 0), session('lower', 'Legs', 1), session('pull', 'Pull', 2)]
    const after = computeAiDynamicNextSession({ ...base, sessions: renamed, history })
    expect(after.session?.id).toBe('upper')
    expect(after.scoredSessions?.find(x => x.session.id === 'lower')?.freshnessScore).toBeLessThan(100)
  })

  it('a session renamed on the day it was trained keeps "Already trained"', () => {
    const today = [{ sessionName: 'Lower', programSessionId: 'lower', startedAt: hoursAgo(0.1), hasExercises: true }]
    const renamed = [session('upper', 'Upper', 0), session('lower', 'Legs', 1)]
    const r = computeAiDynamicNextSession({ ...base, sessions: renamed, history: today })
    expect(r.session?.id).toBe('lower')
    expect(r.reason).toBe('Already trained: Legs')
  })

  it('two sessions with one name do not share a history', () => {
    const twins = [session('a', 'Full Body', 0), session('b', 'Full Body', 1)]
    const done = [{ sessionName: 'Full Body', programSessionId: 'a', startedAt: hoursAgo(26), hasExercises: true }]
    expect(computeAiDynamicNextSession({ ...base, sessions: twins, history: done }).session?.id).toBe('b')
  })

  it('a row with no id, or from another program, still matches by name', () => {
    const ids = new Set(['upper', 'lower'])
    const upper = { id: 'upper', name: 'Upper' }
    expect(loggedAsSession({ sessionName: 'upper', programSessionId: null }, upper, ids)).toBe(true)
    expect(loggedAsSession({ sessionName: 'Upper', programSessionId: 'old-program-upper' }, upper, ids)).toBe(true)
    // An id in this program is the whole answer, whatever the stored name says.
    expect(loggedAsSession({ sessionName: 'Upper', programSessionId: 'lower' }, upper, ids)).toBe(false)
    expect(programSessionFor({ sessionName: 'Lower', programSessionId: 'lower' }, [upper, { id: 'lower', name: 'Legs' }])?.id).toBe('lower')
    expect(programSessionFor({ sessionName: 'Arms', programSessionId: null }, [upper])).toBeUndefined()
  })
})
