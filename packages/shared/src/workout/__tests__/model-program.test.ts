// #3750. One function cleans a model's program for `/api/generate-program` and `/api/builder-chat`.
// These pin what it does to a single answer; `app/api/__tests__/program-routes-clean-alike-3750.test.ts`
// pins that both routes get the same result from it.
import { describe, it, expect } from 'vitest'
import { buildExerciseNameResolver } from '../exercise-name-resolver'
import { GOAL_STYLE_RULES } from '../known-styles'
import { cleanModelProgram, ModelExerciseSchema, type ModelSession } from '../model-program'

const LIBRARY = [
  { name: 'Bench Press', muscles: [{ muscle: 'Chest', role: 'main' as const }, { muscle: 'Triceps', role: 'secondary' as const }] },
  { name: 'Overhead Press', muscles: [{ muscle: 'Shoulders', role: 'main' as const }] },
  { name: 'Triceps Pushdown', muscles: [{ muscle: 'Triceps', role: 'main' as const }] },
]
const resolver = buildExerciseNameResolver(LIBRARY)
const RULES = GOAL_STYLE_RULES.hypertrophy
const styleIdByName = new Map([[RULES.primary, 'id-primary'], [RULES.accessory, 'id-accessory'], ['Custom', 'id-custom']])

const session = (exercises: ModelSession['exercises'], icon = '🫸'): ModelSession => ({ name: 'Push', icon, exercises })
const ex = (name: string, exerciseRole: 'primary' | 'secondary' | 'accessory', progressionStyleName = 'Invented') =>
  ({ name, exerciseRole, progressionStyleName })

describe('cleanModelProgram', () => {
  it('keeps a paraphrased name under the library spelling, with the library muscles', () => {
    const { sessions, dropped } = cleanModelProgram(
      [session([ex('bench press', 'primary'), ex('Press, Overhead', 'secondary')])],
      { resolver, goal: 'hypertrophy', styleIdByName },
    )
    expect(dropped).toEqual([])
    expect(sessions[0].exercises.map(e => e.name)).toEqual(['Bench Press', 'Overhead Press'])
    expect(sessions[0].exercises[0]).toMatchObject({ mainMuscles: ['Chest'], secondaryMuscles: ['Triceps'] })
  })

  it('drops a name the library does not hold and says which', () => {
    const { sessions, dropped } = cleanModelProgram(
      [session([ex('Bench Press', 'primary'), ex('Unicorn Press', 'accessory')])],
      { resolver, goal: 'hypertrophy', styleIdByName },
    )
    expect(sessions[0].exercises.map(e => e.name)).toEqual(['Bench Press'])
    expect(dropped).toEqual(['Unicorn Press'])
  })

  // The resolver deliberately stops at case, punctuation, plurals and word order (LA-43). An added
  // word is a different lift as far as it can tell, so this function must not reach further.
  it('does not treat an added word as a paraphrase', () => {
    const { dropped } = cleanModelProgram([session([ex('Barbell Bench Press', 'primary')])], { resolver, goal: 'hypertrophy', styleIdByName })
    expect(dropped).toEqual(['Barbell Bench Press'])
  })

  it('caps primaries after the drop, so a dropped name cannot spend the one primary', () => {
    const { sessions } = cleanModelProgram(
      [session([ex('Unicorn Press', 'primary'), ex('Bench Press', 'primary'), ex('Overhead Press', 'primary')])],
      { resolver, goal: 'hypertrophy', styleIdByName },
    )
    expect(sessions[0].exercises.map(e => e.exerciseRole)).toEqual(['primary', 'secondary'])
  })

  it('sets the style from the role for the goal, and keeps an accessory style only if the user has it', () => {
    const { sessions } = cleanModelProgram(
      [session([
        ex('Bench Press', 'primary', 'Custom'),
        ex('Overhead Press', 'accessory', 'Custom'),
        ex('Triceps Pushdown', 'accessory', 'Invented'),
      ])],
      { resolver, goal: 'hypertrophy', styleIdByName },
    )
    expect(sessions[0].exercises.map(e => [e.progressionStyleName, e.progressionStyleId])).toEqual([
      [RULES.primary, 'id-primary'],
      ['Custom', 'id-custom'],
      [RULES.accessory, 'id-accessory'],
    ])
  })

  it('without a goal keeps the styles the model returned', () => {
    const { sessions } = cleanModelProgram(
      [session([ex('Bench Press', 'primary', 'Custom'), ex('Overhead Press', 'secondary', 'Invented')])],
      { resolver, styleIdByName },
    )
    expect(sessions[0].exercises.map(e => [e.progressionStyleName, e.progressionStyleId])).toEqual([
      ['Custom', 'id-custom'],
      ['Invented', undefined],
    ])
  })

  it('replaces a non-emoji icon only when asked to', () => {
    const input = [session([ex('Bench Press', 'primary')], 'dumbbell')]
    expect(cleanModelProgram(input, { resolver, styleIdByName }).sessions[0].icon).toBe('dumbbell')
    expect(cleanModelProgram(input, { resolver, styleIdByName, fallbackIcon: true }).sessions[0].icon).toBe('🫸')
    const emoji = [session([ex('Bench Press', 'primary')], '🔥')]
    expect(cleanModelProgram(emoji, { resolver, styleIdByName, fallbackIcon: true }).sessions[0].icon).toBe('🔥')
  })

  // RV-76: the model is not asked for muscles; the library's are written over anything it says.
  it('the model schema asks for three fields and no muscles', () => {
    expect(Object.keys(ModelExerciseSchema.shape).sort()).toEqual(['exerciseRole', 'name', 'progressionStyleName'])
  })
})
