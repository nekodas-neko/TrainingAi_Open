import type { WalkPattern } from '@trainingai/shared/walking/recommend-walk-pattern'
import type { WalkConfig } from '@/lib/walk/interval-plan'

/**
 * TN-25 — turn a recommended walk PATTERN into the block structure the guided walk runs on.
 *
 * `recommendWalkPattern` deliberately returns block lengths and nothing else, so that an HR-band
 * change cannot move the prescription. That leaves two things it cannot supply: how many sets, and
 * how to express a pattern with no fast/slow alternation at all. Both are session-shape questions
 * rather than training math, which is why they are answered here rather than in the selector.
 */

/**
 * Total session length the prescription is fitted to.
 *
 * **Deliberately the length the app already uses** — `DEFAULT_WALK_CONFIG` and the Long preset are
 * both 30 minutes. TN-25's own warning is that the 2026-09-09 session moved block length, recovery
 * and total duration at once, so nothing in the record separates their effects; holding duration
 * fixed is what keeps the selector's block structure the one variable that changes.
 */
export const PRESCRIBED_WALK_MIN = 30

/**
 * The sets/fast/slow the pattern implies. Warm-up and cool-down are absent on purpose: the pattern
 * says nothing about them, so the caller's `setConfig` leaves whatever the walker already chose.
 */
export function walkConfigForPattern(pattern: WalkPattern): Pick<WalkConfig, 'sets' | 'fastSec' | 'slowSec'> {
  const cycleMin = pattern.fastMin + pattern.slowMin
  if (cycleMin <= 0) {
    // Steady brisk and Easy steps are one continuous block, and `buildIntervalPlan` drops any
    // segment of zero length — so a single set with the other half at 0 is the whole session. The
    // two patterns are identical in the table and differ only in which block it is, which is the
    // distinction that matters: the pacer grades a fast block and lets a slow one alone.
    return pattern.id === 'easy_steps'
      ? { sets: 1, fastSec: 0, slowSec: PRESCRIBED_WALK_MIN * 60 }
      : { sets: 1, fastSec: PRESCRIBED_WALK_MIN * 60, slowSec: 0 }
  }
  return {
    sets: Math.max(1, Math.round(PRESCRIBED_WALK_MIN / cycleMin)),
    fastSec: pattern.fastMin * 60,
    slowSec: pattern.slowMin * 60,
  }
}
