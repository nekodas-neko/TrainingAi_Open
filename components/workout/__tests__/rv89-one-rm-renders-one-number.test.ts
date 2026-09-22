import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { displayOneRm } from '@trainingai/shared/1rm'

/** RV-89. One stored 1RM rendered four different numbers in a single session. For a stored 92.25:
 *  the ready screen said 92.5 kg (`mround125`, a PRESCRIPTION rounder — the one that told the owner
 *  to load 82.5 kg onto a pull-up in BF-127), the pre-workout list said ~92kg, the stats sheet and
 *  the Strength Trend card said 92.3 kg, and the exercise summary said 92.25 kg.
 *
 *  Four of the five files already imported `displayOneRm` and called it for the BODYWEIGHT branch
 *  of the same ternary, hand-rolling the weighted branch beside it — so the fix is to delete the
 *  hand-rolls, and this pins them out. The identifier list is explicit rather than a `/rm/i` sweep,
 *  because a 1RM DELTA is a different quantity with its own helper and its own precision.
 *
 *  **What this cannot see, stated rather than implied:** run against the unfixed files, five of the
 *  seven cases below go red. `exercise-summary-screen` stays green, because its hand-roll was a bare
 *  template literal with no rounding call in it — numerically the one site that was already right,
 *  since the stored value is on the 0.25 grid. Routing it through the helper is robustness against
 *  an off-grid value, not a fix, and only the import assertion holds it. */

const ROOT = path.resolve(__dirname, '../../..')

/** The five surfaces RV-89 names. `strength-trend-card` carries three of the sites, not one. */
const SURFACES = [
  'components/workout/active-workout-screen.tsx',
  'components/workout/pre-workout-screen.tsx',
  'components/workout/exercise-summary-screen.tsx',
  'components/workout/exercise-stats-sheet.tsx',
  'components/health/strength-trend-card.tsx',
]

/** Stored-1RM identifiers only. `rmDiff` is deliberately absent: it is a CHANGE between two stored
 *  1RMs, which `displayOneRmDelta` renders at its own precision, and rounding it is not this bug. */
const ONE_RM = ['estimated1rm', 'prevEst1rm', 'newEst1rm', 'allTime1rm', 'currentRm', 'peakRm', 'projectedRm']

const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

describe('RV-89 — a stored 1RM is rendered by the shared helper, never rounded at the call site', () => {
  for (const file of SURFACES) {
    it(`${file} hand-rolls no 1RM rounding`, () => {
      const src = code(readFileSync(path.join(ROOT, file), 'utf8'))
      for (const id of ONE_RM) {
        expect(src, `${id}.toFixed(…) — a second precision for a number the helper already formats`)
          .not.toMatch(new RegExp(`\\b${id}\\b[^\\n]{0,40}\\.toFixed\\(`))
        expect(src, `Math.round(${id}) — the pre-workout "~92kg" shape`)
          .not.toMatch(new RegExp(`Math\\.round\\(\\s*[\\w.?]*\\b${id}\\b`))
        expect(src, `mround125(${id}) — a PRESCRIPTION rounder on a DISPLAY value (BF-127)`)
          .not.toMatch(new RegExp(`mround125\\(\\s*[\\w.?]*\\b${id}\\b\\s*\\)`))
      }
    })
  }

  it('every surface imports the shared helper', () => {
    for (const file of SURFACES) {
      expect(code(readFileSync(path.join(ROOT, file), 'utf8')), file)
        .toMatch(/import\s*\{[^}]*\bdisplayOneRm\b[^}]*\}\s*from\s*["']@trainingai\/shared\/1rm["']/)
    }
  })

  it('and the helper itself gives one answer for the value the entry measured', () => {
    // 92.25 is what the stored 0.25 grid actually holds; every surface above now prints this string.
    expect(displayOneRm(92.25, 'weighted').text).toBe('92.25 kg')
    // Not 92.5 (the plate grid), not 92.3 (toFixed(1)), not 92 (Math.round).
    expect(displayOneRm(92.25, 'weighted').value).toBe(92.25)
  })
})
