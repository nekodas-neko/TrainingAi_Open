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
import { ensureServerOuraConstants } from '../constants-inject'
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
