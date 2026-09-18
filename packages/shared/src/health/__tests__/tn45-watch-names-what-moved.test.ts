import { describe, it, expect } from 'vitest'
import { illnessAdvisory, type IllnessResult } from '@trainingai/shared/health/illness-radar'

// TN-45. `watch` is the only band that has ever fired — 2 days in 72, against 0 for `elevated` and
// `fever` — and it was inert twice over: no readiness penalty (deliberate) and no UI (the gap).
// Its line named nothing, so the one signal the owner actually gets said less than the data behind
// it already knew.
//
// The cause of both firings turned out to be a medication rather than an infection (TN-46), which
// is why every case here also checks the copy does not imply illness.

const bio = (parts: Record<string, { z: number; contribution: number }>) =>
  parts as IllnessResult['biomarkers']

const IMPLIES_ILLNESS = /fever|infection|fighting|sick|unwell|ill\b/i

describe('TN-45 — the watch advisory names what moved', () => {
  it('names the single driving biomarker, with a singular verb', () => {
    const line = illnessAdvisory('watch', bio({
      restingHeartRate: { z: 1.8, contribution: 44 },
      hrvBalance:       { z: -0.1, contribution: 0 },
    }))
    expect(line).toBe('Resting HR is drifting from your baseline — worth keeping an eye on.')
  })

  it('names two, with a plural verb', () => {
    const line = illnessAdvisory('watch', bio({
      restingHeartRate: { z: 1.8, contribution: 44 },
      hrvBalance:       { z: -1.6, contribution: 31 },
    }))
    expect(line).toBe('Resting HR and HRV are drifting from your baseline — worth keeping an eye on.')
  })

  it('caps at two even when three are contributing', () => {
    // The owner asked for one calm sentence. A third name turns it into a readout.
    const line = illnessAdvisory('watch', bio({
      restingHeartRate: { z: 1.8, contribution: 44 },
      hrvBalance:       { z: -1.6, contribution: 31 },
      breathing:        { z: 0.9,  contribution: 12 },
    }))
    expect(line).toBe('Resting HR and HRV are drifting from your baseline — worth keeping an eye on.')
    expect(line).not.toContain('breathing')
  })

  it('ranks by contribution, not by raw z', () => {
    // Temperature holds 40% of the weight, so a small z can out-contribute a larger one. What the
    // reader is being shown is the number's composition, so composition is what ranks.
    const line = illnessAdvisory('watch', bio({
      temperature:      { z: 0.3, contribution: 50 },
      restingHeartRate: { z: 2.9, contribution: 20 },
    }))
    expect(line).toBe('Skin temperature and resting HR are drifting from your baseline — worth keeping an eye on.')
  })

  it('never names a biomarker contributing nothing', () => {
    // On a watch day most are at zero; listing them describes the metric set, not the event.
    const line = illnessAdvisory('watch', bio({
      restingHeartRate: { z: 1.8,  contribution: 44 },
      temperature:      { z: 0.05, contribution: 0 },
      breathing:        { z: -0.4, contribution: 0 },
    }))
    expect(line).toBe('Resting HR is drifting from your baseline — worth keeping an eye on.')
  })

  it('falls back to the previous wording when no biomarkers are passed', () => {
    // The parameter is optional precisely so no existing caller changes meaning.
    expect(illnessAdvisory('watch')).toBe(
      'Some biomarkers are drifting from your baseline — worth keeping an eye on.',
    )
  })

  it('falls back when every contribution is zero', () => {
    expect(illnessAdvisory('watch', bio({ temperature: { z: 0.05, contribution: 0 } }))).toBe(
      'Some biomarkers are drifting from your baseline — worth keeping an eye on.',
    )
  })

  it('never implies infection — that was wrong on both days it has ever fired', () => {
    const line = illnessAdvisory('watch', bio({
      restingHeartRate: { z: 1.8, contribution: 44 },
      hrvBalance:       { z: -1.6, contribution: 31 },
    }))
    expect(line).not.toMatch(IMPLIES_ILLNESS)
  })

  it('leaves the other bands untouched', () => {
    const b = bio({ restingHeartRate: { z: 1.8, contribution: 44 } })
    expect(illnessAdvisory('normal', b)).toBeNull()
    expect(illnessAdvisory('learning', b)).toBeNull()
    expect(illnessAdvisory('fever', b)).toContain('possible fever')
    expect(illnessAdvisory('elevated', b)).toContain('fighting something')
  })

  // Both of the two `watch` days that have ever fired, with the biomarker maps as PERSISTED in
  // production (`oura_daily_derived.illness_biomarkers`) rather than re-derived from guessed
  // z-scores. An earlier draft of this test reconstructed the inputs and scored `normal`, which is
  // the whole argument for reading the stored row instead of fitting one to the assertion.
  it.each([
    ['2026-09-16', 41, {
      breathing:        { z: 0.45,  contribution: 4 },
      hrvBalance:       { z: -3.42, contribution: 15 },
      temperature:      { z: 0.23,  contribution: 3 },
      restingHeartRate: { z: 2.91,  contribution: 19 },
    }],
    ['2026-08-27', 57, {
      breathing:        { z: -0.83, contribution: 0 },
      hrvBalance:       { z: -4.26, contribution: 25 },
      restingHeartRate: { z: 2.84,  contribution: 32 },
    }],
  ] as const)('the real %s firing (score %i) names resting HR and HRV, not illness', (_day, _score, map) => {
    const line = illnessAdvisory('watch', map as IllnessResult['biomarkers'])
    expect(line).toBe('Resting HR and HRV are drifting from your baseline — worth keeping an eye on.')
    expect(line).not.toMatch(IMPLIES_ILLNESS)
  })
})
