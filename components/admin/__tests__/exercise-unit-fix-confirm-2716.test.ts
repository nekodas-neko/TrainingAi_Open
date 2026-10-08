// Issue 2716: the lbs-to-kg Apply confirm tells the owner to sync the phone first, because the push
// path has no merge rule and an unsynced edit would put the old weights back.
import { describe, it, expect } from 'vitest'
import { applyConfirmMessage } from '../exercise-unit-fix'

describe('applyConfirmMessage', () => {
  it('names what will change and says to sync the phone first', () => {
    const msg = applyConfirmMessage(3, ['Bench Press', 'Squat'], '2026-03-31')
    expect(msg).toContain('Convert 3 session(s) for Bench Press, Squat logged before 2026-03-31')
    expect(msg).toContain('This cannot be undone automatically.')
    expect(msg).toContain('Sync your phone first (More → Data → Sync now).')
    expect(msg).toContain('An unsynced edit to one of these workouts would put the old weights back.')
  })
})
