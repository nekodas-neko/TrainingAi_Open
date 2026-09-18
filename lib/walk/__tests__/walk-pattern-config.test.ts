import { describe, it, expect } from 'vitest'
import {
  recommendWalkPattern, WALK_PATTERNS, ZONE2_GAP_MET_MIN, ZONE2_GAP_LARGE_MIN,
} from '@trainingai/shared/walking/recommend-walk-pattern'
import type { ZoneQuota } from '@trainingai/shared/health/zone-quota'
import { walkConfigForPattern, PRESCRIBED_WALK_MIN } from '@/lib/walk/walk-pattern-config'
import { buildIntervalPlan, DEFAULT_WALK_CONFIG } from '@/lib/walk/interval-plan'

// Only Zone 2 drives the selector, so the other rows just have to exist.
function quota(zone2OpenMin: number | null): ZoneQuota {
  const zones = [1, 2, 3, 4, 5].map((zoneId) => {
    const open = zoneId === 2 ? zone2OpenMin : 0
    const targetMin = open == null ? 0 : 120
    const remainingMin = open ?? 0
    return {
      zoneId: zoneId as 1 | 2 | 3 | 4 | 5,
      targetMin,
      doneMin: Math.max(0, targetMin - remainingMin),
      remainingMin,
      pctComplete: 0,
      status: targetMin === 0 ? ('not-required' as const) : remainingMin === 0 ? ('complete' as const) : ('open' as const),
    }
  })
  return { zones, trainingTargetMin: 0, trainingDoneMin: 0, trainingRemainingMin: 0 }
}

/** What the guided walk would actually run for a given open Zone-2 gap. */
function sessionFor(zone2OpenMin: number | null) {
  const { pattern } = recommendWalkPattern(quota(zone2OpenMin))
  const partial = walkConfigForPattern(pattern)
  const plan = buildIntervalPlan({ ...DEFAULT_WALK_CONFIG, ...partial, warmupSec: 0, cooldownSec: 0 })
  return { pattern, partial, plan }
}

describe('walkConfigForPattern (TN-25 wiring)', () => {
  it('gives every pattern a runnable session of about the standard length', () => {
    for (const pattern of Object.values(WALK_PATTERNS)) {
      const partial = walkConfigForPattern(pattern)
      const plan = buildIntervalPlan({ ...DEFAULT_WALK_CONFIG, ...partial, warmupSec: 0, cooldownSec: 0 })
      expect(plan.segments.length, `${pattern.id} produced no segments`).toBeGreaterThan(0)
      // Within one block of the target — `long_intervals`' 7-minute cycle cannot divide 30 exactly.
      const totalMin = plan.totalSec / 60
      expect(Math.abs(totalMin - PRESCRIBED_WALK_MIN), `${pattern.id} ran ${totalMin} min`)
        .toBeLessThanOrEqual(Math.max(pattern.fastMin + pattern.slowMin, 1) / 2)
    }
  })

  it('keeps the two continuous patterns apart, which is the only thing that distinguishes them', () => {
    // WALK_PATTERNS has them byte-identical (both 0/0) — the pacer grades a fast block and lets a
    // slow one alone, so collapsing them would turn a step-volume walk into a graded one.
    const brisk = buildIntervalPlan({ ...DEFAULT_WALK_CONFIG, ...walkConfigForPattern(WALK_PATTERNS.steady_brisk), warmupSec: 0, cooldownSec: 0 })
    const easy = buildIntervalPlan({ ...DEFAULT_WALK_CONFIG, ...walkConfigForPattern(WALK_PATTERNS.easy_steps), warmupSec: 0, cooldownSec: 0 })
    expect(brisk.segments.map(s => s.kind)).toEqual(['fast'])
    expect(easy.segments.map(s => s.kind)).toEqual(['slow'])
    expect(brisk.totalSec).toBe(PRESCRIBED_WALK_MIN * 60)
    expect(easy.totalSec).toBe(PRESCRIBED_WALK_MIN * 60)
  })

  it('prescribes intervals while Zone 2 is open and step volume once it is met', () => {
    const big = sessionFor(ZONE2_GAP_LARGE_MIN)
    expect(big.pattern).toBe(WALK_PATTERNS.long_intervals)
    expect(big.partial).toEqual({ sets: 4, fastSec: 300, slowSec: 120 })

    const moderate = sessionFor(ZONE2_GAP_LARGE_MIN - 1)
    expect(moderate.pattern).toBe(WALK_PATTERNS.short_intervals)
    // The app's existing default session, reached by prescription rather than by preset.
    expect(moderate.partial).toEqual({ sets: 5, fastSec: 180, slowSec: 180 })

    const met = sessionFor(ZONE2_GAP_MET_MIN - 1)
    expect(met.pattern).toBe(WALK_PATTERNS.easy_steps)
    expect(met.plan.segments.every(s => s.kind === 'slow')).toBe(true)
  })

  it('holds total duration fixed so the block structure is the only thing the selector moves', () => {
    // TN-25's own warning: 2026-09-09 changed block length, recovery and total at once, so nothing
    // separates their effects. A prescription that also moved duration would repeat that.
    const durations = Object.values(WALK_PATTERNS).map((p) => {
      const partial = walkConfigForPattern(p)
      return partial.sets * (partial.fastSec + partial.slowSec) / 60
    })
    for (const d of durations) expect(Math.round(d / 5) * 5).toBe(PRESCRIBED_WALK_MIN)
  })
})
