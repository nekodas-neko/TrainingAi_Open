/**
 * Display formatters for the quantities the app renders in more than one place (RV-90).
 *
 * Each of these existed only as a per-site decision, so the same stored number read differently
 * depending on which screen you were on. Measured on the tree, for one weigh-in of **82.45 kg**:
 * Home showed `82.45 kg`, day detail `82.5 kg`, the week-day sheet `82.45kg` (raw *and* no space),
 * and the stats grid `82 kg`. The scale ingest applies no rounding — `app/api/scale-ble/samples`
 * range-validates and stores the load cell's own resolution — so the spread is the renderers', not
 * the data's.
 *
 * **Unit spacing is the part that has to live here rather than at the call site.** It is the
 * decision nobody makes deliberately: `${kg} kg` and `${kg}kg` are one keystroke apart and both
 * look right in isolation.
 */

/**
 * Round half away from zero, on the decimal the number READS as.
 *
 * Shifting the exponent through the string form rather than multiplying: `1.005 * 100` is
 * `100.49999999999999` in binary, so the obvious `Math.round(v * f) / f` rounds a clean-looking
 * half DOWN and a caller asking for two decimals gets `1.00`. `Number('1.005e2')` parses to exactly
 * `100.5`. Normalising the literal first does not help — `Number((1.005).toPrecision(15))` is
 * `1.005` and multiplying it lands back on the same artefact; the multiply is where it comes from.
 *
 * `Math.abs` before the shift and the sign after it, because `Math.round(-100.5)` is `-100` — JS
 * rounds halves toward +∞, which would make a negative round the opposite way from its positive.
 */
function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value
  const shifted = Math.round(Number(`${Math.abs(value)}e${decimals}`))
  return Math.sign(value) * Number(`${shifted}e-${decimals}`)
}

/**
 * A body weight, as `82.5 kg`.
 *
 * One decimal by default: the scale's own resolution is finer, but a tenth is the smallest change
 * that means anything day to day, and it is what four of the seven sites already showed. Pass
 * `decimals` for a surface that genuinely wants more or less — the stats grid's whole-number
 * summary is a deliberate choice, not drift, so it asks for `0` rather than being overridden here.
 */
export function formatKg(kg: number, opts?: { decimals?: number; unit?: boolean }): string {
  const decimals = opts?.decimals ?? 1
  const value = roundTo(kg, decimals).toFixed(decimals)
  return opts?.unit === false ? value : `${value} kg`
}

/**
 * An activity duration in whole minutes, as `42 min`.
 *
 * **Whole minutes, and the done screen is the one that has to change.** It showed
 * `durationMin.toFixed(1)` while every other surface rounded, so a 42.4-minute run read **42.4**
 * on the screen you see once and **42** every time you reopened it. A tenth of a minute is six
 * seconds — below the resolution anyone reads a run at, and the disagreement is what costs.
 */
export function formatMinutes(min: number, opts?: { unit?: boolean }): string {
  const value = String(Math.round(min))
  return opts?.unit === false ? value : `${value} min`
}

/**
 * A duration as `1h 05m`, falling back to `45m` under an hour.
 *
 * Five hand-rolled variants existed in three shapes — `1h05m`, `1h 5m` and `1h 05m` — so the same
 * sleep or zone total read differently on adjacent cards. The minute is zero-padded because these
 * sit in `tabular-nums` columns where an unpadded `1h 5m` shifts the digits out of line.
 */
export function formatHoursMinutes(totalMinutes: number): string {
  const m = Math.round(totalMinutes)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}
