## 2026-09-07 — Four small nutrition inconsistencies, two of which were mis-described (PS-37)

**Branch:** `fix/nutrition-small-inconsistencies` · **Lane A**

### What shipped

**1. A water quick-add now lands on the day the user tapped.** `POST /api/water-log` derived the
date from server-now and never read the body — its own header said *"a date and a millilitre
count"* — while the outbox path keys the identical write to `mut.date`, the client's day. The same
increment therefore landed on different dates depending on which path carried it, and the only time
they disagree is across midnight, which is exactly when a hydration total is being closed out. The
route now accepts an optional `localDate` and the web fallback sends it. **Bounded to today or
yesterday** in the user's timezone: a running total is the wrong place to accept an arbitrary date,
since unbounded it rewrites history one accepted request at a time.

**2. A macro slot can no longer come back negative.** `splitMacrosAcrossMeals` pushed the whole
rounding residual onto the largest slot. Splitting 0.3 g of protein across five meals rounds each to
0.1, overshoots by 0.2, and the old subtraction produced `[-0.1, 0.1, 0.1, 0.1, 0.1]`. The residual
is now taken from slots in descending order, each capped at its own value; a positive residual still
lands entirely on the largest slot, so the common path is unchanged.

**3. The docstring's "daily totals are preserved exactly" is now true.** It is preserved to the
precision the slots are returned at — 0.1 g, 1 kcal — not the target's. 150.25 g across four meals
returns slots summing to 150.2, and no amount of redistribution fixes that.

**4. A failed fresh meal generation no longer says "Could not rewrite that meal".** The branch was
inverted on the else side only; the rewrite branch was always right.

### Two of the four were not what the entry said

**The "two 2500 ml hardcodes" are three different things, and only one is a bug.**

- `health-content.tsx` — a **no-goal-set fallback**. Now `DEFAULT_WATER_GOAL_ML`, exported beside the
  recommender with a comment saying it is a placeholder and explicitly not what `waterMl` computes.
- `day-checkin-prefill.ts` — a **population anchor** for a 1–5 prefill scale, and its neighbour
  `steps / 12000` is the same shape. A prefill is a starting position for a slider the user then
  moves, so the same intake has to mean the same starting position for everyone; scaling it by a
  personal goal would make "hydration: 2" describe a different amount of water per user. Named
  rather than "fixed", with that reasoning in the file.
- **`components/profile/goal-targets-section.tsx` — the one that is genuinely wrong, and the entry
  did not name it.** Two `placeholder="2500"` strings sit on the water-goal inputs *beside the
  control that fills in the real recommendation*. Filed as **LA-75**, Lane B, because it is
  placeholder copy on a screen this session cannot see rendered.

Similarly, item 3 asked for "the docstring or the rounding". Measuring showed they are two separate
defects — the sub-2 g case produces a **negative slot**, not merely an imprecise total — so both were
fixed rather than one chosen.

### Verification

- `packages/shared` + the sync-parity suite + `lib/__tests__` + `app/api/__tests__`: **3477 passed**,
  10 skipped.
- **Mutation-checked, four ways.** Restoring the single-slot residual fails the negative-slot case.
  Dropping the today-or-yesterday bound fails the out-of-range case; ignoring the client date
  entirely fails the parity case. Each half of the water rule is pinned independently, in the file
  that already existed for web-vs-outbox parity (SYNC-P7).
- `pnpm check:rules` — **Ran 68 of 68**. `tsc --noEmit` clean. ESLint clean (the one warning in
  `health-content.tsx` is a pre-existing unused import, confirmed by stashing).
- `pnpm dev`: both changed routes 401 rather than 500, `/health` redirects to sign-in.

**Not exercised:** the device. The water sheet's *local-store* path was not touched and is the one
the APK actually takes — this fixes the web fallback, which is what the sandbox can reach. Nothing
here needs an APK.

**Version:** 1.436.40 (patch) — 1.436.39 was taken by another lane while this branch was open.
