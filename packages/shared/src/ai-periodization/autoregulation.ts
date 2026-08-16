import { goalRange } from '@trainingai/shared/ai-periodization/goal-ranges'

// RPE-based autoregulation.
//
// A back-off requires a HIGH RPE plus a second corroborating signal — but that second signal
// is now EITHER a regressing 1RM OR a missed rep target:
//   • RPE ran HIGH and 1RM went DOWN → back off: cut load 5–10%, sized by how badly reps were
//     missed (rep-completion). Failing by ~a rep → 5%; failing badly → the 10% ceiling.
//   • RPE ran HIGH and you FELL SHORT of the prescribed reps → back off the same way, even if
//     the 1RM is flat/rising. Not completing the set at a high RPE means the load was too heavy
//     to finish with clean reps — a signal in its own right. Reps are held; only the load drops.
//   • RPE ran LOW  and 1RM held/rose (and reps met) → push: RPE-modulated double progression.
//     Bump target reps up the goal band; at the band ceiling an accessory earns a set while a
//     compound lets the already-earned 1RM carry the load. The engine never fabricates a 1RM —
//     it raises the DEMAND and lets the lifter earn the jump.
// High RPE with every rep completed on a non-regressing lift → no action (the healthy +1/AMRAP
// hard session). RPE on target (inside the dead-band) → no action regardless of reps/1RM.

const RPE_DEAD_BAND = 1.5 // trigger threshold: |avg actual − expected RPE|
const BACKOFF_MIN_PCT = 5
export const BACKOFF_MAX_PCT = 10
const COMPLETION_FLOOR = 0.7 // ≤ this (missed badly) → max cut
const COMPLETION_CEIL = 0.95 // ≥ this (missed by ~a rep) → min cut
const PCT_HARD_FLOOR = 40 // never cut a working set below this %1RM in one step

export interface AutoregSignal {
  role: string
  rpeDelta: number | null // avg (actual RPE − expected RPE) across the exercise's recent sets
  rm1Trend: 'up' | 'flat' | 'down'
  repCompletionRate: number | null // actual reps ÷ prescribed reps last session (null = unknown)
}

export interface AutoregContext {
  phase: string
  currentReps: number
  band: { repMin: number; repMax: number }
}

export interface AutoregAdjustment {
  pctMultiplier: number // 1 = unchanged; < 1 = back-off load cut
  repDelta: number // target-rep change (double progression climb)
  setDelta: number // earned extra set (subject to the time budget downstream)
  note: string | null
}

const NONE: AutoregAdjustment = { pctMultiplier: 1, repDelta: 0, setDelta: 0, note: null }

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function computeRpeAdjustment(sig: AutoregSignal, ctx: AutoregContext): AutoregAdjustment {
  if (sig.rpeDelta == null) return NONE
  if (ctx.phase === 'deload' || ctx.phase === 'baseline') return NONE

  // ⬇️ Back-off: RPE ran high AND (the lift is regressing OR you fell short of the prescribed
  // reps). A miss at high RPE means the load was too heavy to finish the set with clean reps —
  // actioned on its own, even when the 1RM is flat/rising. Reps are held; only the load is cut,
  // 5–10% sized by how far short the reps fell (missed by ~a rep → 5%; badly → the 10% ceiling).
  const missedReps = sig.repCompletionRate != null && sig.repCompletionRate < COMPLETION_CEIL
  if (sig.rpeDelta >= RPE_DEAD_BAND && (sig.rm1Trend === 'down' || missedReps)) {
    const completion = sig.repCompletionRate ?? COMPLETION_CEIL // unknown → mildest cut
    const t = clamp((COMPLETION_CEIL - completion) / (COMPLETION_CEIL - COMPLETION_FLOOR), 0, 1)
    const cutPct = BACKOFF_MIN_PCT + (BACKOFF_MAX_PCT - BACKOFF_MIN_PCT) * t
    return {
      pctMultiplier: 1 - cutPct / 100,
      repDelta: 0,
      setDelta: 0,
      note: missedReps
        ? `−${round1(cutPct)}% load — RPE ran high and you fell short of the prescribed reps`
        : `−${round1(cutPct)}% load — RPE ran high while your 1RM slipped`,
    }
  }

  // ⬆️ Push: RPE ran low AND the lift is holding/rising AND the reps were met.
  const metReps = (sig.repCompletionRate ?? 1) >= 1
  if (sig.rpeDelta <= -RPE_DEAD_BAND && sig.rm1Trend !== 'down' && metReps) {
    if (ctx.phase === 'realisation') return NONE // no rep pushes in a low-rep peak block
    const bump = sig.rpeDelta <= -2 ? 2 : 1
    if (ctx.currentReps < ctx.band.repMax) {
      const repDelta = Math.min(bump, ctx.band.repMax - ctx.currentReps)
      return {
        pctMultiplier: 1,
        repDelta,
        setDelta: 0,
        note: `+${repDelta} target rep${repDelta > 1 ? 's' : ''} — that felt easy, earning the next jump`,
      }
    }
    // At the band ceiling: accessories add a set; compounds let the earned 1RM carry the load.
    if (sig.role === 'accessory') {
      return {
        pctMultiplier: 1,
        repDelta: 0,
        setDelta: 1,
        note: "+1 set — you're at the top of the rep range and it still felt easy",
      }
    }
    return NONE
  }

  return NONE
}

