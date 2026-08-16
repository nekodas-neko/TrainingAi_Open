> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Dynamic Wallpaper Backgrounds — Data & Settings Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the weather + location data layer, a persisted settings store, the Profile settings UI, and a home-screen weather chip — the foundation that the visual rendering plan (Plan 2: dynamic background scenes) will consume.

**Architecture:** Weather data is fetched client-side from Open-Meteo (free, no API key) using device geolocation with a manual fallback location, cached in localStorage with a 30-minute TTL. A small persisted Zustand store holds the dynamic-background master toggle, per-section toggles (Home/Health/Workout/Nutrition/More), and the manual fallback location. A `useWeather()` hook exposes `{ condition, temperatureC, sunrise, sunset }` to both the new weather chip (this plan) and the background renderer (Plan 2).

**Tech Stack:** Next.js 15 / React 19, Zustand (`persist` middleware), Open-Meteo forecast + geocoding APIs, `@capacitor/geolocation` (new dependency, Android APK), lucide-react icons, vitest.

Reference spec: `docs/superpowers/specs/2026-06-11-dynamic-wallpaper-backgrounds-design.md`

---

## File Structure

| File | Purpose |
|---|---|
| `lib/weather/types.ts` | `WeatherCondition`, `LocationCoords`, `ManualLocation`, `WeatherSnapshot` types |
| `lib/weather/open-meteo.ts` | `mapWeatherCode()` (WMO → `WeatherCondition`) and `fetchWeatherSnapshot()` |
| `lib/weather/geocode.ts` | `geocodeLocation()` — name → `{lat, lon, name}` via Open-Meteo geocoding API |
| `lib/weather/use-weather.ts` | `useWeather()` hook — location resolution, localStorage cache, fetch |
| `lib/location.ts` | `getDeviceLocation()` — web Geolocation API + `@capacitor/geolocation` on Android |
| `lib/stores/background-settings-store.ts` | Persisted Zustand store: `enabled`, `sections`, `manualLocation` |
| `components/weather-chip.tsx` | Home screen weather pill (icon + temperature) |
| `components/profile/dynamic-background-settings.tsx` | Profile → Appearance settings UI |
| `lib/__tests__/open-meteo.test.ts` | Tests for `mapWeatherCode` and `fetchWeatherSnapshot` |
| `lib/__tests__/geocode.test.ts` | Tests for `geocodeLocation` |
| `app/session-select/session-select-content.tsx` | **Modify** — render `<WeatherChip />` in header |
| `components/more/profile-tab.tsx` | **Modify** — render `<DynamicBackgroundSettings />` in Appearance section |
| `package.json` / `pnpm-lock.yaml` | **Modify** — add `@capacitor/geolocation` |
| `android/app/src/main/AndroidManifest.xml` | **Modify** — add location permissions |

---

### Task 1: Weather types + WMO weather-code mapping

**Files:**
- Create: `lib/weather/types.ts`
- Create: `lib/weather/open-meteo.ts`
- Test: `lib/__tests__/open-meteo.test.ts`

- [ ] **Step 1: Write the types file and the failing test**

`lib/weather/types.ts`:

```ts
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
  sunrise: string
  sunset: string
  fetchedAt: number
  lat: number
  lon: number
}
```

