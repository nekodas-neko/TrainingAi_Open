// Single source of truth for the raw-sample tags the BLE rollup (`aggregateOuraRawSamples`) reads.
// The Lever-2 drop-whitelist (`RAW_STORAGE_DROP_TAGS`) must NEVER intersect this set — dropping a
// rollup-consumed tag at ingest is forward-unrecoverable silent data loss. The raw-storage test
// imports this list (rather than hand-copying it) so the invariant can't drift as the rollup grows
// (review G-1: the copied list had already fallen behind on 0x7e/0x7f).

// The gait step-feature pair, read by the `steps` step of the rollup (paired via unpack27 from
// body_hex, then run through `step_counter`). Kept as its own export so the adapter query and the
// test share one definition.
export const STEP_FEATURE_TAGS = [0x7e, 0x7f] as const

// Motion events (0x47) — `step_counter`'s soft motion stream (D0). Read by the rollup's `steps`
// step alongside the 0x7e/0x7f gait features; keep it archival (it back-fills history via redecode).
export const STEP_MOTION_TAG = 0x47

// Every tag `aggregateOuraRawSamples` reads. Grouped by rollup consumer for traceability.
export const ROLLUP_CONSUMED_TAGS: readonly number[] = [
  0x76,                   // sleep hypnogram
  0x4b, 0x4e, 0x5a,       // sleep / respiratory signals
  0x80, 0x60,             // IBI (HR/HRV)
  0x5d,                   // HRV (rMSSD source)
  0x6f,                   // SpO2 adjacent
  0x8b,                   // SpO2
  0x86,                   // aohr
  0x46, 0x69,             // temperature
  0x72, 0x75,             // movement / motion
  0x50,                   // MET
  ...STEP_FEATURE_TAGS,   // 0x7e/0x7f gait step features (steps → step_counter)
  STEP_MOTION_TAG,        // 0x47 motion events (step_counter soft motion stream)
]

// NOTE: 0x61 (debug_data) is ALSO consumed — but only its battery subtypes, via the decoded-kind
// exception in `isBatteryDebugEvent`. It stays IN the drop set (dropped for every non-battery 0x61
// body), so it deliberately does NOT belong in this "never-drop" list; the subtype exception is what
// keeps its battery events. Do not add it here.
