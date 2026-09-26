import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { stripComments } from '../../../scripts/lib/strip-comments.js'

const ROOT = path.resolve(__dirname, '../../..')
const src = (rel: string) => stripComments(readFileSync(path.join(ROOT, rel), 'utf8'))

/**
 * LB-162 — the three `width` bars RV-207 could not convert, and what each needed.
 *
 * There is no DOM project in this suite, so these are source assertions. Each pins the reason the
 * bar was left behind, because that is what a later reader would otherwise undo.
 */
describe('LB-162 — ProgressFill grew the two props the last three bars needed', () => {
  const fill = src('components/ui/progress-fill.tsx')

  it('takes the growth origin as a PROP, not through className', () => {
    // Both spellings are `transform-origin` utilities of equal specificity, so a caller passing
    // `origin-right` through `className` would win or lose on Tailwind's emit order rather than
    // on the call site. That is why it is a prop.
    expect(fill).toMatch(/origin\?: "left" \| "right"/)
    expect(fill).toMatch(/origin === "right" \? "origin-right" : "origin-left"/)
    expect(fill).not.toMatch(/"h-full w-full origin-left/)
  })

  it('carries an optional boxShadow, and only when given one', () => {
    expect(fill).toMatch(/boxShadow\?: string/)
    expect(fill).toMatch(/\.\.\.\(boxShadow \? \{ boxShadow \} : \{\}\)/)
  })
})

describe('LB-162 — each converted bar keeps what made it awkward', () => {
  it("body-battery grows from the right, because its tank empties from the left", () => {
    const s = src('components/body-battery-card.tsx')
    expect(s).toMatch(/<ProgressFill[^>]*origin="right"/)
    expect(s).not.toMatch(/width: `\$\{battery\.current\}%`/)
  })

  it('warmup keeps its gradient and its glow', () => {
    const s = src('components/workout/warmup-screen.tsx')
    expect(s).toMatch(/<ProgressFill/)
    expect(s).toMatch(/linear-gradient\(90deg, var\(--color-brand\)/)
    expect(s).toMatch(/boxShadow=\{warmupDone/)
    // The old bar ticked once a second under `width 1s linear`; both halves have to survive.
    expect(s).toMatch(/durationMs=\{1000\}/)
    expect(s).toMatch(/ease-linear/)
    expect(s).not.toMatch(/transition: "width 1s linear"/)
  })

  it('muscle-sets clips the FILL without clipping its target markers', () => {
    const s = src('components/health/weekly-muscle-sets-card.tsx')
    // The track stays overflow-visible so the two h-3 markers can escape an h-2 track; the clip
    // moves to a wrapper around the fill alone. Losing either half is a visible regression —
    // an oval fill, or vanished markers.
    expect(s).toMatch(/relative h-2 rounded-full bg-muted overflow-visible/)
    expect(s).toMatch(/absolute inset-0 rounded-full overflow-hidden/)
    expect(s).toMatch(/<ProgressFill pct=\{barPct\}/)
    expect(s).toMatch(/w-0\.5 h-3/)
  })
})
