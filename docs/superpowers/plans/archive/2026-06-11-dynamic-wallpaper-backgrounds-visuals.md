> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Dynamic Wallpaper Backgrounds — Visual Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure-CSS layered background renderer — sky gradient, sun/moon, weather effects, scrim — driven by continuous sunrise/sunset-aware day-phase interpolation, and mount it behind all app content.

**Architecture:** A `<DynamicBackground>` client component is mounted once in `app/layout.tsx`, fixed behind all content (`z-index: -1`). It reads `useWeather()` and `useBackgroundSettingsStore()` (from Plan 1), recomputes a `computeDayPhase()` result every ~60s (paused while the tab is hidden), and writes the result to CSS custom properties consumed by stacked `<div>` layers: sky gradient → celestial body → weather overlay (clouds/rain/snow/fog/stars/lightning) → dark scrim. Zero SVG, zero canvas — all animation is `transform`/`opacity`/`filter` via CSS keyframes, with `motion-reduce:` variants disabling animation for `prefers-reduced-motion`.

**Tech Stack:** Next.js 15 / React 19, Tailwind CSS v4 (arbitrary values + `motion-reduce:` variant), CSS custom properties, vitest.

Reference spec: `docs/superpowers/specs/2026-06-11-dynamic-wallpaper-backgrounds-design.md`
Depends on: `docs/superpowers/plans/2026-06-11-dynamic-wallpaper-backgrounds-data-settings.md` (Plan 1) — this plan consumes `useWeather()` from `lib/weather/use-weather.ts` and `useBackgroundSettingsStore` from `lib/stores/background-settings-store.ts` exactly as defined there. **Plan 1 must be implemented first.**

---

## File Structure

| File | Purpose |
|---|---|
| `lib/background/palettes.ts` | Day-phase palette anchor definitions (deep night / dawn / day / dusk) |
| `lib/background/day-phase.ts` | `computeDayPhase()` — continuous interpolation + celestial arc position |
| `lib/background/weather-filters.ts` | `getSkyFilter()` — CSS `filter` string per `WeatherCondition` |
| `lib/__tests__/day-phase.test.ts` | Tests for `computeDayPhase` |
| `lib/__tests__/weather-filters.test.ts` | Tests for `getSkyFilter` |
| `components/dynamic-background/sky-layer.tsx` | Sky gradient div + weather filter |
| `components/dynamic-background/celestial-layer.tsx` | Sun/moon radial-gradient disc |
| `components/dynamic-background/particles.tsx` | Stars / clouds / rain / snow / fog / lightning particle layers |
| `components/dynamic-background/weather-overlay.tsx` | Switches on `WeatherCondition`, composes particle layers |
| `components/dynamic-background/scrim-layer.tsx` | Dark gradient scrim for readability |
| `components/dynamic-background/dynamic-background.tsx` | Top-level orchestrator — mounted in layout |
| `app/globals.css` | **Modify** — new keyframes + particle utility classes |
| `app/layout.tsx` | **Modify** — mount `<DynamicBackground>`, raise main content to `z-index: 1` |

---

### Task 1: Palette anchors + day-phase interpolation

**Files:**
- Create: `lib/background/palettes.ts`
- Create: `lib/background/day-phase.ts`
- Test: `lib/__tests__/day-phase.test.ts`

- [ ] **Step 1: Write the palette anchor definitions**

`lib/background/palettes.ts`:

```ts
export interface PaletteAnchor {
  skyTop: readonly [number, number, number]
  skyBottom: readonly [number, number, number]
  celestialColor: readonly [number, number, number]
  celestialGlow: readonly [number, number, number]
  starOpacity: number
}

export const PALETTES = {
  deepNight: {
    skyTop: [5, 8, 24],
    skyBottom: [16, 22, 48],
    celestialColor: [232, 240, 255],
    celestialGlow: [170, 195, 255],
    starOpacity: 1,
  },
  dawn: {
    skyTop: [50, 40, 90],
    skyBottom: [255, 145, 90],
    celestialColor: [255, 214, 170],
    celestialGlow: [255, 180, 120],
    starOpacity: 0,
  },
  day: {
    skyTop: [70, 140, 230],
    skyBottom: [180, 220, 255],
    celestialColor: [255, 247, 214],
    celestialGlow: [255, 240, 200],
    starOpacity: 0,
  },
  dusk: {
    skyTop: [55, 25, 75],
    skyBottom: [255, 110, 120],
    celestialColor: [255, 200, 150],
    celestialGlow: [255, 150, 130],
    starOpacity: 0,
  },
} as const satisfies Record<'deepNight' | 'dawn' | 'day' | 'dusk', PaletteAnchor>
```

