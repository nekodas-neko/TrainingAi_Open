# Plan — the constants tree stops being a build-time dependency (Q-49 Phase A3)

_2026-08-10 · Domain `platform` · The last engineering blocker on the public cut._

**Measured, not assumed.** `node scripts/publish-dry-run.js --all` removes all 81.2 MB of private
paths and reports exactly one root cause: `lib/oura-models/constants/` is statically imported, and
its absence breaks the module graph. Everything else already survives removal —
`--ready` (46.9 MB) is green today.

---

## 1. What the blast radius actually is

The dry-run's `--all` failure list is ~170 tests across `set-log-planned-snapshot`,
`backfill-derived-scores`, `hr-window`, `live-steps` and more — none of which use a model constant.
They fail for one reason:

```
Cannot find module './constants' imported from lib/oura-models/steps-motion-decoder.ts
  ❯ lib/oura-ble/step-counter-pipeline.ts
  ❯ lib/data/postgres/adapter.ts
```

`adapter.ts` fails to import, so every DB-backed test dies with it. **One static import, the whole
repository.** Do not read the 170 failures as 170 problems.

## 2. The shape is smaller than Q-49 assumed

The backlog says moving these constants "touches every port that reads a constant". Checked against
`main` on 2026-08-10, that overstates it in the way that matters:

- **No client component imports `lib/oura-models/constants` or any constants-backed function.**
  Verified by grep over `app/` + `components/` `.tsx`. `done-screen.tsx` looked like a hit and is
  a cache-key string, not an import.
- Every consumer is server-side: API routes and `adapter.ts`.
- The getters in `constants/index.ts` are already the single choke point — ten exported
  `get*Constants()` functions over twelve static imports.

**Except one, and it is the interesting one.** `packages/shared/src/health/workout-energy.ts`
imports `constants/energy-expenditure-features.json` **directly**, bypassing `index.ts`, and it sits
on a client chain: `app/health/hooks/use-health-calcs.ts` (a `'use client'` hook) →
`daily-energy.ts` → `workout-energy.ts` → the JSON. It is 11.8 KB.

## 3. Two tasks, and the second is not a loader

### A3a — `constants/index.ts` becomes a lazy reader (server-only)

Replace the twelve `import x from './foo.constants.json'` with a memoised
`JSON.parse(fs.readFileSync(…))` inside the existing getters. Every call site stays **synchronous
and unchanged** — that is the whole reason to do it this way rather than making the getters async,
which would ripple through `stress-resilience.ts` and `steps-motion-decoder.ts`, both of which
evaluate their constants at module scope (`const C = getResilienceConstants()`).

**The part that needs a decision, not just code.** `readFileSync` reads the tree, and the tree is
what we are emptying. So the files must be on disk by the time the first getter runs. The ONNX
answer — fetch inside `getSession`, which is already async — is not available to a synchronous
getter. Options, in the order I would try them:

1. **Boot-time fetch to a writable directory**, in `instrumentation-node.ts` alongside
   `warmSchema()` and `checkModelAssets()`, with the getters reading from there. Module init happens
   on first request, after instrumentation has run, so the ordering holds. Needs the boot check to
   cover constants too, and needs the fetch to be fatal on failure — a missing constant is a wrong
   number, not a missing feature, which is worse than a null model.
2. **Build-time fetch** in `nixpacks.toml` before `next build`. Simpler ordering, but reintroduces
   the build secret the Q-49 owner decision deliberately removed, and CI would need it too.
3. **Async getters.** Correct but the largest diff, and it converts two module-scope constants into
   lifecycle problems. Last resort.

Option 1 is the one to plan against. It is the same shape as `bootstrapAdmin`, already in that file.

### A3b — the MET table gets replaced, not moved

`energy-expenditure-features.json` should not go through A3a at all. It is #999's **Task 2**: an
82-activity MET table whose own header already cites the *Compendium of Physical Activities
(Ainsworth et al.)*, a published and citable source. Re-sourcing it from the public original and
re-keying it to our `activityType` strings makes it **our public data file**, which removes it from
the private set entirely rather than moving it behind a loader.

That is strictly better here: it is on a client chain, and a client chain is exactly where a runtime
file read cannot go.

**Do it as a value-by-value diff.** A mismatch against Oura's pinned copy is a finding, not a
rounding difference — the numbers feed the Energy Budget and per-workout kcal, both user-visible.

## 4. Sequencing

A3b is independent of A3a and safe to take first — it is small, it is public-data sourcing, and it
shrinks A3a's problem by removing its only client-chain case. A3a then has no exceptions to handle.

Neither blocks the `--ready` removal (Phase A4), which is green today and covers 46.9 MB including
every decompiled-source file. **A3 is what unblocks the remaining 34.4 MB**, so it gates the *full*
cut, not the first one.

## 5. Verification

`node scripts/publish-dry-run.js --all` is the gate: it must go green. Nothing else proves the
static import is really gone, because a static import that survives is invisible until the file does
not exist. Add a `pnpm dev` pass over the Energy Budget and a workout's kcal for A3b — a changed MET
value is a changed number on a screen.
