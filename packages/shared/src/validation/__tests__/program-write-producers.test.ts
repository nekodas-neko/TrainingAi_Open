import { describe, expect, it } from 'vitest'
import { WorkoutTemplateWriteSchema } from '@trainingai/shared/validation/program-write'

/**
 * LA-74 — the three payloads that actually reach `POST /api/workout-templates`.
 *
 * Every object below is transcribed from its call site, not written from the `Program` type. That
 * distinction is the entry's whole point: the type is what the producers disagree with, and a
 * schema derived from the type 400s the app's core write path.
 *
 * **The entry counted two producers. There are three** — `builder-review.tsx` was missed, and it is
 * the one that sends `userId: ''` and omits `timeBudgetMinutes` and `supersetGroup`, so a schema
 * checked against only the other two would have rejected every program the AI builder creates.
 */

const ok = (body: unknown) => {
  const r = WorkoutTemplateWriteSchema.safeParse(body)
  if (!r.success) throw new Error(`rejected: ${JSON.stringify(r.error.issues)}`)
  return r.data
}

describe('producer 1 — config-screen.tsx, the editor save', () => {
  // Sessions carry no `programId` and exercises no `sessionId`: the editor builds them from its own
  // React state, and only the ones that already exist in the DB carry an id at all.
  const editorProgram = (schedule: unknown) => ({
    program: {
      id: undefined,
      name: 'Push Pull Legs',
      isActive: true,
      sessions: [{
        id: 'sess-local-1',
        name: 'Upper',
        icon: undefined,
        timeBudgetMinutes: 60,
        position: 0,
        exercises: [{
          id: 'ex-local-1',
          exerciseName: 'Bench Press',
          styleId: undefined,
          exerciseRole: 'primary',
          muscleGroups: ['chest'],
          position: 0,
          supersetGroup: null,
        }],
      }],
      schedule,
      phaseMode: 'manual',
      phaseSetId: undefined,
      sessionsPerCycle: 1,
      trainingGoal: 'hypertrophy',
      autoApplyPrescriptions: false,
    },
  })

  it('accepts the weekly schedule variant', () => {
    ok(editorProgram({
      type: 'weekly',
      days: [{ dayOfWeek: 1 }, { dayOfWeek: 3 }],
      reminderEnabled: true,
      reminderTime: '07:30',
    }))
  })

  it('accepts the rotation variant, which carries no days at all', () => {
    ok(editorProgram({
      type: 'rotation', restAfterN: 3, reminderEnabled: false, reminderTime: null,
    }))
  })

  it('accepts `schedule: null`, which is how the editor CLEARS a schedule', () => {
    // `null` and absent mean different things at the call site — a null is an instruction.
    const parsed = ok(editorProgram(null)) as { program: { schedule: unknown } }
    expect(parsed.program.schedule).toBeNull()
  })
})

describe('producer 2 — config-screen.tsx, the activate button', () => {
  /** `{ ...program, isActive: true }` where `program` came straight from GET, so this is exactly
   *  what `listPrograms` maps: dates as JSON strings, and the columns no editor form touches. */
  const STORED = {
    id: '00000000-0000-4000-8000-00000000b001',
    userId: '00000000-0000-4000-8000-000000000001',
    name: 'Push Pull Legs',
    isActive: false,
    sessions: [{
      id: '00000000-0000-4000-8000-00000000a001',
      programId: '00000000-0000-4000-8000-00000000b001',
      name: 'Upper',
      position: 0,
      timeBudgetMinutes: 60,
      exercises: [{
        id: '00000000-0000-4000-8000-00000000c001',
        sessionId: '00000000-0000-4000-8000-00000000a001',
        exerciseName: 'Bench Press',
        muscleGroups: ['chest'],
        position: 0,
        exerciseRole: 'primary',
        supersetGroup: null,
      }],
    }],
    schedule: {
      id: '00000000-0000-4000-8000-00000000e001',
      programId: '00000000-0000-4000-8000-00000000b001',
      type: 'weekly',
      days: [{ dayOfWeek: 1, sessionId: '00000000-0000-4000-8000-00000000a001' }],
      reminderEnabled: true,
      reminderTime: '07:30',
    },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    phaseMode: 'automatic',
    phaseSetId: '00000000-0000-4000-8000-00000000f001',
    startedAt: '2026-08-01',
    sessionsPerCycle: 3,
    earlyDeloadWeekStart: '2026-08-25',
    totalWeeks: 12,
    trainingGoal: 'strength',
    autoApplyPrescriptions: true,
  }

  it('accepts the whole stored row posted back', () => {
    ok({ program: { ...STORED, isActive: true } })
  })

  it('keeps the columns no form sets — losing one rewrites the activated program', () => {
    const parsed = ok({ program: { ...STORED, isActive: true } }) as {
      program: Record<string, unknown> }
    expect(parsed.program.startedAt).toBe('2026-08-01')
    expect(parsed.program.earlyDeloadWeekStart).toBe('2026-08-25')
    expect(parsed.program.createdAt).toBe('2026-08-01T00:00:00.000Z')
  })
})

