import { describe, expect, it } from 'vitest'
import {
  componentClause, formatClock, formatDuration, verdictCopy, type StoredSleepVerdict,
} from '../sleep-verdict-copy'

/**
 * TN-85/TN-84 — what the app says about last night.
 *
 * **The rules under test are the design, not the prose.** A verdict with no stated cause cannot be
 * argued with, and a correction is the only thing this feature collects — so every outlier line
 * must carry its numbers BEFORE the verdict, and no line may ever ask a question. Three in-sheet
 * questions have already decayed to zero on this owner's surfaces.
 */
const base: StoredSleepVerdict = {
  date: '2026-09-26',
  verdict: 'normal',
  triggered: [],
  components: { durationHours: 7.4, onsetMinutes: -30, efficiency: 91 },
  bands: {
    durationLow: 6.5, durationHigh: 8, onsetLow: -80, onsetHigh: 15,
    efficiencyLow: 88, efficiencyHigh: 94,
  },
  baselineNights: 28,
  modelVersion: 1,
  responseState: 'none',
}
const with_ = (over: Partial<StoredSleepVerdict>): StoredSleepVerdict => ({ ...base, ...over })

describe('formatDuration', () => {
  it('reads as hours and minutes, never a decimal', () => {
    expect(formatDuration(5.17)).toBe('5h10')
    expect(formatDuration(8)).toBe('8h00')
    expect(formatDuration(6.5)).toBe('6h30')
  })
})

describe('formatClock', () => {
  it('turns signed minutes from local midnight into a clock time', () => {
    // Negative is before midnight, which is what makes "later than usual" plain arithmetic.
    expect(formatClock(-50)).toBe('11:10pm')
    expect(formatClock(80)).toBe('1:20am')
    expect(formatClock(0)).toBe('12:00am')
    expect(formatClock(720)).toBe('12:00pm')
  })
})

describe('componentClause', () => {
  it('states the value AND the band it was judged against', () => {
    expect(componentClause(with_({ components: { ...base.components, durationHours: 5.17 } }), 'duration'))
      .toBe('slept 5h10, 1h20 short of your usual')
  })

  it('names the side the value fell on, not just that it was out', () => {
    expect(componentClause(with_({ components: { ...base.components, durationHours: 9.25 } }), 'duration'))
      .toBe('slept 9h15, 1h15 over your usual')
    expect(componentClause(with_({ components: { ...base.components, onsetMinutes: 80 } }), 'onset'))
      .toBe('asleep at 1:20am, 65 min later than usual')
    expect(componentClause(with_({ components: { ...base.components, onsetMinutes: -180 } }), 'onset'))
      .toBe('asleep at 9:00pm, 100 min earlier than usual')
  })

  it('reads efficiency as a percentage of the night', () => {
    expect(componentClause(with_({ components: { ...base.components, efficiency: 82 } }), 'efficiency'))
      .toBe('82% of the night asleep, 6 points below your usual')
  })

  it('returns null rather than a half-sentence when the snapshot is missing a number', () => {
    // A stored verdict can carry a null component: coverage differs per component, so a band can
    // exist for duration and not for efficiency. Half a clause is worse than no clause.
    expect(componentClause(with_({ components: { ...base.components, efficiency: null } }), 'efficiency')).toBeNull()
    expect(componentClause(with_({ bands: { ...base.bands, durationLow: null } }), 'duration')).toBeNull()
  })
})

describe('verdictCopy', () => {
  it('announces an ordinary night quietly, and still announces it', () => {
    // Announcing `normal` is what makes a wrong "normal" correctable. Under an outliers-only
    // design that error produces no announcement and is invisible by construction.
    expect(verdictCopy(base)).toEqual({ line: 'Sleep looks normal — filled in for you.', prominent: false })
  })

  it('gives a lone clause its distance as well as its value', () => {
    expect(verdictCopy(with_({
      verdict: 'poor', triggered: ['duration'],
      components: { ...base.components, durationHours: 5.17 },
    })).line).toBe('Slept 5h10, 1h20 short of your usual. Marked this a poor night.')
  })

  it('puts the numbers BEFORE the verdict on an outlier night, and keeps it to two lines', () => {
    const copy = verdictCopy(with_({
      verdict: 'poor', triggered: ['duration', 'onset'],
      components: { durationHours: 5.17, onsetMinutes: 80, efficiency: 91 },
    }))
    expect(copy).toEqual({
      line: 'Slept 5h10, 65 min later than usual. Marked this a poor night.',
      prominent: true,
    })
  })

  it('never asks a question, on any verdict', () => {
    for (const v of [
      base,
      with_({ verdict: 'poor', triggered: ['duration'] }),
      with_({ verdict: 'good', triggered: ['duration', 'onset', 'efficiency'] }),
    ]) {
      expect(verdictCopy(v).line, verdictCopy(v).line).not.toContain('?')
    }
  })

  it('stops at two clauses — three facts in one line stop being read', () => {
    const copy = verdictCopy(with_({
      verdict: 'good', triggered: ['duration', 'onset', 'efficiency'],
      components: { durationHours: 8.5, onsetMinutes: -180, efficiency: 96 },
    }))
    expect(copy.line).not.toContain('% of the night asleep')
    expect(copy.line.endsWith('Marked this a good night.')).toBe(true)
  })

  it('still names the verdict when every clause is unrenderable', () => {
    const copy = verdictCopy(with_({
      verdict: 'poor', triggered: ['efficiency'],
      components: { durationHours: null, onsetMinutes: null, efficiency: null },
    }))
    expect(copy).toEqual({ line: 'Marked this a poor night.', prominent: true })
  })
})

describe('the follow-on clause', () => {
  it('is the distance alone for duration and onset', () => {
    // TN-84's own draft shape: "Slept 5h10, 90 min later than usual."
    expect(verdictCopy(with_({
      verdict: 'poor', triggered: ['duration', 'onset'],
      components: { durationHours: 5.17, onsetMinutes: 80, efficiency: 91 },
    })).line).toBe('Slept 5h10, 65 min later than usual. Marked this a poor night.')
  })

  it('keeps efficiency’s percentage, because "6 points below your usual" names nothing', () => {
    expect(verdictCopy(with_({
      verdict: 'poor', triggered: ['duration', 'efficiency'],
      components: { durationHours: 5.17, onsetMinutes: -30, efficiency: 82 },
    })).line).toBe('Slept 5h10, 82% of the night asleep, 6 points below your usual. Marked this a poor night.')
  })
})
