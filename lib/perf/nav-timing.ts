// Pure core of the navigation-timing instrument. Everything here is deliberately
// free of browser globals so it can be tested — the DOM/rAF/PerformanceObserver
// half lives in nav-timing-recorder.ts, which owns no logic worth testing.
//
// What is being measured, and why these three numbers:
//   urlMs    — press -> the URL actually changing. For a route that was NOT prefetched
//              this is dominated by the RSC payload round-trip to Railway.
//   paintMs  — press -> the first frame rendered after the URL changed. Five of the
//              routes have a `loading.tsx`, so this can land on a skeleton.
//   settleMs — press -> the last DOM mutation before the screen went quiet. This is the
//              honest "how long until the screen stopped changing" number, and it is the
//              one the summary ranks on, precisely because it survives a skeleton.
//   rscCount — how many RSC payload fetches the navigation had to make. **0 means the
//              route was already warm** (prefetched), which is the direct read-out on
//              whether a prefetch is doing its job.

export const NAV_SAMPLE_LIMIT = 40

/** A press older than this is assumed not to have caused the navigation. */
export const NAV_PRESS_TIMEOUT_MS = 6_000

export interface NavSample {
  /** Wall clock (epoch ms) at which the navigation completed. */
  at: number
  /** Best-effort description of what was tapped, or null for a back/programmatic nav. */
  label: string | null
  from: string
  to: string
  urlMs: number
  paintMs: number
  settleMs: number
  /**
   * True when the watcher hit its hard timeout instead of seeing the screen go quiet —
   * `settleMs` is then a floor, not a measurement. Kept rather than dropped so a screen
   * that mutates forever is visible as such instead of silently inflating the median.
   */
  settleTimedOut?: boolean
  rscCount: number
  rscMs: number
}

export interface ResourceSample {
  name: string
  startTime: number
  duration: number
}

