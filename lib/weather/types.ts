import type { WeatherCondition } from '@trainingai/shared/weather/weather-condition'

export type { WeatherCondition }

export interface LocationCoords {
  lat: number
  lon: number
}

export interface ManualLocation extends LocationCoords {
  name: string
}

export interface WeatherSnapshot {
  condition: WeatherCondition
  temperatureC: number
  uvIndex: number
  sunrise: string
  sunset: string
  fetchedAt: number
  lat: number
  lon: number
}
