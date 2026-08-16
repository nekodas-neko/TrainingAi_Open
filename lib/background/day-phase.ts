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
    { time: sunriseMs - 2 * HOUR_MS, palette: PALETTES.deepNight },
    { time: sunriseMs - HOUR_MS, palette: PALETTES.dawn },
    { time: sunriseMs, palette: PALETTES.dawn },
    { time: sunriseMs + 90 * 60 * 1000, palette: PALETTES.day },
    { time: sunsetMs - 90 * 60 * 1000, palette: PALETTES.day },
    { time: sunsetMs, palette: PALETTES.dusk },
    { time: sunsetMs + HOUR_MS, palette: PALETTES.dusk },
    { time: sunsetMs + 2 * HOUR_MS, palette: PALETTES.deepNight },
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
