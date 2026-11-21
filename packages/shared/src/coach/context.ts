import { z } from 'zod';
import { isCalendarDate } from '@trainingai/shared/date-utils';

/**
 * Where the Coach was opened from (#3896 step 2). The chat request carries this beside the
 * conversation, so the model is told which lift, session, workout or day the user was looking at
 * without the user having to say it.
 *
 * **Only ids and a date cross the wire, never text.** The server checks every id against the
 * signed-in user and writes the context block the model sees from that user's own rows; nothing
 * the client says about the screen reaches the prompt. A client cannot name a lift — only point at
 * one of its own.
 *
 * Shared with the native app, which sends it from step 6 on. Strict, so a client that sends a key
 * this build has not shipped gets a 400 rather than a silently ignored field.
 */
export const COACH_CONTEXT_ORIGINS = ['home', 'exercise', 'session', 'recap', 'day', 'nutrition'] as const;
export type CoachContextOrigin = (typeof COACH_CONTEXT_ORIGINS)[number];

const Id = z.uuid();

export const CoachContextSchema = z
  .object({
    origin: z.enum(COACH_CONTEXT_ORIGINS),
    /** A `session_exercises` row: the lift the user opened the Coach from. */
    sessionExerciseId: Id.optional(),
    /** A `program_sessions` row: the session card or the pre-workout screen. */
    programSessionId: Id.optional(),
    /** A `workout_sessions` row: the recap of a workout already logged. */
    workoutId: Id.optional(),
    /** A local calendar day, `-` or `/` separated, for a day's history screen. */
    date: z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/).refine(isCalendarDate, 'Not a calendar day').optional(),
  })
  .strict()
  .superRefine((ctx, issue) => {
    // Each origin names the one thing it was opened on. An origin without its id is a client bug,
    // and filling it in from "the most recent" would show the model a lift the user never opened.
    const required: Partial<Record<CoachContextOrigin, keyof typeof ctx>> = {
      exercise: 'sessionExerciseId',
      session: 'programSessionId',
      recap: 'workoutId',
      day: 'date',
    };
    const key = required[ctx.origin];
    if (key && ctx[key] == null) {
      issue.addIssue({ code: 'custom', message: `origin "${ctx.origin}" needs ${key}`, path: [key] });
    }
  });
export type CoachContext = z.infer<typeof CoachContextSchema>;
