import type { Program } from '@trainingai/shared/types'

/**
 * Mirrors the home screen's "This Week X/Y" cadence (session-select-content.tsx's
 * weeklyTarget) — must stay in sync so the Goals card agrees with the home screen.
 */
export function getScheduledSessionsPerWeek(program: Program): number {
  const schedule = program.schedule
  if (!schedule) return 3
  if (schedule.type === 'weekly') return schedule.days?.length ?? 3
  if (schedule.type === 'rotation' && schedule.restAfterN) {
    const n = schedule.restAfterN
    return Math.round((n * 7) / (n + 1))
  }
  return 3
}

// Sessions the user still has scheduled this week (including today) — divides the remaining
// weekly volume budget. Prorates the schedule-derived weekly cadence by days left rather
// than assuming half the program's session list runs every week.
export function sessionsRemainingThisWeek(program: Program, daysLeftInWeek: number): number {
  const perWeek = getScheduledSessionsPerWeek(program)
  return Math.max(1, Math.ceil(perWeek * Math.max(0, daysLeftInWeek) / 7))
}
