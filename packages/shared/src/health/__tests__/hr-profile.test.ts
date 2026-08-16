import { describe, it, expect } from 'vitest'
import { resolveHrProfile } from '../hr-profile'
import type { WorkoutRepository } from '@/lib/data/repository'

// A 40-year-old → 220 − 40 = 180 age-predicted.
const DOB = '1986-01-01'

function repoWith({ bpms, dob = DOB, rhr }: { bpms: number[]; dob?: string | null; rhr?: number[] }) {
  return {
    getUserById: async () => ({ dateOfBirth: dob }),
    listBodyMetrics: async () => (rhr ?? []).map((v, i) => ({ date: `2026-07-${10 + i}`, restingHeartRate: v })),
    getHrForWindow: async () => bpms.map((bpm, i) => ({ timestamp: new Date(i * 1000), bpm, source: 'ble' })),
  } as unknown as WorkoutRepository
}

/** n readings at `bpm` — enough of them to clear the reliability gate when n is large. */
const flat = (bpm: number, n: number) => Array.from({ length: n }, () => bpm)

describe('resolveHrProfile — one resolver, corroborated', () => {
  it('a lone spike never becomes the max', async () => {
    // 200 plateau readings at 150, plus four 210s. Four is under the corroboration
    // threshold, so the max stays at the plateau.
    const p = await resolveHrProfile(repoWith({ bpms: [...flat(150, 200), 210, 210, 210, 210] }), 'u', 'Australia/Brisbane')
    expect(p.observed.max).toBe(150)
    expect(p.observed.highestPlausible).toBe(210) // the spike is visible, but did not set the max
  })

  it('an impossible reading is dropped even when it repeats', async () => {
    // 250 bpm is not a human heart rate — the plausibility band rejects it before
    // corroboration is even consulted, so any number of them changes nothing.
    const p = await resolveHrProfile(repoWith({ bpms: [...flat(150, 200), ...flat(250, 50)] }), 'u', 'Australia/Brisbane')
    expect(p.observed.max).toBe(150)
    expect(p.observed.outOfBandRejected).toBe(50) // all 50 dropped before corroboration ran
    expect(p.observed.sampleCount).toBe(200)
    expect(p.maxHr).toBe(180) // still the age estimate
  })

  it('the max does rise once enough real readings corroborate it', async () => {
    const p = await resolveHrProfile(repoWith({ bpms: [...flat(150, 200), ...flat(190, 5)] }), 'u', 'Australia/Brisbane')
    expect(p.observedMax).toBe(190)
    expect(p.maxHr).toBe(190) // above the 180 estimate → it takes over
    expect(p.maxHrSource).toBe('observed')
  })

  it('a low observed max does not drag the effort ceiling down', async () => {
    // Observed 168 < age-predicted 180: the ceiling stays at 180 (you simply haven't
    // gone hard lately), but the reachable-target anchor uses the observed value.
    const p = await resolveHrProfile(repoWith({ bpms: flat(168, 200) }), 'u', 'Australia/Brisbane')
    expect(p.maxHr).toBe(180)
    expect(p.maxHrSource).toBe('estimated')
    expect(p.targetAnchorMax).toBe(168)
  })

  it('too little data → no observed max, both anchors fall back to the estimate', async () => {
    const p = await resolveHrProfile(repoWith({ bpms: flat(170, 10) }), 'u', 'Australia/Brisbane')
    expect(p.observed.isReliable).toBe(false)
    expect(p.observedMax).toBeNull()
    expect(p.maxHr).toBe(180)
    expect(p.targetAnchorMax).toBe(180)
  })

  it('reports whether resting HR was measured or defaulted', async () => {
    const measured = await resolveHrProfile(repoWith({ bpms: [], rhr: [56, 58, 60] }), 'u', 'Australia/Brisbane')
    expect(measured.restingHr).toBe(58)
    expect(measured.restingHrSource).toBe('measured')

    const defaulted = await resolveHrProfile(repoWith({ bpms: [] }), 'u', 'Australia/Brisbane')
    expect(defaulted.restingHr).toBe(60)
    expect(defaulted.restingHrSource).toBe('default')
  })

  it('survives an HR-window read failure rather than failing the whole profile', async () => {
    const repo = {
      getUserById: async () => ({ dateOfBirth: DOB }),
      listBodyMetrics: async () => [],
      getHrForWindow: async () => { throw new Error('db down') },
    } as unknown as WorkoutRepository
    const p = await resolveHrProfile(repo, 'u', 'Australia/Brisbane')
    expect(p.maxHr).toBe(180)
    expect(p.observedMax).toBeNull()
  })
})
