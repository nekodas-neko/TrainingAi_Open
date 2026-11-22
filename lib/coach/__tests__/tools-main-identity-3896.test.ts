// #3896 step 5 / F4 — a client that does not declare lift_preference sends the model exactly the tool
// JSON `main` sent before the domain existed: same descriptions, same input schemas, byte for byte.
// The expected value is `fixtures-main-tools-3896.json`, dumped from `origin/main` (7b28b7204) by
// running its own `buildWidgetTools` — it is not generated from this branch's code. Mocks only.
import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import fixture from './fixtures-main-tools-3896.json'

vi.mock('@/lib/data/postgres/client', () => ({ getDb: () => ({}), ensureSchema: async () => {} }))

type Tool = { description?: string; inputSchema: z.ZodType }
async function dump(scopeName: 'general' | 'nutrition', declared?: string[]) {
  const { buildWidgetTools } = await import('@/lib/coach/tools')
  const { coachScope, withClientDomains } = await import('@/lib/coach/scopes')
  const scope = withClientDomains(coachScope(scopeName), declared)
  const tools = buildWidgetTools({} as never, '00000000-0000-4000-8000-000000000001', scope, 'Australia/Brisbane') as Record<string, Tool>
  return Object.fromEntries(Object.entries(tools).map(([k, t]) => [k, { description: t.description ?? null, inputSchema: z.toJSONSchema(t.inputSchema) }]))
}

describe('tool JSON for a client that does not declare lift_preference', () => {
  it('is byte-identical to main for the general scope, declared nothing or only names the server does not offer', async () => {
    const expected = JSON.stringify(fixture.general)
    expect(JSON.stringify(await dump('general'))).toBe(expected)
    expect(JSON.stringify(await dump('general', []))).toBe(expected)
    expect(JSON.stringify(await dump('general', ['user_goals', 'made_up']))).toBe(expected)
  })

  it('is byte-identical to main for the nutrition scope, even when the domain is declared', async () => {
    const expected = JSON.stringify(fixture.nutrition)
    expect(JSON.stringify(await dump('nutrition'))).toBe(expected)
    expect(JSON.stringify(await dump('nutrition', ['lift_preference']))).toBe(expected)
  })

  it('does grow when the client declares it (so the test above is not vacuous)', async () => {
    const declared = JSON.stringify(await dump('general', ['lift_preference']))
    expect(declared.length).toBeGreaterThan(JSON.stringify(fixture.general).length)
    expect(declared).toContain('more_reps')
  })
})
