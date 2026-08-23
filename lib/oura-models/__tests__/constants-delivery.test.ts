import { describe, it, expect, vi } from 'vitest'

import { ensureConstantsAvailable, CONSTANTS_BUCKET_PREFIX } from '@/lib/oura-models/constants-delivery'
import { hasRealConstants } from '@/lib/oura-models/__fixtures__/real-constants'

/**
 * The constants have to reach a synchronous loader before anything reads it, which is why delivery
 * happens at boot rather than on demand. These pin the part that can be tested without a bucket.
 */
describe('constants delivery', () => {
  // The tree branch still exists and is still the one taken on a machine that has the vendor's
  // files — that is what a re-extraction or a restored archive would land on. It cannot be asserted
  // where the files are gone, which is both CI and the public repo, so it asserts itself where it
  // applies rather than being deleted along with the payload.
  it.skipIf(!hasRealConstants())('prefers the repository copy when a machine has one, downloading nothing', async () => {
    const result = await ensureConstantsAvailable()
    expect(result.source).toBe('tree')
    expect(result.dir).toContain('lib/oura-models/constants')
    expect(result.fetched).toBe(0)
  })

  // Q-361. `lib/oura-models/constants/*` is gitignored and no sandbox can reach the bucket, so
  // before this branch existed every session's `pnpm dev` answered 500 on `/api/nutrition/
  // energy-balance` and `/api/body-metadata` — the loader throws by design, and there was nothing
  // for it to read. Nothing in CI catches that: the read is on first use rather than at module
  // scope so `next build` never opens it, `vitest.config.ts` points the suite at the fixtures, and
  // no E2E spec navigates to either screen. Green in CI, dead locally.
  describe('the non-production fixtures fallback', () => {
    it.skipIf(hasRealConstants())('serves the synthetic fixtures and says so, rather than nothing', async () => {
      const result = await ensureConstantsAvailable()
      expect(result.source).toBe('fixtures')
      expect(result.dir).toContain('__fixtures__/constants')
      // The detail is the boot line a developer reads. It has to name the values as fake there,
      // because that line is the only place the substitution is visible at all.
      expect(result.detail).toContain('SYNTHETIC')
    })

    it('never substitutes fixtures in production', async () => {
      try {
        // A production deploy that lost its storage variables must fail its boot, not come up
        // serving invented MET numbers. This is the fail-closed half, and it is the reason the
        // gate is NODE_ENV and not "did the bucket answer".
        vi.stubEnv('NODE_ENV', 'production')
        const result = await ensureConstantsAvailable()
        expect(result.source).not.toBe('fixtures')
      } finally {
        vi.unstubAllEnvs()
      }
    })
  })

  it('names the prefix the upload script writes to', () => {
    // One string, two consumers. They drifting apart looks like "the bucket is empty" at boot while
    // the upload reports success, which is a confusing pair of true statements.
    expect(CONSTANTS_BUCKET_PREFIX).toBe('oura-model-constants')
  })
})
