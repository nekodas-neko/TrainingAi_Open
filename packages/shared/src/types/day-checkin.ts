// The evening (and, later, morning) wellness check-in captured by the
// End of Day review. All scale fields are 1–5; journal is the only free text.
export type CheckinPhase = 'evening' | 'morning'

export interface DayCheckin {
  id: string
  userId: string
  logDate: string          // YYYY-MM-DD (user's timezone)
  phase: CheckinPhase
  physicalTiredness: number | null // 1 (fresh) … 5 (drained)
  mentalDrain: number | null       // 1 (clear) … 5 (fried)
  barelyMoved: number | null       // 1 (very active) … 5 (sat all day)
  hydration: number | null         // 1 (well hydrated) … 5 (barely drank)
  lateHeavyMeal: number | null     // 1 (none/light early) … 5 (big & late)
  // Morning (phase='morning') scales — null on evening rows.
  wakeMood: number | null          // 1 (great) … 5 (awful)
  perceivedRecovery: number | null // 1 (fully recovered) … 5 (wrecked)
  motivation: number | null        // retired (Q-113) — always null on new rows, see illnessContext
  sleepQualityFeel: number | null  // 1 (slept great) … 5 (terrible)
  restingSoreness: number | null   // 1 (none) … 5 (very sore)
  // Replaces motivation (Q-113): a quick illness/context flag, ties into the AI-periodization
  // system's existing self-reported-sick signal rather than a new parallel one.
  illnessContext: IllnessContext | null
  // True once the lifter has actually tapped this scale this checkin — distinguishes a genuine
  // self-report from an unedited, score-derived prefill (Q-113).
  perceivedRecoveryTouched: boolean
  sleepQualityFeelTouched: boolean
  soreMuscles: string[]
  journal: string | null
  createdAt: Date
  updatedAt: Date
}

export type IllnessContext = 'sick' | 'alcohol' | 'poor_sleep'

export const ILLNESS_CONTEXT_OPTIONS: Array<{ value: IllnessContext; label: string }> = [
  { value: 'sick',       label: 'Feeling sick' },
  { value: 'alcohol',    label: 'Alcohol last night' },
  { value: 'poor_sleep', label: 'Travel / poor sleep environment' },
]

// The five evening scales, in display order, with their end labels and a theme colour
// (matches the metric, e.g. blue for hydration). Drives the WellnessSection UI and the
// pre-fill helper so they never drift apart.
export const EVENING_SCALES = [
  { key: 'physicalTiredness', label: 'Physical tiredness', low: 'Fresh',       high: 'Drained',      color: '#f59e0b' },
  { key: 'mentalDrain',       label: 'Mental drain',       low: 'Clear',       high: 'Fried',        color: '#a855f7' },
  { key: 'barelyMoved',       label: 'Movement',           low: 'Very active', high: 'Barely moved', color: '#22c55e' },
  { key: 'hydration',         label: 'Hydration',          low: 'Well hydrated', high: 'Barely drank', color: '#3b82f6' },
  { key: 'lateHeavyMeal',     label: 'Late / heavy meal',  low: 'None / light', high: 'Big & late',   color: '#f97316' },
] as const

export type EveningScaleKey = typeof EVENING_SCALES[number]['key']

// The morning scales, in display order — same shape as EVENING_SCALES so
// ScaleSelector/WellnessSection render either set.
//
// Two subjective scales are collected: Recovery (correlated against Oura readiness
// in health-trends) and Sleep quality feel (the user's opinion vs Oura's objective
// sleep score). Wake mood was removed as a double-up with Motivation; Motivation itself
// was replaced (Q-113) by a quick illness/context flag — see ILLNESS_CONTEXT_OPTIONS,
// rendered separately from this scale list, not as a ScaleSelector. Resting soreness was
// removed as a double-up with Recovery. All three retired columns are retained on
// DayCheckin for historical rows but are no longer written.
//
// `labels` runs worst → best (left → right on screen), so the scale reads "good on
// the right". The stored value keeps its 1=best … 5=worst semantics (the AI prompt,
// health-trends correlations and Oura prefill all depend on it) — ScaleSelector maps
// the on-screen position p (1..5) to the stored value via 6 − p, so no data changes.
export const MORNING_SCALES = [
  { key: 'perceivedRecovery', label: 'Recovery',             low: 'Fully recovered', high: 'Wrecked',  color: '#22c55e',
    labels: ['Wrecked', 'Rough', 'OK', 'Good', 'Recovered'] },
  { key: 'sleepQualityFeel',  label: 'Sleep quality (feel)', low: 'Slept great',     high: 'Terrible', color: '#8b5cf6',
    labels: ['Terrible', 'Poor', 'OK', 'Good', 'Great'] },
] as const

export type MorningScaleKey = typeof MORNING_SCALES[number]['key']

/**
 * A scale's labels in STORED order — index 0 is stored value 1, the best end.
 *
 * `labels` above is *screen* order (worst → best, so "good on the right"), and `ScaleSelector` maps
 * position p to the stored value via 6 − p. Anything reading a stored 1–5 back out — the calibration
 * surfaces, the AI prompt — needs the reverse, and hand-maintaining a second reversed copy per scale
 * is how the two drift apart when the check-in copy is reworded.
 */
export function storedOrderLabels(key: MorningScaleKey): readonly string[] {
  return [...MORNING_SCALES.find(s => s.key === key)!.labels].reverse()
}
