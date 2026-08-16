'use client'

import { useEffect, useState } from 'react'
import { useBackgroundSettingsStore } from '@/lib/stores/background-settings-store'
import { getDeviceLocation } from '@/lib/location'
import { fetchWeatherSnapshot } from './open-meteo'
import type { LocationCoords, WeatherSnapshot } from './types'

const CACHE_KEY = 'ta_weather_cache'
const CACHE_TTL_MS = 30 * 60 * 1000

function readCache(): WeatherSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as WeatherSnapshot) : null
  } catch {
    return null
  }
}

function writeCache(snapshot: WeatherSnapshot): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot))
  } catch {
    // localStorage unavailable or full — skip caching
  }
}

// Dedup concurrent fetches for the same coordinates — DynamicBackground and
// WeatherChip can both be mounted on Home and request weather at once.
let inflightKey: string | null = null
let inflightFetch: Promise<WeatherSnapshot> | null = null

function fetchWeatherSnapshotShared(coords: LocationCoords): Promise<WeatherSnapshot> {
  const key = `${coords.lat.toFixed(2)},${coords.lon.toFixed(2)}`
  if (inflightFetch && inflightKey === key) return inflightFetch
  inflightKey = key
  inflightFetch = fetchWeatherSnapshot(coords).finally(() => {
    inflightFetch = null
    inflightKey = null
  })
  return inflightFetch
}

export function useWeather(enabled = true) {
  const manualLocation = useBackgroundSettingsStore((s) => s.manualLocation)
  const [snapshot, setSnapshot] = useState<WeatherSnapshot | null>(() => readCache())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled) return

    const cached = readCache()
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      setSnapshot(cached)
      return
    }

    let cancelled = false
    setLoading(true)

    async function load() {
      const device = await getDeviceLocation()
      const coords = device ?? manualLocation
      if (!coords) {
        if (!cancelled) setLoading(false)
        return
      }
      try {
        const fresh = await fetchWeatherSnapshotShared(coords)
        if (!cancelled) {
          writeCache(fresh)
          setSnapshot(fresh)
        }
      } catch {
        // keep showing the stale/cached snapshot if the fetch fails
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [manualLocation, enabled])

  return { snapshot, loading }
}
