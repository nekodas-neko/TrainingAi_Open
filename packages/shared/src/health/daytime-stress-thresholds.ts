// Daytime-stress bucket thresholds — a dependency-free leaf so client bundles can import the
// constants without dragging in `daytime-stress.ts`'s ONNX-backed dHRV imputation (which is
// server-only: onnxruntime-node). Single definition — `daytime-stress.ts` re-exports these, so
// there is still exactly one source of truth (One-Formula-One-Place).
//
// Thresholds on the scaled level: |level| crosses 0.5 exactly when the raw pre-equalize value
// crosses 0.4 — i.e. the moment's dHRV deviation is ≥40% of the personal stress/recovery
// saturation. That is our "high stress" / "high recovery" bucket.
export const STRESS_BUCKET_MS = 30 * 60_000
export const STRESS_HIGH_LEVEL = -0.5
export const RECOVERY_HIGH_LEVEL = 0.5
/** Minutes of high stress in a day at/over which the next-session engine treats the day
 *  as stress-deload-worthy (the derived replacement for Cloud's `very_stressful`). ~2 h,
 *  a documented judgement call — tune here, nowhere else. */
export const STRESS_HIGH_DAY_THRESHOLD_MIN = 120
