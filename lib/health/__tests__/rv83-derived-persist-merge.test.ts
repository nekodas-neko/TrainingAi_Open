import { describe, it, expect } from 'vitest'
import { mergeDerivedPersists, type DerivedPersist } from '../readiness-payload'

// RV-83. The three pillars that persist into `oura_daily_derived` at the end of a readiness
// computation used to issue one upsert each; they are now grouped by day into one statement per
// distinct day. What makes that safe is that their key sets are disjoint — so these tests are about
// the merge preserving every key, and about a future overlap being refused rather than resolved
// silently.

const READINESS: DerivedPersist = {
  day: '2026-09-21',
  pillar: 'readiness',
  patch: {
    readinessScore: 72,
    readinessContributors: { hrv: 80, rhr: 60 },
    readinessSource: 'ble-derived',
    modelVersions: { readiness: 'v3:ri5:2026-08-18' },
  },
}
const SLEEP: DerivedPersist = {
  day: '2026-09-21',
  pillar: 'sleep',
  patch: { sleepScore: 81, sleepContributors: { efficiency: 90 } },
}
const ACTIVITY: DerivedPersist = {
  day: '2026-09-21',
  pillar: 'activity',
  patch: { activityScore: 64, activityContributors: { steps: 70, trained: 1 } },
}

describe('mergeDerivedPersists', () => {
  it('collapses three same-day pillars into one upsert carrying every key', () => {
    const groups = mergeDerivedPersists([READINESS, SLEEP, ACTIVITY])

    expect(groups).toHaveLength(1)
    expect(groups[0].day).toBe('2026-09-21')
    expect(groups[0].pillars).toEqual(['readiness', 'sleep', 'activity'])
    // Every key from every pillar survives, with its own pillar's value.
    expect(groups[0].patch).toEqual({
      readinessScore: 72,
      readinessContributors: { hrv: 80, rhr: 60 },
      readinessSource: 'ble-derived',
      modelVersions: { readiness: 'v3:ri5:2026-08-18' },
      sleepScore: 81,
      sleepContributors: { efficiency: 90 },
      activityScore: 64,
      activityContributors: { steps: 70, trained: 1 },
    })
  })

  it('keeps a pillar on a different day as its own upsert', () => {
    // `lastSleep.date` lags `todayIso` before the rollup runs — the case where the merge cannot
    // collapse anything and must not try.
    const lagged = { ...SLEEP, day: '2026-09-20' }
    const groups = mergeDerivedPersists([READINESS, lagged, ACTIVITY])

    expect(groups.map(g => g.day)).toEqual(['2026-09-21', '2026-09-20'])
    expect(groups[0].pillars).toEqual(['readiness', 'activity'])
    expect(groups[1].pillars).toEqual(['sleep'])
    expect(groups[1].patch).toEqual({ sleepScore: 81, sleepContributors: { efficiency: 90 } })
    // The same-day group must NOT have picked up the lagged day's columns.
    expect(groups[0].patch).not.toHaveProperty('sleepScore')
  })

  it('refuses a key two pillars both claim, naming the key and both pillars', () => {
    // The invariant the merge rests on, asserted rather than assumed: a silent Object.assign would
    // pick a winner and drop the other's value. This is the mutation that a test asserting only the
    // happy path would pass straight through.
    const alsoScores: DerivedPersist = {
      day: '2026-09-21',
      pillar: 'illness',
      patch: { readinessScore: 12 },
    }

    expect(() => mergeDerivedPersists([READINESS, alsoScores]))
      .toThrowError(/readinessScore.*readiness.*illness.*2026-09-21/)
  })

  // #3079: sleep stamps `model_versions` too. The column merges with `||` per pillar key, so two
  // pillars stamping their own keys merge into one map, exactly what two separate writes would leave.
  it('merges model-version stamps under different pillar keys', () => {
    const stampedSleep: DerivedPersist = { ...SLEEP, patch: { ...SLEEP.patch, modelVersions: { sleep: 'v1' } } }
    const [group] = mergeDerivedPersists([READINESS, stampedSleep])
    expect(group.patch.modelVersions).toEqual({ readiness: 'v3:ri5:2026-08-18', sleep: 'v1' })
    expect(group.patch.sleepScore).toBe(81)
  })

  it('refuses two pillars stamping the same model-version key (Q-273 clobber)', () => {
    const alsoStamps: DerivedPersist = {
      day: '2026-09-21',
      pillar: 'illness',
      patch: { illnessScore: 12, modelVersions: { readiness: 'v1' } },
    }

    expect(() => mergeDerivedPersists([READINESS, alsoStamps]))
      .toThrowError(/modelVersions\.readiness.*readiness.*illness.*2026-09-21/)
  })

  it('is empty for no persists, so a gated-out request writes nothing', () => {
    expect(mergeDerivedPersists([])).toEqual([])
  })
})