- [ ] **Step 2: Write the failing test for `computeDayPhase`**

`lib/__tests__/day-phase.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeDayPhase } from '../background/day-phase'
import { PALETTES } from '../background/palettes'

const sunrise = new Date('2026-06-11T06:32:00')
const sunset = new Date('2026-06-11T17:08:00')

describe('computeDayPhase', () => {
  it('returns the deep night palette exactly at solar midnight', () => {
    const solarMidnight = new Date('2026-06-10T23:50:00')
    const result = computeDayPhase(solarMidnight, sunrise, sunset)

    expect(result.skyTop).toEqual(PALETTES.deepNight.skyTop)
    expect(result.skyBottom).toEqual(PALETTES.deepNight.skyBottom)
    expect(result.celestialColor).toEqual(PALETTES.deepNight.celestialColor)
    expect(result.celestialGlow).toEqual(PALETTES.deepNight.celestialGlow)
    expect(result.starOpacity).toBe(PALETTES.deepNight.starOpacity)
  })

  it('returns the dawn palette during the dawn window', () => {
    const duringDawn = new Date('2026-06-11T06:00:00')
    const result = computeDayPhase(duringDawn, sunrise, sunset)

    expect(result.skyTop).toEqual(PALETTES.dawn.skyTop)
    expect(result.skyBottom).toEqual(PALETTES.dawn.skyBottom)
    expect(result.starOpacity).toBe(0)
  })

  it('returns the day palette and is marked as day at solar noon', () => {
    const solarNoon = new Date('2026-06-11T11:50:00')
    const result = computeDayPhase(solarNoon, sunrise, sunset)

    expect(result.skyTop).toEqual(PALETTES.day.skyTop)
    expect(result.skyBottom).toEqual(PALETTES.day.skyBottom)
    expect(result.isDay).toBe(true)
    expect(result.celestialX).toBeCloseTo(50, 5)
    expect(result.celestialY).toBeCloseTo(20, 5)
  })

  it('returns the dusk palette during the dusk window', () => {
    const duringDusk = new Date('2026-06-11T17:30:00')
    const result = computeDayPhase(duringDusk, sunrise, sunset)

    expect(result.skyTop).toEqual(PALETTES.dusk.skyTop)
    expect(result.skyBottom).toEqual(PALETTES.dusk.skyBottom)
    expect(result.isDay).toBe(false)
  })

  it('linearly interpolates between dawn and day in the gap between them', () => {
    // Halfway between sunrise (06:32, dawn) and sunrise+90min (08:02, day) -> 07:17
    const midGap = new Date('2026-06-11T07:17:00')
    const result = computeDayPhase(midGap, sunrise, sunset)

    expect(result.skyTop[0]).toBeCloseTo((PALETTES.dawn.skyTop[0] + PALETTES.day.skyTop[0]) / 2, 5)
    expect(result.skyTop[1]).toBeCloseTo((PALETTES.dawn.skyTop[1] + PALETTES.day.skyTop[1]) / 2, 5)
    expect(result.skyTop[2]).toBeCloseTo((PALETTES.dawn.skyTop[2] + PALETTES.day.skyTop[2]) / 2, 5)
  })

  it('places the sun low at sunrise and traces an arc to sunset', () => {
    const atSunrise = computeDayPhase(sunrise, sunrise, sunset)
    expect(atSunrise.isDay).toBe(true)
    expect(atSunrise.celestialX).toBeCloseTo(0, 5)
    expect(atSunrise.celestialY).toBeCloseTo(85, 5)

    const atSunset = computeDayPhase(sunset, sunrise, sunset)
    expect(atSunset.isDay).toBe(true)
    expect(atSunset.celestialX).toBeCloseTo(100, 5)
    expect(atSunset.celestialY).toBeCloseTo(85, 5)
  })

  it('places the moon at its peak at solar midnight', () => {
    const solarMidnight = new Date('2026-06-10T23:50:00')
    const result = computeDayPhase(solarMidnight, sunrise, sunset)

    expect(result.isDay).toBe(false)
    expect(result.celestialX).toBeCloseTo(50, 5)
    expect(result.celestialY).toBeCloseTo(20, 5)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run lib/__tests__/day-phase.test.ts`
