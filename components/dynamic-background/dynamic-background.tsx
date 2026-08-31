'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useBackgroundSettingsStore } from '@/lib/stores/background-settings-store'
import { useWeather } from '@/lib/weather/use-weather'
import { computeDayPhase } from '@/lib/background/day-phase'
import type { WeatherCondition } from '@/lib/weather/types'
import { SkyLayer } from './sky-layer'
import { CelestialLayer, type CelestialVisibility } from './celestial-layer'
import { WeatherOverlay } from './weather-overlay'
import { ScrimLayer } from './scrim-layer'
import { ScreenPaletteLayer } from './screen-palette-layer'
import { pathnameToSection, pathnameToPaletteKey } from '@/lib/background/pathname-routing'

const RECOMPUTE_INTERVAL_MS = 60 * 1000

function getCelestialVisibility(condition: WeatherCondition): CelestialVisibility {
  if (condition === 'clear') return 'full'
  if (condition === 'cloudy') return 'dimmed'
  return 'hidden'
}

function defaultSunrise(now: Date): Date {
  const d = new Date(now)
  d.setHours(6, 0, 0, 0)
  return d
}

function defaultSunset(now: Date): Date {
  const d = new Date(now)
  d.setHours(18, 0, 0, 0)
  return d
}

export function DynamicBackground() {
  const [mounted, setMounted] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const enabled = useBackgroundSettingsStore((s) => s.enabled)
  const sections = useBackgroundSettingsStore((s) => s.sections)
  const pathname = usePathname()

  const section = pathnameToSection(pathname)
  const paletteKey = pathnameToPaletteKey(pathname)
  const isActive = mounted && enabled && section !== null && sections[section]
  const usesSkyWeather = isActive && paletteKey === null

  const { snapshot } = useWeather(usesSkyWeather)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return

    const tick = () => setNow(new Date())
    const interval = setInterval(() => {
      if (!document.hidden) tick()
    }, RECOMPUTE_INTERVAL_MS)

    const onVisibilityChange = () => {
      if (!document.hidden) tick()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [mounted])

  useEffect(() => {
    if (isActive) {
      document.documentElement.style.setProperty('--page-bg', 'transparent')
    } else {
      document.documentElement.style.removeProperty('--page-bg')
    }
    return () => {
      document.documentElement.style.removeProperty('--page-bg')
    }
  }, [isActive])

  if (!isActive || section === null) return null

  if (paletteKey !== null) {
    return (
      <div className="fixed inset-0 z-[-1] overflow-hidden pointer-events-none">
        <ScreenPaletteLayer section={paletteKey} />
      </div>
    )
  }

  const condition: WeatherCondition = snapshot?.condition ?? 'clear'
  const sunrise = snapshot ? new Date(snapshot.sunrise) : defaultSunrise(now)
  const sunset = snapshot ? new Date(snapshot.sunset) : defaultSunset(now)
  const phase = computeDayPhase(now, sunrise, sunset)

  const style = {
    '--bg-sky-top': phase.skyTop.join(', '),
    '--bg-sky-bottom': phase.skyBottom.join(', '),
    '--bg-celestial-color': phase.celestialColor.join(', '),
    '--bg-celestial-glow': phase.celestialGlow.join(', '),
    '--bg-star-opacity': phase.starOpacity,
    '--bg-celestial-x': `${phase.celestialX}%`,
    '--bg-celestial-y': `${phase.celestialY}%`,
  } as React.CSSProperties

  return (
    <div className="fixed inset-0 z-[-1] overflow-hidden pointer-events-none" style={style}>
      <SkyLayer condition={condition} />
      <CelestialLayer visibility={getCelestialVisibility(condition)} />
      <WeatherOverlay condition={condition} isDay={phase.isDay} />
      <ScrimLayer />
    </div>
  )
}
