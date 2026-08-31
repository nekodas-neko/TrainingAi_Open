// Pure interval-schedule builder for guided interval walking. The classic protocol is
// 3-min fast / 3-min slow × 5 sets; block lengths and set count are configurable. Each
// set is slow-then-fast so the first block eases you in (a warmup, if enabled, precedes).
export type SegmentKind = 'warmup' | 'fast' | 'slow' | 'cooldown'

export interface WalkConfig {
  sets: number
  fastSec: number
  slowSec: number
  warmupSec: number
  cooldownSec: number
  /** Indoors on a treadmill: GPS is skipped entirely rather than recorded and discarded.
   *  Indoor GPS is multipath noise, and a walk carrying a fabricated distance would drag pace
   *  aggregates around. Persisted with the rest of the config so the choice sticks between walks. */
  treadmill: boolean
  /** Cadence floor for a fast block, in steps per minute — the pacer's "walk faster" target.
   *  Optional because a config persisted before Q-410 rehydrates without it; read it through
   *  `resolveCadenceTargets` (lib/walk/walk-pacer.ts) rather than directly. */
  fastCadenceSpm?: number
  /** Cadence ceiling for a slow block. A single cadence number cannot express both halves of an
   *  interval walk — walking the slow block too hard is what stops the fast block being fast. */
  slowCadenceSpm?: number
}

export interface Segment {
  kind: SegmentKind
  index: number      // 0-based position in the segment list
  setNumber: number  // 1-based set this belongs to (0 for warmup/cooldown)
  startSec: number
  endSec: number
}

export interface IntervalPlan { segments: Segment[]; totalSec: number }

export function buildIntervalPlan(cfg: WalkConfig): IntervalPlan {
  const segments: Segment[] = []
  let t = 0
  let index = 0
  const push = (kind: SegmentKind, dur: number, setNumber: number) => {
    if (dur <= 0) return
    segments.push({ kind, index: index++, setNumber, startSec: t, endSec: t + dur })
    t += dur
  }
  push('warmup', cfg.warmupSec, 0)
  for (let s = 1; s <= cfg.sets; s++) {
    push('slow', cfg.slowSec, s)
    push('fast', cfg.fastSec, s)
  }
  push('cooldown', cfg.cooldownSec, 0)
  return { segments, totalSec: t }
}

export interface ActiveSegment { segment: Segment; remainingSec: number }

/** The segment active at `elapsedSec`, or null once the plan is complete. */
export function segmentAt(plan: IntervalPlan, elapsedSec: number): ActiveSegment | null {
  if (elapsedSec >= plan.totalSec) return null
  for (const segment of plan.segments) {
    if (elapsedSec >= segment.startSec && elapsedSec < segment.endSec) {
      return { segment, remainingSec: Math.ceil(segment.endSec - elapsedSec) }
    }
  }
  return null
}

// The cadence pair is deliberately absent here rather than defaulted: every device already
// carries a persisted config that predates it, so `resolveCadenceTargets` has to supply the
// default anyway, and a second copy of the numbers here would be the one that drifts.
export const DEFAULT_WALK_CONFIG: WalkConfig = { sets: 5, fastSec: 180, slowSec: 180, warmupSec: 0, cooldownSec: 0, treadmill: false }
