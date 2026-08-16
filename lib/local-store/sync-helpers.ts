// Pure helpers for the sync engine. No sqlite/capacitor imports so tests can
// run in the node environment.

import type { LocalWorkoutSession, LocalExerciseLog, LocalSetLog } from './types'

export interface PushErrorRecord {
  id?:    string;
  domain: string;
  date:   string;
  error?: string;
}

// Map of failed outbox row id -> error message. Prefers exact id matching
// (new servers); falls back to domain:date for error records missing an id
// (old servers) — which retains every sibling sharing that key, matching the
// pre-id behaviour, never worse.
export function resolveFailedOutboxIds(
  chunk: Array<{ id: string; domain: string; date: string }>,
  errors: PushErrorRecord[],
): Map<string, string> {
  const failed = new Map<string, string>()
  const legacyByKey = new Map<string, string>()
  for (const e of errors) {
    if (e.id) failed.set(e.id, e.error ?? 'sync failed')
    else legacyByKey.set(`${e.domain}:${e.date}`, e.error ?? 'sync failed')
  }
  if (legacyByKey.size) {
    for (const m of chunk) {
      if (failed.has(m.id)) continue
      const legacy = legacyByKey.get(`${m.domain}:${m.date}`)
      if (legacy !== undefined) failed.set(m.id, legacy)
    }
  }
  return failed
}

// Server Zod schemas declare optional fields `.optional()` (T | undefined); local SQLite
// rows use real NULLs (T | null) for the same fields. Reusing a local record's object
// literal directly as a queueMutation payload sends `null` for those fields, and Zod's
// `.optional()` rejects `null` outright — invalidating the WHOLE payload, not just that
// field (this broke every food save once, and activity_logs guided-walk saves on
// 2026-07-23 — CLAUDE.md documents the class). Strip null-valued keys before queueing so
// they're omitted instead of sent as null; required/always-populated fields are untouched.
export function omitNullFields<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null)) as Partial<T>
}

export const MAX_MUTATION_ATTEMPTS = 5

// 30s · 4^(attempts-1), capped at 1h: 30s, 2m, 8m, 32m, then dead-letter.
export function nextRetryDelayMs(attempts: number): number {
  return Math.min(30_000 * 4 ** (attempts - 1), 60 * 60_000)
}

// Whole-queue backoff after a 5xx from /api/sync/push: 30s · 2^(n-1), cap 10m.
export function serverBackoffMs(consecutive5xx: number): number {
  return Math.min(30_000 * 2 ** (consecutive5xx - 1), 10 * 60_000)
}

// Rebuilds a LogExercisePayload-shaped outbox payload from local rows, for
// workouts stranded as sync_status='pending' with no outbox entry (direct POST
// failed AND queueMutation failed). Keyed on the original client ids so the
// server upsert path treats it as a replay, never a duplicate.
export function buildWorkoutLogPayload(
  session: LocalWorkoutSession,
  el: LocalExerciseLog & { sets: LocalSetLog[] },
): { date: string; payload: Record<string, unknown> } {
  const sets = [...el.sets].sort((a, b) => a.setNumber - b.setNumber)
  const everySetHasSetTimes   = sets.length > 0 && sets.every(s => s.setTimeSec != null)
  const everySetHasRestTimes  = sets.length > 0 && sets.every(s => s.restTimeSec != null)
  const everySetHasStartTimes = sets.length > 0 && sets.every(s => s.setStartMs != null)
  const everySetHasEndTimes   = sets.length > 0 && sets.every(s => s.setEndMs != null)
  const everySetHasRpe        = sets.length > 0 && sets.every(s => s.rpe != null)
  // D-3: the local set rows keep the progression-style snapshot (planned_pct /
  // planned_rest_sec / use_for_1rm), but this rebuild emitted no progressionStyle,
  // so the server (which derives those fields ONLY from payload.progressionStyle[i])
  // wrote NULL planned fields and re-derived use_for_1rm via defaultUseFor1rm on
  // replay. Reconstruct it so a stranded replay matches the original log.
  const everySetHasPlanned    = sets.length > 0 && sets.every(s => s.plannedPct != null && s.plannedRestSec != null)
  return {
    // The log's own device-local date (loggedAt was written with the device
    // clock at log time) — deliberately NOT todayInTz(): this is historical.
    date: el.loggedAt.slice(0, 10),
    payload: {
      workoutSessionId: session.id,
      exerciseLogId:    el.id,
      setLogIds:        sets.map(s => s.id),
      sessionName:      session.sessionName,
      exercise:         el.exerciseName,
      weights:          sets.map(s => s.weightKg),
      sets:             sets.length,
      reps:             sets.map(s => s.reps),
      localDate:        el.loggedAt,
      ...(el.timeToComplete != null ? { timeToCompleteSet: el.timeToComplete } : {}),
      ...(everySetHasSetTimes   ? { setTimes:      sets.map(s => s.setTimeSec!) }  : {}),
      ...(everySetHasRestTimes  ? { restTimes:     sets.map(s => s.restTimeSec!) } : {}),
      ...(everySetHasStartTimes ? { setStartTimes: sets.map(s => s.setStartMs!) }  : {}),
      ...(everySetHasEndTimes   ? { setEndTimes:   sets.map(s => s.setEndMs!) }    : {}),
      ...(everySetHasRpe        ? { rpeValues:     sets.map(s => s.rpe!) }         : {}),
      // Q-14: `reps` here is the PRESCRIBED target, which is what the server stores as
      // planned_reps. Rows written before planned_reps existed carry null, and fall back to the
      // actual reps exactly as this line did before — a replay of an old row is unchanged.
      ...(everySetHasPlanned ? { progressionStyle: sets.map(s => ({ pct: s.plannedPct!, reps: s.plannedReps ?? s.reps, restSec: s.plannedRestSec!, useFor1rm: s.useFor1rm })) } : {}),
      ...(el.styleId ? { styleId: el.styleId } : {}),
      ...(el.styleName ? { styleName: el.styleName } : {}),
      ...(el.muscleGroups.length ? { muscleGroups: el.muscleGroups } : {}),
      ...(el.interExerciseRestSec != null ? { interExerciseRestSec: el.interExerciseRestSec } : {}),
      ...(el.estimated1rm != null ? { estimated1rm: el.estimated1rm } : {}),
      ...(el.target80 != null ? { target80: el.target80 } : {}),
      workoutStartedAt: new Date(session.startedAt).getTime(),
      // SYN-6: carry the real program-session + deload/override attribution so a
      // stranded replay doesn't degrade to a normal log with name-fallback phase
      // attribution.
      ...(session.sessionId ? { sessionId: session.sessionId } : {}),
      ...(session.intensityMode ? { intensityMode: session.intensityMode } : {}),
      ...(session.wasOverride ? { wasOverride: true } : {}),
      ...(el.exerciseDeloaded ? { exerciseDeloaded: true } : {}),
    },
  }
}
