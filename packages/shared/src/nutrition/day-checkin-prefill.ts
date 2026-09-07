export interface PrefillSignals {
  batteryLabel?: 'Charged' | 'Good' | 'Low' | 'Drained' | null
  steps?: number | null
  waterMl?: number | null
  lastMealMinutesBeforeBed?: number | null
}
const clamp = (n: number) => Math.max(1, Math.min(5, Math.round(n)))

// Population anchors for the 1-5 prefill scales, NOT the user's goals — and the distinction is why
// they stay fixed (PS-37, which read the water one as a hardcoded goal). A prefill is a starting
// position for a slider the user then moves, so the same intake has to mean the same starting
// position for everyone; scaling it by a personal goal would make "hydration: 2" describe a
// different amount of water per user, and the step anchor beside it has always worked this way.
const HYDRATION_ANCHOR_ML = 2500
const STEPS_ANCHOR = 12000
const LATE_MEAL_ANCHOR_MIN = 300
export function prefillEveningScales(sig: PrefillSignals) {
  const battery = { Charged: 1, Good: 2, Low: 4, Drained: 5 } as const
  return {
    physicalTiredness: sig.batteryLabel ? battery[sig.batteryLabel] : 3,
    mentalDrain: 3, // no reliable signal
    barelyMoved: sig.steps == null ? 3 : clamp(5 - (sig.steps / STEPS_ANCHOR) * 4),
    hydration: sig.waterMl == null ? 3 : clamp(5 - (sig.waterMl / HYDRATION_ANCHOR_ML) * 4),
    lateHeavyMeal: sig.lastMealMinutesBeforeBed == null ? 3
      : clamp(5 - (sig.lastMealMinutesBeforeBed / LATE_MEAL_ANCHOR_MIN) * 4),
  }
}
