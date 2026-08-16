/**
 * Steps math, One-Formula-One-Place. Two things live here:
 *
 *  1. `estimateSteps` — the legacy flat-30-per-walk-window heuristic. Since D0 (own-analysis)
 *     this is NO LONGER the daily-steps source: the rollup runs Oura's real `step_counter`
 *     model instead (`lib/oura-ble/step-counter-pipeline.ts`). `estimateSteps`/`isWalkingWindow`
 *     stay only as the periodicity walk-gate for the realtime accel counter + admin calibration
 *     cross-check — never the persisted daily total.
 *  2. `mergeStepCounterWithLive` — the D0 daily merge: step_counter's per-window output is the
 *     primary source; accurate live-counted accel windows override it for the span they cover.
 *
 * Estimated daily steps from the ring's paired real-step gait features (0x7e/0x7f →
 * `unpack27`, `lib/oura-ble/step-features.ts`).
 *
 * How it works: the ring emits one paired gait-feature window every ~30 s while worn.
 * Column 14 of the unpacked vector is a cadence/periodicity feature that drops to ~0
 * only during rhythmic walking — hand activity (typing, phone use) and stillness both
 * read high. Count the low-col14 windows, multiply by a calibrated steps-per-window.
 *
 * Calibration (owner's counted walks, 2026-07-10, committed in the unit tests):
 * - walking col14: 100-step walk [1,10,13] · 200-step [1,1,5,5,5,9,10] · normal [9,9]
 *   · fast [7,18] · slow [1,123 ← missed]
 * - non-walking col14: clean desk-typing (no walking) [44,46,57,57,100]; dead-still ≥31
 * - threshold 20 catches 15 of 16 walk windows with zero clean false positives
 *   (untested band 21–43 — revisit if real-world totals look inflated)
 * - steps per window: 450 counted steps / 15 detected windows = 30
 *
 * Honest accuracy: an ESTIMATE, biased to UNDER-count — slow/irregular strides can read
 * high (the slow-walk 123) and windows the ring never recorded (radio asleep) are missed.
 * It never invents steps from desk activity. The accurate path is the live-accel counter
 * (`lib/oura-ble/accel.ts`), which replaces this per-window guess where it runs.
 */
import type { PairedStepFeature } from '@/lib/oura-ble/step-features'
import { GAIT_CADENCE_MAX_HZ } from '@/lib/oura-ble/gait-step-count'

/** unpack27 column holding the walk-cadence feature. */
export const WALK_CADENCE_COLUMN = 14

/** A window with col14 at or below this is counted as walking. */
export const WALK_CADENCE_MAX = 20

/** Calibrated steps credited per detected ~30 s walking window. */
export const STEPS_PER_WINDOW = 30

export function isWalkingWindow(columns: number[]): boolean {
  const v = columns[WALK_CADENCE_COLUMN]
  return typeof v === 'number' && v <= WALK_CADENCE_MAX
}

export interface StepEstimate {
  /** Paired 0x7e/0x7f windows examined. */
  windows: number
  /** Windows classified as walking. */
  walkingWindows: number
  /** walkingWindows × STEPS_PER_WINDOW. */
  estimatedSteps: number
}

export function estimateSteps(paired: PairedStepFeature[]): StepEstimate {
  const walkingWindows = paired.filter((p) => isWalkingWindow(p.columns)).length
  return { windows: paired.length, walkingWindows, estimatedSteps: walkingWindows * STEPS_PER_WINDOW }
}

/** A live-counted (Tier 2, accurate) step window, ring-ds keyed. */
export interface LiveStepWindow {
  startDs: number
  endDs: number
  steps: number
}

// A paired gate window recurs at ~30s cadence (the 0x7e/0x7f arrival rate). Used only
// to test overlap against a live-counted window — there is no stored end-ds for a gate
// window, so this synthesizes one for the overlap check.
export const GATE_WINDOW_SPAN_DS = 300

/**
 * Tier-2-wins merge for a single local day: live-counted windows are accurate and
 * override the gate estimate for the ds span they cover; Tier 1's per-window estimate
 * fills every walking gate window that isn't covered by any live window. The rollup's
 * own max-merge guard (only offer a value that beats what's stored) still applies on
 * top of this — this function only computes the day's merged total.
 */
export function mergeStepSources(paired: PairedStepFeature[], liveWindows: LiveStepWindow[]): number {
  const liveTotal = liveWindows.reduce((sum, w) => sum + w.steps, 0)
  const uncoveredWalkingWindows = paired.filter((p) => {
    if (!isWalkingWindow(p.columns)) return false
    const gwEnd = p.ds + GATE_WINDOW_SPAN_DS
    return !liveWindows.some((lw) => p.ds < lw.endDs && gwEnd > lw.startDs)
  }).length
  return liveTotal + uncoveredWalkingWindows * STEPS_PER_WINDOW
}

/** A step-count window in epoch-ms: either `step_counter`'s resampled model output or a
 *  live-counted accel window converted from ring ds. */
export interface StepCountWindow {
  startMs: number
  endMs: number
  steps: number
}

