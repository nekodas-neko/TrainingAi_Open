import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** RV-74. The hero's number eased over 600 ms while its arc snapped: `useCountUp` animates the digits
 *  with `1 - (1-t)^3`, and the `<circle>` set `strokeDashoffset` inline with no transition, so the
 *  ring was parked at its final position while the number was still counting.
 *
 *  The curve is the part worth pinning. The entry proposed `cubic-bezier(0.05,0.7,0.1,1)`, which is a
 *  DIFFERENT curve — at the halfway mark it sits at 0.762 where the count-up is at 0.875, so the ring
 *  would trail the digits by eleven points of progress and still read as two gestures.
 *  `cubic-bezier(0.333, 1, 0.667, 1)` is the exact CSS form of that cubic ease-out, which this file
 *  re-derives rather than asserting on faith. */

const ROOT = path.resolve(__dirname, '../../..')
const CSS = readFileSync(path.join(ROOT, 'app/globals.css'), 'utf8')

const bez = (p1: number, p2: number, t: number) =>
  3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3

describe('RV-74 — the score ring shares the count-up’s curve, not just its duration', () => {
  it('the ring transitions, and at the duration useCountUp actually uses', () => {
    const rule = /\.score-ring\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? ''
    expect(rule, 'the .score-ring rule is gone').toMatch(/stroke-dashoffset/)
    const hook = readFileSync(path.join(ROOT, 'lib/hooks/use-count-up.ts'), 'utf8')
    const durationMs = /durationMs\s*=\s*(\d+)/.exec(hook)?.[1]
    expect(durationMs, 'could not read the count-up duration').toBeTruthy()
    expect(rule, `the ring must share the count-up's ${durationMs}ms`).toContain(`${durationMs}ms`)
  })

  it('the declared bezier IS the count-up’s easing, derived not assumed', () => {
    const m = /\.score-ring\s*\{[^}]*cubic-bezier\(([^)]+)\)/.exec(CSS)
    expect(m, 'no cubic-bezier on .score-ring').toBeTruthy()
    const [x1, y1, x2, y2] = m![1].split(',').map(v => Number(v.trim()))
    // x(t) must be linear, or the curve is not a pure function of elapsed time.
    // y(t) must equal the hook's `1 - (1-t)**3`.
    let maxX = 0, maxY = 0
    for (let i = 0; i <= 500; i++) {
      const t = i / 500
      maxX = Math.max(maxX, Math.abs(bez(x1, x2, t) - t))
      maxY = Math.max(maxY, Math.abs(bez(y1, y2, t) - (1 - (1 - t) ** 3)))
    }
    expect(maxX, 'x(t) is not linear — the ring would not track elapsed time').toBeLessThan(2e-3)
    expect(maxY, 'y(t) is not the count-up easing — ring and number would decelerate differently')
      .toBeLessThan(2e-3)
  })

  it('reduced motion kills it, beside the other stroke-dashoffset class', () => {
    const block = CSS.slice(CSS.indexOf('prefers-reduced-motion'))
    const upTo = block.slice(0, block.indexOf('\n}'))
    expect(upTo).toMatch(/\.score-ring\s*\{[^}]*transition:\s*none/)
    // `.border-run` is the precedent this follows; if it left the block, re-read the convention.
    expect(upTo).toMatch(/\.border-run/)
  })

  it('the circle actually carries the class', () => {
    const src = readFileSync(path.join(ROOT, 'components/health/health-score-detail.tsx'), 'utf8')
    const circle = /<circle[^>]*strokeDashoffset[^>]*>/.exec(src)?.[0]
      ?? /<circle[^>]*className="score-ring"[\s\S]*?\/>/.exec(src)?.[0] ?? ''
    expect(circle, 'the progress circle lost the class').toMatch(/score-ring/)
  })
})
