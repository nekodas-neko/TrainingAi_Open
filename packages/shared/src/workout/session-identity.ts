/**
 * Issue 3665: whether a logged workout is an instance of a program session. Identity is the
 * database id (CLAUDE.md), so a renamed session keeps its history and two sessions that share a
 * name do not share one.
 *
 * A row whose `workout_sessions.session_id` is one of the active program's sessions matches by
 * that id alone. The name is the fallback only for a row with no id, or one pointing outside the
 * active program: that is what carries history across a program rebuilt from scratch, whose new
 * sessions have new ids but the old names.
 */
export interface LoggedSessionRef {
  programSessionId?: string | null
  sessionName: string | null
}

export function loggedAsSession(
  logged: LoggedSessionRef,
  session: { id: string; name: string },
  programSessionIds: ReadonlySet<string>,
): boolean {
  if (logged.programSessionId && programSessionIds.has(logged.programSessionId)) {
    return logged.programSessionId === session.id
  }
  return (logged.sessionName ?? '').toLowerCase() === session.name.toLowerCase()
}

/** The program session a logged workout was an instance of, or `undefined` when none. */
export function programSessionFor<T extends { id: string; name: string }>(
  logged: LoggedSessionRef,
  sessions: readonly T[],
): T | undefined {
  const ids = new Set(sessions.map(s => s.id))
  return sessions.find(s => loggedAsSession(logged, s, ids))
}