export interface AutoregExercise {
  sessionExerciseId: string
  sets: number
  reps: number
  pct: number
}

export interface AutoregExerciseSignal extends AutoregSignal {
  sessionExerciseId: string
}

// Apply the quadrant to a whole prescription. Pure: returns a new exercise array plus the set of
// exercises that earned an extra set (protected downstream by the time budget) and per-exercise
// explanation notes. Rounds pct to 0.5 and keeps reps inside the goal band.
export function applyAutoregulation(
  exercises: AutoregExercise[],
  signals: AutoregExerciseSignal[],
  trainingGoal: string,
  phase: string,
): { exercises: AutoregExercise[]; earnedSetIds: Set<string>; notes: Record<string, string> } {
  const earnedSetIds = new Set<string>()
  const notes: Record<string, string> = {}

  const out = exercises.map((ex) => {
    const sig = signals.find((s) => s.sessionExerciseId === ex.sessionExerciseId)
    if (!sig) return { ...ex }

    const band = goalRange(trainingGoal, sig.role)
    const adj = computeRpeAdjustment(sig, { phase, currentReps: ex.reps, band })
    if (!adj.note) return { ...ex }

    const pct =
      adj.pctMultiplier === 1
        ? ex.pct
        : clamp(Math.round(ex.pct * adj.pctMultiplier * 2) / 2, PCT_HARD_FLOOR, 100)
    const reps =
      adj.repDelta !== 0
        ? clamp(ex.reps + adj.repDelta, band.repMin, Math.min(band.repMax, 30))
        : ex.reps
    const sets = ex.sets + adj.setDelta
    if (adj.setDelta > 0) earnedSetIds.add(ex.sessionExerciseId)
    notes[ex.sessionExerciseId] = adj.note

    return { ...ex, pct, reps, sets }
  })

  return { exercises: out, earnedSetIds, notes }
}

// Combined-deviation clamp: whatever the model chose plus whatever autoregulation cut,
// the final working pct never lands more than one full back-off (10%) below the phase
// zone's floor, and never rides above the phase zone's ceiling (a schema-valid but
// out-of-band pct, e.g. 98% in an accumulation block, must not reach the bar). pctMax is
// optional so existing floor-only callers/tests are unaffected. Rounded to 0.5 like all
// autoreg pcts.
export function clampPrescribedPct(pct: number, zone: { pctMin: number; pctMax?: number }): number {
  const floor = Math.round(zone.pctMin * (1 - BACKOFF_MAX_PCT / 100) * 2) / 2
  const ceiling = zone.pctMax ?? Infinity
  return Math.min(ceiling, Math.max(pct, floor))
}
