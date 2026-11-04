/**
 * A source's per-minute movement series (MET per minute) as a 1-minute grid, and the waking hours
 * it says were worn and moved (#2985, #3114; made source-neutral in #3597).
 *
 * The grid feeds rung 1 of `MET/min` (`met-input.ts`) next to the ring's own grid, walk detection,
 * still-period resting HR, and Activity's move lane. Any connector that declares `perMinuteMovement`
 * (`source-connectors.ts`) fills `MovementIntervalSeries` from its own fields; the Oura Cloud mapping
 * is `lib/oura/cloud/activity-movement.ts`. Nothing here knows which source it came from.
 *
 * Each item covers `intervalMs` from the series' start, and a minute takes the overlap-weighted mean
 * of the items covering it: a 60-second series maps one to one, a coarser one gives each minute the
 * value reported for the span holding it, a finer one is averaged. A null item and a minute nothing
 * covers stay null.
 *
 * **Wear gate.** A minute inside one of the series' `notWorn` spans is null, so a device on the
 * charger is missing for the cascade, never rest.
 *
 * A source's day need not start at local midnight, so a caller passes every series that could touch
 * the window: every item is placed by its own instant, never by a row's date.
 */

const MINUTE_MS = 60_000

/** One stretch of a source's movement series, as its connector normalised it. */
export interface MovementIntervalSeries {
  /** The `HealthSource` its connector writes under, carried into the cascade's provenance. */
  source: string
  /** Instant the first item starts (epoch ms). */
  startMs: number
  /** How long each item covers, in ms. */
  intervalMs: number
  /** MET per item; null where the source reported nothing. */
  mets: readonly (number | null)[]
  /** Spans `[startMs, endMs)` the device was not worn. */
  notWorn: readonly { startMs: number; endMs: number }[]
}

/** A 1-minute grid: `metsPerMinute[i]` is the minute starting `startTimestampMs + i·60 s`. */
export interface PerMinuteMovementGrid {
  startTimestampMs: number
  metsPerMinute: readonly (number | null)[]
  /** Which source filled it (sources joined with `+` if several did), null when nothing did. */
  source?: string | null
}

/** `[fromMs, toMs)` as a grid starting at `fromMs`'s minute; `metsPerMinute[i]` is minute `i`. */
export function perMinuteMovementGrid(
  series: readonly MovementIntervalSeries[], fromMs: number, toMs: number,
): { startTimestampMs: number; metsPerMinute: (number | null)[]; source: string | null } {
  const start = Math.floor(fromMs / MINUTE_MS) * MINUTE_MS
  const n = Math.max(0, Math.ceil((toMs - start) / MINUTE_MS))
  const sum = new Array<number>(n).fill(0)
  const weight = new Array<number>(n).fill(0)
  const nonWear = new Array<boolean>(n).fill(false)

  // Every minute `[a, b)` overlaps, with the overlap in ms.
  const eachMinute = (a: number, b: number, fn: (i: number, overlap: number) => void) => {
    const first = Math.max(0, Math.floor((a - start) / MINUTE_MS))
    const last = Math.min(n - 1, Math.ceil((b - start) / MINUTE_MS) - 1)
    for (let i = first; i <= last; i++) {
      const m = start + i * MINUTE_MS
      const overlap = Math.min(b, m + MINUTE_MS) - Math.max(a, m)
      if (overlap > 0) fn(i, overlap)
    }
  }

  const sources = new Set<string>()
  for (const s of series) {
    const t0 = s.startMs
    const step = s.intervalMs
    if (!Number.isFinite(t0) || !(step > 0)) continue
    s.mets.forEach((v, k) => {
      if (v == null || !Number.isFinite(v)) return
      const a = t0 + k * step
      eachMinute(a, a + step, (i, overlap) => { sum[i] += v * overlap; weight[i] += overlap; sources.add(s.source) })
    })
    for (const span of s.notWorn) eachMinute(span.startMs, span.endMs, i => { nonWear[i] = true })
  }

  return {
    startTimestampMs: start,
    metsPerMinute: sum.map((s, i) => (weight[i] > 0 && !nonWear[i] ? s / weight[i] : null)),
    source: sources.size > 0 ? [...sources].sort().join('+') : null,
  }
}

/**
 * #3114: which waking local hours of `dateIso` the device was worn in, and in which of those it moved,
 * from a grid built by `perMinuteMovementGrid`. A minute with a MET value is worn (the wear gate
 * already made non-wear minutes null); an hour moved when any worn minute in it is at `activeMet` or
 * more. `lastWornHour` is the latest worn waking hour, or null for a day with none, which lets a
 * caller tell hours the device was off from hours that have not arrived yet.
 */
export function movedHoursFromMovement(
  grid: PerMinuteMovementGrid,
  opts: { tz: string; dateIso: string; wakeHour: number; sleepHour: number; activeMet: number },
): { worn: Set<number>; moved: Set<number>; lastWornHour: number | null } {
  const { tz, dateIso, wakeHour, sleepHour, activeMet } = opts
  const worn = new Set<number>()
  const moved = new Set<number>()
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  })
  // Every zone's offset is a multiple of 15 minutes, so the local hour holds across a 15-minute bucket.
  const BUCKET_MS = 15 * MINUTE_MS
  const cache = new Map<number, number | null>()
  const wakingHourOf = (ms: number): number | null => {
    const key = Math.floor(ms / BUCKET_MS)
    if (cache.has(key)) return cache.get(key)!
    const p = fmt.formatToParts(ms)
    const get = (type: string) => p.find(x => x.type === type)!.value
    const hour = get('hour') === '24' ? 0 : Number(get('hour'))
    const hit = `${get('year')}-${get('month')}-${get('day')}` === dateIso && hour >= wakeHour && hour < sleepHour ? hour : null
    cache.set(key, hit)
    return hit
  }
  grid.metsPerMinute.forEach((met, i) => {
    if (met == null) return
    const hour = wakingHourOf(grid.startTimestampMs + i * MINUTE_MS)
    if (hour == null) return
    worn.add(hour)
    if (met >= activeMet) moved.add(hour)
  })
  return { worn, moved, lastWornHour: worn.size > 0 ? Math.max(...worn) : null }
}
