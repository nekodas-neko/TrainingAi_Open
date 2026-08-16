// Intraday SpO₂ curve from tag 0x8b (spo2_r_pi_event). Oura's app shows only one
// nightly average; the ring emits a raw R ratio-of-ratios per sample, which the
// SHARED spo2PctFromR (lib/oura-ble/spo2.ts) turns into a calibrated SpO₂ % (the
// same conversion the daily rollup uses — One Formula, One Place). One point per
// frame; non-physical R (spo2PctFromR → null) is dropped.

import { spo2PctFromR } from '@/lib/oura-ble/spo2'

export interface Spo2RSample { tSec: number; r: number } // r = frame-averaged ratio-of-ratios
export interface Spo2Point { tSec: number; spo2: number }

/** On-finger SpO₂ % points (non-physical R dropped), ascending by tSec. */
export function intradaySpo2Curve(samples: Spo2RSample[]): Spo2Point[] {
  return samples
    .map(s => ({ tSec: s.tSec, spo2: spo2PctFromR(s.r) }))
    .filter((p): p is Spo2Point => p.spo2 != null)
    .sort((a, b) => a.tSec - b.tSec)
}
