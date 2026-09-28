/**
 * Recognise the vitest worker-teardown flake, and nothing else (LA-146).
 *
 * Upstream: https://github.com/vitest-dev/vitest/issues/11153 — open, unfixed, and present in
 * 4.1.11 AND 5.0.0 alike (the reporter measured 3/10 runs on each; 3.2.4 is clean). A worker's RPC
 * channel is closed while a `console.*` forward is still in flight, so the run exits non-zero while
 * every test passed. It is not this repository's bug and no version of vitest we can adopt fixes it.
 *
 * The matcher is deliberately narrow, because a retry that is too eager is a regression detector
 * that has been switched off. BOTH conditions must hold:
 *   1. the output carries the exact upstream error string, and
 *   2. the run reports NO failing test and NO failing file.
 *
 * A run that fails a test AND happens to hit the teardown race is therefore not a match — and it
 * would not be rescued by a retry anyway, since the real failure recurs.
 */

const TEARDOWN_ERROR = 'Closing rpc while "onUserConsoleLog" was pending'

/** The `Tests` / `Test Files` summary lines only carry a `failed` segment when something failed.
 *
 * Read as plain text: vitest leaves these two lines unstyled even under `FORCE_COLOR=3` (measured
 * 2026-09-26), and CI is not a TTY, so there is no escape sequence to strip. If that ever changes
 * the cost is bounded — a real failure misread as the flake is re-run once and fails again on the
 * retry, because a real failure recurs. This matcher can waste a run; it cannot turn a red green. */
function summaryReportsNoFailures(clean, label) {
  const line = clean.match(new RegExp(`^\\s*${label}\\s+(.+)$`, 'm'))
  // No summary at all means the run died before reporting — a real failure, not this one.
  if (!line) return false
  return !/\bfailed\b/.test(line[1])
}

function isTeardownFlake(output) {
  const clean = String(output ?? '')
  if (!clean.includes(TEARDOWN_ERROR)) return false
  return summaryReportsNoFailures(clean, 'Test Files') && summaryReportsNoFailures(clean, 'Tests')
}

module.exports = { isTeardownFlake, TEARDOWN_ERROR }
