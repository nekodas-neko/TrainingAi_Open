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
import { ModelExerciseSchema } from '../../workout/model-program'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

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
  // #3750: both routes now take the exercise shape from one shared schema, so the check reads the
  // schema itself and that each route uses it, where it used to read two literals in route source.
  it('the shared model schema does not ask for muscles', () => {
    const fields = Object.keys(ModelExerciseSchema.shape)
    expect(fields).not.toContain('mainMuscles')
    expect(fields).not.toContain('secondaryMuscles')
    // Still the fields that ARE read, so this cannot pass by the schema being gutted.
    expect(fields).toContain('name')
    expect(fields).toContain('exerciseRole')
  })

  for (const file of ['app/api/generate-program/route.ts', 'app/api/builder-chat/route.ts']) {
    it(`${file} asks the model for the shared shape and declares no exercise schema of its own`, () => {
      const src = read(file)
      expect(src).toContain('sessions: z.array(ModelSessionSchema)')
      expect(src).not.toMatch(/exerciseRole: z\.enum/)
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
