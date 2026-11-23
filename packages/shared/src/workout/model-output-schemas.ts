import { z } from 'zod'
import { ModelSessionSchema } from './model-program'

// What the model is asked to return, for the three workout routes that call it. They live here, not
// in their route files, because a Next route file may export only handlers and the Gemini schema
// check (`lib/ai/__tests__/gemini-model-schemas-4056.test.ts`) has to import them (#4060).

const MUSCLES = ['Chest', 'Shoulders', 'Triceps', 'Biceps', 'Forearms', 'Upper Back', 'Lats', 'Lower Back', 'Traps', 'Core', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Adductors'] as const
const EQUIPMENT = ['barbell', 'dumbbell', 'cable', 'kettlebell', 'machine', 'bodyweight'] as const

export const ExerciseGenSchema = z.object({
  normalizedName: z.string(),
  instructions: z.string(),
  muscles: z.array(z.object({ muscle: z.enum(MUSCLES), role: z.enum(['main', 'secondary']) })).min(1),
  equipment: z.array(z.enum(EQUIPMENT)).min(1),
})

// `/api/generate-program`. Named `...ModelSchema` so it is not mistaken for the request-side
// `GeneratedProgramSchema` in `validation/generated-program.ts`.
//
// The exercise and session shapes are `ModelSessionSchema`, shared with `/api/builder-chat` (#3750).
// They carry no muscles (RV-76): `cleanModelProgram` writes the library's over anything the model
// would return, so asking for them bought two string arrays per exercise on the slowest call in
// the app. The request-side `GeneratedExerciseSchema` in
// packages/shared/src/validation/generated-program.ts keeps both; the builder client posts them.
//
// #3751: the session NAME is not asked for. Code picks the split and the names (`splitForDays`) and
// lists them in the prompt; the model fills them in order, and the names are written on by index.
export const GeneratedProgramModelSchema = z.object({
  name: z.string(),
  sessions: z.array(ModelSessionSchema.omit({ name: true })),
  reasoning: z.string(),
})

// The exercise and session shapes are `ModelSessionSchema`, shared with `/api/generate-program`
// (#3750). They carry no muscles (RV-76): `cleanModelProgram` writes the library's. The request-side
// `GeneratedExerciseSchema` keeps both: it is `.strict()` and the builder client posts its live
// program state wholesale, muscles included.
export const BuilderChatObjectSchema = z.object({
  response: z.string(),
  program: z.object({
    name: z.string(),
    sessions: z.array(ModelSessionSchema),
  }),
})
