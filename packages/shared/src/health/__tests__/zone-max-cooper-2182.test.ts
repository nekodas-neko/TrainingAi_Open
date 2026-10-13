// #2182 (owner 09-09 and 09-17; Orchestrator design (b), 2026-10-11): the zone ceiling is the owner's
// 50/50 rule — round((latest Cooper 12-minute peak + age-predicted) / 2) — derived, not stored.
// The walk's anchor (`targetAnchorMax`) does not move, so its TN-25 fast band does not move.
import { describe, it, expect } from 'vitest'
import { zoneMaxFromTests, walkFastBandBpm } from '../hr-zones'
import { resolveHrProfile } from '../hr-profile'
import { computeObservedHr } from '../observed-hr'
import type { WorkoutRepository } from '@/lib/data/repository'

// 33 on 2026-10-11 → 220 − 33 = 187, the owner's figure.
const DOB = '1993-01-01'
const COOPER = { testType: 'cooper12', date: '2026-09-14', maxHr: 175 }

describe('zoneMaxFromTests', () => {
  it('is 181 for the owner: (175 + 187) / 2', () => {
    expect(zoneMaxFromTests(187, [COOPER])).toEqual({ maxHr: 181, cooperPeak: 175, cooperDate: '2026-09-14' })
  })
  it('is the age-predicted max with no Cooper test', () => {
    expect(zoneMaxFromTests(187, [])).toEqual({ maxHr: 187, cooperPeak: null, cooperDate: null })
    expect(zoneMaxFromTests(187, [{ testType: '6mwt', date: '2026-09-20', maxHr: 150 }]).maxHr).toBe(187)
  })
  it('takes the latest Cooper test, and ignores one without a peak', () => {
    const later = { testType: 'cooper12', date: '2026-11-01', maxHr: 179 }
    expect(zoneMaxFromTests(187, [COOPER, later]).maxHr).toBe(183)
    expect(zoneMaxFromTests(187, [COOPER, { testType: 'cooper12', date: '2026-12-01', maxHr: null }]).maxHr).toBe(181)
  })
})

describe('resolveHrProfile with a Cooper test', () => {
  const repo = (bpms: number[], tests: unknown[] | Error) => ({
    getUserById: async () => ({ dateOfBirth: DOB }),
    listBodyMetrics: async () => [{ date: '2026-10-01', restingHeartRate: 54 }],
    getObservedHrProfile: async () => computeObservedHr(bpms),
    listFitnessTests: async () => { if (tests instanceof Error) throw tests; return tests },
  }) as unknown as WorkoutRepository
  const owner = [...Array.from({ length: 300 }, () => 150), ...Array.from({ length: 5 }, () => 175)]

  it('puts the zone ceiling at 181 and leaves the walk anchor at the observed 175', async () => {
    const p = await resolveHrProfile(repo(owner, [COOPER]), 'u', 'Australia/Brisbane')
    expect(p.maxHr).toBe(181)
    expect(p.maxHrSource).toBe('cooper-blend')
    expect(p.cooperPeak).toBe(175)
    expect(p.estimatedMax).toBe(187)
    expect(p.targetAnchorMax).toBe(175)
    // TN-25: the walk's fast band stays on the observed anchor, not the new 181 ceiling.
    expect(walkFastBandBpm(p.targetAnchorMax)).toEqual(walkFastBandBpm(175))
    expect(walkFastBandBpm(p.targetAnchorMax)).not.toEqual(walkFastBandBpm(181))
  })

  it('a reliable observed max above the blend still wins', async () => {
    const hard = [...owner, ...Array.from({ length: 5 }, () => 190)]
    const p = await resolveHrProfile(repo(hard, [COOPER]), 'u', 'Australia/Brisbane')
    expect(p.maxHr).toBe(190)
    expect(p.maxHrSource).toBe('observed')
  })

  it('a failed fitness-test read falls back to the age estimate, never 0', async () => {
    const p = await resolveHrProfile(repo(owner, new Error('db down')), 'u', 'Australia/Brisbane')
    expect(p.maxHr).toBe(187)
    expect(p.maxHrSource).toBe('estimated')
  })
})
