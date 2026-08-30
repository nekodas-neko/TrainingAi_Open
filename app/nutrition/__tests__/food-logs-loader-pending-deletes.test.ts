// BF-47 — the wiring, guarded at the source, because the behaviour cannot be run here.
//
// `useFoodLogsLoader` is a React hook and both vitest projects are `environment: 'node'` with no
// `@testing-library/react`, so the callback cannot be invoked. The rule it applies is unit-tested in
// `packages/shared/src/sync/__tests__/pending-deletes.test.ts`; what is untestable behaviourally is
// that the loader *calls* it, and **in the right place**.
//
// That placement is the whole fix. Filtering after `applyDelta` would still let the deleted row be
// re-inserted into the local store — which is the case that survives a screen swap, and is why the
// owner saw it come back at all rather than merely flicker.
//
// A source-text check is the established shape for this in the repo (`insert-arity.test.ts`,
// `use-invalidation-refetch.test.ts`). It is narrow on purpose: it asserts order and presence, not
// prose.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(process.cwd(), 'app/nutrition/use-food-logs-loader.ts'), 'utf8')

const at = (needle: string) => {
  const i = SRC.indexOf(needle)
  expect(i, `expected to find \`${needle}\` in use-food-logs-loader.ts`).toBeGreaterThan(-1)
  return i
}

describe('the food-logs loader filters queued deletes out of the server copy', () => {
  it('reads the outbox for the food_logs domain', () => {
    expect(SRC).toContain("getQueuedMutationsForDomain(userId!, 'food_logs')")
  })

  // The CALL, not the identifier: an import line alone satisfies a bare `toContain`, so a mutation
  // that deleted the call and left the import survived the first version of this test.
  it('applies the shared rule rather than re-deciding what a delete is', () => {
    expect(SRC).toContain('pendingDeletedIds(await store.getQueuedMutationsForDomain(')
    expect(SRC).toContain('withoutPendingDeletes(server,')
  })

  // The ordering that matters, and the reason a "filter the server response" fix can still be wrong.
  it('filters BEFORE hydrating the local store, or the row is re-inserted on this device', () => {
    expect(at('withoutPendingDeletes(server,')).toBeLessThan(at('store.applyDelta('))
  })

  it('filters BEFORE the server-copy fallback, which renders it outright', () => {
    expect(at('withoutPendingDeletes(server,')).toBeLessThan(at('applyLogs(server)'))
  })

  // The fallback is a documented fix in its own right — a local read that threw once left the page
  // blank, so logged food "vanished on reload" even though the server had it. Removing it to fix
  // BF-47 would trade one real failure for another.
  it('keeps the server-copy fallback that stops a local-store error blanking the list', () => {
    expect(SRC).toContain('applyLogs(server)')
  })

  // An outbox read that throws must not blank the day; the rest of this function makes the same
  // trade at every step.
  it('treats the outbox read as best-effort', () => {
    const window = SRC.slice(at('getQueuedMutationsForDomain('), at('store.applyDelta('))
    expect(window).toContain('catch')
  })
})
