/**
 * RV-69 — the shape of the degraded answer.
 *
 * The routes that use this had already assembled a complete fact block before calling the model and
 * threw it away on the catch path. What matters here is what replaces it: one sentence, on one
 * line, that says plainly it is not the written summary.
 */
import { describe, it, expect } from 'vitest'
import { degradedFromFacts } from '@/lib/ai/degrade'

describe('degradedFromFacts', () => {
  it('joins the fact lines into one line, so a plain <p> cannot collapse them into a run-on', () => {
    const out = degradedFromFacts('the day', 'Trained today: Upper\nSteps: 8000/10000 today')
    expect(out).not.toContain('\n')
    expect(out).toContain('Trained today: Upper')
    expect(out).toContain('Steps: 8000/10000 today')
    expect(out).toContain(' · ')
  })

  it('says it is not the written summary', () => {
    expect(degradedFromFacts('the week', 'Sessions: 4')).toMatch(/could not be generated/i)
  })

  /**
   * A lead with nothing after it is worse than the error state it would replace, so the caller
   * keeps its existing failure response. Every route checks for null rather than assuming a string.
   */
  it('returns null when there are no facts at all', () => {
    expect(degradedFromFacts('the day', '')).toBeNull()
    expect(degradedFromFacts('the day', '\n  \n')).toBeNull()
  })

  it('drops blank lines rather than printing empty separators', () => {
    expect(degradedFromFacts('the session', 'Duration: 45 min\n\nTotal volume: 8200 kg'))
      .toContain('Duration: 45 min · Total volume: 8200 kg')
  })

  /**
   * Only figures the app computed. Nothing here may invent, round, or re-band a number — the lines
   * arrive already formatted by the route that will also hand them to the model, so the degraded
   * answer and the prompt agree by construction.
   */
  it('reproduces the fact lines verbatim', () => {
    const facts = 'Readiness: 80/100 avg that week (week before 74/100)'
    expect(degradedFromFacts('the week', facts)).toContain(facts)
  })
})
