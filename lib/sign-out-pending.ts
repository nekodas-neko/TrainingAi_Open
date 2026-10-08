'use client'

import type { SyncedMutationDomain } from '@trainingai/shared/sync/mutation-schema'
import { getLocalStore } from '@/lib/local-store'
import { pushMutations } from '@/lib/local-store/sync-engine'
import { flushDetectionEvents } from '@/lib/activity/detection-events'
import { requestsCompleting } from '@/lib/sqlite/cache'
import { useWorkoutStore, isWorkoutActive } from '@/lib/stores/workout-store'

/**
 * Issue 2532 — what a sign-out would throw away, and a sync to shrink that first (engine half).
 *
 * `signOutAndClearDevice()` empties the device on purpose (#2453): data kept past a sign-out would
 * POST under the NEXT account. That is right for synced data and wrong to do silently for data that
 * never reached the server. Owner decision, 2026-10-07: sync first, then warn; nothing is discarded
 * silently. This module is the part that knows what is unsent and runs the sync. The dialog that
 * shows it ("N changes haven't synced. Sync now / Sign out anyway") is a separate change.
 *
 * Nothing here deletes or keeps anything. `signOutAndClearDevice()` is unchanged and still the only
 * way out; "Sign out anyway" calls it exactly as before.
 *
 * Every function here is best-effort and never throws: a failure to count or to sync must not stand
 * between someone and signing out.
 */

/** The localStorage upload queues (JSON arrays) that a sign-out clears. */
export const UPLOAD_QUEUE_KEYS = [
  'detection-events-outbox',
  'ta-cadence-captures',
  'ta-oura-ble-pending-live-steps',
  'ta-oura-ble-pending-live-steps-auto',
  'ta-oura-ble-pending-accel-chunks',
] as const

const PREFS_UNSYNCED_KEY = 'ta_prefs_unsynced'

type OutboxGroup = 'food-body' | 'workout' | 'sleep-ring'

/**
 * Which plain-words group each outbox domain is shown under. A `Record` over the whole domain union,
 * so a new domain is a compile error here rather than a silent "other"; an unknown value at runtime
 * (an older build's row) still lands in food-body, the broadest group.
 */
const OUTBOX_GROUP: Record<SyncedMutationDomain, OutboxGroup> = {
  body_metrics: 'food-body', mood_logs: 'food-body', food_logs: 'food-body', food_items: 'food-body',
  supplement_logs: 'food-body', injuries: 'food-body', supplements: 'food-body', day_checkins: 'food-body',
  saved_meals: 'food-body', plan_meal_answers: 'food-body',
  activity_logs: 'workout', fitness_tests: 'workout', prescribed_run: 'workout', workout_log: 'workout',
  session_rpe: 'workout', complete_workout: 'workout', rest_days: 'workout', exercise_log_edit: 'workout',
  exercise_log_delete: 'workout', workout_session_delete: 'workout',
  oura_daily_summary: 'sleep-ring', oura_daily_derived: 'sleep-ring', sleep_session: 'sleep-ring',
  manual_bedtime: 'sleep-ring', manual_sleep: 'sleep-ring',
}

export interface UnsentChanges {
  /** Rows in the on-device mutation outbox (`mutations_outbox`) for this user, pending or dead-lettered. */
  outbox: { count: number; byDomain: Record<string, number> }
  /** A workout started and not finished: `loggedSets` sets logged that are not saved as a session. */
  activeWorkout: { active: boolean; loggedSets: number }
  /** Preference names in `ta_prefs_unsynced` whose PATCH was never acknowledged. */
  prefsUnsynced: number
  /** Items waiting in each localStorage upload queue, keyed by storage key; empty queues omitted. */
  uploadQueues: Record<string, number>
  /** Everything above summed; the N in "N changes haven't synced". 0 means nothing would be lost. */
  total: number
}

export interface UnsentLine {
  kind: 'workout-sets' | 'food-body' | 'workout' | 'sleep-ring' | 'settings' | 'sensor-uploads'
  count: number
  label: string
}

function emptyUnsent(): UnsentChanges {
  return { outbox: { count: 0, byDomain: {} }, activeWorkout: { active: false, loggedSets: 0 }, prefsUnsynced: 0, uploadQueues: {}, total: 0 }
}

