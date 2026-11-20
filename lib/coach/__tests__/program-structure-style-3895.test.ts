// #3895 — under the AI plan an exercise's progression style reaches nothing, so the Coach must not be
// handed one to propose from. `getProgramStructure` leaves `styleId` out on an `ai_dynamic` program and
// says why, and `proposeChange` tells the model not to propose one. Other modes still get the style.
import { describe, it, expect } from 'vitest'
import { buildWidgetTools } from '../tools'
import type { WorkoutRepository } from '@/lib/data/repository'

const program = (phaseMode: 'manual' | 'automatic' | 'ai_dynamic') => ({
  id: 'p1', name: 'Program', phaseMode,
  sessions: [{
    id: 's1', name: 'Lower', position: 0,
    exercises: [{ id: 'e1', exerciseName: 'Squat', position: 0, styleId: 'style-1', muscleGroups: ['quads'] }],
  }],
})

type Structure = { note?: string; program: { phaseMode: string; sessions: { exercises: Record<string, unknown>[] }[] } }

async function structureFor(phaseMode: 'manual' | 'automatic' | 'ai_dynamic'): Promise<Structure> {
  const repo = { getActiveProgram: async () => program(phaseMode) } as unknown as WorkoutRepository
  const tools = buildWidgetTools(repo, 'u1') as unknown as Record<string, { execute: (i: unknown, o: unknown) => Promise<unknown> }>
  return await tools.getProgramStructure.execute({}, { toolCallId: 't1', messages: [] }) as Structure
}

describe('the Coach is not offered a progression style under the AI plan (#3895)', () => {
  it('leaves styleId out of every exercise on an ai_dynamic program, and says why', async () => {
    const r = await structureFor('ai_dynamic')
    const ex = r.program.sessions[0].exercises[0]
    expect(ex).not.toHaveProperty('styleId')
    expect(ex).toMatchObject({ id: 'e1', name: 'Squat' })
    expect(r.program.phaseMode).toBe('ai_dynamic')
    expect(r.note).toMatch(/progression styles are not used/)
  })

  it.each(['manual', 'automatic'] as const)('still gives the style on a %s program', async mode => {
    const r = await structureFor(mode)
    expect(r.program.sessions[0].exercises[0].styleId).toBe('style-1')
    expect(r.note).toBeUndefined()
  })

  it('tells the model never to propose a style change under ai_dynamic', () => {
    const tools = buildWidgetTools({} as WorkoutRepository, 'u1') as unknown as Record<string, { description?: string }>
    expect(tools.proposeChange.description).toMatch(/Never propose "styleId" when getProgramStructure gives phaseMode "ai_dynamic"/)
  })
})
