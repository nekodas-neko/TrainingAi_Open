# 2026-08-25 — a 4.3-second import inside a 5-second budget (BF-11b follow-up)

**Branch:** `fix/scan-test-import-outside-budget` · **Lane A** · one test file. No product change.

`multi-candidate.test.ts`, merged in #480 this afternoon, is flaky on `main`. Its first case failed
at **5012 ms** in one local run of the nutrition suite and passed on the next — a timeout, in a file
whose model is entirely mocked.

## Measured, not guessed

The route is imported with `await import(...)` inside the helper every test calls, so **the first
test pays the module-import cost inside its own 5-second budget**. Timed directly:

```
IMPORT_MS 4313        # importing app/api/nutrition/scan/route on an idle machine
```

It reaches `@/lib/observability`, which pulls in the Drizzle adapter. That leaves roughly 700 ms of
headroom on an idle machine, and ordinary parallel load eats it.

Moving the import into `beforeAll` — which has its own 10-second budget and pays the cost once —
takes the first test from **3834 ms to 11 ms**:

| | first test's own time |
|---|---|
| import inside the test (as merged) | **3834 ms** |
| import hoisted to `beforeAll` | **11 ms** |

That is the mechanism, rather than four green re-runs, which is all a flake ever gives you.

## The third time today, and the pattern is now clear

- **BF-18** (this morning): an assertion allowed an async write **zero** milliseconds.
- **TN-7 follow-up**: an assertion counted rows written by two racing fire-and-forget calls.
- **This**: a test's budget spent on setup that is not the thing under test.

Different shapes, one root: **an assertion whose outcome depends on machine speed rather than on the
code**. The narrow, checkable question that catches all three is *"what in this test is timed, and is
any of it not the behaviour I am asserting?"* — a module import, a background write, and a second
writer are all answers to it.

Worth noting the first two were found by CI and by mutation testing. This one was found by **not
dismissing a single red run that went green on a re-run**, which is the habit `CLAUDE.md` asks for
and the one most easily skipped when the suite is green the second time.

## Verified

- First test **3834 ms → 11 ms**, measured both ways on the same machine.
- `packages/shared/src/nutrition/` + `app/api/nutrition/` — **306 passed**, four consecutive runs.
- `tsc --noEmit` clean.

## Not exercised

No product code changed, so nothing to run on the device. **Four clean runs are not proof the flake
is gone** — the timing measurement above is the evidence; the runs only show it is not obviously
worse. The other test files that import a route inside a test body were **not** swept: this fix is
the file I made flaky, and a sweep is its own change with its own measurement.
