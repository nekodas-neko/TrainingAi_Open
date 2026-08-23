/**
 * The injection contract, which is load-bearing in a way that is easy to miss.
 *
 * Every one of these ports **throws** when its constants are unset, rather than defaulting — the
 * behaviour they inherited from the disk loader, and the right one, because a missing constant is a
 * wrong physical number rather than a missing feature. That makes a forgotten injection site a hard
 * production failure. The two that are not a Next request path are the ones to worry about:
 * `instrumentation-node.ts` (boot) and `rollup-worker-entry.ts` (its own `worker_threads` realm,
 * which inherits `process.env` but not the main thread's injected values).
 */
import { describe, it, expect, afterAll } from 'vitest'
import { ensureServerOuraConstants, tryEnsureServerOuraConstants } from '../constants-inject'
import {
  daytimeStressLevel,
  hasDaytimeStressConstants,
  __clearDaytimeStressConstants,
} from '@/lib/health/daytime-stress'
import { hasResilienceConstants, __clearResilienceConstants } from '@/lib/health/stress-resilience'
import {
  hasCumulativeStressConstants,
  __clearCumulativeStressConstants,
} from '@/lib/oura-models/cumulative-stress'
import {
  hasStepsDecoderConstants,
  __clearStepsDecoderConstants,
  runStepsMotionDecoder,
} from '@/lib/oura-models/steps-motion-decoder'

const clearAll = () => {
  __clearDaytimeStressConstants()
  __clearResilienceConstants()
  __clearCumulativeStressConstants()
  __clearStepsDecoderConstants()
}

// The setup file injected these for the whole run; leave them injected for everyone else.
afterAll(() => ensureServerOuraConstants())

describe('ensureServerOuraConstants', () => {
  it('covers every port the Oura rollup reaches', () => {
    clearAll()
    expect(hasDaytimeStressConstants()).toBe(false)
    expect(hasResilienceConstants()).toBe(false)
    expect(hasCumulativeStressConstants()).toBe(false)
    expect(hasStepsDecoderConstants()).toBe(false)

    ensureServerOuraConstants()

    expect(hasDaytimeStressConstants()).toBe(true)
    expect(hasResilienceConstants()).toBe(true)
    expect(hasCumulativeStressConstants()).toBe(true)
    expect(hasStepsDecoderConstants()).toBe(true)
  })

  it('is idempotent — a second call is a no-op, not a re-read', () => {
    ensureServerOuraConstants()
    expect(() => ensureServerOuraConstants()).not.toThrow()
    expect(hasResilienceConstants()).toBe(true)
  })

  it('every port throws when its constants are missing, rather than returning a plausible number', () => {
    clearAll()
    // The two whose entry points take a one-line input. `stress-resilience` and
    // `cumulative-stress` have the identical accessor shape but need a full model input to reach
    // it, and a fabricated one would fail validation first and assert nothing.
    expect(() => daytimeStressLevel(60, 55, 50)).toThrow(/daytime-stress: constants not set/)
    expect(() => runStepsMotionDecoder({ timestamps: [0], data: [[0]] })).toThrow(/constants not set/)
    ensureServerOuraConstants()
  })
})

/**
 * `/api/body-battery` 500'd in production for two hours on `daytime-stress: constants not set`,
 * with boot having logged a successful delivery (2026-08-23). Boot injects module-level state into
 * the process that ran boot; a request is not always served by that process, and the route had no
 * injection of its own. Measured with a probe route: `hasDaytimeStressConstants()` read **false**
 * in a handler while the delivered directory was right there in `process.env`.
 *
 * The fix hangs the injection off `getRepository()` — the one thing every path that can reach a
 * constants read already goes through — using the non-throwing variant, because the repository is
 * on the path of every DB route and an unreadable constants directory must not take all of them
 * down.
 */
describe('tryEnsureServerOuraConstants', () => {
  it('injects, exactly like the throwing variant', () => {
    clearAll()
    tryEnsureServerOuraConstants()
    expect(hasDaytimeStressConstants()).toBe(true)
    expect(hasStepsDecoderConstants()).toBe(true)
  })

  it('does not throw when the constants cannot be read', async () => {
    // Point the loader at an empty directory and drop its memoised files — the shape of a
    // production process that never inherited `OURA_CONSTANTS_DIR` and finds no delivered copy.
    const { __clearConstantsCache } = await import('@/lib/oura-models/constants')
    const os = await import('node:os')
    const fs = await import('node:fs')
    const path = await import('node:path')
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'no-constants-'))
    const prev = process.env.OURA_CONSTANTS_DIR
    process.env.OURA_CONSTANTS_DIR = empty
    __clearConstantsCache()
    clearAll()
    try {
      // The throwing variant is what the repository must NOT be using.
      expect(() => ensureServerOuraConstants()).toThrow()
      expect(() => tryEnsureServerOuraConstants()).not.toThrow()
      // And swallowing changes nothing a caller sees: the accessor still refuses at the read site.
      expect(hasDaytimeStressConstants()).toBe(false)
    } finally {
      if (prev === undefined) delete process.env.OURA_CONSTANTS_DIR
      else process.env.OURA_CONSTANTS_DIR = prev
      __clearConstantsCache()
      fs.rmSync(empty, { recursive: true, force: true })
    }
  })
})

