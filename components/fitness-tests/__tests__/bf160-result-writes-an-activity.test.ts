// BF-160's wiring, guarded at the source, because the repo has no React component-testing stack
// (vitest runs `environment: 'node'` with no JSX transform, so a `.tsx` cannot be imported at all).
// The mapping itself is tested for real in `packages/shared/src/fitness-tests/__tests__/` — what is
// only checkable here is that the save path calls it, queues the mutation, and cannot let an
// activity failure cost the test that was actually asked for.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(process.cwd(), 'components/fitness-tests/test-result.tsx'), 'utf8')

describe('BF-160 — the result screen logs the activity beside the test', () => {
  it('asks the shared builder rather than switching on the protocol id here', () => {
    expect(src).toMatch(/buildTestActivity\(\{/)
    expect(src).not.toMatch(/protocol\.id === 'cooper12'/)
  })

  it('writes the local row AND queues the outbox mutation, which is what offline-first needs', () => {
    expect(src).toMatch(/store\.upsertActivityLog\(\{/)
    expect(src).toMatch(/domain: 'activity_logs'/)
  })

  it('invalidates the activity caches too, not only the fitness-test ones', () => {
    expect(src).toMatch(/invalidateActivityWrites/)
    // Both before the push (for this screen) and after it (once the server has the write) — the
    // pushThenRevalidate contract. Handing it only the fitness-test invalidator would leave every
    // activity surface holding its pre-write payload for the key's full TTL.
    expect(src).toMatch(/pushThenRevalidate\(userId!, revalidateBoth\)/)
  })

  it('keeps the activity write in its own catch, so a failure there cannot lose the test', () => {
    // The failure mode this prevents is specific: an uncaught throw here would fall into the
    // outer catch and re-POST the already-saved test to the API fallback under the same id.
    const block = src.slice(src.indexOf('store.upsertActivityLog'))
    expect(block).toMatch(/catch \(e\) \{\s*\n\s*console\.error\('Fitness test activity write failed/)
  })

  it('gives the activity its own id — reusing the test\'s would collide across two domains', () => {
    expect(src).toMatch(/const activityId = activity \? crypto\.randomUUID\(\) : null/)
  })

  it('stamps the clock times in the user\'s timezone, never the device\'s', () => {
    expect(src).toMatch(/msToHHMMInTz\(capture\.startMs, tz\)/)
    expect(src).toMatch(/msToHHMMInTz\(capture\.endMs, tz\)/)
  })
})
