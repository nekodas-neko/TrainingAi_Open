# 2026-08-13 — the constants stop being a build-time dependency (Q-49 Phase A3)

_Branch `feat/constants-runtime-loader` · domain `platform`_

The last engineering blocker on the public cut. `publish-dry-run --all` is now green on all six
gates with the full **81.2 MB** removed.

## What was actually blocking

`constants/index.ts` resolved its 14 files with `import x from './foo.constants.json'`. Webpack bakes
a static import into the bundle at build time, so the directory had to be in the repository for the
app to compile — and removing it took `adapter.ts` down with it, which took every DB test with
*that*. The dry-run's ~170 failures were one cause wearing 170 hats.

Reading at call time makes the directory a **runtime** input, satisfiable from outside git.
`OURA_CONSTANTS_DIR` points at it; Phase A4 populates that from the bucket.

**Synchronous on purpose.** `stress-resilience.ts` and `steps-motion-decoder.ts` both evaluate their
constants at module scope. Async getters would have converted two plain constants into lifecycle
problems across every port that reads one, for no gain — the files are local by then.

**The loader throws.** The infallible contract that suits the ONNX models is the wrong shape here: a
missing model degrades to a fallback, a missing constant is a wrong number nobody can see. Pinned by
a test.

## Two things the work turned up

**The client-boundary problem the plan was written around no longer exists.** The plan's A3b said
`energy-expenditure-features.json` had to be *replaced* from the public Compendium before it could
move, because it sat on a `'use client'` chain through `use-health-calcs.ts` → `daily-energy.ts` →
`workout-energy.ts`. Re-checked today: `use-health-calcs.ts` no longer imports `daily-energy` at all,
and every remaining consumer is a route or a server module. So the MET table moved behind the loader
with everything else, and no MET values had to be re-sourced.

**Re-sourcing it from the Compendium is still worth doing** — it would stop the file being vendor
data rather than merely hiding it — but it is now ordinary quality work, not a blocker. It stays as
#999 Task 2.

**The manifest was over-claiming.** It listed `lib/oura-models/constants/` wholesale as
unpublishable, which includes our own loader, its test and its README. The dry-run caught it by
failing to compile a tree missing its own source file. Those three are excluded now — the same split
the ONNX tree already makes for its golden vectors. 54 files became 51.

## What a green `--all` does and does not prove

It proves **nothing in the published tree needs these files at build time**. It does not prove
production runs without them: production still needs them at runtime, from the bucket, and that is
Phase A4. The dry-run models that delivery by setting `OURA_CONSTANTS_DIR`, which is honest about
what is being tested rather than quietly passing because the files happened to be there.

## Verification

Full suite green (461 files, 3,781 tests). `--all` green on typecheck, tests, private-paths,
dormancy, inlined-constants and doc-links, with 81.2 MB and 10 paths removed.

## Not verified

No device run — nothing here touches an offline-first domain, a native plugin, safe-area or
notifications. The bucket delivery of the constants does not exist yet, so **the files must stay in
the tree until A4 builds it**; this change makes their removal possible, not done.
