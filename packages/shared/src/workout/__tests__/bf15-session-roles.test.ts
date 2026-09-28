// BF-15 — an exercise added to an existing session is never silently Primary, and the session
// shape the plan specifies (docs/superpowers/plans/2026-08-24-exercise-roles.md §2).
import { describe, it, expect } from 'vitest'
import { recommendAddedExerciseRole, sessionShape } from '../exercise-role'

const ex = (m: number | null) => ({ muscleCount: m, equipment: ['barbell'] })

describe('sessionShape (BF-15)', () => {
  it('scales with the configured length, 60 minutes being the measured row', () => {
    expect(sessionShape(30)).toEqual({ exercises: 3, primary: 1, secondary: 1, accessory: 1 })
    expect(sessionShape(45)).toEqual({ exercises: 4, primary: 1, secondary: 2, accessory: 1 })
    expect(sessionShape(60)).toEqual({ exercises: 5, primary: 1, secondary: 2, accessory: 2 })
    expect(sessionShape(90)).toEqual({ exercises: 8, primary: 2, secondary: 3, accessory: 3 })
  })
})

describe('recommendAddedExerciseRole (BF-15)', () => {
  it('never recommends Primary, even for a five-muscle barbell compound', () => {
    expect(recommendAddedExerciseRole(ex(5), [], 60)).not.toBe('primary')
  })

  it('fills Secondary only while the shape has a slot free', () => {
    expect(recommendAddedExerciseRole(ex(3), ['primary', 'accessory'], 60)).toBe('secondary')
    expect(recommendAddedExerciseRole(ex(3), ['primary', 'secondary', 'secondary'], 60)).toBe('accessory')
  })

  it('an isolation movement or an uncatalogued one is Accessory', () => {
    expect(recommendAddedExerciseRole(ex(1), ['primary'], 60)).toBe('accessory')
    expect(recommendAddedExerciseRole(ex(null), ['primary'], 60)).toBe('accessory')
  })
})

describe('the unclassified default (BF-15)', () => {
  it('the server and the device default a missing role the same way, and it is accessory', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const server = readFileSync(join(process.cwd(), 'lib/data/postgres/schema.ts'), 'utf8')
    const device = readFileSync(join(process.cwd(), 'lib/sqlite/migrations.ts'), 'utf8')
    expect(server).toMatch(/exerciseRole: text\('exercise_role'\)\.notNull\(\)\.default\('accessory'\)/)
    expect(device).toMatch(/exercise_role TEXT NOT NULL DEFAULT 'accessory'/)
    expect(device).not.toMatch(/exercise_role TEXT NOT NULL DEFAULT 'primary'/)
  })
})

describe('an accessory exercise always has a style to prescribe from (BF-15 defect a)', async () => {
  const { resolveStyleForExercise } = await import('../../phase-engine')
  const phase = { phaseType: 'accumulation', position: 0, primaryStyleId: 'heavy', secondaryStyleId: 'light' } as never
  const noStyle = { phaseType: 'accessory', position: 1, primaryStyleId: undefined } as never
  const withStyle = { phaseType: 'accessory', position: 1, primaryStyleId: 'acc' } as never

  it('uses the Accessory phase style when there is one', () => {
    expect(resolveStyleForExercise(phase, [phase, withStyle], { exerciseRole: 'accessory' })).toBe('acc')
  })

  it('keeps the exercise\'s own style when the Accessory phase has none', () => {
    expect(resolveStyleForExercise(phase, [phase, noStyle], { exerciseRole: 'accessory', styleId: 'mine' })).toBe('own')
  })

  it('falls back to the phase\'s lighter style rather than to nothing', () => {
    expect(resolveStyleForExercise(phase, [phase, noStyle], { exerciseRole: 'accessory' })).toBe('light')
  })
})

describe('no read site re-manufactures primary (BF-15)', () => {
  it('nothing falls back to primary for a missing role', async () => {
    const { execFileSync } = await import('node:child_process')
    // git grep with no shell, so the pathspecs mean the same thing on Windows as on CI. Exit 1 is
    // "no match", which is the passing case.
    let hits = ''
    try {
      hits = execFileSync('git', ['grep', '-nE', String.raw`(\?\?|\|\|) *'primary'`, '--',
        'app/**', 'components/**', 'lib/**', 'packages/**', ':!**/__tests__/**', ':!**/*.test.*'], { encoding: 'utf8' }).trim()
    } catch (e) {
      if ((e as { status?: number }).status !== 1) throw e
    }
    expect(hits).toBe('')
  })
})