describe('producer 3 — builder-review.tsx, the one the entry missed', () => {
  it('accepts sessions without timeBudgetMinutes and exercises without supersetGroup', () => {
    ok({
      program: {
        userId: '',
        name: 'AI Split',
        isActive: true,
        sessions: [{
          id: '00000000-0000-4000-8000-00000000a001',
          name: 'Upper',
          position: 0,
          icon: undefined,
          exercises: [{
            id: '00000000-0000-4000-8000-00000000c001',
            sessionId: '00000000-0000-4000-8000-00000000a001',
            exerciseName: 'Bench Press',
            muscleGroups: ['chest', 'triceps'],
            position: 0,
            exerciseRole: 'primary',
            styleId: undefined,
          }],
        }],
        schedule: { type: 'rotation', restAfterN: 2 },
        createdAt: '2026-09-20T00:00:00.000Z',
        updatedAt: '2026-09-20T00:00:00.000Z',
        phaseMode: 'ai_dynamic',
        phaseSetId: null,
        sessionsPerCycle: 1,
        totalWeeks: 8,
        trainingGoal: 'hypertrophy',
        autoApplyPrescriptions: true,
      },
      linkPhaseSetOwnership: true,
    })
  })

  it("accepts userId: '' — the builder sends an empty string, not an omission", () => {
    const parsed = ok({ program: { userId: '', name: 'X' } }) as {
      program: { userId: unknown } }
    expect(parsed.program.userId).toBe('')
  })
})

describe('producer 4 — the recalibrate call, which carries no program at all', () => {
  it('accepts it', () => {
    ok({ recalibrateCycleAnchor: true, programId: '00000000-0000-4000-8000-00000000b001' })
  })
})

describe('what it now refuses', () => {
  it('a program key no column has', () => {
    expect(WorkoutTemplateWriteSchema.safeParse({
      program: { name: 'X', isAdmin: true },
    }).success).toBe(false)
  })

  it('an exercise key no column has — the Q-464 shape, one level down', () => {
    expect(WorkoutTemplateWriteSchema.safeParse({
      program: { name: 'X', sessions: [{ name: 'S', exercises: [{ exerciseName: 'E', sets: 3 }] }] },
    }).success).toBe(false)
  })

  it('a schedule type that is neither variant', () => {
    expect(WorkoutTemplateWriteSchema.safeParse({
      program: { name: 'X', schedule: { type: 'fortnightly' } },
    }).success).toBe(false)
  })

  it('a numeric field arriving as a string, which is how a silent miswrite starts', () => {
    expect(WorkoutTemplateWriteSchema.safeParse({
      program: { name: 'X', sessionsPerCycle: '3' },
    }).success).toBe(false)
  })

  it('a top-level key the route does not read', () => {
    expect(WorkoutTemplateWriteSchema.safeParse({
      program: { name: 'X' }, deleteEverything: true,
    }).success).toBe(false)
  })

  it('but NOT a long name — a cap here would 400 the activate of a program saved yesterday', () => {
    expect(WorkoutTemplateWriteSchema.safeParse({
      program: { name: 'N'.repeat(5000) },
    }).success).toBe(true)
  })
})