`lib/__tests__/open-meteo.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mapWeatherCode } from '../weather/open-meteo'

describe('mapWeatherCode', () => {
  it('maps code 0 to clear', () => {
    expect(mapWeatherCode(0)).toBe('clear')
  })

  it('maps codes 1-3 and unrecognised codes to cloudy', () => {
    expect(mapWeatherCode(1)).toBe('cloudy')
    expect(mapWeatherCode(2)).toBe('cloudy')
    expect(mapWeatherCode(3)).toBe('cloudy')
    expect(mapWeatherCode(4)).toBe('cloudy')
  })

  it('maps codes 45 and 48 to fog', () => {
    expect(mapWeatherCode(45)).toBe('fog')
    expect(mapWeatherCode(48)).toBe('fog')
  })

  it('maps drizzle, rain and rain-shower codes to rain', () => {
    expect(mapWeatherCode(51)).toBe('rain')
    expect(mapWeatherCode(63)).toBe('rain')
    expect(mapWeatherCode(67)).toBe('rain')
    expect(mapWeatherCode(80)).toBe('rain')
    expect(mapWeatherCode(82)).toBe('rain')
  })

  it('maps snow and snow-shower codes to snow', () => {
    expect(mapWeatherCode(71)).toBe('snow')
    expect(mapWeatherCode(77)).toBe('snow')
    expect(mapWeatherCode(85)).toBe('snow')
    expect(mapWeatherCode(86)).toBe('snow')
  })

  it('maps codes 95-99 to thunderstorm', () => {
    expect(mapWeatherCode(95)).toBe('thunderstorm')
    expect(mapWeatherCode(96)).toBe('thunderstorm')
    expect(mapWeatherCode(99)).toBe('thunderstorm')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run lib/__tests__/open-meteo.test.ts`
Expected: FAIL — `lib/weather/open-meteo.ts` does not exist (module resolution error).

- [ ] **Step 3: Implement `mapWeatherCode`**

`lib/weather/open-meteo.ts`:

```ts
import type { WeatherCondition } from './types'

export function mapWeatherCode(code: number): WeatherCondition {
  if (code === 0) return 'clear'
  if (code === 45 || code === 48) return 'fog'
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if (code >= 95 && code <= 99) return 'thunderstorm'
  return 'cloudy'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run lib/__tests__/open-meteo.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/weather/types.ts lib/weather/open-meteo.ts lib/__tests__/open-meteo.test.ts
git commit -m "Add weather types and WMO weather-code mapping"
```

---

### Task 2: Fetch current weather from Open-Meteo

**Files:**
- Modify: `lib/weather/open-meteo.ts`
- Modify (test): `lib/__tests__/open-meteo.test.ts`

- [ ] **Step 1: Write the failing tests**

Update the import line at the top of `lib/__tests__/open-meteo.test.ts` from:

```ts
import { describe, it, expect } from 'vitest'
import { mapWeatherCode } from '../weather/open-meteo'
```

to:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mapWeatherCode, fetchWeatherSnapshot } from '../weather/open-meteo'
```

Then append this new `describe` block at the end of the file:

```ts
describe('fetchWeatherSnapshot', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds the request URL and maps the response into a WeatherSnapshot', async () => {
    const mockJson = {
      current: { temperature_2m: 16.2, weather_code: 3 },
      daily: { sunrise: ['2026-06-11T06:32'], sunset: ['2026-06-11T17:08'] },
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockJson),
    })
    vi.stubGlobal('fetch', fetchMock)

    const snapshot = await fetchWeatherSnapshot({ lat: -27.4006, lon: 152.9595 })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('latitude=-27.4006&longitude=152.9595'),
    )
    expect(snapshot).toMatchObject({
      condition: 'cloudy',
      temperatureC: 16.2,
      sunrise: '2026-06-11T06:32',
      sunset: '2026-06-11T17:08',
      lat: -27.4006,
      lon: 152.9595,
    })
    expect(typeof snapshot.fetchedAt).toBe('number')
  })

  it('throws when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    await expect(fetchWeatherSnapshot({ lat: 0, lon: 0 })).rejects.toThrow(
      'Open-Meteo request failed: 500',
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run lib/__tests__/open-meteo.test.ts`
Expected: FAIL — `fetchWeatherSnapshot` is not exported from `../weather/open-meteo`.

- [ ] **Step 3: Implement `fetchWeatherSnapshot`**

Add to `lib/weather/open-meteo.ts` (below `mapWeatherCode`):

```ts
import type { LocationCoords, WeatherSnapshot } from './types'

export async function fetchWeatherSnapshot({ lat, lon }: LocationCoords): Promise<WeatherSnapshot> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,weather_code&daily=sunrise,sunset&timezone=auto`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Open-Meteo request failed: ${res.status}`)
  const data = await res.json()
  return {
    condition: mapWeatherCode(data.current.weather_code),
    temperatureC: data.current.temperature_2m,
    sunrise: data.daily.sunrise[0],
    sunset: data.daily.sunset[0],
    fetchedAt: Date.now(),
    lat,
    lon,
  }
}
```

Update the existing `import type { WeatherCondition } from './types'` line at the top of the file to:

```ts
import type { WeatherCondition, LocationCoords, WeatherSnapshot } from './types'
```

(and remove the duplicate `import type` line you just added inline above — there should be a single combined type import at the top of the file).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run lib/__tests__/open-meteo.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/weather/open-meteo.ts lib/__tests__/open-meteo.test.ts
git commit -m "Fetch current weather snapshot from Open-Meteo"
```

