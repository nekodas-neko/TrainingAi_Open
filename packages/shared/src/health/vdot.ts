// VDOT & race-pace prediction — One Formula, One Place.
//
// Jack Daniels' VDOT ("Daniels' Running Formula", 3rd ed.) is a VO₂max-equivalent
// derived from a recent race result, and the basis for prescribing training paces.
// Two empirical relations (Daniels & Gilbert), used verbatim:
//   • Oxygen cost of running at velocity v (m/min), ml/kg/min:
//       vo2(v) = -4.60 + 0.182258·v + 0.000104·v²
//   • Fraction of VO₂max sustainable for a duration t (min):
//       drop(t) = 0.8 + 0.1894393·e^(-0.012778·t) + 0.2989558·e^(-0.1932605·t)
//   → VDOT = vo2(raceVelocity) / drop(raceMinutes)
//
// Training paces come from inverting vo2() at a target fraction of VDOT (the
// %VDOT intensities Daniels assigns to each run type — see VDOT_PACE_INTENSITY).
// Race-time prediction across distances uses Riegel's endurance law.

export interface VdotPaces {
  /** All paces in seconds per kilometre. */
  easySecPerKm: number
  marathonSecPerKm: number
  thresholdSecPerKm: number
  intervalSecPerKm: number
  repetitionSecPerKm: number
}

const A = 0.000104
const B = 0.182258
const C = -4.60

/** Oxygen cost (ml/kg/min) of running at velocity v (metres/min). */
export function vo2AtVelocity(vMetresPerMin: number): number {
  return C + B * vMetresPerMin + A * vMetresPerMin * vMetresPerMin
}

/** Fraction (0–1) of VO₂max sustainable for a duration of t minutes. */
export function sustainableFraction(tMinutes: number): number {
  return 0.8 + 0.1894393 * Math.exp(-0.012778 * tMinutes) + 0.2989558 * Math.exp(-0.1932605 * tMinutes)
}

/** Velocity (m/min) at which the oxygen cost equals `vo2` — inverse of vo2AtVelocity
 *  (the positive root of the quadratic). */
export function velocityAtVo2(vo2: number): number {
  // A·v² + B·v + (C − vo2) = 0
  const disc = B * B - 4 * A * (C - vo2)
  return (-B + Math.sqrt(disc)) / (2 * A)
}

/** VDOT from a race: distance in metres, time in seconds. Returns null for
 *  non-positive inputs (never throws — callers gate on it). */
export function vdotFromRace(distanceM: number, timeSec: number): number | null {
  if (!(distanceM > 0) || !(timeSec > 0)) return null
  const tMin = timeSec / 60
  const v = distanceM / tMin // m/min
  const vdot = vo2AtVelocity(v) / sustainableFraction(tMin)
  return Number.isFinite(vdot) && vdot > 0 ? Math.round(vdot * 10) / 10 : null
}

// %VDOT intensity that Daniels assigns to each training pace (fraction of VDOT the
// pace's oxygen cost represents). Sourced from Daniels' Running Formula pace tables;
// finalised against the training-science research brief (2026-07-20).
export const VDOT_PACE_INTENSITY = {
  easy: 0.70,        // E — 59–74% VO₂max range, midpoint used for the prescribed pace
  marathon: 0.84,    // M — marathon effort
  threshold: 0.88,   // T — "comfortably hard", ~1-hour race pace / lactate threshold
  interval: 0.975,   // I — ~vVO2max, 3–5 min reps
  repetition: 1.05,  // R — faster than I, short reps for speed/economy
} as const

function paceSecPerKmAtIntensity(vdot: number, fraction: number): number {
  const targetVo2 = fraction * vdot
  const vMetresPerMin = velocityAtVo2(targetVo2)
  // sec/km = 60000 (s/min·m per km) ÷ velocity(m/min)
  return Math.round(60000 / vMetresPerMin)
}

/** Prescribed training paces (sec/km) for a given VDOT. */
export function pacesFromVdot(vdot: number): VdotPaces {
  return {
    easySecPerKm: paceSecPerKmAtIntensity(vdot, VDOT_PACE_INTENSITY.easy),
    marathonSecPerKm: paceSecPerKmAtIntensity(vdot, VDOT_PACE_INTENSITY.marathon),
    thresholdSecPerKm: paceSecPerKmAtIntensity(vdot, VDOT_PACE_INTENSITY.threshold),
    intervalSecPerKm: paceSecPerKmAtIntensity(vdot, VDOT_PACE_INTENSITY.interval),
    repetitionSecPerKm: paceSecPerKmAtIntensity(vdot, VDOT_PACE_INTENSITY.repetition),
  }
}

// Riegel's endurance law: t2 = t1 · (d2/d1)^1.06. The 1.06 fatigue exponent holds
// well from ~1.5 km to the marathon (Peter Riegel, 1981). Used to predict a target-
// distance time from a recent race at another distance.
export const RIEGEL_EXPONENT = 1.06

/** Predict the time (seconds) for `toDistanceM` from a known race
 *  (`fromDistanceM` in `fromTimeSec`). Returns null for non-positive inputs. */
export function predictRaceTime(
  fromDistanceM: number,
  fromTimeSec: number,
  toDistanceM: number,
): number | null {
  if (!(fromDistanceM > 0) || !(fromTimeSec > 0) || !(toDistanceM > 0)) return null
  return Math.round(fromTimeSec * Math.pow(toDistanceM / fromDistanceM, RIEGEL_EXPONENT))
}

/**
 * Format a pace (sec/km) as `m:ss`, WITHOUT the unit.
 *
 * RV-90: three functions called `formatPace` existed with three different contracts — this file's
 * returned `5:12/km`, `pace-bar-chart.tsx`'s returned `5:12`, and `activity-detail-sheet.tsx`'s
 * returned `5:12 /km`. Same name, three meanings, and two different renderings on screen. Splitting
 * value from unit is what makes one of them enough: an axis tick wants the bare value, a stat tile
 * wants the unit, and neither has to re-derive the arithmetic to get it.
 */
export function formatPaceValue(secPerKm: number): string {
  // Round the TOTAL before splitting. Rounding the remainder instead — which this function and both
  // of the copies it replaces used to do — turns any pace in [5:59.5, 6:00) into the literal
  // "5:60", because Math.floor takes the minute before Math.round carries into it.
  const total = Math.round(secPerKm)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** Format a pace (sec/km) as "m:ss/km". */
export function formatPace(secPerKm: number): string {
  return `${formatPaceValue(secPerKm)}/km`
}
