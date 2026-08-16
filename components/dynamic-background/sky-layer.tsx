import { getSkyFilter } from '@/lib/background/weather-filters'
import type { WeatherCondition } from '@/lib/weather/types'

export function SkyLayer({ condition }: { condition: WeatherCondition }) {
  return (
    <div
      className="absolute inset-0"
      style={{
        background: 'linear-gradient(to bottom, rgb(var(--bg-sky-top)), rgb(var(--bg-sky-bottom)))',
        filter: getSkyFilter(condition),
      }}
    />
  )
}
