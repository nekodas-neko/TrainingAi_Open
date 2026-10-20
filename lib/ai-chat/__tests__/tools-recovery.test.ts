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
  getOuraCloudSwitchDay: async () => null,
  // #3095: a treadmill session — its steps join the day's, as on every screen (whether the ring already
  // counts some of them is unknown, pending #3112).
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
    getOuraCloudSwitchDay: async () => null,
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

// #3176 (the switch-day rule, #2998): the ring's stress and resilience stand only before the day the
// user switched to the Oura API; from it, Oura's are read, even over a partial ring row.
describe('getRecoveryData stress and resilience across the switch day (#3176)', () => {
  const ctx = { toolCallId: 't1', messages: [] }
  const SWITCH = '2026-10-18'
  const repoWith = (oura: unknown[], derived: unknown[]) => ({
    getOuraDaily: async () => oura,
    listSleepSessions: async () => [],
    listBodyMetrics: async () => [],
    getOuraDailyDerived: async () => derived,
    getOuraCloudSwitchDay: async () => SWITCH,
    listActivityLogs: async () => [],
  }) as unknown as WorkoutRepository
  const run = (r: WorkoutRepository) => plain(
    buildChatTools(r, 'u1', 'Australia/Brisbane', '2026-10-20').getRecoveryData.execute!(
      { fromDate: '2026-10-15', toDate: '2026-10-20' }, ctx))

  it('an Oura-only day after the switch day falls back to Oura for stress and resilience', async () => {
    const out = await run(repoWith([{ date: '2026-10-19', stressHigh: 5400, resilienceLevel: 'solid' }], []))
    expect(out.daytimeStress).toEqual([{ date: '2026-10-19', source: 'oura', level: null, highMinutes: 90 }])
    expect(out.resilience).toEqual([])
    expect(out.ouraResilience).toEqual([{ date: '2026-10-19', level: 'solid' }])
  })

  it('the switch day: a partial ring row loses to Oura\'s value; the day before it, the ring\'s stands', async () => {
    const out = await run(repoWith(
      [{ date: SWITCH, stressHigh: 3600, resilienceLevel: 'strong' }, { date: '2026-10-17', stressHigh: 1200, resilienceLevel: 'limited' }],
      [
        { day: SWITCH, daytimeStressScaled: -0.2, stressHighMinutes: 7, resilienceLevel: 2 },
        { day: '2026-10-17', daytimeStressScaled: -0.5, stressHighMinutes: 40, resilienceLevel: 4 },
      ],
    ))
    expect(out.daytimeStress).toEqual([
      { date: '2026-10-17', source: 'own', level: -0.5, highMinutes: 40 },
      { date: SWITCH, source: 'oura', level: null, highMinutes: 60 },
    ])
    expect(out.resilience).toEqual([{ date: '2026-10-17', level: 4, band: expect.any(String) }])
    expect(out.ouraResilience).toEqual([{ date: SWITCH, level: 'strong' }])
  })
})
