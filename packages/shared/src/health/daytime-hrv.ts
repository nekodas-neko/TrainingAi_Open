// Daytime HRV curve — 5-min RMSSD samples that fall OUTSIDE the day's sleep
// interval(s). Oura only surfaces nighttime HRV; the ring emits 5-min RMSSD
// (tag 0x5d) all day, so the waking-hours curve is a signal Oura never shows.

export interface HrvSample { tSec: number; rmssd: number }
export interface SleepInterval { startSec: number; endSec: number } // seconds since local midnight

/** Samples not inside any [startSec, endSec] sleep interval, ascending by tSec. */
export function daytimeHrvCurve(samples: HrvSample[], sleep: SleepInterval[]): HrvSample[] {
  return samples
    .filter(s => !sleep.some(w => s.tSec >= w.startSec && s.tSec < w.endSec))
    .sort((a, b) => a.tSec - b.tSec)
}
