// #4056 — the importable schemas this repo hands Gemini, besides the Coach's tools (those are in
// lib/coach/__tests__/gemini-tool-schemas-4056.test.ts), contain nothing Gemini refuses. Mocks only:
// the Google provider builds the real request and `fetch` captures it.
//
// Not covered here because they are module-local to a Next route file, which may export only route
// handlers: ExerciseGenSchema (app/api/exercises/generate), GeneratedProgramSchema
// (app/api/generate-program), BuilderChatObjectSchema (app/api/builder-chat), DraftSchema
// (app/api/nutrition/meal-plans/generate), MealSchema (…/generate/meal), ScanSchema
// (app/api/nutrition/scan). Read by hand for #4056: none has a number or boolean literal or enum.
import { describe, it, expect, vi } from 'vitest'
import type { ToolSet } from 'ai'
import type { z } from 'zod'
import { functionDeclarationsFor, geminiRefusals, responseSchemaFor } from './gemini-schema-guard'

vi.mock('@/lib/data/postgres/client', () => ({ getDb: () => ({}), ensureSchema: async () => {} }))

describe('structured-output schemas as Gemini receives them (#4056)', () => {
  const schemas: Array<[string, () => Promise<z.ZodType>]> = [
    ['PrescriptionSchema (ai-periodization/generate-prescription)', async () => (await import('@trainingai/shared/ai-periodization/prescription-schema')).PrescriptionSchema],
    ['GeneratedProgramSchema (shared validation, builder-chat)', async () => (await import('@trainingai/shared/validation/generated-program')).GeneratedProgramSchema],
    ['TopUpSchema (nutrition/meal-top-up)', async () => (await import('@/lib/nutrition/meal-top-up')).TopUpSchema],
  ]
  it.each(schemas)('%s', async (_name, load) => {
    const converted = await responseSchemaFor(await load())
    expect(converted).toBeTruthy()
    expect(geminiRefusals(converted)).toEqual([])
  })
})

describe('the chat read tools as Gemini receives them (#4056)', () => {
  it('contain nothing Gemini refuses', async () => {
    const { buildChatTools } = await import('@/lib/ai-chat/tools')
    const decls = await functionDeclarationsFor(buildChatTools({} as never, '00000000-0000-4000-8000-000000000001', 'Australia/Brisbane', '2026-11-22') as ToolSet)
    expect(decls.length).toBeGreaterThan(5)
    expect(decls.flatMap(d => geminiRefusals(d.parameters).map(r => `${d.name} ${r}`))).toEqual([])
  })
})
