export interface PrefillSignals {
  batteryLabel?: 'Charged' | 'Good' | 'Low' | 'Drained' | null
  steps?: number | null
  waterMl?: number | null
  lastMealMinutesBeforeBed?: number | null
}
const clamp = (n: number) => Math.max(1, Math.min(5, Math.round(n)))
export function prefillEveningScales(sig: PrefillSignals) {
  const battery = { Charged: 1, Good: 2, Low: 4, Drained: 5 } as const
  return {
    physicalTiredness: sig.batteryLabel ? battery[sig.batteryLabel] : 3,
    mentalDrain: 3, // no reliable signal
    barelyMoved: sig.steps == null ? 3 : clamp(5 - (sig.steps / 12000) * 4),
    hydration: sig.waterMl == null ? 3 : clamp(5 - (sig.waterMl / 2500) * 4),
    lateHeavyMeal: sig.lastMealMinutesBeforeBed == null ? 3
      : clamp(5 - (sig.lastMealMinutesBeforeBed / 300) * 4),
  }
}
