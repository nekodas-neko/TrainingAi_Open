import { WorkoutTemplateWriteSchema } from './program-write'
import { hasVisibleCharacter, BLANK_EXERCISE_NAME_MESSAGE } from './visible-name'

/**
 * #4129: what the SERVER accepts on `POST /api/workout-templates`. A lift needs a name with something
 * a person can see, but that rule sits here and not on `ProgramWriteSchema` (in `program-write.ts`): the native app parses
 * the program LIST response, its cached copy and its queued `program_save` commands with
 * `ProgramWriteSchema`, so a write rule on that shape would stop the whole list loading for one
 * stored blank lift. Reads and queued commands must keep parsing what they parsed before; only a
 * request the server is about to store is refused. Server routes use this; `mobile/` never imports this file (a root test checks).
 */
export const WorkoutTemplateWriteRequestSchema = WorkoutTemplateWriteSchema.superRefine((body, ctx) => {
  body.program?.sessions?.forEach((session, si) => {
    session.exercises?.forEach((ex, ei) => {
      if (!hasVisibleCharacter(ex.exerciseName)) {
        ctx.addIssue({
          code: 'custom',
          message: BLANK_EXERCISE_NAME_MESSAGE,
          path: ['program', 'sessions', si, 'exercises', ei, 'exerciseName'],
        })
      }
    })
  })
})
