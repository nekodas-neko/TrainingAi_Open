// Intraday skin-temperature curve from tags 0x46/0x69 (temps_c). Oura shows only
// one nightly deviation; this is the continuous daytime curve. Samples below the
// skin range are the ring off the finger cooling toward ambient — drop them
// (same 31 °C floor the wear-time gate uses in the rollup).

export const SKIN_MIN_C = 31

export interface TempSample { tSec: number; tempC: number }

/** On-finger temperature samples (>= SKIN_MIN_C), ascending by tSec. */
export function intradayTempCurve(samples: TempSample[]): TempSample[] {
  return samples
    .filter(s => s.tempC >= SKIN_MIN_C)
    .sort((a, b) => a.tSec - b.tSec)
}