/** Length of the JSON array stored under `key`; 0 for absent, malformed, non-array or unreadable. */
function arrayLength(key: string): number {
  try {
    if (typeof localStorage === 'undefined') return 0
    const raw = localStorage.getItem(key)
    if (!raw) return 0
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
}

function lengthOf(v: unknown): number {
  return Array.isArray(v) ? v.length : 0
}

/** Sets logged in the running workout: finished exercises, the current one, and stashed superset buffers. */
function loggedWorkoutSets(): { active: boolean; loggedSets: number } {
  try {
    const s = useWorkoutStore.getState()
    if (!isWorkoutActive(s)) return { active: false, loggedSets: 0 }
    let sets = lengthOf(s.setWeights)
    for (const e of Array.isArray(s.sessionLog) ? s.sessionLog : []) sets += lengthOf(e?.setWeights)
    // Stashed members of a superset: their logged sets are not in the flat fields.
    for (const [idx, b] of Object.entries(s.exerciseBuffers ?? {})) {
      if (Number(idx) !== s.currentIdx) sets += lengthOf(b?.setWeights)
    }
    return { active: true, loggedSets: sets }
  } catch {
    return { active: false, loggedSets: 0 }
  }
}

async function outboxByDomain(userId: string): Promise<Record<string, number>> {
  try {
    const store = getLocalStore(userId)
    return store ? await store.countQueuedMutationsByDomain(userId) : {}
  } catch {
    return {}
  }
}

/** Count everything a sign-out would discard that has not reached the server. Never throws. */
export async function countUnsentChanges(userId: string): Promise<UnsentChanges> {
  const out = emptyUnsent()
  try {
    const byDomain = await outboxByDomain(userId)
    for (const [domain, n] of Object.entries(byDomain)) {
      if (Number.isFinite(n) && n > 0) { out.outbox.byDomain[domain] = n; out.outbox.count += n }
    }
    out.activeWorkout = loggedWorkoutSets()
    out.prefsUnsynced = arrayLength(PREFS_UNSYNCED_KEY)
    for (const key of UPLOAD_QUEUE_KEYS) {
      const n = arrayLength(key)
      if (n > 0) out.uploadQueues[key] = n
    }
  } catch { /* leave whatever was counted */ }
  const queued = Object.values(out.uploadQueues).reduce((a, b) => a + b, 0)
  out.total = out.outbox.count + out.activeWorkout.loggedSets + out.prefsUnsynced + queued
  return out
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** The "what would be lost" list in plain words, one line per non-empty kind. */
export function describeUnsentChanges(u: UnsentChanges): UnsentLine[] {
  const lines: UnsentLine[] = []
  if (u.activeWorkout.loggedSets > 0) {
    lines.push({ kind: 'workout-sets', count: u.activeWorkout.loggedSets, label: `${plural(u.activeWorkout.loggedSets, 'workout set', 'workout sets')} in progress` })
  }
  const groups: Record<OutboxGroup, number> = { 'food-body': 0, workout: 0, 'sleep-ring': 0 }
  for (const [domain, n] of Object.entries(u.outbox.byDomain)) {
    groups[OUTBOX_GROUP[domain as SyncedMutationDomain] ?? 'food-body'] += n
  }
  if (groups['food-body'] > 0) lines.push({ kind: 'food-body', count: groups['food-body'], label: plural(groups['food-body'], 'food/body log change', 'food/body log changes') })
  if (groups.workout > 0) lines.push({ kind: 'workout', count: groups.workout, label: plural(groups.workout, 'workout or activity change', 'workout or activity changes') })
  if (groups['sleep-ring'] > 0) lines.push({ kind: 'sleep-ring', count: groups['sleep-ring'], label: plural(groups['sleep-ring'], 'sleep or ring change', 'sleep or ring changes') })
  if (u.prefsUnsynced > 0) lines.push({ kind: 'settings', count: u.prefsUnsynced, label: plural(u.prefsUnsynced, 'setting change', 'setting changes') })
  const sensors = Object.values(u.uploadQueues).reduce((a, b) => a + b, 0)
  if (sensors > 0) lines.push({ kind: 'sensor-uploads', count: sensors, label: plural(sensors, 'sensor upload', 'sensor uploads') })
  return lines
}

export const SIGN_OUT_SYNC_TIMEOUT_MS = 10_000

export type SignOutSyncOutcome =
  | 'synced'    // the attempt finished and nothing unsent remains
  | 'partial'   // the attempt finished and something is still unsent
  | 'offline'   // not attempted: the server cannot be reached
  | 'timeout'   // the attempt was still running at the deadline and was left behind

export interface SignOutSyncResult {
  outcome: SignOutSyncOutcome
  /** The unsent changes after the attempt (the same shape as `countUnsentChanges`). */
  remaining: UnsentChanges
}

/** True when a push cannot reach the server: radio off, or requests are not completing (BF-195). */
function isOffline(): boolean {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
    return !requestsCompleting()
  } catch {
    return false
  }
}

/**
 * Push what is queued, then report what is still unsent.
 *
 * Runs `pushMutations` — the one push path the sync-health card and every write site use. (The
 * "Sync now" button on More → Data is `pullDelta`, which never pushes, so it is not what a
 * sign-out wants.) Detection events are flushed beside it; the other upload queues are drained by
 * their owners and only counted here.
 *
 * Never hangs: offline returns at once without a request, and an attempt still running after
 * `timeoutMs` is abandoned (it may finish on its own; a late success only shrinks the next count).
 * Never throws.
 */
export async function syncBeforeSignOut(
  userId: string,
  opts: { timeoutMs?: number } = {},
): Promise<SignOutSyncResult> {
  if (isOffline()) return { outcome: 'offline', remaining: await countUnsentChanges(userId) }

  const timeoutMs = opts.timeoutMs ?? SIGN_OUT_SYNC_TIMEOUT_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), timeoutMs) })
  const attempt = Promise.allSettled([pushMutations(userId), flushDetectionEvents()]).then(() => 'done' as const)
  const raced = await Promise.race([attempt, deadline])
  if (timer !== undefined) clearTimeout(timer)

  const remaining = await countUnsentChanges(userId)
  if (raced === 'timeout') return { outcome: 'timeout', remaining }
  return { outcome: remaining.total === 0 ? 'synced' : 'partial', remaining }
}

export interface PrepareSignOutResult {
  outcome: SignOutSyncOutcome
  remaining: UnsentChanges
  /** What "Sign out anyway" would discard, in plain words. Empty when nothing is unsent. */
  lost: UnsentLine[]
}

/**
 * The engine entry point for Sign Out and account deletion: sync, recount, and say what would be
 * lost. The caller decides — `lost.length === 0` means sign out straight away; otherwise show the
 * warning and either call this again ("Sync now") or `signOutAndClearDevice()` ("Sign out anyway").
 * Changes no data and signs nobody out.
 */
export async function prepareSignOut(
  userId: string,
  opts: { timeoutMs?: number } = {},
): Promise<PrepareSignOutResult> {
  const { outcome, remaining } = await syncBeforeSignOut(userId, opts)
  return { outcome, remaining, lost: describeUnsentChanges(remaining) }
}