---

### Task 3: Geocode a location name for the manual fallback

**Files:**
- Create: `lib/weather/geocode.ts`
- Test: `lib/__tests__/geocode.test.ts`

- [ ] **Step 1: Write the failing test**

`lib/__tests__/geocode.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { geocodeLocation } from '../weather/geocode'

describe('geocodeLocation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the first result with name and admin1 combined', async () => {
    const mockJson = {
      results: [{ latitude: -27.42, longitude: 152.96, name: 'Mitchelton', admin1: 'Queensland' }],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockJson) }))

    const result = await geocodeLocation('Mitchelton')

    expect(result).toEqual({ lat: -27.42, lon: 152.96, name: 'Mitchelton, Queensland' })
  })

  it('falls back to just the name when admin1 is missing', async () => {
    const mockJson = { results: [{ latitude: 51.5, longitude: -0.12, name: 'London' }] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockJson) }))

    const result = await geocodeLocation('London')

    expect(result).toEqual({ lat: 51.5, lon: -0.12, name: 'London' })
  })

  it('returns null when there are no results', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ results: [] }) }))

    const result = await geocodeLocation('Nowhereville')

    expect(result).toBeNull()
  })

  it('throws when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    await expect(geocodeLocation('Mitchelton')).rejects.toThrow('Geocoding request failed: 500')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run lib/__tests__/geocode.test.ts`
Expected: FAIL — `lib/weather/geocode.ts` does not exist.

- [ ] **Step 3: Implement `geocodeLocation`**

`lib/weather/geocode.ts`:

```ts
import type { ManualLocation } from './types'

interface GeocodeResult {
  latitude: number
  longitude: number
  name: string
  admin1?: string
}

interface GeocodeResponse {
  results?: GeocodeResult[]
}

export async function geocodeLocation(query: string): Promise<ManualLocation | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Geocoding request failed: ${res.status}`)
  const data = (await res.json()) as GeocodeResponse
  const result = data.results?.[0]
  if (!result) return null
  return {
    lat: result.latitude,
    lon: result.longitude,
    name: result.admin1 ? `${result.name}, ${result.admin1}` : result.name,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run lib/__tests__/geocode.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/weather/geocode.ts lib/__tests__/geocode.test.ts
git commit -m "Add geocoding lookup for manual fallback location"
```

---

### Task 4: Background settings store (Zustand, persisted)

**Files:**
- Create: `lib/stores/background-settings-store.ts`

- [ ] **Step 1: Write the store**

`lib/stores/background-settings-store.ts`:

```ts
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ManualLocation } from '@/lib/weather/types'

export type BackgroundSection = 'home' | 'health' | 'workout' | 'nutrition' | 'more'

interface BackgroundSettingsState {
  enabled: boolean
  sections: Record<BackgroundSection, boolean>
  manualLocation: ManualLocation | null
  setEnabled: (enabled: boolean) => void
  setSectionEnabled: (section: BackgroundSection, enabled: boolean) => void
  setManualLocation: (location: ManualLocation | null) => void
}

const DEFAULT_SECTIONS: Record<BackgroundSection, boolean> = {
  home: true,
  health: true,
  workout: true,
  nutrition: true,
  more: true,
}

