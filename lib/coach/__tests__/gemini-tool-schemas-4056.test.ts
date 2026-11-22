// #4056 — every Coach tool set the route can build is one Gemini accepts. Mocks only: the Google
// provider builds the real request and `fetch` captures it (lib/ai/__tests__/gemini-schema-guard.ts).
//
// Why it exists: a number `enum` in the lift_preference `setsDelta` change made Gemini refuse every
// Coach request from the native app (which names that domain) with HTTP 400, and no test sent the
// tool schemas anywhere.
import { describe, it, expect, vi } from 'vitest'
import type { ToolSet } from 'ai'
import { functionDeclarationsFor, geminiRefusals } from '@/lib/ai/__tests__/gemini-schema-guard'

vi.mock('@/lib/data/postgres/client', () => ({ getDb: () => ({}), ensureSchema: async () => {} }))

const USER = '00000000-0000-4000-8000-000000000001'
const TZ = 'Australia/Brisbane'

/** The tool set `app/api/coach/route.ts` hands `streamText`, minus the provider-defined search tool. */
async function coachTools(scopeId: string, declared: string[] | undefined): Promise<ToolSet> {
  const { buildChatTools } = await import('@/lib/ai-chat/tools')
  const { buildWidgetTools } = await import('@/lib/coach/tools')
  const { coachScope, pickTools, withClientDomains } = await import('@/lib/coach/scopes')
  const scope = withClientDomains(coachScope(scopeId), declared)
  return {
    ...pickTools(buildChatTools({} as never, USER, TZ, '2026-11-22'), scope.readTools),
    ...buildWidgetTools({} as never, USER, scope, TZ),
  } as ToolSet
}

async function cases() {
  const { COACH_SCOPES } = await import('@/lib/coach/scopes')
  const { GATED_PATCH_DOMAINS } = await import('@/lib/coach/patch')
  const declarations: Array<string[] | undefined> = [undefined, ...GATED_PATCH_DOMAINS.map(d => [d]), [...GATED_PATCH_DOMAINS]]
  return Object.keys(COACH_SCOPES).flatMap(scopeId => declarations.map(declared => ({ scopeId, declared })))
}

describe('Coach tool schemas as Gemini receives them (#4056)', () => {
  it('contain nothing Gemini refuses, for every scope, with and without every gated domain', async () => {
    const refusals: string[] = []
    let declarationCount = 0
    for (const { scopeId, declared } of await cases()) {
      const decls = await functionDeclarationsFor(await coachTools(scopeId, declared))
      declarationCount += decls.length
      for (const d of decls) {
        for (const r of geminiRefusals(d.parameters)) refusals.push(`${scopeId} ${JSON.stringify(declared ?? [])} ${d.name} ${r}`)
      }
    }
    expect(declarationCount).toBeGreaterThan(20)
    expect(refusals).toEqual([])
  }, 30_000)

  it('still offers setsDelta to a client that names lift_preference (so the check is not vacuous)', async () => {
    const decls = await functionDeclarationsFor(await coachTools('general', ['lift_preference']))
    const propose = decls.find(d => d.name === 'proposeChange')
    expect(JSON.stringify(propose?.parameters)).toContain('setsDelta')
    expect(JSON.stringify(propose?.parameters)).toContain('-1 or 1, never 0')
  })

  it('the walker catches what Gemini refused in #4056', () => {
    expect(geminiRefusals({ anyOf: [{ type: 'number', enum: [-1] }] })).toHaveLength(2)
    expect(geminiRefusals({ type: 'object', properties: { a: { const: true } } })).toEqual(['$.properties.a.const: true'])
    expect(geminiRefusals({ type: 'string', enum: ['a', 'b'] })).toEqual([])
  })
})

describe('setsDelta from the model is still exactly -1 or 1 (#4056)', () => {
  const TARGET = '10000000-0000-4000-8000-000000000003'
  const proposal = (to: unknown, from: unknown = null) => ({
    kind: 'change_preview',
    title: 'One more set',
    patch: { domain: 'lift_preference', targetId: TARGET, changes: [{ id: 's', field: 'setsDelta', from, to }] },
  })

  // The SDK validates a client-side tool's arguments with `safeParseAsync` on its own inputSchema
  // (provider-utils `zodSchema`) and retries the model on a failure, so this is the gate a reply meets.
  async function modelSchema() {
    const tools = await coachTools('general', ['lift_preference']) as Record<string, { inputSchema: import('zod').ZodType }>
    return tools.proposeChange.inputSchema
  }

  it('refuses 0, 2 and "1" in `to`, and 0 in `from`', async () => {
    const schema = await modelSchema()
    for (const bad of [0, 2, '1', -2, 0.5, null]) expect((await schema.safeParseAsync(proposal(bad))).success, `to ${JSON.stringify(bad)}`).toBe(false)
    expect((await schema.safeParseAsync(proposal(1, 0))).success).toBe(false)
  })

  it('accepts -1 and 1 and hands on exactly the numbers the model sent', async () => {
    const schema = await modelSchema()
    for (const [to, from] of [[1, null], [-1, null], [-1, 1], [1, -1]] as const) {
      const parsed = await schema.safeParseAsync(proposal(to, from))
      expect(parsed.success).toBe(true)
      expect((parsed.data as ReturnType<typeof proposal>).patch.changes[0]).toEqual({ id: 's', field: 'setsDelta', from, to })
    }
  })

  it('the parsed proposal is one the strict schema (clients, preview, apply) accepts unchanged', async () => {
    const { CoachPatchSchema } = await import('@/lib/coach/patch')
    const parsed = await (await modelSchema()).parseAsync(proposal(-1))
    expect(CoachPatchSchema.parse((parsed as ReturnType<typeof proposal>).patch)).toEqual(proposal(-1).patch)
    for (const bad of [0, 2, '1']) expect(CoachPatchSchema.safeParse(proposal(bad).patch).success).toBe(false)
  })
})
