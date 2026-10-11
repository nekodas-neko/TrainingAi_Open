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
    // pick a winner and drop the other pillar's value.
    const alsoScoresSleep: DerivedPersist = { day: '2026-09-21', pillar: 'nap', patch: { sleepScore: 40 } }
    expect(() => mergeDerivedPersists([SLEEP, alsoScoresSleep]))
      .toThrowError(/sleepScore.*sleep.*nap.*2026-09-21/)
  })

  it('merges model_versions per pillar key, as the database does, and refuses one key twice (#2237)', () => {
    // Each pillar stamps its own key in the `model_versions` map (Q-273 merges per key in SQL), so
    // sleep stamping beside readiness is one write carrying both stamps, not a clash. A plain
    // Object.assign would have kept only the later map, which is the clobber Q-273 removed.
    const sleepStamped: DerivedPersist = { ...SLEEP, patch: { ...SLEEP.patch, modelVersions: { sleep: 'v2:even-gain:2026-10-14' } } }
    const [group] = mergeDerivedPersists([READINESS, sleepStamped])
    expect(group.patch.modelVersions).toEqual({ readiness: 'v3:ri5:2026-08-18', sleep: 'v2:even-gain:2026-10-14' })
    expect(group.patch.sleepScore).toBe(81)

    const readinessAgain: DerivedPersist = { day: '2026-09-21', pillar: 'illness', patch: { modelVersions: { readiness: 'v9' } } }
    expect(() => mergeDerivedPersists([READINESS, readinessAgain]))
      .toThrowError(/modelVersions\.readiness written twice on 2026-09-21/)
  })

  it('is empty for no persists, so a gated-out request writes nothing', () => {
    expect(mergeDerivedPersists([])).toEqual([])
  })
})
