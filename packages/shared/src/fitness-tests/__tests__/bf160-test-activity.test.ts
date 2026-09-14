import { describe, it, expect } from 'vitest'
import { buildTestActivity } from '@trainingai/shared/fitness-tests/test-activity'
import { getProtocol, FITNESS_TEST_PROTOCOLS } from '@trainingai/shared/fitness-tests/protocols'
import { distanceCanBeScored } from '@trainingai/shared/health/fitness-tests'
import { ActivityLogBody } from '@trainingai/shared/validation/activity-log'

const cooper = getProtocol('cooper12')!
const sixMwt = getProtocol('6mwt')!
const hrr = getProtocol('resting_hrr')!

const START = 1_757_800_000_000

function run(protocol = cooper, over: Partial<Parameters<typeof buildTestActivity>[0]> = {}) {
  return buildTestActivity({
    protocol, startMs: START, endMs: START + 720_000,
    distanceM: 1975, avgHr: 156, maxHr: 175, ...over,
  })
}

describe('BF-160 — the activity a fitness test is worth', () => {
  it("maps the owner's Cooper run onto a run activity with its measured numbers", () => {
    expect(run()).toEqual({
      activityType: 'run',
      title: 'Cooper 12-Minute Run',
      durationMin: 12,
      distanceKm: 1.98,
      avgHr: 156,
      maxHr: 175,
    })
  })

  it('maps a 6MWT onto a walk, which is what the pedometer-overlap subtraction keys off', () => {
    const a = run(sixMwt, { endMs: START + 360_000, distanceM: 600 })
    expect(a).toMatchObject({ activityType: 'walk', durationMin: 6, distanceKm: 0.6 })
  })

  it('writes nothing for resting_hrr — a minute of effort inside three of sitting is not cardio', () => {
    expect(run(hrr, { distanceM: 0 })).toBeNull()
  })

  it('writes nothing when the capture has no duration, so a mis-tap leaves no row', () => {
    expect(run(cooper, { endMs: START })).toBeNull()
    expect(run(cooper, { endMs: START + 2_000 })).toBeNull()   // rounds to 0.0 min
  })

  it('keeps a 3-second capture out while keeping a 4-second one in, at the 1dp rounding boundary', () => {
    expect(run(cooper, { endMs: START + 2_999 })).toBeNull()
    expect(run(cooper, { endMs: START + 3_000 })).toMatchObject({ durationMin: 0.1 })
  })

  it('omits a zero distance rather than sending it, because the wire schema rejects a 0 km run', () => {
    expect(run(cooper, { distanceM: 0 })?.distanceKm).toBeNull()
  })

  it('omits the distance for a protocol that does not capture one', () => {
    const noDistance = { ...cooper, captureDistance: false }
    expect(run(noDistance, { distanceM: 1975 })?.distanceKm).toBeNull()
  })

  it('still logs the activity when BF-158 refuses to score the distance — the effort happened', () => {
    const tooShort = 500
    expect(distanceCanBeScored('cooper', tooShort)).toBe(false)
    expect(run(cooper, { distanceM: tooShort })).toMatchObject({ activityType: 'run', durationMin: 12 })
  })

  it('carries a null HR through rather than inventing one', () => {
    expect(run(cooper, { avgHr: null, maxHr: null })).toMatchObject({ avgHr: null, maxHr: null })
  })

  // The wire schema is the thing that decides whether this reaches the database at all: the sync
  // push parses the outbox payload with it and pushes a failure into `errors[]`, where a rejected
  // activity is dead-lettered silently rather than surfacing on the screen that saved it. So the
  // builder's output is checked against the schema here, not only against its own field names.
  describe('the payload the wire schema will actually see', () => {
    const wire = (draft: NonNullable<ReturnType<typeof buildTestActivity>>) => ({
      date: '2026-09-14',
      activityType: draft.activityType, title: draft.title,
      durationMin: draft.durationMin,
      ...(draft.distanceKm != null ? { distanceKm: draft.distanceKm } : {}),
      ...(draft.avgHr != null ? { avgHr: draft.avgHr } : {}),
      ...(draft.maxHr != null ? { maxHr: draft.maxHr } : {}),
      startTime: '06:30', endTime: '06:42',
    })

    it("accepts the owner's Cooper", () => {
      expect(ActivityLogBody.safeParse(wire(run()!)).success).toBe(true)
    })

    it('accepts a 6MWT', () => {
      const a = run(sixMwt, { endMs: START + 360_000, distanceM: 600 })!
      expect(ActivityLogBody.safeParse(wire(a)).success).toBe(true)
    })

    it('accepts the distance-less shape, which is the one a zero would have broken', () => {
      // `distanceKm` is `.positive()`, so sending the 0 rather than omitting it is a rejection —
      // and a rejection on the push path is a dead letter, not an error the user ever sees.
      const a = run(cooper, { distanceM: 0 })!
      expect(a.distanceKm).toBeNull()
      expect(ActivityLogBody.safeParse(wire(a)).success).toBe(true)
      expect(ActivityLogBody.safeParse({ ...wire(a), distanceKm: 0 }).success).toBe(false)
    })

    it('accepts a capture with no heart-rate readings at all', () => {
      const a = run(cooper, { avgHr: null, maxHr: null })!
      expect(ActivityLogBody.safeParse(wire(a)).success).toBe(true)
    })
  })

  it('leaves every protocol answering the activity question, so a new row cannot forget', () => {
    for (const p of FITNESS_TEST_PROTOCOLS) {
      expect(p, p.id).toHaveProperty('activityType')
      expect(p.activityType === null || typeof p.activityType === 'string', p.id).toBe(true)
    }
  })
})
