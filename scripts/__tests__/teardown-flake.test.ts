/**
 * LA-146 — the matcher that decides whether CI may re-run a shard.
 *
 * Its job is to say no. A retry that fires on a real failure is a regression detector that has
 * been switched off, and this one guards a REQUIRED check, so the negative cases below matter more
 * than the positive one. The fixtures are the real shapes from the recorded sightings in
 * docs/local-dev-database.md, not invented text.
 */
import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isTeardownFlake, TEARDOWN_ERROR } = require('../lib/teardown-flake.js')

/** The seventh sighting, in CI: shard 1, 269 files / 2,498 tests, zero failed, exit 1. */
const FLAKE_RUN = `
 RUN  v4.1.11 /home/runner/work/TrainingAi_Open/TrainingAi_Open

 Test Files  269 passed (269)
      Tests  2498 passed | 331 skipped (2829)
   Start at  04:09:17
   Duration  201.44s

Vitest caught 1 unhandled error during the test run.
EnvironmentTeardownError: [vitest-worker]: Closing rpc while "onUserConsoleLog" was pending
This error originated in "lib/__tests__/nutrition-goals-recommend-route.test.ts"
`

const CLEAN_RUN = `
 Test Files  269 passed (269)
      Tests  2498 passed | 331 skipped (2829)
`

/** A genuine assertion failure — no teardown error anywhere. */
const REAL_FAILURE = `
 FAIL  lib/__tests__/thing.test.ts > does the thing
AssertionError: expected 1 to be 2

 Test Files  1 failed | 268 passed (269)
      Tests  1 failed | 2497 passed (2498)
`

/** Both at once. A retry must not rescue this — and would not, but the matcher says no first. */
const REAL_FAILURE_PLUS_TEARDOWN = `
 Test Files  1 failed | 268 passed (269)
      Tests  1 failed | 2497 passed (2498)

Vitest caught 1 unhandled error during the test run.
EnvironmentTeardownError: [vitest-worker]: Closing rpc while "onUserConsoleLog" was pending
`

describe('isTeardownFlake', () => {
  it('matches the upstream teardown race with every test green', () => {
    expect(isTeardownFlake(FLAKE_RUN)).toBe(true)
  })

  it('refuses a run with a failing test, even carrying the same teardown error', () => {
    expect(isTeardownFlake(REAL_FAILURE_PLUS_TEARDOWN)).toBe(false)
  })

  it('refuses an ordinary failure', () => {
    expect(isTeardownFlake(REAL_FAILURE)).toBe(false)
  })

  it('refuses a failing FILE even when no individual test failed — the Q-249 shape', () => {
    // A file vitest could not run at all reports "1 failed" files against 0 failed tests. That is
    // a real fault (it is how the e2e specs leaking into vitest presented) and must not be retried.
    expect(isTeardownFlake(`
 Test Files  1 failed | 268 passed (269)
      Tests  2498 passed (2498)

EnvironmentTeardownError: [vitest-worker]: ${TEARDOWN_ERROR}
`)).toBe(false)
  })

  it('refuses a run that died before reporting a summary', () => {
    expect(isTeardownFlake(`Killed\nEnvironmentTeardownError: [vitest-worker]: ${TEARDOWN_ERROR}`))
      .toBe(false)
  })

  it('refuses a green run that never mentioned the error', () => {
    expect(isTeardownFlake(CLEAN_RUN)).toBe(false)
  })

  it('refuses a DIFFERENT pending-rpc race — the fetch variant upstream already fixed twice', () => {
    expect(isTeardownFlake(FLAKE_RUN.replace('onUserConsoleLog', 'fetch'))).toBe(false)
  })

  it('refuses empty and absent output rather than treating it as a match', () => {
    expect(isTeardownFlake('')).toBe(false)
    expect(isTeardownFlake(null)).toBe(false)
    expect(isTeardownFlake(undefined)).toBe(false)
  })
})

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runWithRetry } = require('../ci/vitest-retry-teardown-flake.js')

/** A scripted vitest: each call returns the next result, and records that it was called. */
function scripted(...results: Array<{ code: number; output: string }>) {
  const calls: number[] = []
  const run = async () => {
    calls.push(calls.length)
    return results[Math.min(calls.length - 1, results.length - 1)]
  }
  return { run, calls }
}
const quiet = () => {}

describe('runWithRetry — the retry policy itself', () => {
  it('does not re-run a green run', async () => {
    const { run, calls } = scripted({ code: 0, output: CLEAN_RUN })
    expect(await runWithRetry(run, quiet)).toBe(0)
    expect(calls).toHaveLength(1)
  })

  it('does not re-run a real failure, and keeps its exit code', async () => {
    const { run, calls } = scripted({ code: 1, output: REAL_FAILURE })
    expect(await runWithRetry(run, quiet)).toBe(1)
    expect(calls).toHaveLength(1)
  })

  it('preserves a non-1 exit code rather than normalising it', async () => {
    const { run } = scripted({ code: 137, output: 'Killed' })
    expect(await runWithRetry(run, quiet)).toBe(137)
  })

  it('re-runs the flake once, and passes when the retry is clean', async () => {
    const { run, calls } = scripted({ code: 1, output: FLAKE_RUN }, { code: 0, output: CLEAN_RUN })
    expect(await runWithRetry(run, quiet)).toBe(0)
    expect(calls).toHaveLength(2)
  })

  it('retries EXACTLY once — a second teardown error fails the job', async () => {
    const { run, calls } = scripted({ code: 1, output: FLAKE_RUN })
    expect(await runWithRetry(run, quiet)).toBe(1)
    expect(calls).toHaveLength(2)
  })

  it('reports a real failure that only appears on the retry', async () => {
    const { run, calls } = scripted({ code: 1, output: FLAKE_RUN }, { code: 1, output: REAL_FAILURE })
    expect(await runWithRetry(run, quiet)).toBe(1)
    expect(calls).toHaveLength(2)
  })

  it('says so loudly whenever it retries — a silently absorbed flake stops being counted', async () => {
    const said: string[] = []
    const { run } = scripted({ code: 1, output: FLAKE_RUN }, { code: 0, output: CLEAN_RUN })
    await runWithRetry(run, (m: string) => said.push(m))
    const all = said.join('\n')
    // The upstream issue, so a reader can check whether it is still open, and the exact error, so
    // the sighting is greppable in a job log without opening the script.
    expect(all).toContain('vitest#11153')
    expect(all).toContain(TEARDOWN_ERROR)
    expect(all).toMatch(/re-running this shard ONCE/)
  })

  it('says nothing at all when it does not retry', async () => {
    const said: string[] = []
    const { run } = scripted({ code: 1, output: REAL_FAILURE })
    await runWithRetry(run, (m: string) => said.push(m))
    expect(said).toEqual([])
  })
})
