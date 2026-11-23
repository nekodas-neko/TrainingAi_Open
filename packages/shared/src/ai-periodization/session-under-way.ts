// #3900 second review (1): the ONE definition of "a session of this type is under way".
//
// Under way: a workout of this session type that is not finished and whose most recent logged set is
// recent. It is read from the last set, not from when the workout started: a session started 40
// minutes ago and a session abandoned half-done yesterday evening both have a start inside any
// start-based window, and nothing in the repo closes an abandoned workout, so a start-based window
// pinned an abandoned workout's plan for the whole window.
//
// While a session is under way the plan it started with drives the bar on every path: generation
// returns it, the serve paths do not call it pending, fall back to base numbers or regenerate it, and
// a program move spares it. The window is read here by all of them, never re-derived.
import type { WorkoutRepository } from '@/lib/data/repository'

/**
 * How long after its last logged set an unfinished workout still counts as under way: 5 hours.
 * Long enough for the longest real session: a heavy day with 5-minute rests and 3 minutes between
 * lifts is under 3 hours between sets, and a break (a meal, a shower, a call) of an hour or two is
 * still inside it with room to spare. Short enough that a workout left open in the evening has let go
 * of its type by the next morning: even a session abandoned at 23:00 is released at 04:00, before the
 * same type is trained the next day. A workout crossing local midnight is covered, because the window
 * counts from the last set, not from the date.
 */
export const SESSION_UNDER_WAY_LAST_SET_WINDOW_MS = 5 * 60 * 60 * 1000

/** The oldest last-set time that still counts as under way, at `now`. */
export function sessionUnderWayCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - SESSION_UNDER_WAY_LAST_SET_WINDOW_MS)
}

/**
 * One read of which session types are under way, as a test per type id: for a reader that asks about
 * several at once. A repository with no read says none is (nothing to keep); a failed read says every
 * one is, so a database hiccup never re-plans or serves differently a session that is being trained.
 */
export async function sessionUnderWayCheck(
  repo: Pick<WorkoutRepository, 'listUnfinishedLoggedSessions'>,
  userId: string,
  now: Date = new Date(),
): Promise<(programSessionId: string) => boolean> {
  if (typeof repo.listUnfinishedLoggedSessions !== 'function') return () => false
  try {
    const ids = new Set((await repo.listUnfinishedLoggedSessions(userId, sessionUnderWayCutoff(now))) ?? [])
    return id => ids.has(id)
  } catch (err) {
    console.error('[prescribe] reading the sessions under way failed; treating them as under way:', err)
    return () => true
  }
}

/** Whether a workout of this session type is under way (`sessionUnderWayCheck` for one type). */
export async function isSessionUnderWay(
  repo: Pick<WorkoutRepository, 'listUnfinishedLoggedSessions'>,
  userId: string,
  programSessionId: string,
  now: Date = new Date(),
): Promise<boolean> {
  return (await sessionUnderWayCheck(repo, userId, now))(programSessionId)
}