export const useBackgroundSettingsStore = create<BackgroundSettingsState>()(
  persist(
    (set) => ({
      enabled: false,
      sections: DEFAULT_SECTIONS,
      manualLocation: null,
      setEnabled: (enabled) => set({ enabled }),
      setSectionEnabled: (section, enabled) =>
        set((s) => ({ sections: { ...s.sections, [section]: enabled } })),
      setManualLocation: (manualLocation) => set({ manualLocation }),
    }),
    {
      name: 'ta_background_settings',
      storage: createJSONStorage(() => localStorage),
    },
  ),
)
```

- [ ] **Step 2: Verify it type-checks**

Run: `pnpm exec tsc --noEmit`
Expected: No new errors referencing `lib/stores/background-settings-store.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/stores/background-settings-store.ts
git commit -m "Add persisted store for dynamic background settings"
```

---

### Task 5: Device location helper (web + Capacitor)

**Files:**
- Create: `lib/location.ts`
- Modify: `package.json`, `pnpm-lock.yaml`
- Modify: `android/app/src/main/AndroidManifest.xml`

- [ ] **Step 1: Check for an existing geolocation wrapper before adding one**

Run: `grep -r "@capacitor/geolocation" package.json` and check for `lib/location.ts` or similar (`find lib -iname "*location*"`).

A separate GPS/activity-tracking effort may land first and already add `@capacitor/geolocation` plus a location wrapper and the Android permissions below. If `lib/location.ts` (or an equivalent `getDeviceLocation`-style helper) already exists and exports a `LocationCoords`-shaped `{ lat, lon }` result, skip Steps 2-3 and reuse that helper directly in Task 6 instead of creating a new one — adjust the import in `lib/weather/use-weather.ts` accordingly. Otherwise continue with Steps 2-4 below.

- [ ] **Step 2: Add the `@capacitor/geolocation` dependency**

Run: `pnpm add @capacitor/geolocation`
Expected: `package.json` dependencies gain `@capacitor/geolocation`, `pnpm-lock.yaml` updates.

- [ ] **Step 3: Add Android location permissions**

Modify `android/app/src/main/AndroidManifest.xml` — change:

```xml
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.VIBRATE" />
```

to:

```xml
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
```

- [ ] **Step 3: Implement `getDeviceLocation`**

`lib/location.ts`:

```ts
import { Capacitor } from '@capacitor/core'
import type { LocationCoords } from '@/lib/weather/types'

const TIMEOUT_MS = 10_000
const MAX_AGE_MS = 60 * 60 * 1000

export async function getDeviceLocation(): Promise<LocationCoords | null> {
  if (Capacitor.isNativePlatform()) return getNativeLocation()
  return getWebLocation()
}

async function getNativeLocation(): Promise<LocationCoords | null> {
  try {
    const { Geolocation } = await import('@capacitor/geolocation')
    const status = await Geolocation.checkPermissions()
    if (status.location !== 'granted' && status.coarseLocation !== 'granted') {
      const requested = await Geolocation.requestPermissions()
      if (requested.location !== 'granted' && requested.coarseLocation !== 'granted') return null
    }
    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: false,
      timeout: TIMEOUT_MS,
    })
    return { lat: position.coords.latitude, lon: position.coords.longitude }
  } catch {
    return null
  }
}

function getWebLocation(): Promise<LocationCoords | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: TIMEOUT_MS, maximumAge: MAX_AGE_MS },
    )
  })
}
```

- [ ] **Step 4: Verify it type-checks**

Run: `pnpm exec tsc --noEmit`
Expected: No new errors referencing `lib/location.ts`.

- [ ] **Step 5: Commit**

```bash
git add lib/location.ts package.json pnpm-lock.yaml android/app/src/main/AndroidManifest.xml
git commit -m "Add device location helper for web and Android"
```

---

### Task 6: `useWeather` hook — location resolution, caching, fetch

**Files:**
- Create: `lib/weather/use-weather.ts`

- [ ] **Step 1: Implement the hook**

`lib/weather/use-weather.ts`:

```ts
'use client'

import { useEffect, useState } from 'react'
import { useBackgroundSettingsStore } from '@/lib/stores/background-settings-store'
import { getDeviceLocation } from '@/lib/location'
import { fetchWeatherSnapshot } from './open-meteo'
import type { WeatherSnapshot } from './types'

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

