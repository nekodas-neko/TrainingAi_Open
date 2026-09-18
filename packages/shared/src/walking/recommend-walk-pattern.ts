import type { ZoneQuota } from '@trainingai/shared/health/zone-quota'

/**
 * TN-25 — which block structure today's guided walk should use.
 *
 * The owner asked for the fast/slow pattern to be **varied and assigned** rather than chosen by
 * them: *"I'd like the fast/slow rates to be varying and assigned to me… If we need more zone 2
 * maybe it's more fast? If we have zone 2 done maybe it's just light interval for steps."* That is a
 * description of `recommendRunType`, which already does exactly this for runs — so this extends an
 * existing deterministic selector to walks rather than inventing a prescription engine.
 *
 * **This module picks a PATTERN, never an HR band**, and the separation is deliberate — the same one
 * `recommendRunType` keeps, whose own comment calls its zone map "not a target". TN-25's
 * *"the band, not the fraction: target 105–118 bpm directly, do not re-derive it as a fraction of
 * reserve"* applies to the code that sets the pacer's targets, not here. Mixing them is how an
 * anchor change (TN-30) would silently move the walk.
 *
 * **⚠ An LLM must never choose the pattern.** `recommendRunType` is deliberately deterministic and
 * says why; the same rule holds here. A model picking today's session is a self-reported number
 * gating an automatic action, which the AI defaults forbid.
 */

export type WalkPatternId = 'steady_brisk' | 'long_intervals' | 'short_intervals' | 'easy_steps'

export interface WalkPattern {
  id: WalkPatternId
  label: string
  /** Minutes in the faster block; 0 for a pattern with no fast phase. */
  fastMin: number
  /** Minutes in the recovery block; 0 for a single continuous block. */
  slowMin: number
}

/**
 * The four patterns, from TN-25's owner-approved table.
 *
 * **⛔ Do not claim one is best.** The 2026-09-09 session changed block length (3→5 min), recovery
 * (3→2) and total duration (30→35) at once, so nothing in the record separates their effects. The
 * table is fine to ship; a claim about which pattern works is not — let the selector run and measure.
 */
export const WALK_PATTERNS: Record<WalkPatternId, WalkPattern> = {
  steady_brisk:    { id: 'steady_brisk',    label: 'Steady brisk',   fastMin: 0, slowMin: 0 },
  long_intervals:  { id: 'long_intervals',  label: 'Long intervals', fastMin: 5, slowMin: 2 },
  short_intervals: { id: 'short_intervals', label: 'Short intervals', fastMin: 3, slowMin: 3 },
  easy_steps:      { id: 'easy_steps',      label: 'Easy steps walk', fastMin: 0, slowMin: 0 },
}

/** Below this many open Zone-2 minutes the week's aerobic base is effectively done, and the walk
 *  becomes step volume rather than stimulus. Chosen as one short walk's worth of Zone 2 — under
 *  that, another interval session cannot close the gap anyway. */
export const ZONE2_GAP_MET_MIN = 15
/** Above this, the gap is large enough to be worth the longest work blocks. */
export const ZONE2_GAP_LARGE_MIN = 45

export interface WalkPatternRecommendation {
  pattern: WalkPattern
  reason: string
}

/**
 * Deterministically pick today's walk pattern from the week's open Zone-2 gap.
 *
 * Zone 2 alone drives it, and that is the point rather than a simplification: a walk is the session
 * this owner cannot push past Zone 2 in — measured, 0 of 44 fast blocks reached the old Zone-3
 * target — so grading it against the higher zones would recommend work the mode cannot deliver.
 * Zones 3+ are what `recommendRunType` is for.
 *
 * `hadHardDayYesterday` steps one pattern down: the shorter work blocks are the returning-from-hard
 * case in TN-25's table. It never overrides a met quota — if Zone 2 is done, the answer is the easy
 * walk either way.
 */
export function recommendWalkPattern(
  quota: ZoneQuota,
  opts?: { hadHardDayYesterday?: boolean; shortOnTime?: boolean },
): WalkPatternRecommendation {
  const zone2 = quota.zones.find(z => z.zoneId === 2) ?? null
  // No Zone-2 target at all means nothing to aim the walk at; treat it as met rather than inventing
  // a gap, so the selector degrades to step volume instead of prescribing intervals off no data.
  const openMin = zone2 != null && zone2.status === 'open' ? zone2.remainingMin : 0

  // RV-60 — "no target" is a row with `status: 'not-required'`, not a MISSING row. `computeZoneQuota`
  // emits one zone per target and sets that status when `targetMin === 0`
  // (`health/zone-quota.ts`), and `zone-quota.test.ts` pins the distinction deliberately: "marks a
  // zero-target zone as not-required, not complete". Testing `zone2 == null` therefore never fired
  // against real data, and a user with no target was told their target was DONE — which is the one
  // thing these two strings exist to tell apart.
  const noTarget = zone2 == null || zone2.status === 'not-required'

  if (openMin < ZONE2_GAP_MET_MIN) {
    return {
      pattern: WALK_PATTERNS.easy_steps,
      reason: noTarget
        ? 'No Zone 2 target set this week — walking for steps'
        : 'Zone 2 is done for the week — walking for steps',
    }
  }

  const large = openMin >= ZONE2_GAP_LARGE_MIN
  if (large && opts?.shortOnTime) {
    return {
      pattern: WALK_PATTERNS.steady_brisk,
      reason: `${Math.round(openMin)} min of Zone 2 still open — one continuous block`,
    }
  }
  const pattern = large && !opts?.hadHardDayYesterday
    ? WALK_PATTERNS.long_intervals
    : WALK_PATTERNS.short_intervals

  const why = opts?.hadHardDayYesterday && large ? ' (shorter blocks after yesterday)' : ''
  return {
    pattern,
    reason: `${Math.round(openMin)} min of Zone 2 still open${why}`,
  }
}
