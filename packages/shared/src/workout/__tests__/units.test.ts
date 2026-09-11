// BF-141 — the lb↔kg constant, moved out of `lib/data/postgres/adapter.ts` so the toggle that stops
// pounds reaching the weight_kg column can use the same number the 2026-06-15 repair tool used.
//
// The repair tool exists because this already happened: Dumbbell Lateral Raise, Preacher Curl and
// Shoulder Press were logged in pounds and recorded as kilograms, inflating 1RM, target80, volume
// and the all-time PR. A second copy of the constant is how that class starts again.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { LBS_TO_KG, lbsToKg, kgToLbs } from '../units'

describe('BF-141 — one lb↔kg constant', () => {
  it('is the exact international definition', () => {
    // Defined, not measured: the international pound has been exactly 0.45359237 kg since 1959.
    expect(LBS_TO_KG).toBe(0.45359237)
  })

  it('converts the repair tool\'s own worked example', () => {
    // The tool's documented case: a "20 kg" Lateral Raise set that was really 20 lb → 9 kg.
    expect(lbsToKg(20)).toBeCloseTo(9.0718, 4)
  })

  it('round-trips', () => {
    for (const lbs of [2.5, 5, 10, 20, 45, 100]) {
      expect(kgToLbs(lbsToKg(lbs))).toBeCloseTo(lbs, 10)
    }
  })

  // The hazard the entry flags: a converted value must not be snapped back onto the kg dial grid.
  it('does NOT round — the caller decides, because the dial grid would ruin it', () => {
    // 5 lb is 2.27 kg. `mround125` clamps to [5, 250], so rounding here would floor it to 5 kg and
    // silently more than double the weight — reinstating the exact inaccuracy the toggle removes.
    const fiveLb = lbsToKg(5)
    expect(fiveLb).toBeLessThan(5)
    expect(fiveLb).toBeCloseTo(2.268, 3)
  })

  it('a 20 lb dumbbell is not on the 1.25 kg grid, which is the point', () => {
    const kg = lbsToKg(20)
    // The dial steps 1.25 kg for non-barbell equipment; 9.07 sits between 8.75 and 10.00.
    expect(Math.abs(kg / 1.25 - Math.round(kg / 1.25))).toBeGreaterThan(0.01)
  })

  // One Formula, One Place: the adapter must import rather than redeclare.
  it('the adapter imports it rather than keeping its own copy', () => {
    const src = readFileSync('lib/data/postgres/adapter.ts', 'utf8')
    expect(src).toContain("from '@trainingai/shared/workout/units'")
    expect(src).not.toMatch(/const LBS_TO_KG\s*=/)
  })

  // What must not recur is a second DECLARATION. A bare mention is not one: the adapter's comment
  // still names the value while importing it, and this file asserts it — both correct. Matching raw
  // text would have failed on exactly those two, which is the comment-vs-code trap this repo keeps
  // paying for (the same shape bit LA-101's and RV-41's source guards on the same day).
  it('no second declaration of the constant exists', () => {
    const files = execSync(
      "grep -rl '0\\.45359237' --include='*.ts' --include='*.tsx' lib app components packages || true",
      { encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean)

    const declarations = files.filter(f => {
      if (f === 'packages/shared/src/workout/units.ts') return false   // the one home
      const code = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
      return /(?:const|let|var)\s+\w+\s*[:=][^\n]*0\.45359237/.test(code)
    })
    expect(declarations).toEqual([])
  })
})
