import { describe, it, expect } from 'vitest'

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

  it('names the prefix the upload script writes to', () => {
    // One string, two consumers. They drifting apart looks like "the bucket is empty" at boot while
    // the upload reports success, which is a confusing pair of true statements.
    expect(CONSTANTS_BUCKET_PREFIX).toBe('oura-model-constants')
  })
})
