// RV-76 — the two program routes asked the model for muscle arrays they then threw away.
//
// `generate-program` runs every generated exercise through `resolveAgainstLibrary`, which overwrites
// mainMuscles/secondaryMuscles with the library's assignments and drops names the library does not
// hold. `builder-chat` filters to `exerciseMuscleLookup` and then overwrites from it. So the model's
// arrays — up to 10 strings x 60 chars per exercise, across ~30 exercises, on the slowest call in
// the app — were discarded on arrival, and they are a field the model is known to get wrong.
//
// THE TRAP THIS FILE EXISTS FOR: the entry said to delete the fields from `GeneratedExerciseSchema`
// too. That is the REQUEST-side schema, it is `.strict()`, and `builder-review.tsx` posts its live
// program state wholesale — muscles included. Deleting them there would 400 every builder-chat turn,
// which is exactly the failure the Q-464 comment in that file records for `clientId`.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GeneratedProgramSchema } from '../generated-program'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

/** A named `z.object({...})` literal from a route, so a match cannot come from a different one. */
function schemaLiteral(src: string, name: string): string {
  const i = src.indexOf(`const ${name} = z.object({`)
  expect(i, `${name} not found`).toBeGreaterThan(-1)
  const rest = src.slice(i)
  return rest.slice(0, rest.indexOf('\n})') + 3)
}

/** What the builder client really posts: its program state, muscles and all. */
const clientProgram = {
  name: 'Upper/Lower',
  sessions: [{
    name: 'Upper', icon: '🏋️',
    exercises: [{
      name: 'Bench Press',
      exerciseRole: 'primary' as const,
      mainMuscles: ['Chest'],
      secondaryMuscles: ['Triceps'],
      progressionStyleName: 'Linear',
    }],
  }],
}

describe('RV-76 — muscles leave the model schemas and stay in the request schema', () => {
  for (const [file, schema] of [
    ['app/api/generate-program/route.ts', 'GeneratedExerciseSchema'],
    ['app/api/builder-chat/route.ts', 'BuilderExerciseSchema'],
  ] as const) {
    it(`${schema} no longer asks the model for muscles`, () => {
      const literal = schemaLiteral(read(file), schema)
      expect(literal).not.toContain('mainMuscles')
      expect(literal).not.toContain('secondaryMuscles')
      // Still the fields that ARE read, so this cannot pass by the schema being gutted.
      expect(literal).toContain('name')
      expect(literal).toContain('exerciseRole')
    })
  }

  // The half that must NOT be "cleaned up" next.
  it('the REQUEST schema still accepts a program carrying muscles', () => {
    expect(GeneratedProgramSchema.safeParse(clientProgram).success).toBe(true)
  })

  it('and still requires them, because the client always sends them', () => {
    const withoutMuscles = structuredClone(clientProgram) as Record<string, unknown>
    const ex = (withoutMuscles.sessions as { exercises: Record<string, unknown>[] }[])[0].exercises[0]
    delete ex.mainMuscles
    delete ex.secondaryMuscles
    expect(GeneratedProgramSchema.safeParse(withoutMuscles).success).toBe(false)
  })

  // `.strict()` is what turns "removed a field the client sends" into a 400 rather than a shrug,
  // and it is also what makes the request schema the wrong place to delete from.
  it('rejects an unknown field, which is why the request schema is load-bearing', () => {
    const extra = structuredClone(clientProgram) as Record<string, unknown>
    const ex = (extra.sessions as { exercises: Record<string, unknown>[] }[])[0].exercises[0]
    ex.inventedByAModel = 'yes'
    expect(GeneratedProgramSchema.safeParse(extra).success).toBe(false)
  })
})
