import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** RV-101, as reshaped by #2554. The heatmap paints two scales into one silhouette: a categorical
 *  role scale (primary / secondary / injured) and a volume scale, chosen by which prop the caller
 *  passed.
 *
 *  The original defect was in the volume half: the bottom two ramp stops sat under the 3:1
 *  non-text floor against the muscle's untouched fill (1.65:1 and 2.11:1), and the ramp had no key
 *  while its middle stop was the very green the role scale uses for "primary mover". #2554 retired
 *  the ramp altogether — the patches are the bars' own green / amber / red tokens, from one shared
 *  rule — but both halves of the old rule still hold: every patch colour must clear the floor
 *  against an untrained muscle, and the scale must say what it means.
 *
 *  `scripts/check-contrast.js` enforces the numbers. This file is the half a script cannot be: it
 *  states the rule independently, so loosening the script does not silently erase it. */

const ROOT = path.resolve(__dirname, '../..')
const SRC = readFileSync(path.join(ROOT, 'components/muscle-heatmap.tsx'), 'utf8')

describe('RV-101 — the volume colours are readable, and say what they mean', () => {
  it('the green ramp is gone: the map has no scale of its own to drift from the bars', () => {
    expect(SRC).not.toMatch(/VOLUME_TINT_STEPS/)
    expect(SRC, 'the map must take its colour from the shared rule').toMatch(/muscleVolumeColor/)
  })

  it('the key renders in compact mode, which is the only mode the volume caller uses', () => {
    // The volume caller passes `compact` (weekly-muscle-sets-card), so a key gated on `!compact` —
    // as the injured swatch above it is — would be hidden exactly where it is needed.
    const key = /\{hasActivity && usingVolumes && \(([\s\S]*?)\n {6}\)\}/.exec(SRC)?.[1]
    expect(key, 'the volume key block was not found').toBeTruthy()
    expect(key).not.toMatch(/!compact/)
    expect(key).toMatch(/Under 60%/)
    expect(key).toMatch(/60–99%/)
    expect(key).toMatch(/At target/)
    expect(key).toMatch(/Not trained/)
  })

  it('the volume call site really does pass compact, which is what makes that gate matter', () => {
    // If a caller stopped passing it the assertion above would still pass while guarding nothing.
    for (const f of ['components/health/weekly-muscle-sets-card.tsx']) {
      const call = /<MuscleHeatmap[^>]*volumes=[^>]*>/.exec(readFileSync(path.join(ROOT, f), 'utf8').replace(/\n\s*/g, ' '))?.[0]
      expect(call, `${f} no longer has a volumes call site`).toBeTruthy()
      expect(call, `${f} stopped passing compact`).toMatch(/\bcompact\b/)
    }
  })

  it('the script still passes, and says how many colours it actually measured', () => {
    // Guards the vacuous case: if its regex stops matching, the script exits 1, but a silently
    // reduced count would leave it green while measuring less than the whole rule.
    const out = execFileSync('node', ['scripts/check-contrast.js'], { cwd: ROOT, encoding: 'utf8' })
    expect(out).toMatch(/all 3 volume-band colours clear 3:1 against an untouched muscle in both themes/)
  })
})
