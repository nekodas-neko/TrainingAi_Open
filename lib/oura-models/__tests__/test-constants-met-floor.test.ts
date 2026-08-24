import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Q-312. The synthetic constants replace every vendor number with a ramp in [0.1, 1.0], and applied
// to a MET that is physiologically impossible — 1 MET *is* resting metabolism. It also scrambled the
// tiers, so an activity could read `met_easy 1.0, met_hard 0.2`.
//
// That is not cosmetic. `estWorkoutKcal` is `max(0, duration × (met − 1.5) × bmrPerMinute)`, so
// every activity at every tier returned **0** and a set of assertions with nothing to do with vendor
// magnitudes could not run at all — they compared zero with zero.
//
// This holds the invariant from the fixture side, because that is the side CI reads. The generator
// carries the same bands, but it only runs on a machine that has the vendor files, so a check that
// lived only there would be a check that never runs.
const FIXTURE = join(__dirname, '..', '__fixtures__', 'constants', 'energy-expenditure-features.json')

// The subtraction in `estWorkoutKcal`. A floor at 1.0 — which is where "1 MET is rest" points, and
// what the backlog entry originally prescribed — leaves `met - 1.5` negative and the `max(0, …)`
// still returns 0, so the tests stay exactly as degenerate. The floor has to clear this, not 1.0.
const NET_MET_SUBTRACTION = 1.5

describe('the synthetic MET table is physiologically usable', () => {
  const dict = (JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    activity_type_dict: Record<string, { name?: string; met_easy: number; met_moderate: number; met_hard: number }>
  }).activity_type_dict
  const entries = Object.entries(dict)

  it('covers every activity', () => {
    expect(entries.length).toBeGreaterThan(50)
    for (const [id, a] of entries) {
      for (const k of ['met_easy', 'met_moderate', 'met_hard'] as const) {
        expect(typeof a[k], `${id}.${k}`).toBe('number')
      }
    }
  })

  it('never puts a MET below resting metabolism', () => {
    for (const [id, a] of entries) {
      for (const k of ['met_easy', 'met_moderate', 'met_hard'] as const) {
        expect(a[k], `${id}.${k}`).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('clears the net-MET subtraction at every tier, so no activity estimates zero kcal', () => {
    for (const [id, a] of entries) {
      for (const k of ['met_easy', 'met_moderate', 'met_hard'] as const) {
        expect(a[k], `${id}.${k} must exceed ${NET_MET_SUBTRACTION}`).toBeGreaterThan(NET_MET_SUBTRACTION)
      }
    }
  })

  it('orders the tiers easy < moderate < hard', () => {
    for (const [id, a] of entries) {
      expect(a.met_easy, `${id} easy < moderate`).toBeLessThan(a.met_moderate)
      expect(a.met_moderate, `${id} moderate < hard`).toBeLessThan(a.met_hard)
    }
  })

  // The bands are what make the ordering above a property of the design rather than of where a
  // value happened to land in the generator's walk. Pinning them here means a future regeneration
  // that drops the bands fails on the reason, not just on a symptom.
  it('keeps each tier in its own disjoint band', () => {
    for (const [id, a] of entries) {
      expect(a.met_easy, `${id} easy band`).toBeLessThan(3)
      expect(a.met_moderate, `${id} moderate band`).toBeGreaterThanOrEqual(4)
      expect(a.met_moderate, `${id} moderate band`).toBeLessThan(5)
      expect(a.met_hard, `${id} hard band`).toBeGreaterThanOrEqual(6)
      expect(a.met_hard, `${id} hard band`).toBeLessThan(7)
    }
  })
})
