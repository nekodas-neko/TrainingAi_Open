# 2026-09-01 · Lane A — a display constant stops being a copy (LB-43)

Branch `lane-a/energy-constants-leaf`. Four constants moved one file over. No migration, no device.

## The chain, and that it has now broken twice

`daily-energy.ts` → `workout-energy.ts` → `lib/oura-models/constants` → a node builtin. Turbopack
refuses the client chunk and `/nutrition` returns 500. BF-87 hit it wanting `STEP_BASELINE` for a
**line of copy**, and shipped a mirrored `STEP_BASELINE = 3_000` with a test to stop it drifting.

**The same chain broke the same tab before**, in Q-401, through `goal-recommendation` →
`calorie-balance` → `calorie-zone-bar` — with `node:path` rather than `node:fs/promises`. The fix
then was `energy-baseline.ts`, a leaf module holding `SEDENTARY_MULTIPLIER` and importing nothing.

## The entry proposed a new file. The right answer was the one already there.

LB-43 says to move the constants into *"something like
`packages/shared/src/health/energy-constants.ts`"*. It did not know `energy-baseline.ts` existed —
which is understandable, since only `SEDENTARY_MULTIPLIER` lived there and the name does not suggest
step conversions.

Creating the proposed file would have left **two dependency-free leaf modules for one purpose**,
which is precisely the drift the one-formula rule exists to prevent, arriving one level up from the
usual place. The three constants went into the existing module instead, its doc now carries both
incidents, and `daily-energy.ts` re-exports all four so every server-side importer is untouched.

This is the "re-verify the plan against current `main`" rule paying for itself: the entry was
written from a true measurement and a stale assumption about what the repo already had.

## The test that guarded the mirror could no longer fail

`expect(STEP_BASELINE).toBe(SHARED_STEP_BASELINE)` was the whole thing keeping the copy honest. With
one re-exporting the other it is **tautological** — and a test that cannot fail is worse than no
test, because it reads like coverage.

It was replaced with the invariant nothing else checks: **`energy-baseline.ts` imports nothing at
all**, no `import` and no `require`. That is the only property keeping it client-importable, `tsc`
would say nothing if it changed, and it is exactly what broke twice already.

Mutation-tested both ways. Adding an import to the leaf module turns the suite red. Changing
`STEP_BASELINE`'s value does **not** — and that is correct rather than a gap: with one constant,
drift is impossible, and the movement tests derive their fixtures from the constant instead of
restating it.

## Verification

`/nutrition` returns **200** on `pnpm dev` with the client component importing the shared constant,
and the dev log carries no *"chunking context does not support external modules"*. `pnpm check:rules`
Ran 67 of 67. Full suite green.

**Not exercised:** native SQLite, Capacitor, safe-area, the APK path — nothing here touches them.
The 500 was a bundler failure, so the browser render is the real check and it is the one that ran.
