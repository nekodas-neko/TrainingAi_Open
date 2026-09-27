# 2026-09-27 — LB-168: `pnpm test` exiting 1 with zero failures, root-caused and fixed

**Branch:** `fix/late-console-teardown-race` · **Lane:** Implementation B · **Files:** `vitest.setup.ts`.

## The defect

`pnpm test` exited 1 while reporting `1111 passed | 0 failed`, roughly one full run in five, with
`EnvironmentTeardownError: [vitest-worker]: Closing rpc while "onUserConsoleLog" was pending`. It had
been attributed to two unrelated files and reproduced on neither.

## Root cause

Vitest carries every console call from the worker to the main process over an RPC. A log emitted
**after its file's tests have finished** can still be in flight when that worker's channel closes.
The error names whichever worker was closing rather than whoever logged — which is why the
attribution was meaningless and the file-by-file hunt could not converge.

A hook in `vitest.setup.ts` that flags any console call after the last `afterAll` found it on the
first run. **Across four instrumented full runs, every escape was one emitter and one stack:**
`ensureSchema`'s informational summary (`[ensureSchema] 0 applied, 0 already present, 0 failed`),
reached from an **unawaited `scheduleFlush`** in `lib/rate-limit.ts` whose `flushKey` awaits
`ensureSchema` after the test file has already returned.

**The escaping files change between runs**, which is the whole reason this looked file-specific. The
flush races the remainder of its own file: a fast run swallows it, a slow one does not. Three named
runs produced **seven distinct files with zero overlap**. Any file exercising a rate-limited route is
a candidate, so there was never a finite list to fix.

## What shipped

**Stop forwarding `ensureSchema`'s `info` output under test.** Vitest never carries it, so the race
has nothing left to lose. `console.error` is untouched — a migration's `FAILED` / `DID NOT APPLY`
must never be swallowed. Done in the test setup rather than in `lib/data/postgres/client.ts`, so the
log keeps working in production (where it is the only record of what a boot applied) and production
code gains no knowledge that tests exist; there is no `process.env.VITEST` anywhere in it today and
this does not add the first one.

**Plus the detector, kept permanently.** `[late-console]` reports each distinct escape once, with its
stack and its file, straight to `stderr` — the process's own fd, so it cannot join the race it
reports. It is non-fatal on purpose: an escape only sometimes loses the race, so failing would trade
a rare confusing red for a rare clear one while breaking runs that are otherwise sound. It cannot
prevent an escape; it means the next one costs a read instead of a day.

**Verified:** two consecutive clean full runs post-fix — exit 0, zero escapes, zero `[ensureSchema]`
noise, **352 s against a 348 s pre-fix baseline**, so no measurable cost.

## Two fixes built, measured, and rejected

Both are written into `vitest.setup.ts`'s comment so they are not re-derived.

1. **Draining globally from the setup file** (`await import('@/lib/rate-limit')` in an `afterAll`).
   Correct in shape. It took the suite from **348 s to 482 s (+39%)**, because that import pulls `pg`
   into all ~1,100 files' isolated module registries. It also **failed 70 files outright**: they
   `vi.mock` the module partially, and **vitest's mock proxy throws on reading an absent export**, so
   even `mod.fn?.()` raises — `'fn' in mod` is the only safe probe. That one is worth knowing well
   beyond this entry.
2. **Draining per-file**, as six test files already do. Three files were fixed that way and the next
   run escaped from three different ones.

## The entry's own hypotheses, judged against the measurement

`LB-168` proposed three things. (a) *"silence `ensureSchema` under test"* was right — and was the
whole fix rather than the cheapest of three, though it belongs in the test setup, not Lane A's file.
(b) *"cut the top five test emitters, ~80 of the 381"* was beside the point: **not one of those five
ever escaped**, because a test's own `console` call happens during its test. Volume was never the
variable; reachability from an unawaited promise was. (c) a vitest bump is unnecessary.

## Follow-up filed

**`LB-170`** (Lane A) — `lib/rate-limit.ts` still does a DB write after the request that started it
was answered. The logging was the visible half and is fixed; the floating write is not, and what is
owed there is a judgement rather than necessarily a change (in a long-lived process it is the intended
design; the shutdown case is where an increment is lost). Split out rather than left as a `Keep:` on
`LB-168`, which is fixed.

## Not exercised

No product code changed — `vitest.setup.ts` is test infrastructure and reaches no runtime. Nothing
here touches the APK, the device, safe-area, native SQLite or production data. The one claim that
rests on sampling rather than proof is the rate: the defect was ~1 in 5, and two clean runs are two
clean runs, not a proof that the last escape path is gone. The `[late-console]` guard exists precisely
because that cannot be proved from here.
