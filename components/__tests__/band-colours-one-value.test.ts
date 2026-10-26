import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { stripComments } from '../../scripts/lib/strip-comments.js'
import { BAND_COLOR } from '@trainingai/shared/health/score-band'
import { acwrBand } from '@trainingai/shared/ai-periodization/acwr'
import { balanceZone } from '@trainingai/shared/nutrition/calorie-balance'
import { TREND_COLOR } from '@trainingai/shared/health/strength-progress'

/** #2148. A band is a good / warning / bad reading, and the app has one value for each:
 *  `--accent-green`, `--accent-amber`, `--destructive`. Around 180 copies of the old Tailwind-500
 *  hex triad meant the same state read as two greens side by side (`rgb(34,197,94)` against the
 *  token's `rgb(86,238,102)` in dark). The bands now read the token, so this fails a line that
 *  picks one of the three by a condition with a hex or rgb spelling of it.
 *
 *  What it deliberately leaves alone is what the issue named as not-a-band: an identity colour (a
 *  card that is green because it is the Steps card, the heart-rate red), a ramp that runs through
 *  the triad on purpose (`hr-zones.ts`, the UV chip, the RPE strip, the calibration card), and
 *  canvas paint, which cannot resolve `var()`. Those are the files in IDENTITY below. A new file
 *  that needs one goes in the list, in the diff, where a reviewer reads it. */

const ROOT = path.resolve(__dirname, '../..')
const SCAN = ['app', 'components', 'lib', 'packages/shared/src']
const TRIAD = /#22c55e|#eab308|#ef4444|#f59e0b|#f87171|rgba?\(\s*(?:34\s*,\s*197\s*,\s*94|234\s*,\s*179\s*,\s*8|239\s*,\s*68\s*,\s*68|245\s*,\s*158\s*,\s*11)\s*[,)]/i
/** A ternary, an `if`, or a keyed state table on the same line is what separates a band from a tint. */
const CONDITION = /\?|\bif\s*\(|\bup:|\bdown:|\bgood:|\bbad:|\bwarn:/

const IDENTITY = new Set([
  'components/admin/calibration-card.tsx', // a deliberate five-step rating ramp
  'components/weather-chip.tsx', // the UV ramp
  'components/workout/rpe-strip.tsx', // the RPE ramp
  'components/workout/done-screen.tsx', // confetti paint
  'components/workout-builder/goal-spectrum.tsx', // a goal spectrum gradient
  'components/profile/achievements-grid.tsx', // per-category identity colours
  'components/activity/activity-route-map.tsx', // map markers, canvas paint
  'components/health/body-cards/rhr-hrv-spo2-card.tsx', // per-metric identity colours
  'app/health/day/day-detail-content.tsx', // the heart-rate cell's identity red
  'components/health/sleep-timing-trend-card.tsx', // the wake-time line, drawn on a canvas
  'packages/shared/src/health/hr-zones.ts', // the deliberate blue → red ramp
  'packages/shared/src/rarity-colors.ts', // identity
  'packages/shared/src/nutrition/macro-colors.ts', // protein's identity colour
  'packages/shared/src/types/day-checkin.ts', // per-scale identity colours
  'lib/home/home-prefs.ts', // per-metric identity colours
])

function files(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) return ['node_modules', '__tests__', '__check_fixture__'].includes(e.name) ? [] : files(rel)
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [rel] : []
  })
}

describe('#2148 — a band has one value', () => {
  it('no line picks the green, amber or red of a band with a hex or rgb literal', () => {
    const all = SCAN.flatMap(files)
    expect(all.length).toBeGreaterThan(500)
    const offenders: string[] = []
    for (const f of all) {
      if (IDENTITY.has(f)) continue
      stripComments(readFileSync(path.join(ROOT, f), 'utf8')).split('\n').forEach((line, i) => {
        if (TRIAD.test(line) && CONDITION.test(line)) offenders.push(`${f}:${i + 1} ${line.trim().slice(0, 120)}`)
      })
    }
    expect(offenders, 'a band colour is BAND_COLOR / var(--accent-green) / --accent-amber / --destructive').toEqual([])
  })

  it('every IDENTITY entry still exists, so the list cannot rot into an allowlist', () => {
    for (const f of IDENTITY) expect(() => readFileSync(path.join(ROOT, f), 'utf8'), f).not.toThrow()
  })

  it('the shared band modules return the three tokens', () => {
    expect(BAND_COLOR).toEqual({ good: 'var(--accent-green)', warning: 'var(--accent-amber)', bad: 'var(--destructive)' })
    expect(acwrBand(1).color).toBe(BAND_COLOR.good)
    expect(acwrBand(1.4).color).toBe(BAND_COLOR.warning)
    expect(acwrBand(2).color).toBe(BAND_COLOR.bad)
    expect(balanceZone(0).color).toBe(BAND_COLOR.good)
    expect(balanceZone(-1000).color).toBe(BAND_COLOR.bad)
    expect(balanceZone(1000).color).toBe(BAND_COLOR.bad)
    expect(TREND_COLOR).toEqual({ up: BAND_COLOR.good, down: BAND_COLOR.bad })
  })
})
