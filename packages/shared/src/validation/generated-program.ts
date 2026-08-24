import { z } from 'zod'

// Bounded request-side mirror of the GeneratedProgram interface
// (lib/types/builder.ts). Used by builder-chat to replace `program: z.any()`
// — caps sizes so a hostile payload can't balloon the Gemini prompt, and
// turns the previous 500 (program.sessions.length on garbage) into a 400.
export const GeneratedExerciseSchema = z.object({
  name: z.string().min(1).max(120),
  exerciseRole: z.enum(['primary', 'secondary', 'accessory']),
  mainMuscles: z.array(z.string().max(60)).max(10),
  secondaryMuscles: z.array(z.string().max(60)).max(10),
  progressionStyleName: z.string().max(100).optional(),
  progressionStyleId: z.string().max(100).optional(),
  // Q-464: builder-review.tsx mints a clientId on every exercise in its live `program` state (the
  // review editor's React key) and sends that state wholesale to builder-chat — `.strict()` without
  // this would 400 every real chat turn. Not read below; it round-trips back to the client unchanged.
  clientId: z.string().optional(),
}).strict()

export const GeneratedSessionSchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().max(60),
  exercises: z.array(GeneratedExerciseSchema).min(1).max(20),
}).strict()

export const GeneratedPhaseSchema = z.object({
  name: z.string().min(1).max(100),
  durationCycles: z.number().int().min(1).max(52),
  phaseType: z.string().max(60),
  primaryStyleName: z.string().max(100).optional(),
}).strict()

export const GeneratedProgramSchema = z.object({
  name: z.string().min(1).max(100),
  sessions: z.array(GeneratedSessionSchema).min(1).max(7),
  phaseStructureName: z.string().max(100).default(''),
  phaseSetId: z.string().max(100).default(''),
  reasoning: z.string().max(5000).default(''),
  phases: z.array(GeneratedPhaseSchema).max(12).default([]),
}).strict()
