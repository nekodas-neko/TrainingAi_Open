import { describe, it, expect } from 'vitest'
import { buildChatTools } from '@/lib/ai-chat/tools'
import type { WorkoutRepository, SetHrStatsRow } from '@/lib/data/repository'

function setRow(over: Partial<SetHrStatsRow>): SetHrStatsRow {
  return {
    setLogId: 'x', workoutSessionId: 'w', exerciseLogId: 'e', exerciseId: null, exerciseName: 'Squat',
    phaseType: null, setNumber: 1, intensityPct: 90, plannedPct: 90, restTakenSec: 90, plannedRestSec: 90,
    loggedAt: new Date('2026-05-10T00:00:00Z'),
    peakBpm: 130, avgBpm: 120, bpmAtEnd: 128, drop30s: 10, drop60s: 25, drop90s: 32, drop120s: 40,
    troughBpm: 118, secToPreset: 55, recoveredPreset: true, secToResting: null, recoveredResting: null,
    pctHrrAtRestEnd: 60, secToHrr50: 25, restAdequate: true, readingsCount: 40, coverageOk: true,
    computedAt: new Date(), ...over,
  }
}

const repo = {
  getSetHrStatsSince: async () => [setRow({}), setRow({ loggedAt: new Date('2026-06-10T00:00:00Z'), drop120s: 50 })],
  getOuraWorkouts: async () => [],
  getHrForWindow: async () => [],
  getUserById: async () => null,
  listBodyMetrics: async () => [],
} as unknown as WorkoutRepository

describe('getHrRecoveryProfile chat tool', () => {
  it('returns bands and a per-band month-over-month trend', async () => {
    const tools = buildChatTools(repo, 'u1', 'Australia/Brisbane', '2026-07-20')
    const out = await tools.getHrRecoveryProfile.execute!({ days: null }, { toolCallId: 't', messages: [] })
    const band = out.bands.find((b: { label: string }) => b.label === '120–149')
    expect(band).toBeDefined()
    expect(band.n).toBe(2)
    const trendBand = out.trend.find((t: { label: string }) => t.label === '120–149')
    expect(trendBand.points.length).toBe(2)
    expect(trendBand.points[0].period).toBe('2026-05')
    expect(trendBand.points[1].period).toBe('2026-06')
  })
})
