import { weatherCondition } from '@trainingai/shared/weather/weather-condition'
import type { LocationCoords, WeatherSnapshot } from './types'

export async function fetchWeatherSnapshot({ lat, lon }: LocationCoords): Promise<WeatherSnapshot> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,weather_code,uv_index&daily=sunrise,sunset&timezone=auto`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Open-Meteo request failed: ${res.status}`)
  const data = await res.json()
  return {
    condition: weatherCondition(data.current.weather_code),
    temperatureC: data.current.temperature_2m,
    uvIndex: data.current.uv_index,
    sunrise: data.daily.sunrise[0],
    sunset: data.daily.sunset[0],
    fetchedAt: Date.now(),
    lat,
    lon,
  }
}
