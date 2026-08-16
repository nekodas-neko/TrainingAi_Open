/**
 * Correct pairing + bit-unpack of the ring's real-step feature frames (0x7e/0x7f).
 *
 * Ported byte-exact from Th0rgal/open_health `tools/run_activity_model.py::unpack27`
 * (which the author transcribed from libringeventparser.so's
 * `EventParser::parse_api_real_steps_features_1/2`). The per-frame `decodeRealSteps`
 * in `decode.ts` unpacks each 14-byte frame independently — that is the NAIVE decode
 * and carries no usable signal (confirmed by a multi-window byte-diff, session 241).
 *
 * The CORRECT decode pairs the two halves: `0x7f` (feature_2) is emitted one
 * ring-timestamp unit after its matching `0x7e` (feature_1); the two 14-byte bodies
 * bit-unpack into 27 quantized gait-feature columns, with the carry bits for the
 * `<<1` fields packed into feature_2's last byte (`p2[13]`).
 *
 * This is NOT a step count — it produces the 27 quantized gait-feature columns. Oura's
 * `steps_motion_decoder` dequantization is ported in `lib/oura-models/steps-motion-decoder.ts`
 * (`runStepsMotionDecoder`, golden-pinned — the single production copy), so the physical values (incl. `strideFrequency`
 * Hz) ARE reproducible first-order — superseding the earlier "cannot reproduce their number" note.
 * The remaining open item is validating that THIS `unpack27` column order matches Oura's
 * `data_columns` against a counted walk on-device (Sub-plan D, task D-2 — the UNITS half is
 * resolved as of 2026-07-27: steps/second, see RING_STRIDE_HZ_TO_SPM; column order is still open)
 * before the decoded cadence
 * feeds the step count. Re-analysis of captured walks (session 242) found COLUMN 0 alone cleanly
 * separates idle from walking, the current Tier-1 activity-gate input (n=13 — confirm across more
 * captures before hard-coding a threshold).
 * See `docs/superpowers/plans/2026-07-15-oura-movement-steps-activity-energy.md` (D-1/D-2) and
 * `docs/superpowers/plans/2026-07-09-oura-ble-own-step-counter.md` §2A/§4.
 */

/** Number of quantized gait-feature columns produced per paired step-feature window. */
export const STEP_FEATURE_COLUMNS = 27

/** Column index whose value cleanly separated idle from walking (session-242 finding,
 *  zero overlap, n=13). It derives entirely from feature_2 (`p2[10]` + carry bits), so
 *  it is stable even if feature_1 pairing drifts. Not yet a confirmed threshold. */
export const STEP_GAIT_GATE_COLUMN = 0

/** Bit-unpack one paired feature_1 (`0x7e`) + feature_2 (`0x7f`) body into the
 *  27-column gait-feature vector. Returns null if either body is not 14 bytes. */
export function unpack27(p1: Uint8Array, p2: Uint8Array): number[] | null {
  if (p1.length !== 14 || p2.length !== 14) return null
  const c = p2[13] // packed carry byte: bits 7..0 feed the `<<1` fields below
  return [
    (p2[10] << 2) | (c & 0x3), p2[11], p2[12],
    (p1[0] << 1) | (p1[3] >> 7), (p1[1] << 1) | ((c >> 7) & 1), (p1[2] << 1) | ((c >> 6) & 1),
    p1[3] & 0x7f, p1[4], p1[5], p1[6], p1[7],
    (p1[8] << 1) | (p1[11] >> 7), (p1[9] << 1) | ((c >> 5) & 1), (p1[10] << 1) | ((c >> 4) & 1),
    p1[11] & 0x7f, p1[12], p1[13], p2[0], p2[1],
    (p2[2] << 1) | (p2[5] >> 7), (p2[3] << 1) | ((c >> 3) & 1), (p2[4] << 1) | ((c >> 2) & 1),
    p2[5] & 0x7f, p2[6], p2[7], p2[8], p2[9],
  ]
}

export interface StepFeatureFrame {
  /** Ring timestamp in deciseconds since the ring's own epoch (`oura_raw_samples.ring_timestamp_ds`). */
  ds: number
  /** Event tag — 0x7e (feature_1) or 0x7f (feature_2). */
  tag: number
  body: Uint8Array
}

export interface PairedStepFeature {
  /** Ring timestamp (ds) of the feature_1 (`0x7e`) frame. */
  ds: number
  /** The 27 quantized gait-feature columns. */
  columns: number[]
}

/**
 * Pair `0x7e`/`0x7f` frames by adjacent ring timestamp (feature_2 sits at `ds + 1`)
 * and unpack each pair into 27 columns. Unpaired or malformed frames are skipped —
 * this never throws, matching the infallible-decoder rule.
 */
export function pairStepFeatures(frames: StepFeatureFrame[]): PairedStepFeature[] {
  const feature2ByDs = new Map<number, Uint8Array>()
  for (const f of frames) {
    if (f.tag === 0x7f && f.body.length === 14) feature2ByDs.set(f.ds, f.body)
  }
  const paired: PairedStepFeature[] = []
  for (const f of frames) {
    if (f.tag !== 0x7e || f.body.length !== 14) continue
    const b2 = feature2ByDs.get(f.ds + 1)
    if (!b2) continue
    const columns = unpack27(f.body, b2)
    if (columns) paired.push({ ds: f.ds, columns })
  }
  return paired
}
