# 2026-09-29 — an e2e route overlay outliving its test took four runs red

**Branch:** `fix/e2e-route-overlay-outlives-test` · test infrastructure only, no product change, no
version bump.

## What was wrong

`E2E shard 4` concluded **failure** on four consecutive runs — `36594986970` (LA-36's predecessor
TN-32), `36598412525`, `36602819608` and `36604843800` — and three of those PRs merged anyway,
because `E2E` is advisory rather than required.

The shard's own summary is the part worth remembering: **`74 expected · 0 unexpected · flaky 0 ·
ok: true`, exit code 1**, under `1 error was not a part of any test`. No test failed. Playwright was
reporting a rejection raised *outside* any test, which is why the log names no spec and why the
failure reads as CI infrastructure.

The cause was in `tn32-heart-rate-graded-by-profile.spec.ts`. Its `/api/readiness-score` overlay
calls `await r.fetch()` inside the route handler — a real network round trip, taken deliberately,
because a thin `{ hrCurrent }` stub crashes that page. When the test ends with one of those requests
still in flight, Playwright rejects the pending call with `route.fetch: Test ended.` and attributes
it to the run rather than to a test.

## How it was found, and the wrong answer it was nearly attributed to

`get_job_logs` gives a log tail, and the tail of a failed shard is Postgres container teardown — the
error is thousands of lines upstream. The answer came from the **uploaded `playwright-report-4`
artifact**, fetched by the repository-scoped REST path `LB-149` already documents
(`/repos/<owner>/<repo>/actions/artifacts/<id>/zip`; the URL the run log prints is refused by the
sandbox proxy with a 403 that looks like an auth failure and is not). The report's `report.json`
carries the run-level `errors[]` array with the full call log and the `spec.ts:25` frame.

**This is not `LB-149`.** That entry is owed one more red E2E read through its repaired `dmesg`
branch, and this run did print the repaired line — *"no OOM kill in dmesg"* — but it is **not the
observation LB-149 is waiting for**: there was no browser death here. The browser was healthy, 74
tests passed, and there is no `chrome-headless-shell` crash stack. LB-149 stays open, untouched, and
still owes its own red run. Attributing this there would have closed it on the wrong evidence, which
is the failure mode its own entry warns about.

## The fix

`tolerateTestEnd(handler)` in `e2e/fixtures.ts` wraps a route callback and swallows **only** the
end-of-test rejections (`Test ended`, `Target page, context or browser has been closed`, `Request
context disposed`), rethrowing everything else — a handler that genuinely cannot serve its overlay
must still fail the test that depends on it, or a spec silently asserts against the real payload it
meant to replace.

Playwright's own hint is `page.unrouteAll({ behavior: 'ignoreErrors' })` before the test ends. That
was rejected: it is per-test and has to be remembered at every exit path including a failing
assertion. Catching at the source cannot be forgotten.

Applied to all **six** specs whose handlers do a real `route.fetch()` — the sibling-surface sweep,
since the other five are the same latent bug and four of them predate this session:
`tn32-heart-rate-graded-by-profile`, `la82-stand-in-hr-sources`, `rv72-progress-bars-composite`,
`score-gap-reason`, `deload-confirm-eviction`, `rv202-stale-numbers-are-labelled`. Each keeps its own
`fulfill` shape untouched — `rv202` preserves response headers via `{ response: res }` and that was
not going to change silently inside a CI fix.

`scripts/check-e2e-route-tolerance.js` holds it, registered in the Custom Rules job
(**`Ran 84 of 84`**). It was verified by restoring `origin/main`'s unwrapped spec and watching it
fail on both offending lines, not by trusting a green run. Scope is deliberately `route.fetch()`
only: there are **69** inline `page.route` handlers across 44 specs, and the 64 that merely `fulfill`
a literal body have never produced this in the suite's history. Wrapping all of them would be a large
diff for a failure that has not happened.

## Verified by a control pair, locally

Both specs, same command, same database, twice:

| tree | result |
|---|---|
| `origin/main`'s specs | `8 passed (1.7m)` · `1 error was not a part of any test` · **exit 1**, at `tn32-heart-rate-graded-by-profile.spec.ts:25` |
| with `tolerateTestEnd` | `8 passed (1.7m)` · **exit 0** |

So CI's signature reproduces locally and the fix removes it — the failure was never environmental.
Note what the control shows about the shape of this bug: **the test count is identical in both
columns.** Nothing about the suite's assertions changed; only the exit code did.

One process note that cost twenty minutes: `pkill -f 'playwright test'` matches nothing here, because
the running process is `cli.js test …`. A first run was believed killed, was not, and raced a second
against the same dev server and database until both were killed by PID — with `next-server` at 9.3 GB
RSS by then. Kill by PID, and confirm with `ps` rather than assuming the pattern matched.

## Also fixed: #1987's Build job

BF-15's own PR was red on **`Build`**, which *is* required — `check-test-typecheck.js` found one type
error in `bf15-recommended-exercise-role.test.ts`. The fixture declared `exerciseType: 'strength'`,
which is not in the union (`'weighted' | 'bodyweight'`), and an `as ExerciseLibraryEntry` cast on the
object literal kept the compiler quiet. **`npx tsc --noEmit` does not cover test files** — they are a
separate project, `tsconfig.tests.json`. The cast is gone as well as the value corrected, so the
fields are now checked where they are written. Ten tests still pass; none of them reads that field.

## Not exercised

- **The device.** Nothing here ships to the APK — test harness and CI only.
- **A full four-shard run.** The two specs are proven; that shard 4 is green *end to end* is what
  this branch's own CI run has to show. A local single-shard run was started and abandoned, because
  edits landing mid-run contaminate it.
- **The five specs that were not already failing.** They are the same shape and the same class, but
  only `tn32` had been observed leaking; the other five are fixed on the argument that the mechanism
  is identical, not on a reproduction of each.