Expected: FAIL — `lib/background/day-phase.ts` does not exist (module resolution error).

- [ ] **Step 4: Implement `computeDayPhase`**

`lib/background/day-phase.ts`:

```ts
import { PALETTES, type PaletteAnchor } from './palettes'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export interface DayPhaseResult {
  skyTop: readonly [number, number, number]
  skyBottom: readonly [number, number, number]
  celestialColor: readonly [number, number, number]
  celestialGlow: readonly [number, number, number]
  starOpacity: number
  isDay: boolean
  celestialX: number
  celestialY: number
}

interface Keyframe {
  time: number
  palette: PaletteAnchor
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpRgb(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

function buildKeyframes(sunriseMs: number, sunsetMs: number): Keyframe[] {
  const prevSolarMidnight = (sunsetMs - DAY_MS + sunriseMs) / 2
  const nextSolarMidnight = (sunsetMs + sunriseMs + DAY_MS) / 2

  return [
    { time: prevSolarMidnight, palette: PALETTES.deepNight },
    { time: sunriseMs - HOUR_MS, palette: PALETTES.dawn },
    { time: sunriseMs, palette: PALETTES.dawn },
    { time: sunriseMs + 90 * 60 * 1000, palette: PALETTES.day },
    { time: sunsetMs - 90 * 60 * 1000, palette: PALETTES.day },
    { time: sunsetMs, palette: PALETTES.dusk },
    { time: sunsetMs + HOUR_MS, palette: PALETTES.dusk },
    { time: nextSolarMidnight, palette: PALETTES.deepNight },
  ]
}

function findBracket(all: Keyframe[], nowMs: number): [Keyframe, Keyframe] {
  for (let i = 0; i < all.length - 1; i++) {
    if (nowMs >= all[i].time && nowMs <= all[i + 1].time) {
      return [all[i], all[i + 1]]
    }
  }
  return [all[0], all[all.length - 1]]
}

function computeCelestialPosition(
  nowMs: number,
  sunriseMs: number,
  sunsetMs: number,
  isDay: boolean,
): { celestialX: number; celestialY: number } {
  let start: number
  let end: number
  if (isDay) {
    start = sunriseMs
    end = sunsetMs
  } else if (nowMs > sunsetMs) {
    start = sunsetMs
    end = sunriseMs + DAY_MS
  } else {
    start = sunsetMs - DAY_MS
    end = sunriseMs
  }

  const span = end - start
  const progress = span === 0 ? 0 : Math.min(1, Math.max(0, (nowMs - start) / span))
  const celestialX = progress * 100
  const arc = 1 - (2 * progress - 1) ** 2
  const celestialY = 85 - arc * 65

  return { celestialX, celestialY }
}

export function computeDayPhase(now: Date, sunrise: Date, sunset: Date): DayPhaseResult {
  const sunriseMs = sunrise.getTime()
  const sunsetMs = sunset.getTime()
  const nowMs = now.getTime()

  const base = buildKeyframes(sunriseMs, sunsetMs)
  const all = [
    ...base.map((k) => ({ ...k, time: k.time - DAY_MS })),
    ...base,
    ...base.map((k) => ({ ...k, time: k.time + DAY_MS })),
  ].sort((a, b) => a.time - b.time)

  const [prev, next] = findBracket(all, nowMs)
  const span = next.time - prev.time
  const t = span === 0 ? 0 : (nowMs - prev.time) / span

  const isDay = nowMs >= sunriseMs && nowMs <= sunsetMs
  const { celestialX, celestialY } = computeCelestialPosition(nowMs, sunriseMs, sunsetMs, isDay)

  return {
    skyTop: lerpRgb(prev.palette.skyTop, next.palette.skyTop, t),
    skyBottom: lerpRgb(prev.palette.skyBottom, next.palette.skyBottom, t),
    celestialColor: lerpRgb(prev.palette.celestialColor, next.palette.celestialColor, t),
    celestialGlow: lerpRgb(prev.palette.celestialGlow, next.palette.celestialGlow, t),
    starOpacity: lerp(prev.palette.starOpacity, next.palette.starOpacity, t),
    isDay,
    celestialX,
    celestialY,
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run lib/__tests__/day-phase.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/background/palettes.ts lib/background/day-phase.ts lib/__tests__/day-phase.test.ts
git commit -m "Add continuous day-phase interpolation for dynamic background"
```

