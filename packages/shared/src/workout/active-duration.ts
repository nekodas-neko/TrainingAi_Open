// Leaf module: it imports nothing, so a client component (the time-audit card) can reach it
// through `time-audit.ts` without pulling `workout-energy` and its disk-reading Oura models into the
// browser chunk. `workout-energy.ts` re-exports it, so energy callers are unaffected.

/**
 * Minutes a session was actually under way: its span less the time it spent paused (#3266). The one
 * place a session's duration is taken, so a 10-minute call mid-workout is not burned off and every
 * screen shows the same figure. Paused time is clamped to the span, and null or absent (every
 * session saved before pause existed) takes nothing off.
 */
export function sessionActiveMin(startedAt: Date, completedAt: Date, pausedSec?: number | null): number {
  const spanMin = (completedAt.getTime() - startedAt.getTime()) / 60_000
  const pausedMin = typeof pausedSec === 'number' && Number.isFinite(pausedSec) ? Math.max(0, pausedSec) / 60 : 0
  return spanMin - Math.min(pausedMin, Math.max(0, spanMin))
}
