#!/usr/bin/env node
/**
 * Run vitest, and re-run it ONCE if — and only if — it failed with the upstream worker-teardown
 * race and nothing else (LA-146).
 *
 * `Tests` became a required check on 2026-09-25, which turned a flake that used to cost a manual
 * re-run into one that blocks the merge button. The flake is vitest's, not ours
 * (https://github.com/vitest-dev/vitest/issues/11153 — open, and present in 4.1.11 and 5.0.0
 * alike), so there is nothing in this repository to fix. This automates the response the backlog
 * entry already prescribed — `rerun_failed_jobs` — and does it inside the job, so it costs one
 * shard rather than a whole workflow re-run (which on this repo also cancels and restarts the
 * 34-minute E2E alongside it).
 *
 * It is NOT a blanket retry, and must never become one:
 *   · the matcher requires the exact upstream error string AND zero failing tests AND zero failing
 *     files, so any real failure exits on the first run;
 *   · exactly one retry, ever — a second occurrence in the same job fails the job, because a flake
 *     that has become reproducible is no longer a flake;
 *   · every retry prints a loud, greppable notice, so sightings keep being counted rather than
 *     silently absorbed. That count is what would justify revisiting the heavier options.
 *
 * Deliberately NOT chosen, with the measurement that ruled each out, so nobody re-walks it:
 *   · Upgrading — upstream measured 3/10 failures on BOTH 4.1.11 and 5.0.0. Only 3.2.4 is clean,
 *     and this config uses `projects`, which is v4+.
 *   · `disableConsoleIntercept: true` — it WOULD make the race structurally impossible (vitest only
 *     installs the RPC console sender when the option is false). Measured cost on 176 of our files:
 *     the log goes from 12 lines to 526, 342 of them `[ensureSchema]`, because passing tests' output
 *     stops being suppressed. Across a full shard that buries the failure you are reading the log for.
 *   · `maxWorkers: 1`, `isolate: false`, `silent: 'passed-only'`, console spying in setup files, and
 *     draining pending work — all measured ineffective by the upstream reporter.
 */
const { spawn } = require('node:child_process')
const { isTeardownFlake, TEARDOWN_ERROR } = require('../lib/teardown-flake.js')

const NOTICE = '[vitest-retry] upstream teardown flake (vitest#11153)'

function runVitest(args) {
  return new Promise(resolve => {
    // No shell, and no pipeline — a pipe would report the tee's exit code, not vitest's.
    const child = spawn('npx', ['vitest', 'run', ...args], { stdio: ['inherit', 'pipe', 'pipe'] })
    let output = ''
    // Streamed as it arrives so the job log stays live, and captured so the matcher can read it.
    child.stdout.on('data', d => { output += d; process.stdout.write(d) })
    child.stderr.on('data', d => { output += d; process.stderr.write(d) })
    child.on('close', code => resolve({ code: code ?? 1, output }))
  })
}

/**
 * The whole policy, separated from the spawning so it can be tested without a vitest run.
 * `run` returns `{ code, output }`; the return value is the exit code the job should take.
 */
async function runWithRetry(run, log = console.error) {
  const first = await run()
  if (first.code === 0) return 0
  if (!isTeardownFlake(first.output)) return first.code

  log(`\n${NOTICE}: every test passed but the run exited ${first.code}.`)
  log(`${NOTICE}: "${TEARDOWN_ERROR}"`)
  log(`${NOTICE}: re-running this shard ONCE. A second occurrence fails the job.\n`)

  const second = await run()
  if (second.code !== 0 && isTeardownFlake(second.output)) {
    log(`\n${NOTICE}: hit AGAIN on the retry. That is no longer a flake — failing the job.`)
    log(`${NOTICE}: raise this on LA-146; two in one job is the signal that would justify`)
    log(`${NOTICE}: paying for disableConsoleIntercept (see this script's header).\n`)
  }
  return second.code
}

module.exports = { runWithRetry, NOTICE }

if (require.main === module) {
  const args = process.argv.slice(2)
  runWithRetry(() => runVitest(args)).then(code => process.exit(code))
}