---

### Task 2: Weather sky filters

**Files:**
- Create: `lib/background/weather-filters.ts`
- Test: `lib/__tests__/weather-filters.test.ts`

- [ ] **Step 1: Write the failing test**

`lib/__tests__/weather-filters.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getSkyFilter } from '../background/weather-filters'

describe('getSkyFilter', () => {
  it('returns none for clear skies', () => {
    expect(getSkyFilter('clear')).toBe('none')
  })

  it('returns a filter for every other condition', () => {
    expect(getSkyFilter('cloudy')).toBe('saturate(0.85) brightness(0.95)')
    expect(getSkyFilter('rain')).toBe('saturate(0.6) brightness(0.75) hue-rotate(-5deg)')
    expect(getSkyFilter('fog')).toBe('saturate(0.4) brightness(0.9)')
    expect(getSkyFilter('snow')).toBe('saturate(0.7) brightness(1.05)')
    expect(getSkyFilter('thunderstorm')).toBe('saturate(0.5) brightness(0.6)')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run lib/__tests__/weather-filters.test.ts`
Expected: FAIL — `lib/background/weather-filters.ts` does not exist.

- [ ] **Step 3: Implement `getSkyFilter`**

`lib/background/weather-filters.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run lib/__tests__/weather-filters.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/background/weather-filters.ts lib/__tests__/weather-filters.test.ts
git commit -m "Add per-condition sky filter lookup for dynamic background"
```

---

### Task 3: Background animation keyframes + particle utility classes

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Append the new keyframes and utility classes**

`app/globals.css` currently ends with (lines 305-321):

```css

/* Hide scrollbar but keep scroll */
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

/* Mobile usability */
@media (max-width: 640px) {
  /* Prevent iOS zoom on input focus */
  input, textarea, select {
    font-size: 16px !important;
  }

  /* Minimum tap target size */
  button {
    min-height: 44px;
  }
}
```

Append this block immediately after the final `}` (end of file):

```css

/* Dynamic background — keyframes (Section 2 of dynamic wallpaper backgrounds spec) */
@keyframes twinkle {
  0%, 100% { opacity: var(--bg-star-opacity, 1); }
  50%      { opacity: calc(var(--bg-star-opacity, 1) * 0.3); }
}

@keyframes cloud-drift {
  from { transform: translateX(-10%); }
  to   { transform: translateX(10%); }
}

@keyframes rain-fall {
  from { transform: translateY(-10%) translateX(0); opacity: 0.6; }
  to   { transform: translateY(110%) translateX(-6%); opacity: 0.2; }
}

@keyframes snow-fall {
  0%   { transform: translateY(-10%) translateX(0); opacity: 0.9; }
  50%  { transform: translateY(50%) translateX(8px); }
  100% { transform: translateY(110%) translateX(-8px); opacity: 0.4; }
}

@keyframes fog-drift {
  from { transform: translateX(-8%); opacity: 0.5; }
  to   { transform: translateX(8%); opacity: 0.7; }
}

@keyframes lightning-flash {
  0%, 92%, 100% { opacity: 0; }
  93%, 95%      { opacity: 0.8; }
  94%           { opacity: 0.2; }
}

/* Dynamic background — particle animation classes */
.bg-particle-star {
  animation-name: twinkle;
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
}

.bg-particle-cloud {
  animation-name: cloud-drift;
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
  animation-direction: alternate;
}

.bg-particle-rain {
  animation-name: rain-fall;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}

.bg-particle-snow {
  animation-name: snow-fall;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}

.bg-fog-band {
  animation-name: fog-drift;
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
  animation-direction: alternate;
}

.bg-lightning-flash {
  animation-name: lightning-flash;
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
}
```

- [ ] **Step 2: Verify the stylesheet still builds**

