import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** RV-101. The heatmap paints two scales into one silhouette: a categorical role scale
 *  (primary / secondary / injured) and a sequential volume ramp, chosen by which prop the caller
 *  passed. Two things were wrong with the ramp half.
 *
 *  The bottom two stops sat under the 3:1 non-text floor — and against the wrong background in the
 *  original finding. The neighbour an untouched muscle presents is `defaultFill` composited over
 *  `--card`, not `--card`; measured there the stops were 1.65:1 and 2.11:1 rather than the 2.04 and
 *  2.60 first reported, so the defect was worse than filed.
 *
 *  And the ramp had no key at all, while its middle stop is the very colour the role scale uses for
 *  "primary mover". `scripts/check-contrast.js` enforces the numbers. This file is the half a script
 *  cannot be: it states the rule independently, so loosening the script does not silently erase it. */

const ROOT = path.resolve(__dirname, '../..')
const SRC = readFileSync(path.join(ROOT, 'components/muscle-heatmap.tsx'), 'utf8')

describe('RV-101 — the volume ramp is readable, and says what it means', () => {
  it('no ramp stop is one of the two that could not be told from an untouched muscle', () => {
    // Stated as the specific failing values rather than "run the script", so this survives the
    // script being edited. green-900 measured 1.65:1 and green-800 2.11:1 against the default fill.
    const ramp = /const VOLUME_TINT_STEPS = \[([^\]]*)\]/.exec(SRC)?.[1] ?? ''
    const stops = [...ramp.matchAll(/"(#[0-9a-fA-F]{6})"/g)].map(m => m[1].toLowerCase())
    expect(stops.length, 'the ramp did not parse — this test would pass vacuously').toBe(5)
    expect(stops).not.toContain('#14532d')
    expect(stops).not.toContain('#166534')
  })

  it('the key renders in compact mode, which is the only mode the volume callers use', () => {
    // Both volume callers pass `compact` (body-muscle-card, weekly-muscle-sets-card), so a key
    // gated on `!compact` — as the injured swatch above it is — would be hidden exactly where it
    // is needed. That was the trap the 2026-09-24 re-read of the entry caught.
    const key = /\{hasActivity && usingVolumes && \(([\s\S]*?)\n {6}\)\}/.exec(SRC)?.[1]
    expect(key, 'the volume key block was not found').toBeTruthy()
    expect(key).not.toMatch(/!compact/)
    expect(key).toMatch(/Under 20%/)
    expect(key).toMatch(/At target/)
  })

  it('both volume call sites really do pass compact, which is what makes that gate matter', () => {
    // If a caller stopped passing it the assertion above would still pass while guarding nothing.
    for (const f of ['components/health/body-muscle-card.tsx', 'components/health/weekly-muscle-sets-card.tsx']) {
      const call = /<MuscleHeatmap[^>]*volumes=[^>]*>/.exec(readFileSync(path.join(ROOT, f), 'utf8'))?.[0]
      expect(call, `${f} no longer has a volumes call site`).toBeTruthy()
      expect(call, `${f} stopped passing compact`).toMatch(/\bcompact\b/)
    }
  })

  it('the script still passes, and says how many stops it actually measured', () => {
    // Guards the vacuous case: if its regex stops matching the component the script exits 1, but a
    // silently reduced count would leave it green while measuring less than the whole ramp.
    const out = execFileSync('node', ['scripts/check-contrast.js'], { cwd: ROOT, encoding: 'utf8' })
    expect(out).toMatch(/all 5 volume-ramp stops clear 3:1 against an untouched muscle/)
  })
})
