/**
 * Client-safe activity metadata for the workout energy estimate — ids + labels only, no model
 * weights or the features JSON (so importing this into a client component stays lean). The MET
 * values themselves live in `workout-energy.ts` (server), keyed by these same ids.
 */

/** Default when a workout has no chosen activity — this is a strength-training app. */
export const DEFAULT_ACTIVITY_ID = 8 // "strength training"

/**
 * Curated subset of Oura's 82 activity types offered in the workout activity picker — the ones
 * relevant here (strength + walking/running) plus common cross-training. Ids/labels match the
 * model's own table; the full table still backs the estimate, this is just what the UI surfaces.
 */
export const COMMON_WORKOUT_ACTIVITIES: { id: number; label: string }[] = [
  { id: 8, label: 'Strength training' },
  { id: 14, label: 'Walking' },
  { id: 12, label: 'Running' },
  { id: 5, label: 'Cycling' },
  { id: 30, label: 'HIIT' },
  { id: 67, label: 'Kettlebell' },
  { id: 28, label: 'Core exercise' },
  { id: 7, label: 'Elliptical' },
  { id: 11, label: 'Rowing' },
  { id: 21, label: 'Hiking' },
  { id: 13, label: 'Swimming' },
  { id: 79, label: 'Cardio (other)' },
]
