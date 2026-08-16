import { describe, it, expect } from 'vitest'
import { FITNESS_TEST_PROTOCOLS, getProtocol, phasesTotalSec, hrrRecoveryStartMs } from '../protocols'

describe('FITNESS_TEST_PROTOCOLS', () => {
  it('defines the three baseline protocols with unique ids', () => {
    const ids = FITNESS_TEST_PROTOCOLS.map((p) => p.id)
    expect(ids).toEqual(['6mwt', 'cooper12', 'resting_hrr'])
    expect(new Set(ids).size).toBe(3)
  })

  it('6MWT is a fixed 6-minute distance-capturing walk', () => {
    const p = getProtocol('6mwt')!
    expect(p.durationSec).toBe(360)
    expect(p.captureDistance).toBe(true)
    expect(p.vo2Equation).toBe('6mwt')
  })

  it('Cooper is a fixed 12-minute distance-capturing run', () => {
    const p = getProtocol('cooper12')!
    expect(p.durationSec).toBe(720)
    expect(p.captureDistance).toBe(true)
    expect(p.vo2Equation).toBe('cooper')
  })

  it('Resting HRR captures recovery, no distance, no VO2 equation', () => {
    const p = getProtocol('resting_hrr')!
    expect(p.captureHrr).toBe(true)
    expect(p.captureDistance).toBe(false)
    expect(p.vo2Equation).toBeNull()
  })

  it('Resting HRR is a guided rest → effort → recovery flow', () => {
    const p = getProtocol('resting_hrr')!
    expect(p.phases?.map((ph) => ph.key)).toEqual(['rest', 'effort', 'recovery'])
    expect(phasesTotalSec(p.phases!)).toBe(180)
  })

  it('getProtocol returns undefined for an unknown id', () => {
    expect(getProtocol('nope')).toBeUndefined()
  })
})

describe('hrrRecoveryStartMs', () => {
  it('opens the recovery window when the last non-recovery phase ends', () => {
    const phases = getProtocol('resting_hrr')!.phases!
    const start = 1_000_000
    // rest (60) + effort (60) = 120 s after start
    expect(hrrRecoveryStartMs(phases, start)).toBe(start + 120_000)
  })
})
