'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  useBackgroundSettingsStore,
  type BackgroundSection,
} from '@/lib/stores/background-settings-store'
import { useWeather } from '@/lib/weather/use-weather'
import { computeDayPhase } from '@/lib/background/day-phase'
import type { WeatherCondition } from '@/lib/weather/types'
import { SkyLayer } from './sky-layer'
import { CelestialLayer, type CelestialVisibility } from './celestial-layer'
import { WeatherOverlay } from './weather-overlay'
import { ScrimLayer } from './scrim-layer'
import { ScreenPaletteLayer } from './screen-palette-layer'
import type { ScreenPaletteKey } from '@/lib/background/screen-palettes'

const RECOMPUTE_INTERVAL_MS = 60 * 1000

// Decision (Batch L chunk 1): the 4 health detail pages (/health/sleep,
// /health/readiness, /health/activity, /health/heart-rate) keep their own
// bespoke DetailHero/PAGE_GRADIENTS art rather than the dynamic wallpaper —
// they already satisfy the per-screen visual-identity goal, and don't need
// any background layer mounted underneath (their root paints an opaque
// gradient of its own). `pathnameToSection` returns null for them so
// DynamicBackground skips rendering — and skips the weather fetch — entirely.
function pathnameToSection(pathname: string): BackgroundSection | null {
  if (/^\/health\/(sleep|readiness|activity|heart-rate)(\/|$)/.test(pathname)) return null
  if (pathname.startsWith('/health')) return 'health'
  if (pathname.startsWith('/workout')) return 'workout'
  if (pathname.startsWith('/nutrition')) return 'nutrition'
  if (pathname.startsWith('/more') || pathname.startsWith('/profile')) return 'more'
  return 'home'
}

// Screens rendering a static per-screen palette (chunk 2/3) instead of the
// shared time-of-day/weather sky system, keyed finer than the 5-key toggle
// bucket above so multiple distinct scenes can share one on/off switch (e.g.
// stats gates off the "home" toggle; workout-select gates off
// the "workout" toggle while the actual in-progress /workout screen — which
// paints its own bg-black during the active phase — keeps the shared sky
// scene unchanged). Returns null for Home and the active workout screen.
function pathnameToPaletteKey(pathname: string): ScreenPaletteKey | null {
  if (/^\/health\/(sleep|readiness|activity|heart-rate)(\/|$)/.test(pathname)) return null
  if (pathname.startsWith('/health')) return 'health'
  if (pathname.startsWith('/nutrition')) return 'nutrition'
  if (pathname.startsWith('/more') || pathname.startsWith('/profile')) return 'more'
  if (pathname.startsWith('/stats')) return 'stats'
  if (pathname.startsWith('/workout-select')) return 'workoutSelect'
  if (pathname.startsWith('/session-explain')) return 'sessionExplain'
  return null
}

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
