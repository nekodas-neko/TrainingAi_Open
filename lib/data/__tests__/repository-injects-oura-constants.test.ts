// `/api/body-battery` 500'd in production for two hours on `daytime-stress: constants not set`,
// while boot had logged a successful constants delivery (2026-08-23, 19 recorded faults).
//
// Boot injects module-level state into the process that ran boot. A request is not always served by
// that process, and the route did its own read with no injection. Measured with a probe route: a
// handler read `hasDaytimeStressConstants()` as **false** while the delivered directory was sitting
// right there in `process.env` — so this is module-instance divergence, not a missing env var, and
// the env-var half is fixed separately in `constantsDir()`.
//
// `getRepository()` is the hook because it is the one thing every path that can reach a constants
// read already goes through. Verified by mutation: removing the call fails the first case here.
import { describe, it, expect, beforeAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL

describe.skipIf(!canRun)('getRepository — Oura constants injection', () => {
  let hasDaytimeStressConstants: () => boolean
  let hasStepsDecoderConstants: () => boolean
  let clearAll: () => void

  beforeAll(async () => {
    const daytime = await import('@/lib/health/daytime-stress')
    const steps = await import('@/lib/oura-models/steps-motion-decoder')
    const resilience = await import('@/lib/health/stress-resilience')
    const cumulative = await import('@/lib/oura-models/cumulative-stress')
    hasDaytimeStressConstants = daytime.hasDaytimeStressConstants
    hasStepsDecoderConstants = steps.hasStepsDecoderConstants
    clearAll = () => {
      daytime.__clearDaytimeStressConstants()
      steps.__clearStepsDecoderConstants()
      resilience.__clearResilienceConstants()
      cumulative.__clearCumulativeStressConstants()
    }
  })

  it('injects the constants a request path can reach', async () => {
    clearAll()
    expect(hasDaytimeStressConstants()).toBe(false)
    expect(hasStepsDecoderConstants()).toBe(false)

    const { getRepository } = await import('@/lib/data')
    await getRepository()

    expect(hasDaytimeStressConstants()).toBe(true)
    expect(hasStepsDecoderConstants()).toBe(true)
  })

  it('still returns a repository when the constants are unreadable', async () => {
    // The reason it is the non-throwing variant. The repository is on the path of every DB route;
    // an unreadable constants directory must degrade the stress reads, not the whole app.
    const { __clearConstantsCache } = await import('@/lib/oura-models/constants')
    const os = await import('node:os')
    const fs = await import('node:fs')
    const path = await import('node:path')
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'no-constants-repo-'))
    const prev = process.env.OURA_CONSTANTS_DIR
    process.env.OURA_CONSTANTS_DIR = empty
    __clearConstantsCache()
    clearAll()
    try {
      const { getRepository } = await import('@/lib/data')
      await expect(getRepository()).resolves.toBeTruthy()
    } finally {
      if (prev === undefined) delete process.env.OURA_CONSTANTS_DIR
      else process.env.OURA_CONSTANTS_DIR = prev
      __clearConstantsCache()
      fs.rmSync(empty, { recursive: true, force: true })
      const { ensureServerOuraConstants } = await import('@/lib/oura-models/constants-inject')
      ensureServerOuraConstants()
    }
  })
})
