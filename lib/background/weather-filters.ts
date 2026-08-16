import type { WeatherCondition } from '@/lib/weather/types'

const WEATHER_FILTERS: Record<WeatherCondition, string> = {
  clear: 'none',
  cloudy: 'saturate(0.85) brightness(0.95)',
  rain: 'saturate(0.6) brightness(0.75) hue-rotate(-5deg)',
  fog: 'saturate(0.4) brightness(0.9)',
  snow: 'saturate(0.7) brightness(1.05)',
  thunderstorm: 'saturate(0.5) brightness(0.6)',
}

export function getSkyFilter(condition: WeatherCondition): string {
  return WEATHER_FILTERS[condition]
}