Run: `pnpm dev` (or `pnpm build`) and confirm no CSS errors are reported in the terminal output. Stop the dev server afterwards (Ctrl+C) — it isn't needed again until Task 10.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "Add keyframes and particle utility classes for dynamic background"
```

---

### Task 4: Sky layer and scrim layer components

**Files:**
- Create: `components/dynamic-background/sky-layer.tsx`
- Create: `components/dynamic-background/scrim-layer.tsx`

- [ ] **Step 1: Implement the sky layer**

`components/dynamic-background/sky-layer.tsx`:

```tsx
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
```

- [ ] **Step 2: Implement the scrim layer**

`components/dynamic-background/scrim-layer.tsx`:

```tsx
export function ScrimLayer() {
  return (
    <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/10 to-black/40 dark:via-black/20 dark:to-black/60" />
  )
}
```

- [ ] **Step 3: Verify it type-checks**

Run: `pnpm exec tsc --noEmit`
Expected: No new errors referencing `components/dynamic-background/sky-layer.tsx` or `scrim-layer.tsx`.

- [ ] **Step 4: Commit**

```bash
git add components/dynamic-background/sky-layer.tsx components/dynamic-background/scrim-layer.tsx
git commit -m "Add sky and scrim layers for dynamic background"
```

---

### Task 5: Celestial layer (sun/moon)

**Files:**
- Create: `components/dynamic-background/celestial-layer.tsx`

- [ ] **Step 1: Implement the celestial layer**

`components/dynamic-background/celestial-layer.tsx`:

```tsx
export type CelestialVisibility = 'full' | 'dimmed' | 'hidden'

