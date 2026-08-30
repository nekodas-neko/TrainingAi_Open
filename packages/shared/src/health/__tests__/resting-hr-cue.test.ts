// TN-13 — the HR tile showed a 7-day average of the signal that best predicts how the owner feels,
// and showed it as a bare bpm.
//
// Two findings, and the second is the one that decided the design. The tile read `restingHr`, the
// 7-day mean: measured against production over 71 nights the nightly value changes on **61 of 70**
// night-pairs while the rounded mean changes on **29**, so the number stood still on nearly six days
// in ten. And expressing either candidate as a deviation from the owner's own baseline roughly
// **doubles** its correlation with felt state (+0.291 vs +0.176) — which metric you pick moves the
// number far less than raw-versus-relative does, so showing an absolute bpm at all was the defect.
//
// The entry's pass test is explicit that half a fix fails it: *"a change that keeps the 7-day average
// and merely adds a cue beside it fails this entry."*
import { describe, it, expect } from 'vitest'
import { restingHrCue } from '../resting-hr-cue'
import { scoreBand } from '../score-band'

describe('restingHrCue reads as a delta, not a tier', () => {
  it('says how far from usual, with a sign', () => {
    expect(restingHrCue(50, 52)?.word).toBe('−2 vs usual')
    expect(restingHrCue(55, 52)?.word).toBe('+3 vs usual')
  })

  // "0 vs usual" reads as a measurement error rather than as a normal night.
  it('says "same as usual" rather than a signed zero', () => {
    expect(restingHrCue(52, 52)?.word).toBe('same as usual')
  })

  // The whole point: a bare bpm is what the entry calls the defect.
  it('never renders a bare bpm as the cue', () => {
    for (const bpm of [40, 52, 69, 90]) {
      expect(restingHrCue(bpm, 52)!.word).not.toBe(String(bpm))
      expect(restingHrCue(bpm, 52)!.word).toMatch(/vs usual|same as usual/)
    }
  })

  it('rounds both sides before subtracting, so the delta matches the displayed number', () => {
    // The tile prints `Math.round`ed bpm. A cue computed on the unrounded pair can read "+1 vs
    // usual" beside two numbers that are equal on screen.
    expect(restingHrCue(52.4, 51.6)?.word).toBe('same as usual')
  })

  describe('the colour still bands, and the thresholds are unchanged', () => {
    it.each([
      ['well below', 48, 85],
      ['at the low edge', 50, 85],
      ['steady', 52, 75],
      ['at the steady edge', 54, 75],
      ['elevated', 57, 60],
      ['high', 58, 40],
    ])('%s → the %i band', (_label, bpm, band) => {
      expect(restingHrCue(bpm, 52)!.color).toBe(scoreBand(band).color)
    })

    // CLAUDE.md: never convey state by colour alone. The sign and the number ARE the label here.
    it('always pairs the colour with text', () => {
      for (const bpm of [45, 52, 60, 80]) {
        expect(restingHrCue(bpm, 52)!.word.length).toBeGreaterThan(0)
      }
    })
  })

  describe('when there is nothing to compare against', () => {
    it('says what the number is rather than inventing a comparison', () => {
      expect(restingHrCue(52, null)).toEqual({ color: 'hsl(var(--muted-foreground))', word: 'Resting' })
    })

    it('has no cue at all with no reading', () => {
      expect(restingHrCue(null, 52)).toBeNull()
      expect(restingHrCue(null, null)).toBeNull()
    })
  })
})
