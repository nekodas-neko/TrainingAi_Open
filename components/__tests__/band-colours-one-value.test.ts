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
/** #3421. The Tailwind palette spelling of the same triad. `text-green-500` paints the old
 *  Tailwind-500 green, not `--accent-green`. A state picks the band, so the class is
 *  `text-accent-green` / `text-accent-amber` / `text-destructive` (theme colours in `globals.css`,
 *  so `/15` opacity and `border-` / `bg-` forms all work). A condition here is a ternary, an `&&`,
 *  a `: "…"` continuation line, or a keyed table entry (`mild: "…"`). */
const PALETTE_BAND = /\b(?:text|bg|border|ring|fill|stroke|from|to|via|divide|outline|shadow|decoration)-(?:green|emerald|amber|yellow|red|rose)-\d{2,3}\b/
const PALETTE_CONDITION = /\?|&&|\bif\s*\(|^\s*:\s|^\s*['"]?\w+['"]?\s*:\s*['"`{]/

/** Files that keep a Tailwind palette colour on a conditional line because it is identity, not a
 *  band. Each reason is the whole argument; a new entry goes through review in the diff. */
const PALETTE_IDENTITY = new Set([
  'app/admin/admin-content.tsx', // the submission-type chip: bug is red, feature is blue
  'components/exercises/add-exercise-sheet.tsx', // the secondary-muscle role chip is amber
  'components/admin/exercise-manager.tsx', // the secondary-muscle role chip and the custom-exercise chip
  'components/workout/exercise-role-labels.ts', // the secondary-muscle role chip is amber
  'components/config/program-editor-sheet.tsx', // main vs secondary role pill, brand against amber
  'components/more/friend-leaderboard.tsx', // the gold medal
  'components/more/friend-feed.tsx', // the gold trophy
  'components/health/body-cards/sleep-card.tsx', // per-metric chips: awake, efficiency, onset, HRV
  'components/workout/review/workout-review-sheet.tsx', // a dropped exercise is red, an added one blue
  'components/workout/pre-workout-screen.tsx', // the solid start button and its hover tint
  'components/workout/active-workout-screen.tsx', // the solid green action button with white text
  'components/nutrition/assign-step.tsx', // over-budget orange against green, orange has no token
  'components/nutrition/meal-type-manager.tsx', // the required-meal star
  'components/shell/local-store-dead-banner.tsx', // a solid amber banner with dark text
])

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

  it('no conditional line picks a band with a Tailwind green, amber or red class (#3421)', () => {
    const offenders: string[] = []
    for (const f of [...SCAN.flatMap(files)]) {
      if (PALETTE_IDENTITY.has(f)) continue
      stripComments(readFileSync(path.join(ROOT, f), 'utf8')).split('\n').forEach((line, i) => {
        if (PALETTE_BAND.test(line) && PALETTE_CONDITION.test(line)) offenders.push(`${f}:${i + 1} ${line.trim().slice(0, 120)}`)
      })
    }
    expect(offenders, 'a band class is text-/bg-/border-accent-green, accent-amber or destructive').toEqual([])
  })

  it('every IDENTITY entry still exists, so the list cannot rot into an allowlist', () => {
    for (const f of [...IDENTITY, ...PALETTE_IDENTITY]) expect(() => readFileSync(path.join(ROOT, f), 'utf8'), f).not.toThrow()
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
