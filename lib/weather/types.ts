export type WeatherCondition = 'clear' | 'cloudy' | 'rain' | 'fog' | 'snow' | 'thunderstorm'

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
