# 2026-09-26 — LA-146: CI absorbs the vitest teardown flake, narrowly

**Branch:** `fix/vitest-teardown-flake-retry` · **Lane A** · entry LA-146 (removed from the queue)

## What this is

A full run exits 1 while reporting **zero failing tests**, with one line:
`EnvironmentTeardownError: [vitest-worker]: Closing rpc while "onUserConsoleLog" was pending`.
Ten sightings, ten clean re-runs on identical code — and two of them landed on one day, which is the rate change that moved this to rank 1. It was free until 2026-09-25, when `Tests`
became a **required** check — so it stopped costing a re-run and started blocking the merge button.

## It is upstream's bug, and that is now evidenced rather than assumed

[vitest-dev/vitest#11153](https://github.com/vitest-dev/vitest/issues/11153) — open, `p3-minor-bug`,
no fix. The reporter measured **3/10 runs failing on 4.1.11 and 3/10 on 5.0.0**, against **0/10 on
3.2.4**. They also measured `maxWorkers: 1` (still 2/10, 5× slower), `isolate: false` (still 2/6,
and it broke tests in 2 of 6), `silent: 'passed-only'` (3/10), console spying in a setup file
(3/10) and draining pending work (no effect).

**This retires a stale claim in `docs/local-dev-database.md`**, which said *"not fixable by
upgrading — 4.1.11 is the latest 4.1.x and no 4.2 exists"*. Vitest **5.0.2 exists now**. The
conclusion survives and the reason does not: upgrading is still no use, because the regression
carries into v5. Only 3.2.4 is clean, and this config uses `projects`, which is v4+.

## What shipped

`scripts/ci/vitest-retry-teardown-flake.js`, wired at the `test-shard` step, re-runs a shard once —
and only when the run carries that exact error **and** reports zero failing tests **and** zero
failing files. This automates the response the entry already prescribed (`rerun_failed_jobs`), but
inside the job, so it costs one shard rather than a workflow re-run that also cancels and restarts
the 34-minute E2E.

**It cannot turn a red green.** A false positive costs one extra run, because a real failure recurs
on the retry. A second occurrence in the same job fails the job, and every retry prints a greppable
`[vitest-retry]` notice so sightings keep being counted.

## Why not the structural fix

`disableConsoleIntercept: true` would make the race **impossible**, not rarer — vitest installs the
worker-side RPC console sender only when that option is false
(`if (!config.disableConsoleIntercept) await setupConsoleLogSpy()`), and that sender is the only
caller of `rpc.onUserConsoleLog`. I verified that chain in the installed source rather than
inferring it.

Its cost is what ruled it out, and **the cost this repo had written down was wrong**. The doc said
it *"costs per-file log attribution for everyone"*. Measured: with intercept on, a **passing**
test's `console.log` is dropped entirely and only a **failing** test's output is kept and
attributed — so there is much less attribution on offer than claimed. The real cost is volume:
across `lib/data/postgres/__tests__/` (176 files) the log goes from **12 lines to 526**, 342 of them
`[ensureSchema]`. Over a full shard that buries the failure you opened the log to read. Two in one
job is the evidence that would justify paying it anyway.

## Mutation pass

8 deliberate defects, all killed; 2 deliberately equivalent controls, both survived.

A ninth mutant — removing the ANSI-stripping from the matcher — survived, **and the right response
was to delete the code rather than write a test for it.** I had stripped escape codes before
reading the summary lines, on the theory that a coloured `failed` would defeat `\bfailed\b`.
Measured: vitest emits those two summary lines **unstyled even under `FORCE_COLOR=3`**, and CI is
not a TTY. It was defence against something that does not happen, so it went. The matcher's docstring
now records the bound that makes that safe: a misread costs one wasted run, never a false green.

## Not done

The flake itself is not fixed and cannot be fixed here. When vitest#11153 closes, delete the
wrapper and go back to `pnpm vitest run` — that is the one thing this change owes, and it is
conditional on upstream rather than on us.

## Not exercised

No device run and none applicable — CI tooling only, no product code, no APK. The retry path was
proven with a scripted runner (16 tests) and the real spawn path was exercised end to end for exit
codes (green → 0, red → 1, vitest invoked once, no retry). **The one thing not exercised live is a
genuine occurrence**, because the fault is not reproducible on demand — 24 controlled runs produced
none. What was verified is the policy around it, not a real interception.
