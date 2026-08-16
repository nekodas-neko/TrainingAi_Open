import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { STEPS_DECODER_CONSTANTS_TTL } from '@trainingai/shared/cache-ttl'
import {
  setStepsDecoderConstants,
  hasStepsDecoderConstants,
} from '@/lib/oura-models/steps-motion-decoder'
import type { StepsDecoderConstants } from '@/lib/oura-models/constants/steps-decoder-types'

/**
 * Get the steps-motion decoder its dequantisation table, client-side (Q-221).
 *
 * The table used to be a static JSON import inside the decoder, which webpack compiled into the
 * browser bundle — and `middleware.ts`'s matcher excludes `_next/static`, so those chunks were
 * served with no session. It now comes from an authenticated route.
 *
 * **Offline still works after one successful fetch**: `cachedFetch` seeds from the client cache, so
 * a cold launch with no network injects the cached copy. Before that first fetch there is nothing to
 * inject, and the callers must do nothing rather than decode — `runStepsMotionDecoder` throws on an
 * absent table precisely so that "nothing" cannot silently become "plausible wrong numbers".
 */
const CACHE_KEY = 'steps-decoder-constants-v1'

let inflight: Promise<boolean> | null = null

/**
 * Resolves true once the decoder has its table. Safe to call on every frame — it returns
 * immediately once injected, and concurrent callers share one request.
 */
export function ensureStepsDecoderConstants(): Promise<boolean> {
  if (hasStepsDecoderConstants()) return Promise.resolve(true)

  // Synchronous seed first: on a warm start this injects without waiting for the network at all,
  // which is what keeps auto-detection working on a cold offline launch.
  const seed = readCacheSync<StepsDecoderConstants>(CACHE_KEY)
  if (seed && isUsable(seed)) {
    setStepsDecoderConstants(seed)
    return Promise.resolve(true)
  }

  if (inflight) return inflight
  inflight = cachedFetch<StepsDecoderConstants>(
    CACHE_KEY,
    '/api/oura-ble/decoder-constants',
    STEPS_DECODER_CONSTANTS_TTL,
    (data) => {
      if (isUsable(data)) setStepsDecoderConstants(data)
    },
  )
    .then(() => hasStepsDecoderConstants())
    .catch(() => false)
    .finally(() => { inflight = null })
  return inflight
}

/**
 * A truncated or error-shaped payload must never be injected: the decoder would then run on a table
 * missing columns and produce physical values that look real. Checking the two fields every decode
 * path indexes is enough to tell a real table from `{error: 'Unauthorized'}`.
 */
function isUsable(k: StepsDecoderConstants | null | undefined): boolean {
  return Boolean(
    k &&
      Array.isArray(k.data_columns) &&
      k.data_columns.length > 0 &&
      k.decoder_base_settings &&
      typeof k.n_features_30s === 'number',
  )
}
