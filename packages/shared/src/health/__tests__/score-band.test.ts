import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { scoreBand, scoreBandByLabel, SCORE_BAND_COLOR } from '@trainingai/shared/health/score-band'

describe('scoreBand', () => {
  it('maps scores to canonical bands', () => {
    expect(scoreBand(85)).toEqual({ label: 'High', color: SCORE_BAND_COLOR.High })
    expect(scoreBand(70)).toEqual({ label: 'High', color: SCORE_BAND_COLOR.High })
    expect(scoreBand(69)).toEqual({ label: 'Moderate', color: SCORE_BAND_COLOR.Moderate })
    expect(scoreBand(50)).toEqual({ label: 'Moderate', color: SCORE_BAND_COLOR.Moderate })
    expect(scoreBand(49)).toEqual({ label: 'Low', color: SCORE_BAND_COLOR.Low })
    expect(scoreBand(0)).toEqual({ label: 'Low', color: SCORE_BAND_COLOR.Low })
  })

  // RV-99. The thresholds above are asserted against the token constants, so they cannot pin a
  // stale literal again; these fix what those constants must BE, which is the actual finding.
  it('returns theme tokens, never raw hex', () => {
    expect(SCORE_BAND_COLOR).toEqual({
      High: 'var(--accent-green)',
      Moderate: 'var(--accent-amber)',
      Low: 'var(--destructive)',
    })
    for (const s of [85, 60, 20]) expect(scoreBand(s).color).toMatch(/^var\(--/)
  })

  it('agrees with the recovery and body-battery bands it used to contradict', () => {
    // The whole of RV-99: the same good/warning/bad triad existed twice, and resolved in dark the
    // green was rgb(34,197,94) here against rgb(86,238,102) there — a different colour, not a
    // shade. Asserted against the sibling modules' source so a drift in either fails.
    const root = path.resolve(__dirname, '..')
    const recovery = readFileSync(path.join(root, 'recovery-band.ts'), 'utf8')
    const battery = readFileSync(path.join(root, 'body-battery-band.ts'), 'utf8')
    for (const src of [recovery, battery]) {
      expect(src).toContain(SCORE_BAND_COLOR.High)
      expect(src).toContain(SCORE_BAND_COLOR.Moderate)
      expect(src).toContain(SCORE_BAND_COLOR.Low)
    }
  })

  it('scoreBandByLabel returns the same colour scoreBand does', () => {
    for (const s of [85, 60, 20]) {
      const b = scoreBand(s)
      expect(scoreBandByLabel(b.label)).toBe(b.color)
    }
  })
})
