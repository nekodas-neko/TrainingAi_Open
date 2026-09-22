import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { SESSION_PALETTE } from '@trainingai/shared/session-palette'

/** RV-100. A periodization phase is a CATEGORY; green, amber and red are the app's STATE language.
 *  `PHASE_COLORS` mixed them: `realisation` — the peak-output phase — was `text-red-500`, and
 *  `deload` was `text-green-500` while the Home banner paints a deload RECOMMENDATION amber or red.
 *
 *  Both are live rather than theoretical, which is what the entry asked to establish before sizing
 *  the work: the active program is `ai_dynamic`, and production carried 2 sessions in `deload` and
 *  2 in `realisation` when this was written. */

const ROOT = path.resolve(__dirname, '../../..')
const CARD = 'components/health/ai-periodization-status-card.tsx'
const BANNER = 'app/session-select/components/deload-banner.tsx'
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

/** The `PHASE_COLORS` object body, so the assertions cannot be satisfied by an unrelated class. */
function phaseColours(): Record<string, string> {
  const body = /const PHASE_COLORS: Record<string, string> = \{([\s\S]*?)\};/.exec(code(read(CARD)))?.[1]
  expect(body, 'PHASE_COLORS did not parse — these assertions would pass vacuously').toBeTruthy()
  return Object.fromEntries([...body!.matchAll(/(\w+):\s*"([^"]+)"/g)].map(m => [m[1], m[2]]))
}

describe('RV-100 — phase identity does not borrow the state colours', () => {
  it('no phase is painted green, amber, orange or red', () => {
    const colours = phaseColours()
    expect(Object.keys(colours).length, 'the five phases are not all here').toBe(5)
    for (const [phase, cls] of Object.entries(colours)) {
      expect(cls, `${phase} is painted in the state language — green reads "all good", red reads '
        + '"failure", and a phase means neither`)
        .not.toMatch(/\b(green|amber|yellow|orange|red)\b/)
    }
  })

  it('the two that were wrong are specifically not what they were', () => {
    const colours = phaseColours()
    expect(colours.realisation, 'realisation is the PEAK phase and was the failure colour')
      .not.toBe('text-red-500')
    expect(colours.deload, 'deload was green while the banner calls the same word amber or red')
      .not.toBe('text-green-500')
    expect(colours.baseline, 'baseline is genuinely the absence of a phase and stays neutral')
      .toBe('text-muted-foreground')
  })

  it('and SESSION_PALETTE is not the source, because it carries green and red itself', () => {
    // The entry suggested borrowing it. It is indexed by session POSITION and includes both
    // reserved hues, so it would have re-randomised the collision rather than ended it.
    const hues = SESSION_PALETTE.map(p => p.color)
    expect(hues).toContain('green')
    expect(hues).toContain('red')
  })

  it('the banner no longer introduces a third amber', () => {
    const src = code(read(BANNER))
    expect(src, '#fbbf24 is back — that is a third amber beside #f59e0b and --accent-amber')
      .not.toContain('#fbbf24')
    expect(src).toContain('var(--accent-amber)')
    // The red and orange literals stay: they carry the escalation and the repo has no orange
    // token, so converting one of a pair would read worse than converting neither.
    expect(src).toContain('#ef4444')
    expect(src).toContain('#f97316')
  })
})
