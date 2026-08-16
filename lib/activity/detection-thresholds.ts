// Shared walk/run auto-detection quality thresholds ("Balanced" tier).
//
// Centralised so the three detection sites — the Oura workouts route
// (`app/api/oura/workouts/route.ts`), the day-timeline walk filter
// (`app/api/day-timeline/route.ts`), and the phone GPS detector
// (`lib/stores/auto-detection-store.ts`) — can't drift apart again.
//
// Tightened from the old 500 m / 1.5 km/h gate, which passed slow home-pottering
// strolls as "walks". 2.5 km/h is a deliberate, purposeful pace and 7 minutes filters
// out the brief moves that produced most false positives, while still catching a genuine
// short walk.
export const MIN_DISTANCE_M    = 750
export const MIN_AVG_SPEED_KMH = 2.5
export const MIN_DURATION_SEC  = 7 * 60
export const MAX_DURATION_SEC  = 3 * 3600

export const MIN_AVG_SPEED_MS  = MIN_AVG_SPEED_KMH / 3.6
