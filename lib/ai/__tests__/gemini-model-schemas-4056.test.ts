// #4056 — the importable schemas this repo hands Gemini, besides the Coach's tools (those are in
// lib/coach/__tests__/gemini-tool-schemas-4056.test.ts), contain nothing Gemini refuses. Mocks only:
// the Google provider builds the real request and `fetch` captures it.
//
// Every schema a `generateObject` call hands the model is in the list below, including the six that
// used to be local to a route file (#4060). `model-schemas-covered-4060.test.ts` fails when a call
// site's schema is defined in a route file or is missing from this list.
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
    ['ExerciseGenSchema (exercises/generate)', async () => (await import('@trainingai/shared/workout/model-output-schemas')).ExerciseGenSchema],
    ['GeneratedProgramModelSchema (generate-program)', async () => (await import('@trainingai/shared/workout/model-output-schemas')).GeneratedProgramModelSchema],
    ['BuilderChatObjectSchema (builder-chat)', async () => (await import('@trainingai/shared/workout/model-output-schemas')).BuilderChatObjectSchema],
    ['DraftSchema (nutrition/meal-plans/generate)', async () => (await import('@trainingai/shared/nutrition/model-output-schemas')).DraftSchema],
    ['MealSchema (nutrition/meal-plans/generate/meal)', async () => (await import('@trainingai/shared/nutrition/model-output-schemas')).MealSchema],
    ['ScanSchema (nutrition/scan)', async () => (await import('@trainingai/shared/nutrition/model-output-schemas')).ScanSchema],
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