/**
 * Physical ceiling on step cadence, taken from the gait detector's OWN upper band edge
 * (`GAIT_CADENCE_MAX_HZ` = 2.8 Hz ≈ 168 steps/min) rather than a new magic number — the counter
 * cannot legitimately emit faster than the band it detects in, and its 350 ms refractory
 * (`MIN_STEP_GAP_SEC`) independently caps it at ~2.86 Hz. Anything above this is a counting fault,
 * not a fast walk: elite running cadence is ~3 Hz and only in short bursts.
 */
export const MAX_PLAUSIBLE_STEPS_PER_SEC = GAIT_CADENCE_MAX_HZ

/**
 * Slack for a window whose boundaries cut a stride, and for ds↔ms rounding. Small on purpose: the
 * point is to reject counts that are physically impossible, never to second-guess a brisk walk.
 */
export const STEP_WINDOW_GRACE_STEPS = 2

/**
 * Is this window's step count physically achievable over its own duration?
 *
 * Added after a live-counted window claimed **3,605 steps in 13 minutes (288 steps/min)** and, via
 * the Tier-2-wins override below, turned a plausible 1,578-step day into a displayed 4,903
 * (2026-07-28). Two of 40 stored live windows were impossible — 288 and **1,145** steps/min — and
 * between them accounted for 5,321 of 8,195 live-counted steps.
 *
 * A zero-or-negative duration is never plausible: it would divide by zero and, worse, a window with
 * no span cannot have been walked.
 */
export function isPlausibleStepWindow(steps: number, startMs: number, endMs: number): boolean {
  const durationSec = (endMs - startMs) / 1000
  if (!Number.isFinite(durationSec) || durationSec <= 0) return false
  return steps <= durationSec * MAX_PLAUSIBLE_STEPS_PER_SEC + STEP_WINDOW_GRACE_STEPS
}

/**
 * D0 daily-steps merge. `model` is `step_counter`'s per-window output (the primary source since D0);
 * `live` is the day's accurate live-counted accel windows (Tier 2). Live windows OVERRIDE the model
 * for the ds/ms span they cover — any model window overlapping a live window is dropped in favour of
 * the live count — while model windows outside every live window keep their count. This is the same
 * Tier-2-wins contract the retired flat-30 estimate had (`mergeStepSources`), generalised to the
 * model's windowed output so the accuracy hierarchy (live accel > step_counter model) is preserved.
 * Returns an integer step total (the model emits fractional per-window steps).
 */
/**
 * Live windows may overlap each other, and summing them double-counts the shared span. Production
 * holds 15 overlapping pairs — including four `continuous-accel` rows whose starts differ by 1–3 ds
 * and which cover the same ~4 minutes, plus two shorter windows inside them. `upsertStepLiveWindow`
 * conflicts on `(userId, startDs)` alone, so a retry that lands a decisecond later inserts a second
 * row rather than replacing the first.
 *
 * Overlapping windows cannot all be true, and there is no way to tell which is right — so this never
 * adds them. Greedy by descending count: take the largest, then any window that overlaps nothing
 * already taken. That credits the most steps achievable without counting any instant twice, and can
 * only ever lower a total, never raise one.
 */
export function dedupeOverlappingWindows(windows: StepCountWindow[]): StepCountWindow[] {
  const accepted: StepCountWindow[] = []
  for (const w of [...windows].sort((a, b) => b.steps - a.steps || a.startMs - b.startMs)) {
    if (!accepted.some((a) => w.startMs < a.endMs && w.endMs > a.startMs)) accepted.push(w)
  }
  return accepted
}

export function mergeStepCounterWithLive(model: StepCountWindow[], live: StepCountWindow[]): number {
  // Drop physically impossible live windows BEFORE they claim their span. Ingest rejects these now
  // too, but rows written before that guard existed are already stored — and because a live window
  // overrides the model wherever it overlaps, one bad row silently replaces good model output for
  // its whole span. Filtering here means the model's own count is used instead, rather than a hole.
  const usableLive = dedupeOverlappingWindows(live.filter((w) => isPlausibleStepWindow(w.steps, w.startMs, w.endMs)))
  const liveTotal = usableLive.reduce((sum, w) => sum + w.steps, 0)
  // The same gate on the model side (Q-139). It used to apply to live windows only, so the three
  // impossible windows a compressed clock produced on 2026-08-07 — the worst holding 1,555 steps in
  // 60 s, 26 per second — went straight into the daily total unchallenged. The clock fix stops that
  // cause; this stops the class, including rows already stored and anything a future decoder bug
  // produces. A window is dropped, not clamped: there is no way to know how many of its steps were
  // real.
  const uncoveredModelSteps = model
    .filter((mw) => isPlausibleStepWindow(mw.steps, mw.startMs, mw.endMs))
    .filter((mw) => !usableLive.some((lw) => mw.startMs < lw.endMs && mw.endMs > lw.startMs))
    .reduce((sum, w) => sum + w.steps, 0)
  return Math.round(liveTotal + uncoveredModelSteps)
}
