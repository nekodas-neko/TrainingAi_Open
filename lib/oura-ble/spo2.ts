// SpO₂ calibration for the ring's spo2_r_pi_event (0x8b) — the "SpO₂ Simple" path.
//
// The Ring 5 never emits the firmware-calibrated spo2_event (0x6f) over BLE
// (confirmed overnight, BLE-16); it sends a raw R ratio-of-ratios + perfusion
// index per sample. Oura's own app converts R with a per-hardware quadratic
// (open_oura docs/spo2-calibration.md, coefficients read from the decompiled
// app at com/ouraring/oura/workitem/data/items/d.java):
//
//   SpO2(%) = a·r² + b·r + c, clamped to [85, 100]
//
// The Ring 5's exact hardware→coefficient mapping is not pinned upstream (the
// decompiled app predates it); the two known sets differ by <1% on real data,
// so open_oura defaults to gen4/oreo and we do the same. Values shipped from
// these coefficients are estimates, not firmware-calibrated — surface them as
// such (`calibrated: false` in the tester summary).
export const SPO2_COEFFS = {
  gen4: { a: -13.4, b: -5.1, c: 105.2 },
  cooper: { a: -12.1, b: -6.9, c: 106.3 },
} as const

const { a: A, b: B, c: C } = SPO2_COEFFS.gen4

/** One R sample → SpO₂ % (float, clamped [85,100]); null for non-physical R. */
export function spo2PctFromR(r: number): number | null {
  if (!Number.isFinite(r) || r <= 0) return null
  return Math.min(100, Math.max(85, A * r * r + B * r + C))
}