export function useWeather() {
  const manualLocation = useBackgroundSettingsStore((s) => s.manualLocation)
  const [snapshot, setSnapshot] = useState<WeatherSnapshot | null>(() => readCache())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
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
        const fresh = await fetchWeatherSnapshot(coords)
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
  }, [manualLocation])

  return { snapshot, loading }
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `pnpm exec tsc --noEmit`
Expected: No new errors referencing `lib/weather/use-weather.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/weather/use-weather.ts
git commit -m "Add useWeather hook with location resolution and caching"
```

---

### Task 7: Weather chip on the home screen

**Files:**
- Create: `components/weather-chip.tsx`
- Modify: `app/session-select/session-select-content.tsx`

- [ ] **Step 1: Implement the weather chip**

`components/weather-chip.tsx`:

```tsx
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

export function WeatherChip() {
  const { snapshot } = useWeather()
  if (!snapshot) return null

  const now = Date.now()
  const isDay = now >= new Date(snapshot.sunrise).getTime() && now < new Date(snapshot.sunset).getTime()
  const Icon = ICONS[snapshot.condition][isDay ? 'day' : 'night']

  return (
    <div className="flex items-center gap-1 rounded-full bg-muted/60 px-2.5 py-1 text-xs font-semibold">
      <Icon className="h-3.5 w-3.5" style={{ color: 'var(--color-brand)' }} />
      <span>{Math.round(snapshot.temperatureC)}°</span>
    </div>
  )
}
```

- [ ] **Step 2: Render the chip in the home screen header**

In `app/session-select/session-select-content.tsx`, add the import alongside the other component imports (near `import { AiChatOverlay } from "@/components/ai-chat-overlay";`):

```tsx
import { AiChatOverlay } from "@/components/ai-chat-overlay";
import { WeatherChip } from "@/components/weather-chip";
```

Then update the header (around line 797) — change:

```tsx
          <div className="flex items-center gap-2 flex-none">
            <button
              onClick={() => setSectionEditMode(e => !e)}
```

to:

```tsx
          <div className="flex items-center gap-2 flex-none">
            <WeatherChip />
            <button
              onClick={() => setSectionEditMode(e => !e)}
```

- [ ] **Step 3: Verify it type-checks and lints**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add components/weather-chip.tsx app/session-select/session-select-content.tsx
git commit -m "Show a weather chip on the home screen header"
```

---

### Task 8: Profile settings — dynamic background toggle, sections, fallback location

**Files:**
- Create: `components/profile/dynamic-background-settings.tsx`
- Modify: `components/more/profile-tab.tsx`

- [ ] **Step 1: Implement the settings component**

`components/profile/dynamic-background-settings.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  useBackgroundSettingsStore,
  type BackgroundSection,
} from '@/lib/stores/background-settings-store'
import { geocodeLocation } from '@/lib/weather/geocode'

const SECTION_LABELS: Record<BackgroundSection, string> = {
  home: 'Home',
  health: 'Health',
  workout: 'Workout',
  nutrition: 'Nutrition',
  more: 'More',
}

const SECTION_ORDER: BackgroundSection[] = ['home', 'health', 'workout', 'nutrition', 'more']

