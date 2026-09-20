import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ProgramWriteSchema, WorkoutTemplateWriteSchema,
} from '@trainingai/shared/validation/program-write'

/**
 * LA-74 — the drift guard, and the reason this schema is safe to make `.strict()` at all.
 *
 * `config-screen.tsx`'s activate button posts the whole stored program back
 * (`{ ...program, isActive: true }`), and that object is exactly what `listPrograms` mapped out of
 * the row. So the schema is permanently coupled to the `Program` family of types: **a field added
 * to `Program`, `ProgramSession`, `SessionExercise`, `Schedule` or `ScheduleDay` and not added here
 * 400s the activate button**, on a path a unit test of the new field would never touch.
 *
 * Reading the interfaces out of the type source is the only way to catch that in CI — types are
 * erased at runtime, so nothing else can compare them. Same technique BF-178 used for a prompt
 * line: assert against the source when the failure reaches no other surface.
 *
 * **It asks the schema by PARSING, not by walking `_def`.** The first version of this test
 * introspected the wrapper chain to reach each nested shape, and broke on `z.array(...).optional()`
 * — a test that knows that much about Zod's internals fails on a dependency bump rather than on the
 * drift it is for. Feeding a key in and looking for `unrecognized_keys` asks the only question that
 * matters and survives the bump.
 *
 * One-directional on purpose: every TYPE field must be accepted; the schema may carry fields the
 * type does not, because the producers send `userId` and JSON date strings the type models
 * differently, and refusing those is the bug this exists to prevent.
 */

const TYPES_SRC = readFileSync(join(__dirname, '../../types/program.ts'), 'utf8')

/** Field names declared directly inside `export interface <name> { … }`. The interfaces here are
 *  flat; a nested one would surface as a miss rather than be silently skipped. */
function interfaceFields(name: string): string[] {
  const start = TYPES_SRC.indexOf(`export interface ${name} {`)
  expect(start, `interface ${name} not found — renamed?`).toBeGreaterThan(-1)
  const body = TYPES_SRC.slice(start, TYPES_SRC.indexOf('\n}', start))
  return [...body.matchAll(/^\s{2}(\w+)\??\s*:/gm)].map(m => m[1])
}

/** Is `field` refused as an unknown key when it appears at the level `wrap` puts it? Any other
 *  complaint (a wrong value type, say) is not this test's business. */
function refusedAsUnknown(wrap: (probe: Record<string, unknown>) => unknown, field: string): boolean {
  const result = ProgramWriteSchema.safeParse(wrap({ [field]: 'probe' }))
  if (result.success) return false
  return result.error.issues.some(
    i => i.code === 'unrecognized_keys' && (i as { keys?: string[] }).keys?.includes(field),
  )
}

const LEVELS: Array<[string, (probe: Record<string, unknown>) => unknown]> = [
  ['Program', p => ({ name: 'P', ...p })],
  ['ProgramSession', p => ({ name: 'P', sessions: [{ name: 'S', ...p }] })],
  ['SessionExercise', p => ({ name: 'P', sessions: [{ name: 'S', exercises: [{ exerciseName: 'E', ...p }] }] })],
  ['Schedule', p => ({ name: 'P', schedule: { type: 'weekly', ...p } })],
  ['ScheduleDay', p => ({ name: 'P', schedule: { type: 'weekly', days: [{ dayOfWeek: 0, ...p }] } })],
]

describe('LA-74 — every field the Program types carry is nameable in the write schema', () => {
  for (const [typeName, wrap] of LEVELS) {
    it(`${typeName}'s fields are all accepted as keys`, () => {
      const missing = interfaceFields(typeName).filter(f => refusedAsUnknown(wrap, f))
      expect(
        missing,
        `${typeName} declares ${missing.join(', ')}, which POST /api/workout-templates would now `
        + 'reject. The activate button posts the stored row back verbatim, so that is a 400 on the '
        + "app's core write path — add the field to program-write.ts.",
      ).toEqual([])
    })
  }

  it('the probe can actually fail, at every level', () => {
    // Without this, a `refusedAsUnknown` that always returned false — or an `interfaceFields` that
    // returned [] — would make every case above pass while checking nothing. The two fragile parts
    // are the regex and the issue-code match, so both get proven.
    for (const [typeName, wrap] of LEVELS) {
      expect(refusedAsUnknown(wrap, 'aKeyNoColumnHas'), `${typeName} level`).toBe(true)
    }
    expect(interfaceFields('Program')).toContain('autoApplyPrescriptions')
    expect(interfaceFields('Program').length).toBeGreaterThan(10)
    expect(interfaceFields('ScheduleDay')).toEqual(['dayOfWeek', 'sessionId'])
  })

  it('the body wrapper names exactly the four keys the route reads', () => {
    expect(Object.keys((WorkoutTemplateWriteSchema as unknown as {
      shape: Record<string, unknown> }).shape).sort())
      .toEqual(['linkPhaseSetOwnership', 'program', 'programId', 'recalibrateCycleAnchor'])
  })
})
