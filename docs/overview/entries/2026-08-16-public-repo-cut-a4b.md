# 2026-08-16 — Q-49 A4b: Oura's material leaves the repository

**Branch:** `claude/trainingai-migration-a4b-sufoxv` · **Domain:** platform

The deletion step of the public-repo migration. All ten paths in `scripts/private-paths.json` are
gone — trained weights, baked constants, decompiled vendor source, and the two documents describing
how any of it was obtained. `check-private-paths` now reports `total tracked: 0.0 MB`.

## What shipped

- **535 files deleted**, ~89 MB. `lib/oura-models/weights/` (44 MB), `onnx/` (28 MB), `constants/`
  (12 MB), `docs/oura-models/` (3.7 MB), `scripts/oura-models/_source/`, both extraction skills, and
  the three provisioning/inventory/key-extraction documents. Our own code inside those directories
  stays: the constants loader, its type declarations, the golden recordings under
  `onnx/__fixtures__/`, and the tests.
- **`.gitignore` covers every path**, with negations mirroring the manifest's `excludes`. The point
  is `git add -A` on a machine that still has the files.
- **Both boot checks are fatal in production.** `checkModelAssets` asked the *disk*, which after this
  change is the wrong question, so it now asks the bucket; `deliverConstants` already reported and
  now throws. Both are awaited, which is what makes them gates — `register()` is awaited by Next, so
  a `void` call would have surfaced the same error as an unhandled rejection while the process
  carried on serving.
- **`NOTICE`** — it could not be written earlier, because it states that no third-party model weights
  are included and that was false until they were gone.
- **17 test files guarded** with `skipIf(!hasRealConstants())` / `!hasRealModels()`.

## The blocker A3 was believed to have removed

`next build` failed with `ENOENT ... energy-expenditure-features.json` at *Failed to collect page
data for /api/achievements*. A3 replaced the static JSON imports with a runtime loader and
`publish-dry-run --all` went green, which everything downstream read as "the constants are no longer
a build-time dependency". They still were: `next build` imports every route to collect page data, so
a module that calls a loader at **module scope** opens the file during the build. Seven such reads
existed across six modules.

They now read on first use, memoised, with each function taking its own `const C = C_()` so the
bodies are untouched. Parity against the real vendor values was run before and after the refactor —
70/70 across the four golden suites — because a lazy-init transform on 100 usages of domain math is
exactly the kind of change that looks safe and is not.

**The dry-run could not have caught this**, and that is the durable finding: its six gates do not
include a build. Filed as **Q-306**, with a cheap partial (a Custom Rules check for module-scope
constants reads) alongside the real fix.

## Guarding, and why it was done per block rather than per file

The handoff warned that a blanket regex over every top-level `describe` over-guards, and that turned
out to understate it. Measured against the deleted tree, the failures were **49 of 122 assertions**
in those files, and they do not line up with `describe` boundaries: `constants/__tests__/index.test.ts`
loses 4 of 6 blocks in its first describe while MANIFEST integrity and the registry shape hold fine
against synthetic fixtures; `ots.test.ts` loses 4 of 5; `daytime-stress.test.ts` loses 11 of 24 across
three describes. So each block was guarded on what it actually asserts, and the result was checked
**both ways** — with the vendor's files temporarily restored via `git show`, all 122 run and pass; with
them gone, 73 run and 49 skip. A guard that over-skips is invisible, so measuring only the second
direction would have proven nothing.

**The handoff's list of 16 was one short.** It was measured by moving the *constants* aside, which
never exercised the `.onnx` deletion. `oura-ble-rollup-worker.test.ts`'s "leaves the main thread free
while it runs" compares *durations*, and without the models every caller falls back and the rollup
finishes in ~65 ms — tripping the test's own degenerate-comparison guard. That guard is the test
being honest about its preconditions, so it skips rather than being relaxed.

## What is not proven

**The bucket download has still never executed anywhere.** Every run to date took the repo-copy
branch, and session sandboxes hold placeholder storage credentials that reject with
`SignatureDoesNotMatch` — confirmed again here, in the `pnpm dev` boot log. Its first real run is the
Railway deploy that merges this. A healthy boot logs `model constants: bucket — downloaded 34
file(s)` and `model assets: 8 file(s) in object storage`; anything else and the process will not come
up, which is the intended behaviour and the reason the check was made fatal in this same change.

The fatal path is gated on `NODE_ENV === 'production'`, not on whether storage credentials are set —
gating on credentials would skip the check in exactly the case it exists to catch. Non-production
logs the same message and continues degraded, which is what keeps `pnpm dev` startable at all now
that there is no tree copy to fall back on.

## Also here

- The two dangling provenance comments the private-path check had been reporting are rewritten, so
  it now reports zero.
- `lib/oura-models/constants/README.md` described a directory of files that no longer exist and
  linked to two deleted documents. Rewritten to describe the loader and where the files come from.
- `bucket-report.ts`'s summaries told an operator that "the repo-tree fallback is what production is
  using" — the single most misleading sentence to read at the moment the boot fails, since there is
  no fallback any more.
- `check-oura-models-dormancy`'s KEEP list carried 33 exemptions for files that are now untracked. An
  exemption for a file `git ls-files` cannot return exempts nothing, so they are removed.
- CLAUDE.md pointed sessions at the `oura-native-ble` skill, which went with the rest.

## Verification

`publish-dry-run --all` green with the files actually deleted rather than simulated · `next build`
clean · full suite 3,864 passed / 75 skipped / 0 failed · `pnpm check:rules` 36 of 36 ·
`check-private-paths` at `total tracked: 0.0 MB` with zero comment references · `pnpm dev` boots,
logs both degraded lines with their real cause, and serves `/api/readiness-score` 200.

**Not exercised:** the bucket download path (no credentials reachable from a session), and anything
device-side — this PR touches no native code, so the APK is unaffected and no rebuild is needed.