export interface RscWindowStat {
  count: number
  totalMs: number
  maxMs: number
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX_ID_RE = /^[0-9a-f]{16,}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Collapses a URL to a route shape suitable for grouping: ids and dates become
 * placeholders, and query *values* are dropped (a session id is not interesting,
 * the fact that the route takes a `session` param is).
 */
export function normalizeNavPath(href: string): string {
  let pathname = href
  let queryKeys: string[] = []
  try {
    const url = new URL(href, 'http://local')
    pathname = url.pathname
    queryKeys = [...new Set([...url.searchParams.keys()])].sort()
  } catch {
    const [rawPath, rawQuery] = href.split('?')
    pathname = rawPath
    if (rawQuery) {
      queryKeys = [
        ...new Set(rawQuery.split('&').map(p => p.split('=')[0]).filter(Boolean)),
      ].sort()
    }
  }

  const shaped = pathname
    .split('/')
    .map(seg => {
      if (!seg) return seg
      if (UUID_RE.test(seg) || HEX_ID_RE.test(seg)) return ':id'
      if (DATE_RE.test(seg)) return ':date'
      if (/^\d+$/.test(seg)) return ':n'
      return seg
    })
    .join('/')

  const path = shaped === '' ? '/' : shaped
  return queryKeys.length ? `${path}?${queryKeys.join('&')}` : path
}

/** Next's client-side route payload fetches carry an `_rsc` cache-buster query param. */
export function isRscResourceName(name: string): boolean {
  return name.includes('_rsc=')
}

/**
 * Totals the RSC payload fetches that were in flight during a navigation window.
 * An entry counts if it *started* before the window closed and *ended* after it
 * opened — a fetch kicked off by the press but still running at commit time is
 * exactly the cost we are trying to see.
 */
export function summarizeRscWindow(
  entries: readonly ResourceSample[],
  start: number,
  end: number,
): RscWindowStat {
  let count = 0
  let totalMs = 0
  let maxMs = 0
  for (const e of entries) {
    if (!isRscResourceName(e.name)) continue
    if (e.startTime > end) continue
    if (e.startTime + e.duration < start) continue
    count += 1
    totalMs += e.duration
    if (e.duration > maxMs) maxMs = e.duration
  }
  return { count, totalMs: round1(totalMs), maxMs: round1(maxMs) }
}

/** Appends a sample, keeping only the most recent `limit`. */
export function appendNavSample(
  samples: readonly NavSample[],
  sample: NavSample,
  limit = NAV_SAMPLE_LIMIT,
): NavSample[] {
  const next = [...samples, sample]
  return next.length > limit ? next.slice(next.length - limit) : next
}

/** Trims a raw DOM-derived label to something readable in a JSON dump. */
export function cleanNavLabel(raw: string | null | undefined, maxLen = 40): string | null {
  if (!raw) return null
  const collapsed = raw.replace(/\s+/g, ' ').trim()
  if (!collapsed) return null
  return collapsed.length > maxLen ? `${collapsed.slice(0, maxLen - 1)}…` : collapsed
}

export interface NavRouteStat {
  to: string
  count: number
  medianSettleMs: number
  worstSettleMs: number
  /** Navigations that made no RSC fetch — the route was already warm. */
  warmCount: number
  coldCount: number
}

export interface NavTimingSummary {
  sampleCount: number
  /** Null when nothing has been recorded yet. */
  overall: {
    medianSettleMs: number
    p95SettleMs: number
    worstSettleMs: number
    medianUrlMs: number
    medianPaintMs: number
  } | null
  warmCount: number
  coldCount: number
  /** Samples whose settle time is a floor rather than a measurement — see NavSample. */
  settleTimedOutCount: number
  byRoute: NavRouteStat[]
  slowest: NavSample[]
}

export function summarizeNavSamples(samples: readonly NavSample[]): NavTimingSummary {
  if (samples.length === 0) {
    return {
      sampleCount: 0,
      overall: null,
      warmCount: 0,
      coldCount: 0,
      settleTimedOutCount: 0,
      byRoute: [],
      slowest: [],
    }
  }

  const settles = samples.map(s => s.settleMs).sort((a, b) => a - b)
  const paints = samples.map(s => s.paintMs).sort((a, b) => a - b)
  const urls = samples.map(s => s.urlMs).sort((a, b) => a - b)
  const warmCount = samples.filter(s => s.rscCount === 0).length

  const groups = new Map<string, NavSample[]>()
  for (const s of samples) {
    const bucket = groups.get(s.to)
    if (bucket) bucket.push(s)
    else groups.set(s.to, [s])
  }

  const byRoute: NavRouteStat[] = [...groups.entries()]
    .map(([to, group]) => {
      const sorted = group.map(s => s.settleMs).sort((a, b) => a - b)
      const warm = group.filter(s => s.rscCount === 0).length
      return {
        to,
        count: group.length,
        medianSettleMs: percentile(sorted, 50),
        worstSettleMs: sorted[sorted.length - 1],
        warmCount: warm,
        coldCount: group.length - warm,
      }
    })
    .sort((a, b) => b.medianSettleMs - a.medianSettleMs || a.to.localeCompare(b.to))

  return {
    sampleCount: samples.length,
    overall: {
      medianSettleMs: percentile(settles, 50),
      p95SettleMs: percentile(settles, 95),
      worstSettleMs: settles[settles.length - 1],
      medianUrlMs: percentile(urls, 50),
      medianPaintMs: percentile(paints, 50),
    },
    warmCount,
    coldCount: samples.length - warmCount,
    settleTimedOutCount: samples.filter(s => s.settleTimedOut === true).length,
    byRoute,
    slowest: [...samples].sort((a, b) => b.settleMs - a.settleMs).slice(0, 5),
  }
}

/** Nearest-rank percentile. Sample counts here are tiny, so interpolation would be false precision. */
export function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0
  const rank = Math.ceil((p / 100) * sortedAsc.length)
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, rank - 1))]
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10
}
