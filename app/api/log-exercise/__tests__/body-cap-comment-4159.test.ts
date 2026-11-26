// #4159: the comments that justify the workout upload's body caps name the schema and a measured
// maximal payload. Adding `setEfforts` to the schema grew that maximum, so the figure is measured
// here, at the schema's own limits, and the comments must state it.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { LogExerciseUploadSchema } from '@trainingai/shared/workout/log-exercise'

const uuid = '00000000-0000-4000-8000-000000000000'
const s200 = 'x'.repeat(200)
const nums = (v: number) => Array(20).fill(v)
// Every array at 20 entries, every string at 200 characters, every number at its largest legal value.
const MAXIMAL = {
  sessionName: s200, sessionId: uuid, workoutSessionId: uuid, exerciseLogId: uuid, setLogIds: Array(20).fill(uuid),
  exercise: s200, weights: nums(-100), sets: 20, reps: nums(100), localDate: s200,
  timeToCompleteSet: 86_400, setTimes: nums(86_400), restTimes: nums(86_400),
  setStartTimes: nums(4_100_000_000_000), setEndTimes: nums(4_100_000_000_000),
  interExerciseRestSec: 86_400, prepTimeSec: 86_400,
  progressionStyle: Array(20).fill({ id: s200, styleId: s200, setNumber: 20, pct: 100, reps: 100, restSec: 86_400, useFor1rm: true }),
  prescriptionBasisKg: 1000, liftOneShotSetAt: '2026-11-26T00:00:00.000Z',
  plannedWeights: nums(500), styleName: s200, styleId: s200, muscleGroups: Array(20).fill(s200),
  workoutStartedAt: 4_100_000_000_000, warmupEndedAtMs: 4_100_000_000_000,
  rpeValues: nums(10), rpeSources: Array(20).fill('rated'), intensityMode: 'deload', wasOverride: true,
  exerciseDeloaded: true, effort: { vsPlan: -1, source: 'default' },
  setEfforts: Array(20).fill({ vsPlan: -1, source: 'default' }),
  estimated1rm: 1000, target80: 1000, editedAt: 4_100_000_000_000,
}
const readSrc = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

describe('the upload body-cap comments (#4159)', () => {
  it('the maximal payload is valid, and both comments name the schema and its measured size', () => {
    expect(LogExerciseUploadSchema.safeParse(MAXIMAL).success).toBe(true)
    const bytes = Buffer.byteLength(JSON.stringify(MAXIMAL))
    expect(bytes).toBeLessThan(64 * 1024) // the route's cap holds it
    const figure = bytes.toLocaleString('en-US')
    const route = readSrc('../route.ts')
    expect(route).toContain('LogExerciseUploadSchema')
    expect(route).not.toContain('LogExercisePayloadSchema')
    expect(route).toContain(`${figure} bytes`)
    expect(readSrc('../../sync/push/route.ts')).toContain(`${figure} bytes`)
  })
})
