import { describe, it, expect } from 'vitest'
import { intensityZone, secondaryIntensityZone, intensityZoneForRole } from '../prompt'
import { clampPrescribedPct } from '../autoregulation'
import { goalRange, accessoryTargetRpe } from '../goal-ranges'
import { expectedRpe, pctForExpectedRpe } from '../expected-rpe'
import type { PeriodizationPhase } from '@trainingai/shared/types/ai-periodization'

describe('secondary compound moderation (powerbuilding)', () => {
  it('secondaryIntensityZone shifts a primary phase band down and reps up', () => {
    const primary = intensityZone('powerbuilding', 'accumulation') // 72.5–80%, 6–8 reps
    const secondary = secondaryIntensityZone(primary)
    expect(secondary.pctMax).toBe(primary.pctMax - 7.5) // 72.5
    expect(secondary.pctMin).toBe(primary.pctMin - 7.5) // 65
    expect(secondary.repMin).toBe(primary.repMin + 2)   // 8
  })

  it('a heavy AI pick for a secondary is clamped into the moderate band', () => {
    const zone = intensityZoneForRole('powerbuilding', 'accumulation', 'secondary')
    // The model asks for 80% (primary-heavy); the clamp pulls it to the secondary ceiling.
    expect(clampPrescribedPct(80, zone)).toBeLessThanOrEqual(72.5)
    // A primary in the same session keeps the heavy zone.
    expect(clampPrescribedPct(80, intensityZoneForRole('powerbuilding', 'accumulation', 'primary'))).toBe(80)
  })

  it('the secondary band still climbs with the phase (accumulation < intensification < realisation)', () => {
    const acc = intensityZoneForRole('powerbuilding', 'accumulation', 'secondary')
    const inten = intensityZoneForRole('powerbuilding', 'intensification', 'secondary')
    const real = intensityZoneForRole('powerbuilding', 'realisation', 'secondary')
    expect(inten.pctMax).toBeGreaterThan(acc.pctMax)
    expect(real.pctMax).toBeGreaterThan(inten.pctMax)
    // …but every secondary band stays below its own phase's primary band.
    expect(inten.pctMax).toBeLessThan(intensityZone('powerbuilding', 'intensification').pctMax)
  })

  it('only powerbuilding moderates secondaries — strength keeps them heavy', () => {
    const pbPrimary = intensityZoneForRole('powerbuilding', 'accumulation', 'primary')
    const pbSecondary = intensityZoneForRole('powerbuilding', 'accumulation', 'secondary')
    expect(pbSecondary.pctMax).toBeLessThan(pbPrimary.pctMax)

    const strPrimary = intensityZoneForRole('strength', 'accumulation', 'primary')
    const strSecondary = intensityZoneForRole('strength', 'accumulation', 'secondary')
    expect(strSecondary).toEqual(strPrimary) // unchanged
  })

  it('goalRange gives powerbuilding secondary a moderate band (lighter than primary, heavier than accessory)', () => {
    const primary = goalRange('powerbuilding', 'primary')
    const secondary = goalRange('powerbuilding', 'secondary')
    const accessory = goalRange('powerbuilding', 'accessory')
    expect(secondary.pctMax).toBeLessThan(primary.pctMax)
    expect(secondary.repMin).toBeGreaterThan(primary.repMin)
    expect(secondary.pctMax).toBeGreaterThan(accessory.pctMax)
    // Strength secondary is unchanged (== its compound band).
    expect(goalRange('strength', 'secondary')).toEqual(goalRange('strength', 'primary'))
  })
})

describe('secondary compound effort floor (owner steer 2026-07-20)', () => {
  // Mirrors the `role === 'secondary'` branch of
  // app/api/ai-periodization/session/[sessionId]/prescribe/route.ts: a secondary compound is
  // floored at the accessory target effort (never lighter than an accessory) and capped at the
  // primary zone's ceiling so it climbs toward but never out-loads the heavy anchor.
  const secondaryPct = (goal: string, phase: PeriodizationPhase, aiPct: number, reps: number): number => {
    const exZone = intensityZoneForRole(goal, phase, 'secondary')
    const primaryZone = intensityZoneForRole(goal, phase, 'primary')
    const mainEffortCeil = expectedRpe(primaryZone.pctMax, primaryZone.repMin)
    const secondaryTargetRpe = Math.min(accessoryTargetRpe(goal), mainEffortCeil)
    const effortPct = pctForExpectedRpe(secondaryTargetRpe, reps)
    const primaryCeil = primaryZone.pctMax ?? 85
    return Math.min(primaryCeil, Math.max(clampPrescribedPct(aiPct, exZone), effortPct))
  }

  it('lifts a light AI pick to at least the accessory effort — the bent-over-row RPE-6 bug', () => {
    // Before: band-clamp only left the model's 68% pick untouched → expected RPE ~6 ("Light").
    expect(clampPrescribedPct(68, intensityZoneForRole('powerbuilding', 'accumulation', 'secondary'))).toBe(68)
    expect(Math.round(expectedRpe(68, 9))).toBe(6)
    // After: floored to the accessory target effort → a real working set, never lighter than an accessory.
    const pct = secondaryPct('powerbuilding', 'accumulation', 68, 9)
    expect(pct).toBeGreaterThanOrEqual(pctForExpectedRpe(accessoryTargetRpe('powerbuilding'), 9))
    expect(expectedRpe(pct, 9)).toBeGreaterThanOrEqual(7.5)
  })

  it('never out-loads the primary anchor even at low reps', () => {
    const primaryCeil = intensityZoneForRole('powerbuilding', 'accumulation', 'primary').pctMax!
    expect(secondaryPct('powerbuilding', 'accumulation', 60, 3)).toBeLessThanOrEqual(primaryCeil)
  })

  it('never out-EFFORTS the main in a phase whose primary runs light (strength/power accumulation)', () => {
    // Strength accumulation deliberately keeps the main submaximal (70–77.5% / 5–8, ~RPE 6) to
    // accumulate volume. The goal-agnostic accessory floor is RPE 8 — flooring a secondary there
    // would push it ABOVE the main. The cap at the main's phase effort ceiling prevents that.
    for (const goal of ['strength', 'power'] as const) {
      const primaryZone = intensityZoneForRole(goal, 'accumulation', 'primary')
      const mainCeilRpe = expectedRpe(primaryZone.pctMax, primaryZone.repMin)
      // Feed a light AI pick + the secondary's own rep target; the secondary must not out-effort the main.
      const reps = primaryZone.repMin
      const pct = secondaryPct(goal, 'accumulation', 55, reps)
      expect(expectedRpe(pct, reps)).toBeLessThanOrEqual(mainCeilRpe + 0.05)
    }
  })

  it('powerbuilding keeps its RPE-8 secondary floor (the cap only bites when the main is lighter)', () => {
    // Powerbuilding accumulation main tops out near RPE 8, so min(accessoryRpe, mainCeil) stays at
    // the accessory target — the bent-over-row fix above is unaffected by the cap.
    const pct = secondaryPct('powerbuilding', 'accumulation', 68, 9)
    expect(expectedRpe(pct, 9)).toBeGreaterThanOrEqual(7.5)
  })
})