export function DynamicBackgroundSettings() {
  const enabled = useBackgroundSettingsStore((s) => s.enabled)
  const sections = useBackgroundSettingsStore((s) => s.sections)
  const manualLocation = useBackgroundSettingsStore((s) => s.manualLocation)
  const setEnabled = useBackgroundSettingsStore((s) => s.setEnabled)
  const setSectionEnabled = useBackgroundSettingsStore((s) => s.setSectionEnabled)
  const setManualLocation = useBackgroundSettingsStore((s) => s.setManualLocation)

  const [locationQuery, setLocationQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  async function handleLocationSearch() {
    const query = locationQuery.trim()
    if (!query) return
    setSearching(true)
    setSearchError(null)
    try {
      const result = await geocodeLocation(query)
      if (!result) {
        setSearchError('Location not found')
        return
      }
      setManualLocation(result)
      setLocationQuery('')
    } catch {
      setSearchError('Search failed — try again')
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="space-y-3 pt-3 mt-3 border-t border-border">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">Dynamic background</p>
          <p className="text-[10px] text-muted-foreground">Sky scene that follows time of day &amp; weather</p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Dynamic background" />
      </div>

      {enabled && (
        <>
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Show on</p>
            {SECTION_ORDER.map((key) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-sm">{SECTION_LABELS[key]}</span>
                <Switch
                  checked={sections[key]}
                  onCheckedChange={(checked) => setSectionEnabled(key, checked)}
                  aria-label={`Dynamic background on ${SECTION_LABELS[key]}`}
                />
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Fallback location</p>
            <p className="text-xs text-muted-foreground">
              {manualLocation
                ? `${manualLocation.name} (used if device location is unavailable)`
                : 'Device location is used; set a fallback for when it is unavailable'}
            </p>
            <div className="flex gap-2">
              <Input
                value={locationQuery}
                onChange={(e) => setLocationQuery(e.target.value)}
                placeholder="Search for a city"
                className="flex-1"
              />
              <Button type="button" onClick={handleLocationSearch} disabled={searching}>
                {searching ? '…' : 'Set'}
              </Button>
            </div>
            {searchError && <p className="text-xs text-destructive">{searchError}</p>}
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire it into the Profile Appearance section**

In `components/more/profile-tab.tsx`, add the import alongside the other profile sub-component imports (near `import { ThemeColorPicker } from '@/components/theme-color-picker'`):

```tsx
import { ThemeColorPicker } from '@/components/theme-color-picker'
import { DynamicBackgroundSettings } from '@/components/profile/dynamic-background-settings'
```

Then update the expanded Appearance section (around line 619-623) — change:

```tsx
          {appearanceExpanded && (
            <div className="px-4 pb-4 border-t border-border pt-3">
              <ThemeColorPicker />
            </div>
          )}
```

to:

```tsx
          {appearanceExpanded && (
            <div className="px-4 pb-4 border-t border-border pt-3">
              <ThemeColorPicker />
              <DynamicBackgroundSettings />
            </div>
          )}
```

- [ ] **Step 3: Verify it type-checks and lints**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add components/profile/dynamic-background-settings.tsx components/more/profile-tab.tsx
git commit -m "Add dynamic background settings to Profile > Appearance"
```

---

### Task 9: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: All tests pass, including the new `lib/__tests__/open-meteo.test.ts` and `lib/__tests__/geocode.test.ts`.

- [ ] **Step 2: Run lint and typecheck**

Run: `pnpm lint && pnpm exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Manual smoke test (local dev server)**

Run: `pnpm dev`

- Open the app on `/` (Home). If the browser prompts for location, allow it — the weather chip should appear in the header within a few seconds showing an icon + temperature (e.g. "☁️ 16°"). If location is denied and no fallback is set, the chip simply does not render (no error).
- Go to More → Theme & Appearance (expand it). Confirm the new "Dynamic background" toggle, the five per-section toggles (Home/Health/Workout/Nutrition/More) once enabled, and the "Fallback location" search box are visible and don't break the existing accent-colour picker.
- In the fallback location search box, type a city name (e.g. "Brisbane") and tap "Set". Confirm it saves and displays "Brisbane, Queensland (used if device location is unavailable)" (or similar).

If anything fails, fix it and amend with a follow-up commit (do not amend already-pushed commits).

---

## Notes for Plan 2 (visual rendering)

Plan 2 will consume:
- `useWeather()` from `lib/weather/use-weather.ts` → `{ snapshot: WeatherSnapshot | null, loading }`
- `useBackgroundSettingsStore` from `lib/stores/background-settings-store.ts` → `enabled`, `sections[currentSection]`
- `WeatherCondition` and `WeatherSnapshot` types from `lib/weather/types.ts`

No further changes to these files should be needed for Plan 2 — if Plan 2 discovers a gap (e.g. an additional field needed from the weather snapshot), extend `WeatherSnapshot` and `fetchWeatherSnapshot` rather than introducing a parallel data source.
