/**
 * Open-Meteo's WMO weather code, reduced to the six conditions the app draws (sky, icon, overlay).
 *
 * One table for both apps (#3041). Their Open-Meteo clients stay separate: the current app's reads
 * the current UV and today's sun times, and Preview's validates the response and reads hourly UV
 * and two days of daylight. But a code has to mean the same sky in both.
 */
export const WEATHER_CONDITIONS = ['clear', 'cloudy', 'rain', 'fog', 'snow', 'thunderstorm'] as const

export type WeatherCondition = (typeof WEATHER_CONDITIONS)[number]

/** Anything the table does not name (1-3 partly cloudy and overcast, unknown codes) reads as cloudy. */
export function weatherCondition(code: number): WeatherCondition {
  if (code === 0) return 'clear'
  if (code === 45 || code === 48) return 'fog'
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if (code >= 95 && code <= 99) return 'thunderstorm'
  return 'cloudy'
}
