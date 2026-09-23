import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { scoreBand, SCORE_BAND_COLOR } from '@trainingai/shared/health/score-band'

const ROOT = path.resolve(__dirname, '../../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
/** Both files explain the bug in prose and quote the caption they replaced. */
const code = (rel: string) =>
  read(rel).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/**
 * BF-172 — the explain screen called the session-FIT score "readiness".
 *
 * `overallScore` is `recovery·w + balance·w + freshness·w` from `computeAiDynamicNextSession`: how
 * well this session fits today. The screen printed it as *"Overall readiness for this session"* and
 * ran it through `scoreBand`, so it read **84 HIGH** in green directly above *Oura readiness 37 ·
 * Low*, *HRV well below your usual* and *strong deload advised*.
 *
 * Same class as BF-154: a number correct in its own terms, under a caption belonging to the quantity
 * it replaced. Nothing is miscomputed.
 */
describe('BF-172 — the fit score is not called readiness', () => {
  const ring = code('app/session-explain/components/score-ring.tsx')
  const content = code('app/session-explain/session-explain-content.tsx')

  it('the caption names fit, not readiness', () => {
    expect(content).toContain('How well this session fits today')
    expect(content, 'the caption that created the contradiction')
      .not.toContain('Overall readiness for this session')
  })

  it('the ring prints fit vocabulary rather than the readiness ladder', () => {
    expect(ring).toContain('Strong fit')
    expect(ring).toContain('Poor fit')
    // `band.label` bare is High/Moderate/Low — the readiness words this screen must not stamp on a
    // fit score.
    expect(ring, 'the readiness band word must not be rendered here').not.toMatch(/>\{band\.label\}</)
  })

  it('and still prints a WORD, because the ring and number are band-coloured', () => {
    // Dropping the band word would leave the band carried by colour alone, which is what this
    // component's own comment says it was added to prevent (CLAUDE.md: not colour-only state).
    expect(ring).toMatch(/\{FIT_WORD\[band\.label\]\}/)
  })

  it('maps from scoreBand rather than re-deriving 70/50 here', () => {
    // CLAUDE.md bans local label strings against re-derived thresholds — two divergent copies have
    // been found that way. The thresholds and the colour stay in the module that owns them.
    expect(ring).toContain('scoreBand(score)')
    expect(ring, 'no local threshold arithmetic').not.toMatch(/score\s*>=\s*(70|50)/)
  })

  it('leaves scoreBand itself alone — every other caller is scoring real readiness', () => {
    // Colours come from SCORE_BAND_COLOR rather than literals: RV-99 moved them to theme tokens,
    // and this case is about BF-172 leaving the BANDS alone, not about which three colours they are.
    expect(scoreBand(84)).toEqual({ label: 'High', color: SCORE_BAND_COLOR.High })
    expect(scoreBand(60)).toEqual({ label: 'Moderate', color: SCORE_BAND_COLOR.Moderate })
    expect(scoreBand(37)).toEqual({ label: 'Low', color: SCORE_BAND_COLOR.Low })
  })

  it('covers every band, so a new one cannot render undefined', () => {
    for (const s of [84, 60, 37]) {
      const { label } = scoreBand(s)
      expect(['High', 'Moderate', 'Low']).toContain(label)
      expect(ring).toContain(`${label}:`)
    }
  })
})
