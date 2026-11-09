import { describe, expect, it } from 'vitest'
import { getTableColumns } from 'drizzle-orm'
import { workoutSessions } from '../schema'

// #2412 step 1. `workout_sessions.program_session_id` is dead: never written, never read, and the
// live link to `program_sessions` is `session_id`. Drizzle selects every declared column, so while
// the schema declared it, dropping the column would have broken every `workout_sessions` read on any
// deployed build. Undeclared, the drop (step 2, confirm-first with the owner) becomes safe to ship
// once a release without the declaration is live.
describe('workout_sessions schema (#2412)', () => {
  it('does not declare the dead program_session_id column', () => {
    const columns = Object.values(getTableColumns(workoutSessions)).map(c => c.name)
    expect(columns).not.toContain('program_session_id')
  })

  it('keeps the live link to program_sessions on session_id', () => {
    expect(getTableColumns(workoutSessions).programSessionId.name).toBe('session_id')
  })
})