export function CelestialLayer({ visibility }: { visibility: CelestialVisibility }) {
  if (visibility === 'hidden') return null

  return (
    <div
      className="absolute h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full"
      style={{
        left: 'var(--bg-celestial-x)',
        top: 'var(--bg-celestial-y)',
        background:
          'radial-gradient(circle, rgba(var(--bg-celestial-glow), 0.9) 0%, rgba(var(--bg-celestial-color), 0.6) 35%, transparent 70%)',
        opacity: visibility === 'dimmed' ? 0.25 : 1,
      }}
    />
  )
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `pnpm exec tsc --noEmit`
Expected: No new errors referencing `components/dynamic-background/celestial-layer.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/dynamic-background/celestial-layer.tsx
git commit -m "Add celestial (sun/moon) layer for dynamic background"
```

---

### Task 6: Particle layers (stars, clouds, rain, snow, fog, lightning)

**Files:**
- Create: `components/dynamic-background/particles.tsx`

- [ ] **Step 1: Implement the particle layers**

`components/dynamic-background/particles.tsx`:

```tsx
'use client'

import { useMemo } from 'react'

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

export function Stars({ count = 18 }: { count?: number }) {
  const stars = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        left: rand(0, 100),
        top: rand(0, 55),
        size: rand(1, 2.5),
        duration: rand(2, 5),
        delay: rand(0, 5),
      })),
    [count],
  )

  return (
    <>
      {stars.map((star, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-white bg-particle-star motion-reduce:animate-none"
          style={{
            left: `${star.left}%`,
            top: `${star.top}%`,
            width: `${star.size}px`,
            height: `${star.size}px`,
            opacity: 'var(--bg-star-opacity)',
            animationDuration: `${star.duration}s`,
            animationDelay: `${star.delay}s`,
          }}
        />
      ))}
    </>
  )
}

export function Clouds({ count }: { count: number }) {
  const clouds = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        left: rand(-20, 80),
        top: rand(5, 35),
        width: rand(160, 320),
        height: rand(50, 90),
        opacity: rand(0.25, 0.5),
        duration: rand(120, 240),
        delay: rand(-120, 0),
      })),
    [count],
  )

  return (
    <>
      {clouds.map((cloud, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-particle-cloud motion-reduce:animate-none"
          style={{
            left: `${cloud.left}%`,
            top: `${cloud.top}%`,
            width: `${cloud.width}px`,
            height: `${cloud.height}px`,
            opacity: cloud.opacity,
            background: 'radial-gradient(closest-side, rgba(255,255,255,0.9), transparent)',
            filter: 'blur(20px)',
            animationDuration: `${cloud.duration}s`,
            animationDelay: `${cloud.delay}s`,
          }}
        />
      ))}
    </>
  )
}

export function RainStreaks({ count = 30 }: { count?: number }) {
  const drops = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        left: rand(0, 100),
        height: rand(40, 80),
        duration: rand(0.5, 1),
        delay: rand(0, 1),
      })),
    [count],
  )

  return (
    <>
      {drops.map((drop, i) => (
        <div
          key={i}
          className="absolute w-px bg-particle-rain motion-reduce:animate-none"
          style={{
            left: `${drop.left}%`,
            top: '-10%',
            height: `${drop.height}px`,
            background: 'linear-gradient(to bottom, transparent, rgba(200,220,255,0.5))',
            animationDuration: `${drop.duration}s`,
            animationDelay: `${drop.delay}s`,
          }}
        />
      ))}
    </>
  )
}

export function SnowParticles({ count = 25 }: { count?: number }) {
  const flakes = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        left: rand(0, 100),
        size: rand(2, 5),
        duration: rand(8, 15),
        delay: rand(0, 15),
      })),
    [count],
  )

  return (
    <>
      {flakes.map((flake, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-white/80 bg-particle-snow motion-reduce:animate-none"
          style={{
            left: `${flake.left}%`,
            top: '-5%',
            width: `${flake.size}px`,
            height: `${flake.size}px`,
            animationDuration: `${flake.duration}s`,
            animationDelay: `${flake.delay}s`,
          }}
        />
      ))}
    </>
  )
}

export function FogBands({ count = 2 }: { count?: number }) {
  const bands = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        top: 60 + i * 15 + rand(-5, 5),
        height: rand(60, 120),
        duration: rand(60, 100),
        delay: rand(-60, 0),
      })),
    [count],
  )

  return (
    <>
      {bands.map((band, i) => (
        <div
          key={i}
          className="absolute inset-x-[-10%] bg-fog-band motion-reduce:animate-none"
          style={{
            top: `${band.top}%`,
            height: `${band.height}px`,
            background: 'linear-gradient(to right, transparent, rgba(220,225,235,0.35), transparent)',
            animationDuration: `${band.duration}s`,
            animationDelay: `${band.delay}s`,
          }}
        />
      ))}
    </>
  )
}

export function LightningFlashes({ count = 3 }: { count?: number }) {
  const flashes = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        duration: rand(10, 18),
        delay: rand(0, 15),
      })),
    [count],
  )

  return (
    <>
      {flashes.map((flash, i) => (
        <div
          key={i}
          className="absolute inset-0 bg-white bg-lightning-flash motion-reduce:hidden"
          style={{
            animationDuration: `${flash.duration}s`,
            animationDelay: `${flash.delay}s`,
          }}
        />
      ))}
    </>
  )
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `pnpm exec tsc --noEmit`
Expected: No new errors referencing `components/dynamic-background/particles.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/dynamic-background/particles.tsx
git commit -m "Add particle layers for dynamic background weather effects"
```

---

### Task 7: Weather overlay

**Files:**
- Create: `components/dynamic-background/weather-overlay.tsx`

- [ ] **Step 1: Implement the weather overlay**

`components/dynamic-background/weather-overlay.tsx`:

```tsx
import type { WeatherCondition } from '@/lib/weather/types'
import { Stars, Clouds, RainStreaks, SnowParticles, FogBands, LightningFlashes } from './particles'

export function WeatherOverlay({
  condition,
  isDay,
}: {
  condition: WeatherCondition
  isDay: boolean
}) {
  switch (condition) {
    case 'clear':
      return isDay ? null : <Stars />
    case 'cloudy':
      return <Clouds count={4} />
    case 'rain':
      return (
        <>
          <Clouds count={5} />
          <RainStreaks />
        </>
      )
    case 'fog':
      return <FogBands />
    case 'snow':
      return (
        <>
          <Clouds count={3} />
          <SnowParticles />
        </>
      )
    case 'thunderstorm':
      return (
        <>
          <Clouds count={6} />
          <RainStreaks count={36} />
          <LightningFlashes />
        </>
      )
    default:
      return null
  }
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `pnpm exec tsc --noEmit`
Expected: No new errors referencing `components/dynamic-background/weather-overlay.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/dynamic-background/weather-overlay.tsx
git commit -m "Add weather overlay composing per-condition particle layers"
```

---

### Task 8: Top-level `DynamicBackground` orchestrator

**Files:**
- Create: `components/dynamic-background/dynamic-background.tsx`

- [ ] **Step 1: Implement the orchestrator**

`components/dynamic-background/dynamic-background.tsx`:

```tsx
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

const RECOMPUTE_INTERVAL_MS = 60 * 1000

function pathnameToSection(pathname: string): BackgroundSection {
  if (pathname.startsWith('/health')) return 'health'
  if (pathname.startsWith('/workout')) return 'workout'
  if (pathname.startsWith('/nutrition')) return 'nutrition'
  if (pathname.startsWith('/more') || pathname.startsWith('/profile')) return 'more'
  return 'home'
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
  const { snapshot } = useWeather()

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

  if (!mounted) return null

  const section = pathnameToSection(pathname)
  if (!enabled || !sections[section]) return null

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
```

- [ ] **Step 2: Verify it type-checks**

Run: `pnpm exec tsc --noEmit`
Expected: No new errors referencing `components/dynamic-background/dynamic-background.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/dynamic-background/dynamic-background.tsx
git commit -m "Add dynamic background orchestrator component"
```

---

### Task 9: Mount the background in the root layout

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Step 1: Import and mount `<DynamicBackground>`**

In `app/layout.tsx`, add the import alongside the other component imports:

```tsx
import { SyncProvider } from "@/components/sync-provider";
import { DynamicBackground } from "@/components/dynamic-background/dynamic-background";
import { BRAND_THEME_STORAGE_KEY } from "@/lib/brand-themes";
```

Then update the body — change:

```tsx
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <main className="h-full">{children}</main>
          <Toaster />
          <ServiceWorkerRegistration />
          <HealthConnectProvider />
          <MobileAuthHandler />
          <SyncProvider />
        </ThemeProvider>
```

to:

```tsx
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <DynamicBackground />
          <main className="relative z-[1] h-full">{children}</main>
          <Toaster />
          <ServiceWorkerRegistration />
          <HealthConnectProvider />
          <MobileAuthHandler />
          <SyncProvider />
        </ThemeProvider>
```

- [ ] **Step 2: Verify it type-checks and lints**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx
git commit -m "Mount dynamic background behind app content"
```

---

### Task 10: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: All tests pass, including `lib/__tests__/day-phase.test.ts` and `lib/__tests__/weather-filters.test.ts`.

- [ ] **Step 2: Run lint and typecheck**

Run: `pnpm lint && pnpm exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Manual smoke test — enable the background**

Run: `pnpm dev`, open the app, go to More → Theme & Appearance, and turn on "Dynamic background" (added in Plan 1). Confirm:

- A sky gradient fills the screen behind all content, with a soft glowing circle (sun/moon) and a dark scrim toward the bottom for text readability.
- The bottom nav and cards remain fully visible and interactive (background is `pointer-events: none` and sits behind `z-index: 1` content).
- Toggling a per-section switch off (e.g. Workout) and navigating to that tab hides the background; navigating back to an enabled tab shows it again.

- [ ] **Step 4: Manual smoke test — day-phase and weather variety**

The current real time/weather will only show one combination. To check the others, temporarily edit `components/dynamic-background/dynamic-background.tsx`:

- Hardcode `const now = new Date('2026-06-11T23:50:00')` (replacing the `now` from `useState`) to preview deep night (stars visible if `condition` is `'clear'`).
- Hardcode `const condition: WeatherCondition = 'thunderstorm'` to preview heavy rain + lightning flashes.
- Try `'snow'`, `'fog'`, and `'cloudy'` similarly.

For each combination, confirm the sky colours, celestial body (visible/dimmed/hidden per `getCelestialVisibility`), and effect layers (clouds drifting, rain falling diagonally, snow swaying, fog bands drifting, stars twinkling, lightning flashing) render and animate smoothly without layout shift or scrollbars appearing.

Revert these temporary edits afterwards — do not commit them.

- [ ] **Step 5: Manual smoke test — reduced motion**

In Chrome DevTools, open the Rendering tab and set "Emulate CSS media feature `prefers-reduced-motion`" to `reduce`. Confirm clouds/rain/snow/fog/stars/lightning stop animating (frozen in place) while the sky gradient and celestial body remain visible.

If anything fails, fix it and commit a follow-up fix (do not amend already-pushed commits).

---

## Out of Scope (per design spec)

- Hourly/multi-day forecast-driven previews
- User-customizable colour palettes per scene
- Additional weather conditions (windy, hail)
- Tap-to-expand weather chip with forecast detail
- Parallax/scroll-based background movement
