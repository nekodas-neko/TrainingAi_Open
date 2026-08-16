// Raw-storage tag whitelist (Oura data-culling, Sub-plan A Lever 2). Pure telemetry / debug / device-
// state tags carry NO analytical value and NO redecode value, so we stop persisting their
// `oura_raw_samples` rows at ingest — forward-only, non-destructive (existing rows are left in place),
// and reversible (drop the tag from this set and it stores again).
//
// SAFETY: every tag here was verified NOT consumed by the rollup and NOT biometric per
// `lib/oura-ble/decode.ts`. The rollup-consumed set lives in `rollup-consumed-tags.ts`
// (`ROLLUP_CONSUMED_TAGS`, incl. the 0x7e/0x7f gait step features) — the raw-storage test imports it
// and asserts it never intersects this drop set, so the invariant tracks the code instead of a
// hand-copied list (review G-1). Anything plausibly future-decodable is deliberately KEPT archival
// (raw PPG 0x64/0x68, sleep summaries 0x49/0x4c/0x4f/0x58, atlas 0x87/0x88). 0x61 stays IN this set
// but its battery subtypes are kept via the `isBatteryDebugEvent` decoded-kind exception below.
export const RAW_STORAGE_DROP_TAGS: ReadonlySet<number> = new Set([
  0x42, // time_sync — u32 unix ts, no analytical value
  0x43, // debug_event
  0x45, // state_change — state byte + ASCII description
  0x53, // wear_event — wear text
  0x56, // alert_event
  0x5b, // BLE/radio telemetry + diagnostics (device-internal)
  0x61, // debug_data
  0x79, // telemetry
  0x82, // telemetry
  0x83, // telemetry
])

/** True when a raw BLE history event of this tag should NOT be persisted (Lever 2). */
export const shouldDropRawTag = (tag: number): boolean => RAW_STORAGE_DROP_TAGS.has(tag)

// The two decoded `debug_data` (0x61) subtypes we DO want to persist — the ring's battery
// telemetry. Everything else on 0x61 (ASCII boot/debug text, other binary subtypes) stays dropped
// per Lever 2. Keying off the DECODED kind keeps the decoder (decodeDebugData) the single authority
// on "what is a battery event".
const BATTERY_DEBUG_KINDS: ReadonlySet<string> = new Set(['charging_time', 'battery_level_changed'])

/** True when a 0x61 event's decoded body is a battery subtype worth keeping. */
export function isBatteryDebugEvent(tag: number, decoded: Record<string, unknown> | null): boolean {
  return tag === 0x61 && typeof decoded?.kind === 'string' && BATTERY_DEBUG_KINDS.has(decoded.kind as string)
}

/**
 * True when a raw BLE history event should NOT be persisted (Lever 2), WITH the subtype-aware
 * exception that 0x61 battery events are kept even though 0x61 is a dropped tag. Use this at ingest
 * instead of shouldDropRawTag when the decoded body is available.
 */
export function shouldDropRawEvent(tag: number, decoded: Record<string, unknown> | null): boolean {
  if (isBatteryDebugEvent(tag, decoded)) return false
  return RAW_STORAGE_DROP_TAGS.has(tag)
}
