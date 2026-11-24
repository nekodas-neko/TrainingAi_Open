// #4114 item 4: on a manual program the Coach's "About" line describes the next session as the
// screen shows it, whatever early-deload week is stored; automatic and AI-planned programs still
// call a confirmed early-deload week a deload.
import { describe, it, expect, vi } from 'vitest'
import { todayInTz } from '@trainingai/shared/date-utils'
import { liftLine } from '@/lib/coach/about'

const TZ = 'Australia/Brisbane'
const today = todayInTz(TZ)
const style = { id: 'style-main', name: 'Main', sets: [{ pct: 80, reps: 8, restSec: 120, useFor1rm: true }, { pct: 80, reps: 8, restSec: 120, useFor1rm: true }] }
const session = {
  id: 'sess-1', programId: 'prog-1', name: 'Push', position: 0, timeBudgetMinutes: 60,
  exercises: [{ id: 'ex-p', sessionId: 'sess-1', exerciseName: 'Bench Press', styleId: 'style-main', position: 0, exerciseRole: 'primary', muscleGroups: [] }],
}
const target = {
  id: 'ex-p', sessionId: 'sess-1', exerciseName: 'Bench Press', exerciseId: null, styleId: 'style-main', position: 0, muscleGroups: [],
  exerciseRole: 'primary', sessionName: 'Push', programId: 'prog-1', accessoryPhaseStyled: false,
}

function repoFor(phaseMode: string, earlyDeloadWeekStart?: string) {
  const program = { id: 'prog-1', userId: 'user-1', phaseMode, trainingGoal: 'strength', sessions: [session], ...(earlyDeloadWeekStart ? { earlyDeloadWeekStart } : {}) }
  return {
    getActiveProgram: vi.fn(async () => program),
    listProgressionStyles: vi.fn(async () => [style]),
    listExerciseLibrary: vi.fn(async () => [{ id: 'lib-1', name: 'Bench Press', exerciseType: 'weighted', equipment: ['barbell'], muscles: [] }]),
    getProgramPhaseState: vi.fn(async () => ({ phases: [], sessionCounts: new Map() })),
    getLastExerciseLogsBatch: vi.fn(async () => new Map()),
    getLastRealOneRmBatch: vi.fn(async (_u: string, names: string[]) => new Map(names.map(n => [n, { estimated1rm: 100, target80: 80 }]))),
    getExerciseEstimates: vi.fn(async () => []),
    listPersonalRecords: vi.fn(async () => new Map()),
    listExercisePreferences: vi.fn(async () => new Map()),
  }
}
const line = (phaseMode: string, week?: string) =>
  liftLine({} as never, repoFor(phaseMode, week) as never, 'user-1', { ...target, phaseMode } as never, TZ, today)

describe('the Coach About line and a stored early-deload week (#4114)', () => {
  it('a manual program with a leftover week reads exactly as one without', async () => {
    const plain = await line('manual')
    const leftover = await line('manual', today)
    expect(plain).toMatch(/next 2 × 8/)
    expect(leftover).toBe(plain)
    expect(leftover).not.toMatch(/deload or a test/)
  })

  it('an automatic program in a confirmed early-deload week is still excluded, as before', async () => {
    // No phase rows here, so only the week itself can make it a deload: the behaviour kept for non-manual programs.
    expect(await line('automatic', today)).toBe('Bench Press · next session is a deload or a test')
  })
})
