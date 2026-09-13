'use client'

import { useEffect, useState } from 'react'
import { useBackgroundSettingsStore } from '@/lib/stores/background-settings-store'
import { getDeviceLocation } from '@/lib/location'
import { fetchWeatherSnapshot } from './open-meteo'
import type { LocationCoords, WeatherSnapshot } from './types'

const CACHE_PREFIX = 'ta_weather_cache'
const CACHE_TTL_MS = 30 * 60 * 1000

/**
 * PS-35b ④. The cache was ONE unkeyed entry, read before any coordinates were known — so a device
 * that had moved showed the previous location's weather for up to 30 minutes, and the fetch that
 * would have corrected it was skipped as a fresh hit.
 *
 * Two decimal places is ~1.1 km, which matches the dedup key `fetchWeatherSnapshotShared` already
 * uses below — one rounding rule, not two. Finer would miss the cache on every step taken; coarser
 * would keep the bug at neighbourhood scale.
 */
export function weatherCacheKey(coords: LocationCoords): string {
  return `${CACHE_PREFIX}:${coords.lat.toFixed(2)},${coords.lon.toFixed(2)}`
}

function readCache(coords: LocationCoords | null): WeatherSnapshot | null {
  if (typeof window === 'undefined' || !coords) return null
  try {
    const raw = localStorage.getItem(weatherCacheKey(coords))
    return raw ? (JSON.parse(raw) as WeatherSnapshot) : null
  } catch {
    return null
  }
}

/**
 * The coordinates the last successful fetch used.
 *
 * Keying the cache by place costs the instant paint, because the key cannot be built until
 * `getDeviceLocation()` resolves — and a skeleton flash on a repeat visit is a bug in this repo.
 * This is the seed: remember where you were, paint that immediately, and let the real coordinates
 * correct it a moment later. Strictly better than the unkeyed cache it replaces, which showed the
 * old place's weather for up to 30 minutes AND skipped the fetch that would have fixed it.
 */
const LAST_COORDS_KEY = `${CACHE_PREFIX}:last`

function writeCache(coords: LocationCoords, snapshot: WeatherSnapshot): void {
  try {
    localStorage.setItem(weatherCacheKey(coords), JSON.stringify(snapshot))
    localStorage.setItem(LAST_COORDS_KEY, JSON.stringify(coords))
  } catch {
    // localStorage unavailable or full — skip caching
  }
}

function readLastCoords(): LocationCoords | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(LAST_COORDS_KEY)
    return raw ? (JSON.parse(raw) as LocationCoords) : null
  } catch {
    return null
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
  const [snapshot, setSnapshot] = useState<WeatherSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  // PS-35b ④. Without this the chip pulses forever on a failed fetch — the Q-499 shape, where an
  // absent failure state renders as an eternal skeleton and the user cannot tell "loading" from
  // "this broke". Reset on every attempt so a later success clears it.
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    // Instant paint from wherever the last fetch was, before the async location lookup starts.
    // In a `useEffect`, not a `useState` initializer — the repo's seeding rule, and the old code
    // broke it. `loading` stays true underneath, so a moved device does not read as settled.
    const seed = readCache(readLastCoords())
    if (seed) setSnapshot(seed)
    setLoading(true)
    setFailed(false)

    async function load() {
      const device = await getDeviceLocation()
      const coords = device ?? manualLocation
      if (!coords) {
        // No coordinates is not a failure — nothing was asked for, so the chip renders nothing
        // rather than an error. Permission refused and location unavailable both land here.
        if (!cancelled) setLoading(false)
        return
      }

      // Read the cache only once the coordinates are known, which is the whole of the keying fix:
      // the old code read it before `getDeviceLocation()` and so could not know which place the
      // stored snapshot belonged to.
      const cached = readCache(coords)
      if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        if (!cancelled) { setSnapshot(cached); setLoading(false) }
        return
      }

      try {
        const fresh = await fetchWeatherSnapshotShared(coords)
        if (!cancelled) {
          writeCache(coords, fresh)
          setSnapshot(fresh)
        }
      } catch {
        // A stale entry for THIS place still beats an error state; only say it failed when there
        // is nothing to show.
        if (!cancelled) {
          if (cached) setSnapshot(cached)
          else setFailed(true)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [manualLocation, enabled])

  return { snapshot, loading, failed }
}
