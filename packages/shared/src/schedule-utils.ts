import type { Program, Schedule } from '@trainingai/shared/types'

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

/**
 * The largest gap between training days that still counts as FOLLOWING the schedule, in rest days
 * (BF-122a).
 *
 * **Not `7 ÷ sessionsPerWeek`, and that is the whole reason this exists.** A count cannot see where
 * the hole is: Mon+Tue is two days a week with a five-day hole in it, and a user on that schedule is
 * compliant for five straight days. `getScheduledSessionsPerWeek` above collapses both schedule
 * shapes to a count for the Home "This Week X/Y" chip, which is the right input for a chip and the
 * wrong one here — so this sits beside it rather than replacing it.
 *
 * Returns **rest days**, not calendar days: 0 means "train again tomorrow or you have slipped", 1
 * means one day off is fine. That is the unit `computeStreak`'s `maxRestGap` already speaks.
 *
 * Measured against the owner's last 120 days when this was written: gaps of 1 day occurred 44 times
 * and 2 days 26 times (both inside a 1-rest-day allowance), against 5 gaps of 3 days and one of 6.
 * So the allowance this returns for their schedule fires about monthly — a live clock rather than a
 * decorative one.
 */
export function maxCompliantRestGap(program: Program | null | undefined): number {
  return maxCompliantRestGapFor(program?.schedule)
}

/**
 * The same rule, taking the schedule directly.
 *
 * Exists because the friends leaderboard computes a streak for every user in one pass and has no
 * `Program` for any of them — it batch-loads the schedules instead, and building a fake `Program`
 * around each one to satisfy a signature is how a helper acquires a shape nobody needs.
 */
export function maxCompliantRestGapFor(
  // Only the three fields the rule reads. Narrower than `Schedule` on purpose: the leaderboard
  // rebuilds these from a flat join and has no `id`/`programId` for them, and inventing empty
  // strings to satisfy a signature — or casting the difference away — is how a helper acquires a
  // shape nobody actually has.
  schedule: Pick<Schedule, 'type' | 'restAfterN' | 'days'> | null | undefined,
): number {
  // No schedule is not "train every day". One rest day is what `computeStreak`'s two call sites
  // already assumed for everyone, and keeping it as the fallback means an unscheduled user's streak
  // does not change under this.
  if (!schedule) return 1

  // A rotation is N training days then ONE rest day, whatever N is — so the largest compliant gap
  // is one rest day and `restAfterN` does not enter into it. The value changes how often a rest day
  // falls, never how long one lasts.
  if (schedule.type === 'rotation') return 1

  if (schedule.type === 'weekly') {
    // Only days carrying a session are training days — a `ScheduleDay` with no `sessionId` is a
    // configured rest day, not a missed one.
    const days = (schedule.days ?? [])
      .filter(d => d.sessionId != null)
      .map(d => d.dayOfWeek)
      .filter(d => Number.isInteger(d))
    const unique = [...new Set(days)].sort((a, b) => a - b)
    if (unique.length === 0) return 1
    // One training day a week is a six-rest-day gap, every week. Nothing else to compare it to.
    if (unique.length === 1) return 6

    // The WIDEST gap, wrapping around the week end — Mon+Tue's five-day hole is Tue→Mon, which no
    // pairwise scan of a sorted list finds without the wrap term.
    let widest = 0
    for (let i = 0; i < unique.length; i++) {
      const next = unique[(i + 1) % unique.length]
      const span = i + 1 < unique.length ? next - unique[i] : next + 7 - unique[i]
      widest = Math.max(widest, span)
    }
    // A span of 3 calendar days between training days is 2 rest days.
    return Math.max(0, widest - 1)
  }

  return 1
}
