import type { HrZone } from '@trainingai/shared/health/hr-zones'

// Weekly time-in-zone targets per framework — how many minutes of the week should
// fall in each HR zone. Grounded in the 2026-07-20 training-science brief:
//   • Polarized 80/20 (Seiler; Stöggl & Sperlich 2014): ~80% easy (Z1–2), ~20% hard
//     (Z4–5), minimal Z3 "grey zone".
//   • Public-health floor (WHO 2020 / AHA / ACSM): 150 min/wk moderate OR 75 min/wk
//     vigorous; vigorous counts double (1 min vigorous ≈ 2 min moderate); Z1 is "light",
//     below the moderate threshold.
//   • Heart-health → Zone-2 emphasis; recovery → almost all easy, no grey-zone grind.

export type IntensityModel = 'polarized' | 'zone2-base' | 'aerobic-recovery'

// Fraction of weekly minutes per zone [Z1..Z5]. Each row sums to 1.0.
const ZONE_WEIGHTS: Record<string, { model: IntensityModel; weights: [number, number, number, number, number] }> = {
  // Speed: still majority easy, but the most quality of any goal (VO₂max Z5 + threshold Z4).
  'speed-vo2max':      { model: 'polarized',        weights: [0.10, 0.60, 0.08, 0.12, 0.10] },
  // Endurance base: textbook 80/20 with a small threshold touch.
  'polarized-80-20':   { model: 'polarized',        weights: [0.15, 0.65, 0.05, 0.10, 0.05] },
  // Heart health: Zone-2 dominant, a sliver of tempo, no Z5.
  'zone2-base':        { model: 'zone2-base',       weights: [0.20, 0.72, 0.05, 0.03, 0.00] },
  // Recovery/HRR: all easy aerobic, no hard work at all.
  'aerobic-recovery':  { model: 'aerobic-recovery', weights: [0.35, 0.60, 0.05, 0.00, 0.00] },
  // Density progression: every session is easy-effort at a fixed duration (see
  // frameworks/density-progression.ts) — mostly Zone 2, with a touch more Z3 tolerance than
  // zone2-base since holding a growing distance in the same time occasionally nudges effort up.
  'density-progression': { model: 'zone2-base', weights: [0.15, 0.70, 0.10, 0.05, 0.00] },
  // Intervals (Norwegian 4×4, Helgerud/Wisløff): capped at 2 hard sessions/week, each a fixed
  // 40-min protocol with only 16 min truly at Z4–5 (the 4×4 work reps) — less total hard-zone
  // share than a continuous VO2max block, since the rest of the week is easy fill + one long run.
  'norwegian-4x4':     { model: 'polarized',        weights: [0.15, 0.65, 0.06, 0.09, 0.05] },
}

const DEFAULT_KEY = 'polarized-80-20'

export interface ZoneTarget {
  zoneId: HrZone['id']
  minutes: number
}

export interface WeeklyZoneTargets {
  frameworkKey: string
  model: IntensityModel
  totalMinutes: number
  perZone: ZoneTarget[]
  easyShare: number          // fraction in Z1–2
  moderateShare: number      // fraction in Z3
  hardShare: number          // fraction in Z4–5
  /** Moderate-equivalent minutes (Z2–3 + 2×Z4–5; Z1 excluded as "light"). */
  moderateEquivMinutes: number
  /** Meets the ACSM/WHO/AHA 150-min moderate-equivalent floor. */
  meetsActivityGuideline: boolean
  guidelineNote: string
}

const GUIDELINE_MIN = 150 // min/wk moderate-equivalent (WHO/AHA/ACSM)

/** Weekly per-zone minute targets for a framework at a given weekly volume. Volume is
 *  floored at the 150-min public-health guideline so even a light plan states the floor. */
export function weeklyZoneTargets(frameworkKey: string, weeklyMinutes: number): WeeklyZoneTargets {
  const def = ZONE_WEIGHTS[frameworkKey] ?? ZONE_WEIGHTS[DEFAULT_KEY]
  const total = Math.max(GUIDELINE_MIN, Math.round(weeklyMinutes))
  const perZone: ZoneTarget[] = def.weights.map((w, i) => ({
    zoneId: (i + 1) as HrZone['id'],
    minutes: Math.round(total * w),
  }))
  const min = (z: number) => perZone[z - 1].minutes
  const easy = min(1) + min(2)
  const moderate = min(3)
  const hard = min(4) + min(5)
  // Vigorous (Z4–5) counts double; Z1 is light and excluded from the moderate tally.
  const moderateEquiv = min(2) + min(3) + 2 * hard
  const meets = moderateEquiv >= GUIDELINE_MIN
  return {
    frameworkKey,
    model: def.model,
    totalMinutes: total,
    perZone,
    easyShare: easy / total,
    moderateShare: moderate / total,
    hardShare: hard / total,
    moderateEquivMinutes: moderateEquiv,
    meetsActivityGuideline: meets,
    guidelineNote: meets
      ? `Meets the 150 min/week moderate-activity guideline (${moderateEquiv} moderate-equivalent min).`
      : `${moderateEquiv} of the 150 moderate-equivalent min/week guideline — add easy aerobic volume.`,
  }
}
