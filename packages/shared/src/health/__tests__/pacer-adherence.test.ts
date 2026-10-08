import { describe, it, expect } from 'vitest'
import { addPacerTick, emptyBandCounts, pacerAdherence, summarisePacerTally } from '../pacer-adherence'

describe('pacerAdherence (issue 2242)', () => {
  it('is in-band ticks over judged ticks', () => {
    expect(pacerAdherence({ green: 3, amber: 1, red: 0, stopped: 0 })).toBe(0.75)
    expect(pacerAdherence({ green: 0, amber: 2, red: 2, stopped: 0 })).toBe(0)
    expect(pacerAdherence({ green: 4, amber: 0, red: 0, stopped: 0 })).toBe(1)
  })

  it('does not count a pause for or against', () => {
    expect(pacerAdherence({ green: 2, amber: 0, red: 2, stopped: 50 })).toBe(0.5)
  })

  it('is null, never 0, when nothing was judged', () => {
    expect(pacerAdherence(emptyBandCounts())).toBeNull()
    expect(pacerAdherence({ green: 0, amber: 0, red: 0, stopped: 9 })).toBeNull()
  })
})

describe('summarisePacerTally', () => {
  it('is null with no tally, so the stored fields are absent', () => {
    expect(summarisePacerTally(undefined)).toBeNull()
    expect(summarisePacerTally(null)).toBeNull()
    expect(summarisePacerTally({})).toBeNull()
  })

  it('names the signal that showed the most, and sums the counts across signals', () => {
    let t = addPacerTick(undefined, 'hr', 'red')
    for (let i = 0; i < 3; i++) t = addPacerTick(t, 'cadence', 'green')
    t = addPacerTick(t, 'cadence', 'amber')
    const s = summarisePacerTally(t)!
    expect(s.pacerSignal).toBe('cadence')
    expect(s.pacerTicks).toEqual({ green: 3, amber: 1, red: 1, stopped: 0 })
    expect(s.pacerAdherence).toBe(0.6)
  })

  it('a segment shown only as stopped has a signal and counts but null adherence', () => {
    const s = summarisePacerTally(addPacerTick(undefined, 'speed', 'stopped'))!
    expect(s.pacerSignal).toBe('speed')
    expect(s.pacerAdherence).toBeNull()
  })

  it('addPacerTick does not mutate its input', () => {
    const a = addPacerTick(undefined, 'hr', 'green')
    addPacerTick(a, 'hr', 'green')
    expect(a.hr!.green).toBe(1)
  })
})
