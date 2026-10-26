// #3169 (owner, 26 Oct): a run is softened while readiness is still learning, read from the stored
// composite's own contributors, so an Oura Cloud day (no ring summary) is judged on its own normals.
import { describe, it, expect } from 'vitest'
import { assembleInputs } from '../assemble-plan-context'
import { todayInTz } from '../../date-utils'

const TZ = 'Australia/Brisbane'
const today = todayInTz(TZ)
const awaiting = { gap: 'awaiting_baseline' }
const scored = { gap: null }
const contributors = (gap: object) => ({ restingHeartRate: gap, hrvBalance: gap, temperature: gap, sleepBalance: gap })

const run = async (derived: unknown[], summaries: unknown[]) => {
  const repo = {
    getOuraDailyDerived: async () => derived,
    getOuraDailySummary: async () => summaries,
    getSessionLoadsFrom: async () => [],
    getWorkoutSessionsFrom: async () => [],
    listSleepSessions: async () => [],
    getPrescribedRuns: async () => [],
    getActiveProgram: async () => null,
  } as never
  const plan = {
    id: 'p', userId: 'u', goalKind: 'general', targetDistanceKm: null, targetDate: null,
    frameworkKey: 'polarized', fitnessSnapshot: null, timePerSessionMinutes: null,
    isActive: true, createdAt: new Date(Date.now() - 20 * 86_400_000), updatedAt: new Date(),
  } as never
  return (await assembleInputs(repo, 'u', TZ, {} as never, plan)).gate.readinessProvisional
}
const row = (source: string | null, c: unknown) => ({ day: today, readinessScore: 70, readinessSource: source, readinessContributors: c })

describe('run softening reads Oura-era readiness learning (#3169)', () => {
  it('an Oura Cloud day with every baseline input waiting on its normal is provisional, with no ring summary', async () => {
    expect(await run([row('generic-derived', contributors(awaiting))], [])).toBe(true)
  })
  it('a day with a scored baseline input is not', async () => {
    expect(await run([row('generic-derived', contributors(scored))], [])).toBe(false)
  })
  it('a row that cannot say keeps the ring-summary rule', async () => {
    expect(await run([row('generic-derived', null)], [{ nHistory: 3 }])).toBe(true)
    expect(await run([row('generic-derived', null)], [{ nHistory: 30 }])).toBe(false)
    expect(await run([], [])).toBe(false)
  })
  it("a readiness row that is not our composite is not read", async () => {
    expect(await run([row('oura', contributors(awaiting))], [])).toBe(false)
  })
})
