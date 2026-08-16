import { describe, it, expect } from 'vitest'
import { buildChatTools } from '@/lib/ai-chat/tools'
import type { WorkoutRepository } from '@/lib/data/repository'

// Stub only what getRecoveryData touches — the tool must surface spo2Pct, which
// body_metrics has carried all along while the chat payload silently dropped it.
const repo = {
  getOuraDaily: async () => [],
  listSleepSessions: async () => [],
  listBodyMetrics: async () => [
    { date: '2026-07-15', hrvMs: 52, restingHeartRate: 48, steps: 9000, weightKg: 82.5, spo2Pct: 96.4 },
  ],
  getOuraDailyDerived: async () => [],
} as unknown as WorkoutRepository

describe('getRecoveryData chat tool', () => {
  it('includes SpO2 in the body-metrics payload', async () => {
    const tools = buildChatTools(repo, 'u1', 'Australia/Brisbane', '2026-07-16')
    const out = await tools.getRecoveryData.execute!(
      { fromDate: '2026-07-10', toDate: '2026-07-16' },
      { toolCallId: 't1', messages: [] },
    )
    expect(out.bodyMetrics[0]).toMatchObject({ hrvMs: 52, spo2Pct: 96.4 })
  })
})
