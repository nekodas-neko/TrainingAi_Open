/**
 * Oura's night temperature, which it sends only as a difference from its own baseline (never a
 * reading in °C). `/api/day-log` returns `{ meanC: null, devC, source: 'oura_cloud' }` for it, and
 * both apps draw the row from this one place (#3215).
 */
export const TEMPERATURE_DEVIATION_LABEL = 'Temperature vs your normal'
export const TEMPERATURE_DEVIATION_NOTE = 'From Oura, against its own baseline'

/** "+0.30 °C", "-0.20 °C", "0.00 °C". Always two decimals, signed; `null` for a non-finite value. */
export function formatTemperatureDeviation(devC: number | null | undefined): string | null {
  if (devC == null || !Number.isFinite(devC)) return null
  const fixed = devC.toFixed(2)
  // -0.001 rounds to "-0.00"; that is zero, so it carries no sign.
  const text = Number(fixed) === 0 ? '0.00' : fixed
  return `${Number(fixed) > 0 ? '+' : ''}${text} °C`
}

/**
 * The deviation-only row, or `null` when it does not apply. It applies when there is no absolute
 * mean (`meanC == null`) and a deviation is present; a night with a mean keeps its existing row.
 * A night the ring's own BLE data produced (`source: 'ble'`) is never Oura's number, so the "From
 * Oura" row stays out of it.
 */
export function ouraTemperatureDeviationRow(
  temp: { meanC?: number | null; devC?: number | null; source?: string | null } | null | undefined,
): { label: string; value: string; note: string } | null {
  if (!temp || temp.meanC != null || temp.source === 'ble') return null
  const value = formatTemperatureDeviation(temp.devC)
  if (value == null) return null
  return { label: TEMPERATURE_DEVIATION_LABEL, value, note: TEMPERATURE_DEVIATION_NOTE }
}
