// #2478. Walk auto-detection's funnel, sent to the server so its accuracy can be measured (#2471).
//
// READ-ONLY TELEMETRY. Nothing here feeds back into detection: the service and the store call
// `recordDetectionEvent` at the moments they already decide things, and this module only queues and
// posts. Every entry point swallows every failure, so a broken outbox can never block or throw in
// the detection path.
//
// Server-only table, phone-side outbox. Nothing on the device reads these events back, so there is
// no local-store domain to keep in step (docs/rules/offline-first-and-storage.md is about domains a
// UI reads); the device keeps only a small persisted queue so a walk with no signal, or an app
// killed before its post, does not lose the events. The queue is localStorage, capped, and drops
// the OLDEST first: losing old telemetry is fine, growing without bound on a phone is not.
//
// Idempotent: each detection emits each kind at most once, and the server's key is (user,
// detectionId, kind), so a batch that posted but whose response was lost is re-sent harmlessly.
import {
  MAX_DETECTION_EVENTS_PER_POST,
  type DetectionEvent,
  type DetectionEventKind,
} from '@trainingai/shared/validation/detection-event'

export type { DetectionEvent, DetectionEventKind }

const OUTBOX_KEY = 'detection-events-outbox'
export const DETECTION_OUTBOX_CAP = 500
const FLUSH_DEBOUNCE_MS = 2_000
const ENDPOINT = '/api/activity-detection/events'

/** A fresh detection id, or null where the platform has no `crypto.randomUUID`. Never throws. */
export function newDetectionId(): string | null {
  try {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : null
  } catch {
    return null
  }
}

function readOutbox(): DetectionEvent[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = localStorage.getItem(OUTBOX_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as DetectionEvent[]) : []
  } catch {
    return []
  }
}

function writeOutbox(events: DetectionEvent[]): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (events.length === 0) localStorage.removeItem(OUTBOX_KEY)
    else localStorage.setItem(OUTBOX_KEY, JSON.stringify(events.slice(-DETECTION_OUTBOX_CAP)))
  } catch {
    /* storage full or blocked — telemetry only */
  }
}

/** Test seam. */
export function readDetectionOutbox(): DetectionEvent[] {
  return readOutbox()
}

let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushing: Promise<void> | null = null

/**
 * Queue one event and schedule a flush. A no-op without a detection id (a session that started
 * before this shipped, or a platform with no `randomUUID`). Never throws.
 */
export function recordDetectionEvent(
  detectionId: string | null | undefined,
  kind: DetectionEventKind,
  gate: string,
  detail: Partial<Omit<DetectionEvent, 'detectionId' | 'kind' | 'gate' | 'occurredAt'>> = {},
  nowMs: number = Date.now(),
): void {
  try {
    if (!detectionId) return
    const event: DetectionEvent = { detectionId, kind, gate, occurredAt: Math.round(nowMs) }
    for (const [k, v] of Object.entries(detail)) {
      // Drop anything the server's schema would reject rather than poison the whole batch: a
      // non-finite or negative number is a missing measurement, not a value.
      if (v === undefined || v === null) continue
      if (typeof v === 'number' && (!Number.isFinite(v) || v < 0)) continue
      ;(event as Record<string, unknown>)[k] = typeof v === 'number' && (k === 'sessionStartAt' || k === 'pointCount') ? Math.round(v) : v
    }
    const outbox = readOutbox()
    outbox.push(event)
    writeOutbox(outbox)
    scheduleFlush()
  } catch {
    /* telemetry only */
  }
}

function scheduleFlush(): void {
  try {
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      void flushDetectionEvents()
    }, FLUSH_DEBOUNCE_MS)
  } catch {
    /* telemetry only */
  }
}

/**
 * Post the queued events, oldest first, ≤`MAX_DETECTION_EVENTS_PER_POST` a request. Single-flight.
 * A 2xx removes the batch. A 400 removes it too: the schema rejected it, and a batch that can never
 * pass must not wedge the queue behind it forever. Anything else (offline, 401, 429, 5xx) keeps it
 * for the next flush. Never throws.
 */
export function flushDetectionEvents(): Promise<void> {
  if (flushing) return flushing
  // `.finally` always runs asynchronously, so the reset cannot land before the assignment below.
  const p = postQueued().finally(() => { if (flushing === p) flushing = null })
  flushing = p
  return p
}

async function postQueued(): Promise<void> {
  try {
    if (typeof fetch === 'undefined') return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    for (let guard = 0; guard < 20; guard++) {
      const outbox = readOutbox()
      if (outbox.length === 0) return
      const batch = outbox.slice(0, MAX_DETECTION_EVENTS_PER_POST)
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch }),
        cache: 'no-store',
      })
      if (!res.ok && res.status !== 400) return
      // Re-read: events recorded while the request was in flight were appended after `batch`.
      const sent = new Set(batch.map(e => `${e.detectionId}|${e.kind}`))
      writeOutbox(readOutbox().filter(e => !sent.has(`${e.detectionId}|${e.kind}`)))
    }
  } catch {
    /* the next record, resume or start retries the same rows */
  }
}

/** Test seam: forget timers and in-flight state. */
export function resetDetectionEventsForTest(): void {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = null
  flushing = null
}
