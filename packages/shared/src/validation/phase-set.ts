// Phase-set write bodies. Shared by the create, update and clone routes, which all took a raw cast
// (RV-177): `durationCycles` reached the driver unchecked, and a bad body gave a bodiless 500.
import { z } from 'zod'

/** The six `ProgramPhaseType` values, as a runtime list. All five in use in production are here. */
export const PHASE_TYPES = ['normal', 'peak', 'deload', 'accessory', 'testing', 'baseline'] as const

/** Bounds, named rather than inline (Q-164). 52 is `generated-program.ts`'s existing ceiling. */
export const MAX_DURATION_CYCLES = 52
export const MAX_PHASES_PER_SET = 24
export const MAX_PHASE_NAME_CHARS = 100
/** Positions are re-derived from array order by every route; the bound is hygiene, not semantics. */
const MAX_PHASE_POSITION = MAX_PHASES_PER_SET - 1
const MAX_LOCAL_ID_CHARS = 64

/**
 * **Zero is allowed on purpose.** `generated-program.ts` bounds the AI path's phases at `min(1)`,
 * and the obvious move was to copy it — but the phase editor's stepper floors at
 * `Math.max(0, …)`, and production holds **8 phases at `duration_cycles = 0`**. A `min(1)` here
 * would 400 the owner re-saving a phase set that is already in his database. Whether 0 should be
 * reachable at all is a real question and a separate one; this schema is here to stop unchecked
 * input reaching the driver, not to change what the app accepts.
 *
 * 52 is the existing ceiling, taken from `generated-program.ts` rather than invented.
 */
const PhaseInput = z.object({
  name: z.string().trim().min(1).max(MAX_PHASE_NAME_CHARS),
  durationCycles: z.number().int().min(0).max(MAX_DURATION_CYCLES),
  phaseType: z.enum(PHASE_TYPES),
  // `nullish` in, `undefined` out. `ProgramPhase` types these as `string | undefined`, but a client
  // that clears a style may well send an explicit null rather than omitting the key, and refusing
  // that would be a behaviour change dressed up as validation.
  primaryStyleId: z.string().uuid().nullish().transform(v => v ?? undefined),
  secondaryStyleId: z.string().uuid().nullish().transform(v => v ?? undefined),

  // Declared, not stripped. The client posts `EditablePhase`, which carries these three on top of
  // the fields above — `position` and `primaryStyleName` from `ProgramPhase`, `localId` from the
  // editor — and every route re-derives position and ignores the rest. The first draft left the
  // schema non-strict so Zod would drop them silently; `check-strict-request-schemas` refused it,
  // and it was right: a silent drop hides a client/server mismatch, while naming them keeps an
  // unknown key a 400.
  position: z.number().int().min(0).max(MAX_PHASE_POSITION).optional(),
  localId: z.string().max(MAX_LOCAL_ID_CHARS).optional(),
  primaryStyleName: z.string().max(MAX_PHASE_NAME_CHARS).optional(),
}).strict()

/** `POST /api/phase-sets` and `PUT /api/phase-sets/[id]` take the same body. */
export const PhaseSetWriteBody = z.object({
  name: z.string().trim().min(1).max(MAX_PHASE_NAME_CHARS),
  phases: z.array(PhaseInput).max(MAX_PHASES_PER_SET).default([]),
}).strict()

export const PhaseSetCloneBody = z.object({
  phaseSetId: z.string().uuid(),
  programName: z.string().trim().min(1).max(MAX_PHASE_NAME_CHARS),
  // position → durationCycles. JSON object keys are strings, so the key is validated as digits
  // rather than as a number.
  overrides: z.record(z.string().regex(/^\d+$/), z.number().int().min(0).max(MAX_DURATION_CYCLES)).default({}),
  includeBaseline: z.boolean().optional(),
}).strict()

export type PhaseSetWriteInput = z.infer<typeof PhaseSetWriteBody>
export type PhaseSetCloneInput = z.infer<typeof PhaseSetCloneBody>
