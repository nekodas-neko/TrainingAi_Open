import type { RunPrescription } from '@/components/running/prescribed-run-card'

export type RunChipMode = 'distance' | 'duration' | 'elapsed'

/** Which live metric the run status-bar chip should track, derived from today's
 *  prescription (or the lack of one for a freeform run). Mirrors the actual data
 *  model: only the density-progression ("Go further") framework ever sets
 *  distanceKm — every other framework only ever sets durationMin. */
export function chooseRunChipMode(prescription: RunPrescription | null): RunChipMode {
  if (prescription?.distanceKm != null) return 'distance'
  if (prescription?.durationMin != null) return 'duration'
  return 'elapsed'
}

/** "3.26 / 5.00 km · 5:42 /km" — the distance-mode chip's static text, re-posted
 *  on each GPS fix. `paceLabel` is the already-formatted "M:SS /km" string (or
 *  null before the first pace reading exists). */
export function formatDistanceChipText(
  distanceKm: number,
  targetKm: number,
  paceLabel: string | null,
  paused = false,
): string {
  const base = `${distanceKm.toFixed(2)} / ${targetKm.toFixed(2)} km`
  const withPace = paceLabel ? `${base} · ${paceLabel}` : base
  return paused ? `${withPace} (paused)` : withPace
}
