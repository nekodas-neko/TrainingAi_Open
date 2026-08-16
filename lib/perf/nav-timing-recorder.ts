import {
  NAV_PRESS_TIMEOUT_MS,
  NAV_SAMPLE_LIMIT,
  appendNavSample,
  cleanNavLabel,
  isRscResourceName,
  normalizeNavPath,
  round1,
  summarizeNavSamples,
  summarizeRscWindow,
  type NavSample,
  type NavTimingSummary,
  type ResourceSample,
} from './nav-timing'

// Browser half of the navigation-timing instrument. Deliberately holds no logic worth
// testing — every decision lives in nav-timing.ts. The only thing this file knows how
// to do is watch the URL and the DOM after a tap and hand the numbers over.
//
// It does NOT hook Next's router. A watcher polls `location.href` on animation frames
// instead, which costs a string compare per frame for at most a few seconds after a tap
// and — unlike a `usePathname` effect — also catches navigations that change only the
// query string (`/workout` -> `/workout?session=…` is the app's busiest one).

const STORAGE_KEY = 'ta_nav_timing_v1'

/** DOM quiet for this long after the URL changed = the new screen has finished arriving. */
const SETTLE_QUIET_MS = 120

/** Hard stop, so a screen that mutates forever can never keep a watcher alive. */
const WATCH_TIMEOUT_MS = NAV_PRESS_TIMEOUT_MS

const RSC_RING_LIMIT = 60

let samples: NavSample[] = []
let loaded = false
let recentRsc: ResourceSample[] = []

function loadSamples(): void {
  if (loaded) return
  loaded = true
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) samples = parsed.slice(-NAV_SAMPLE_LIMIT) as NavSample[]
  } catch {
    // A corrupt or unreadable buffer is not worth a single line of recovery — start empty.
  }
}

function persist(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(samples))
  } catch {
    // Storage full or blocked: keep recording in memory.
  }
}

export function getNavSamples(): NavSample[] {
  loadSamples()
  return samples
}

export function getNavTimingSummary(): NavTimingSummary {
  return summarizeNavSamples(getNavSamples())
}

export function clearNavSamples(): void {
  samples = []
  loaded = true
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to do — the in-memory buffer is already cleared.
  }
}

function describePressTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null
  const control = target.closest('a,button,[role="button"],[data-nav-label]')
  if (!control) return null
  const explicit = control.getAttribute('data-nav-label') ?? control.getAttribute('aria-label')
  return cleanNavLabel(explicit ?? control.textContent)
}

// Only the newest press is watched: a second tap during a slow navigation supersedes
// the first, rather than being dropped (which would silently hide the slowest cases).
let watchGeneration = 0

/**
 * Watches for a URL change following `pressAt`, then for the DOM to go quiet, and
 * records one sample. Records nothing if no navigation happened before the timeout.
 */
function watchNavigation(pressAt: number, fromHref: string, label: string | null): void {
  const generation = ++watchGeneration
  let urlAt: number | null = null
  let paintAt = pressAt
  let toHref = fromHref
  let lastMutationAt = pressAt
  let sawFrameAfterUrl = false

  const observer = new MutationObserver(() => {
    lastMutationAt = performance.now()
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })

  const finish = (settleAt: number, timedOut = false) => {
    observer.disconnect()
    if (urlAt === null) return
    const rsc = summarizeRscWindow(recentRsc, pressAt, urlAt)
    const sample: NavSample = {
      at: Date.now(),
      label,
      from: normalizeNavPath(fromHref),
      to: normalizeNavPath(toHref),
      urlMs: round1(urlAt - pressAt),
      paintMs: round1(paintAt - pressAt),
      settleMs: round1(Math.max(settleAt, urlAt) - pressAt),
      ...(timedOut ? { settleTimedOut: true } : {}),
      rscCount: rsc.count,
      rscMs: rsc.totalMs,
    }
    loadSamples()
    samples = appendNavSample(samples, sample)
    persist()
  }

  const tick = () => {
    if (generation !== watchGeneration) {
      observer.disconnect()
      return
    }
    const now = performance.now()
    if (now - pressAt > WATCH_TIMEOUT_MS) {
      finish(lastMutationAt, true)
      return
    }
    if (urlAt === null) {
      if (window.location.href !== fromHref) {
        urlAt = now
        toHref = window.location.href
      }
      requestAnimationFrame(tick)
      return
    }
    if (!sawFrameAfterUrl) {
      sawFrameAfterUrl = true
      paintAt = now
    }
    if (now - lastMutationAt >= SETTLE_QUIET_MS) {
      finish(lastMutationAt)
      return
    }
    requestAnimationFrame(tick)
  }

  requestAnimationFrame(tick)
}

export function startNavTimingRecorder(): () => void {
  loadSamples()

  const observer =
    typeof PerformanceObserver !== 'undefined'
      ? new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            if (!isRscResourceName(entry.name)) continue
            recentRsc.push({ name: entry.name, startTime: entry.startTime, duration: entry.duration })
          }
          if (recentRsc.length > RSC_RING_LIMIT) recentRsc = recentRsc.slice(-RSC_RING_LIMIT)
        })
      : null
  try {
    observer?.observe({ type: 'resource', buffered: true })
  } catch {
    // Resource timing unavailable: samples still record, with rscCount reading 0.
  }

  const onPointerDown = (event: Event) => {
    const label = describePressTarget(event.target)
    if (label === null) return
    watchNavigation(performance.now(), window.location.href, label)
  }

  document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true })

  return () => {
    document.removeEventListener('pointerdown', onPointerDown, { capture: true })
    observer?.disconnect()
  }
}
