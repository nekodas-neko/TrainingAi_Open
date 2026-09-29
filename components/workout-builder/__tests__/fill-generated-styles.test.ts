import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fillGeneratedStyles } from '@/components/workout-builder/fill-generated-styles'
import { mostUsedStyleId } from '@/components/config/default-exercise-style'
import { stripComments } from '../../../scripts/lib/strip-comments.js'
import type { GeneratedProgram, GeneratedExercise } from '@trainingai/shared/types/builder'

const ex = (
  name: string,
  exerciseRole: GeneratedExercise['exerciseRole'],
  style?: [string, string],
): GeneratedExercise => ({
  name,
  exerciseRole,
  mainMuscles: ['chest'],
  secondaryMuscles: [],
  progressionStyleId: style?.[0],
  progressionStyleName: style?.[1],
})

const program = (...exercises: GeneratedExercise[]): GeneratedProgram => ({
  name: 'Generated',
  sessions: [{ name: 'One', icon: '🏋️', exercises }],
  phaseStructureName: 'Linear Progression',
  phaseSetId: '',
  reasoning: '',
  phases: [],
})

const POWER: [string, string] = ['power', 'Powerbuilding']
const HYPER: [string, string] = ['hyper', 'Hypertrophy 3-set']

describe('fillGeneratedStyles — LA-183', () => {
  it('gives a style-less exercise the style its role already uses, with the matching name', () => {
    const filled = fillGeneratedStyles(program(
      ex('Bench', 'primary', POWER),
      ex('Fly', 'accessory', HYPER),
      ex('Pushdown', 'accessory', HYPER),
      ex('Row', 'primary'),
    ))
    const [, , , row] = filled.sessions[0].exercises
    expect(row.progressionStyleId).toBe('power')
    // The name has to travel with the id: the row's sets/reps line is keyed on the NAME.
    expect(row.progressionStyleName).toBe('Powerbuilding')
  })

  it('falls back to the program-wide favourite when the role has nothing styled', () => {
    const filled = fillGeneratedStyles(program(
      ex('Fly', 'accessory', HYPER),
      ex('Pushdown', 'accessory', HYPER),
      ex('Row', 'primary'),
    ))
    expect(filled.sessions[0].exercises[2].progressionStyleId).toBe('hyper')
  })

  it('returns the very same object when nothing is missing, so a memo over it stays stable', () => {
    const input = program(ex('Bench', 'primary', POWER), ex('Fly', 'accessory', HYPER))
    expect(fillGeneratedStyles(input)).toBe(input)
  })

  it('leaves an exercise alone when the whole program has no style to copy', () => {
    const filled = fillGeneratedStyles(program(ex('Bench', 'primary'), ex('Fly', 'accessory')))
    expect(filled.sessions[0].exercises.map(e => e.progressionStyleId)).toEqual([undefined, undefined])
  })

  it('never overwrites a style the program already carries', () => {
    const filled = fillGeneratedStyles(program(
      ex('Bench', 'primary', POWER),
      ex('Fly', 'accessory', HYPER),
      ex('Row', 'primary'),
    ))
    expect(filled.sessions[0].exercises[0].progressionStyleId).toBe('power')
    expect(filled.sessions[0].exercises[1].progressionStyleId).toBe('hyper')
  })
})

describe('mostUsedStyleId accepts every id unless told otherwise — LA-183', () => {
  // The builder's ids were resolved server-side against the user's own styles, so re-checking them
  // is neither possible on this screen nor needed; the editor passes the check because its slots can
  // carry a style the user has since deleted.
  const slots = [{ exercises: [{ styleId: 'from-the-server', exerciseRole: 'primary' as const }] }]

  it('returns an id it was given no list to check against', () => {
    expect(mostUsedStyleId(slots)).toBe('from-the-server')
  })

  it('drops one the caller calls unknown', () => {
    expect(mostUsedStyleId(slots, undefined, () => false)).toBeUndefined()
  })
})

describe('the review screen shows and saves the filled program — LA-183', () => {
  // Comments stripped first: this file's prose names the symbols it is checking for.
  const review = stripComments(
    readFileSync(path.join(process.cwd(), 'components/workout-builder/builder-review.tsx'), 'utf8'),
  )

  it('derives the filled program rather than writing it back through onProgramChange', () => {
    expect(review).toMatch(/const shown = useMemo\(\(\) => fillGeneratedStyles\(program\), \[program\]\)/)
    expect(review).not.toMatch(/useEffect[\s\S]{0,200}fillGeneratedStyles/)
  })

  it('renders the rows, the volume projection and the save payload from it', () => {
    expect(review).toMatch(/\{shown\.sessions\.map\(\(session, si\) => \(/)
    expect(review).toMatch(/projectMuscleSets\(shown\)/)
    expect(review).toMatch(/const programSessions = shown\.sessions\.map/)
    expect(review).not.toMatch(/projectMuscleSets\(program\)/)
  })

  it('never leaves the sets/reps line blank for a style it has no display row for', () => {
    expect(review).toMatch(/STYLE_DISPLAY\[ex\.progressionStyleName\] \?\? ex\.progressionStyleName/)
  })
})
