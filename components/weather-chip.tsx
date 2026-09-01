'use client'

import { Sun, Moon, Cloud, CloudRain, CloudFog, CloudSnow, CloudLightning, type LucideIcon } from 'lucide-react'
import { useWeather } from '@/lib/weather/use-weather'
import type { WeatherCondition } from '@/lib/weather/types'

const ICONS: Record<WeatherCondition, { day: LucideIcon; night: LucideIcon }> = {
  clear: { day: Sun, night: Moon },
  cloudy: { day: Cloud, night: Cloud },
  rain: { day: CloudRain, night: CloudRain },
  fog: { day: CloudFog, night: CloudFog },
  snow: { day: CloudSnow, night: CloudSnow },
  thunderstorm: { day: CloudLightning, night: CloudLightning },
}

function uvColor(uvIndex: number): string {
  if (uvIndex >= 11) return '#8b5cf6' // extreme
  if (uvIndex >= 8) return '#ef4444' // very high
  if (uvIndex >= 6) return '#f97316' // high
  if (uvIndex >= 3) return '#eab308' // moderate
  return '#22c55e' // low
}

export function WeatherChip() {
  const { snapshot, loading } = useWeather()
  if (!snapshot) {
    if (!loading) return null
    return <div className="h-[26px] w-14 rounded-full bg-muted/60 animate-pulse" />
  }

  const now = Date.now()
  const isDay = now >= new Date(snapshot.sunrise).getTime() && now < new Date(snapshot.sunset).getTime()
  const Icon = ICONS[snapshot.condition][isDay ? 'day' : 'night']
  const showUv = isDay && snapshot.uvIndex >= 1

  // BF-96: `whitespace-nowrap shrink-0` because the sibling date in the header row already carries
  // both, so this chip was the only compressible item there and took 100% of any shortfall — `UV 5`
  // broke at its own space and the pill went two lines tall. Nothing about the layout changed:
  // `EEEE d MMMM` runs 12–20 characters across the year, and a long date is what runs the row out
  // of width, which is why it looked fine on shorter ones.
  return (
    <div className="flex items-center gap-1 whitespace-nowrap shrink-0 rounded-full bg-muted/60 px-2.5 py-1 text-xs font-semibold">
      <Icon className="h-3.5 w-3.5" style={{ color: 'var(--color-brand)' }} />
      <span>{Math.round(snapshot.temperatureC)}°</span>
      {showUv && (
        <>
          <span className="text-muted-foreground/40">·</span>
          <span style={{ color: uvColor(snapshot.uvIndex) }}>UV {Math.round(snapshot.uvIndex)}</span>
        </>
      )}
    </div>
  )
}
