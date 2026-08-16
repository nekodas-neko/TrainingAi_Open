import type { WeatherCondition, LocationCoords, WeatherSnapshot } from './types'

export function mapWeatherCode(code: number): WeatherCondition {
  if (code === 0) return 'clear'
  if (code === 45 || code === 48) return 'fog'
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if (code >= 95 && code <= 99) return 'thunderstorm'
  return 'cloudy'
}

export async function fetchWeatherSnapshot({ lat, lon }: LocationCoords): Promise<WeatherSnapshot> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,weather_code,uv_index&daily=sunrise,sunset&timezone=auto`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Open-Meteo request failed: ${res.status}`)
  const data = await res.json()
  return {
    condition: mapWeatherCode(data.current.weather_code),
    temperatureC: data.current.temperature_2m,
    uvIndex: data.current.uv_index,
    sunrise: data.daily.sunrise[0],
    sunset: data.daily.sunset[0],
    fetchedAt: Date.now(),
    lat,
    lon,
  }
}
