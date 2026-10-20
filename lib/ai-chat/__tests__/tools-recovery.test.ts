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
  // #3095: a treadmill session the ring could not see — its steps join the day's, as on every screen.
  listActivityLogs: async () => [{ date: '2026-07-15', activityType: 'treadmill', steps: 2000, startTime: '12:00:00' }],
} as unknown as WorkoutRepository

// `execute` is typed as returning a value or a stream; these tools return a plain value.
const plain = async <T>(out: T | AsyncIterable<T> | PromiseLike<T | AsyncIterable<T>>) => (await out) as T

describe('getRecoveryData chat tool', () => {
  it('includes SpO2 in the body-metrics payload', async () => {
    const tools = buildChatTools(repo, 'u1', 'Australia/Brisbane', '2026-07-16')
    const out = await plain(tools.getRecoveryData.execute!(
      { fromDate: '2026-07-10', toDate: '2026-07-16' },
      { toolCallId: 't1', messages: [] },
    ))
    expect(out.bodyMetrics[0]).toMatchObject({ hrvMs: 52, spo2Pct: 96.4 })
  })

  it('sends the day\'s steps the app shows, treadmill included (#3095)', async () => {
    const tools = buildChatTools(repo, 'u1', 'Australia/Brisbane', '2026-07-16')
    const out = await plain(tools.getRecoveryData.execute!(
      { fromDate: '2026-07-10', toDate: '2026-07-16' },
      { toolCallId: 't1', messages: [] },
    ))
    expect(out.bodyMetrics[0].steps).toBe(11_000)
  })
})

// #3000 (scoring doc rule 5): Oura's own readiness, sleep and activity scores are never sent to the
// chat as ours. Oura's scores exist and ours don't → the fields are null, never Oura's.
describe("recovery chat tools never send Oura's scores as ours (#3000)", () => {
  const ouraRow = { date: '2026-10-17', readinessScore: 91, sleepScore: 87, activityScore: 83, temperatureDeviation: 0.2 }
  const withDerived = (derived: unknown[]) => ({
    getOuraDaily: async () => [ouraRow],
    listSleepSessions: async () => [],
    listBodyMetrics: async () => [],
    getOuraDailyDerived: async () => derived,
    getWorkoutSessionsFrom: async () => [],
    listActivityLogs: async () => [],
  }) as unknown as WorkoutRepository
  const ctx = { toolCallId: 't1', messages: [] }

  it('getRecoveryData: Oura scores only → null scores, Oura temperature kept', async () => {
    const tools = buildChatTools(withDerived([]), 'u1', 'Australia/Brisbane', '2026-10-18')
    const out = await plain(tools.getRecoveryData.execute!({ fromDate: '2026-10-11', toDate: '2026-10-18' }, ctx))
    expect(out.daily).toEqual([{ date: '2026-10-17', readiness: null, sleepScore: null, activityScore: null, tempDeviationC: 0.2 }])
    expect(JSON.stringify(out)).not.toMatch(/\b(91|87|83)\b/)
  })

  it('getRecoveryData: our scores are the ones sent', async () => {
    const tools = buildChatTools(withDerived([
      { day: '2026-10-17', readinessScore: 55, readinessSource: 'ble-derived', sleepScore: 64, activityScore: 40 },
    ]), 'u1', 'Australia/Brisbane', '2026-10-18')
    const out = await plain(tools.getRecoveryData.execute!({ fromDate: '2026-10-11', toDate: '2026-10-18' }, ctx))
    expect(out.daily).toEqual([{ date: '2026-10-17', readiness: 55, sleepScore: 64, activityScore: 40, tempDeviationC: 0.2 }])
  })

  it('getRecoveryVsPerformance counts our readiness days, not Oura\'s', async () => {
    const tools = buildChatTools(withDerived([]), 'u1', 'Australia/Brisbane', '2026-10-18')
    const none = await plain(tools.getRecoveryVsPerformance.execute!({ days: 30 }, ctx))
    expect(none.readinessDatesAvailable).toBe(0)
    const ours = buildChatTools(withDerived([
      { day: '2026-10-17', readinessScore: 55, readinessSource: 'ble-derived' },
    ]), 'u1', 'Australia/Brisbane', '2026-10-18')
    expect((await plain(ours.getRecoveryVsPerformance.execute!({ days: 30 }, ctx))).readinessDatesAvailable).toBe(1)
  })
})
