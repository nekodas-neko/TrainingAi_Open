import { describe, it, expect } from 'vitest'
import { SessionRpeSchema } from '@trainingai/shared/validation/session-rpe'

describe('SessionRpeSchema', () => {
  it('accepts an in-range RPE', () => {
    const r = SessionRpeSchema.safeParse({ workoutSessionId: 'a3f4c8b2-1e4d-4a9b-8f2e-6d5c4b3a2f1e', sessionRpe: 7 })
    expect(r.success).toBe(true)
  })
  it('rejects an out-of-range RPE', () => {
    expect(SessionRpeSchema.safeParse({ workoutSessionId: 'a3f4c8b2-1e4d-4a9b-8f2e-6d5c4b3a2f1e', sessionRpe: 42 }).success).toBe(false)
    expect(SessionRpeSchema.safeParse({ workoutSessionId: 'a3f4c8b2-1e4d-4a9b-8f2e-6d5c4b3a2f1e', sessionRpe: 0 }).success).toBe(false)
    expect(SessionRpeSchema.safeParse({ workoutSessionId: 'a3f4c8b2-1e4d-4a9b-8f2e-6d5c4b3a2f1e', sessionRpe: 5.5 }).success).toBe(false)
  })
  it('rejects a malformed workoutSessionId', () => {
    expect(SessionRpeSchema.safeParse({ workoutSessionId: 'not-a-uuid', sessionRpe: 7 }).success).toBe(false)
    expect(SessionRpeSchema.safeParse({ sessionRpe: 7 }).success).toBe(false)
  })
})
