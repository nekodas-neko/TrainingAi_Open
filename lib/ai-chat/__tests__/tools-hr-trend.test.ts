import { describe, it, expect } from 'vitest'
import { buildChatTools } from '@/lib/ai-chat/tools'
import type { WorkoutRepository, SetHrStatsRow } from '@/lib/data/repository'

function row(over: Partial<SetHrStatsRow>): SetHrStatsRow {
  return {
    setLogId: 'x', workoutSessionId: 'w1', exerciseLogId: 'e', exerciseId: 'exid-bench', exerciseName: 'Barbell Bench Press',
    phaseType: 'peak', setNumber: 1, intensityPct: 90, plannedPct: 90, restTakenSec: 90, plannedRestSec: 90,
    loggedAt: new Date('2026-07-15T02:00:00Z'),
    peakBpm: 170, avgBpm: 150, bpmAtEnd: 165, drop30s: 20, drop60s: 30, drop90s: 40, drop120s: 45,
    troughBpm: 120, secToPreset: 55, recoveredPreset: true, secToResting: null, recoveredResting: false,
    pctHrrAtRestEnd: 60, secToHrr50: 25, restAdequate: true, readingsCount: 40, coverageOk: true,
    computedAt: new Date(), ...over,
  }
}

const rows: SetHrStatsRow[] = [
  row({ workoutSessionId: 'w1', exerciseId: 'exid-bench', exerciseName: 'Barbell Bench Press', drop60s: 30, intensityPct: 90 }),
  row({ workoutSessionId: 'w2', exerciseId: 'exid-bench', exerciseName: 'Barbell Bench Press', drop60s: 34, intensityPct: 72, loggedAt: new Date('2026-07-17T02:00:00Z') }),
  row({ workoutSessionId: 'w1', exerciseId: 'exid-squat', exerciseName: 'Back Squat', drop60s: 18, loggedAt: new Date('2026-07-15T03:00:00Z') }),
]

const repo = { getSetHrStatsSince: async () => rows } as unknown as WorkoutRepository

describe('getWorkoutHrTrends chat tool', () => {
  it('overview: one row per exercise, newest-trained first', async () => {
    const tools = buildChatTools(repo, 'u1', 'Australia/Brisbane', '2026-07-20')
    const out = await tools.getWorkoutHrTrends.execute!({ exerciseName: null, days: null }, { toolCallId: 't', messages: [] })
    expect(out.byExercise).toHaveLength(2)
    expect(out.byExercise[0].exerciseName).toBe('Barbell Bench Press') // last trained 07-17
    const squat = out.byExercise.find((e: { exerciseName: string }) => e.exerciseName === 'Back Squat')!
    expect(squat.avgDrop60).toBe(18) // slower recovery than bench
  })

  it('detailed: fuzzy name match → per-session + intensity breakdown', async () => {
    const tools = buildChatTools(repo, 'u1', 'Australia/Brisbane', '2026-07-20')
    const out = await tools.getWorkoutHrTrends.execute!({ exerciseName: 'bench', days: null }, { toolCallId: 't', messages: [] })
    expect(out.exercise).toBe('bench')
    expect(out.sessions).toHaveLength(2)
    expect(out.byIntensity.some((b: { label: string }) => b.label === '90+')).toBe(true)
    expect(out.byIntensity.some((b: { label: string }) => b.label === '70–79')).toBe(true)
  })
})
