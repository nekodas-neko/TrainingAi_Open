/**
 * One way to write each kind of number (#3757).
 *
 * The same figure read three ways on three screens: lifetime volume `1.5 t` / `1.5T` / `1.5k kg`,
 * water `0.5 L` / `500ml` / bare `ml`, XP `12345` / `12,345`. A formatter changes how a stored or
 * computed number is WRITTEN, never the number: nothing here converts a unit or rounds a value that
 * a caller then computes with.
 *
 * The locale is fixed (`en-AU`, which groups with commas), not the device's, so a figure reads the
 * same on every phone and in a test.
 */

const LOCALE = 'en-AU'
const ABSENT = '—'

const isNumber = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * A whole number with thousands separators: `12,345`. `null`, `undefined` and NaN read `—`, never
 * `0` (absence is not zero). Rounds half up like `Math.round`, so a caller that rounded first gets
 * the same text. `decimals` keeps up to that many places (`1,234.5`) for the few figures that have them.
 */
export function formatCount(n: number | null | undefined, opts?: { decimals?: number }): string {
  if (!isNumber(n)) return ABSENT
  const decimals = opts?.decimals ?? 0
  // Whole numbers round like `Math.round` (half up, so -2.5 is -2); places are left to Intl.
  const value = decimals === 0 ? Math.round(n) + 0 : n
  return value.toLocaleString(LOCALE, { maximumFractionDigits: decimals })
}

/** Experience points: `12,345 XP`. */
export function formatXp(xp: number | null | undefined): string {
  return isNumber(xp) ? `${formatCount(xp)} XP` : ABSENT
}

/**
 * Volume lifted over a whole lifetime: `850 kg`, `1.5 t`, `1.2 kt`.
 *
 * Tonne is a lowercase `t` (the capital is the tesla), with a space before every unit. This is the
 * current app's More-tab stats grid (RV-207), so a profile and a friend's profile read alike.
 */
export function formatLifetimeVolume(kg: number | null | undefined): string {
  if (!isNumber(kg)) return ABSENT
  const tons = kg / 1000
  if (tons >= 1000) return `${(tons / 1000).toFixed(1)} kt`
  if (tons >= 1) return `${tons.toFixed(1)} t`
  return `${Math.round(kg)} kg`
}

/** Volume over a day, session or week: whole kilograms with separators, `4,320 kg`. */
export function formatVolumeKg(kg: number | null | undefined): string {
  return isNumber(kg) ? `${formatCount(kg)} kg` : ABSENT
}

/**
 * A water amount as the number and its unit apart, for a tile that draws the unit in its own
 * element: `{ value: '1.8', unit: 'L' }` from 1000 ml up, `{ value: '800', unit: 'ml' }` below.
 */
export function waterParts(ml: number | null | undefined): { value: string; unit: 'L' | 'ml' } | null {
  if (!isNumber(ml)) return null
  return ml >= 1000 ? { value: (ml / 1000).toFixed(1), unit: 'L' } : { value: String(Math.round(ml)), unit: 'ml' }
}

/** A water amount: `1.8 L` or `800 ml`; `—` when there is none. */
export function formatWaterMl(ml: number | null | undefined): string {
  const parts = waterParts(ml)
  return parts ? `${parts.value} ${parts.unit}` : ABSENT
}

/**
 * Distance over a whole lifetime: `12.3 km` under 100 km, `1,234 km` from 100 km; `—` for none.
 * The current app's More-tab stats grid. A single run's distance is `formatDistanceKm`.
 */
export function formatLifetimeDistance(km: number | null | undefined): string {
  if (!isNumber(km) || km <= 0) return ABSENT
  return km >= 100 ? `${formatCount(km)} km` : `${km.toFixed(1)} km`
}
