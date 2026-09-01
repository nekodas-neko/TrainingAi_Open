# 2026-09-01 — the calorie bar says why zero is zero

**Branch:** `fix/bf-87-steps-threshold-copy` · **Entry:** BF-87 · **Lane:** B · **Version:** v1.416.2

## The report

Owner: *"is basic steps being counted towards calorie burn? It says I've done 1000 but not sure if
that's counting towards nutrition."* His screenshot held both halves of the contradiction — **STEPS
1,196 Today** beside *"1,365 base — nothing earned from movement yet today"*.

**The app was right and the screen could not say why.** Only steps above `STEP_BASELINE` (3,000)
earn calories, deliberately: the sedentary base is BMR × 1.2, and a desk day's incidental stepping
is already inside that multiplier, so counting every step would count it twice. At 1,196 the honest
answer is zero — given without the reason, which is what produced the question.

## What shipped

**The zero case names the threshold**, because naming the shortfall alone does not answer it: a user
with a 7,000 step goal still cannot tell how many of those convert. It reads
*"2,478 base — nothing earned from movement yet; steps count above 3,000/day"*.

**The earned case now breaks down**, rather than rolling three addends into one figure at the exact
point of confusion: *"2,478 base + 1 earned from movement (1 activity)"*. `activeBreakdown` already
returned workout, activity and step calories separately (Q-391), so the data was in hand.

**Both "calories out" explainers name the same number** instead of *"steps above a baseline"*.

**The parts need no rounding here, and finding that out cost the best code in the change.** The
first version apportioned them by largest remainder, over a sweep of 480 fractional splits, on the
assumption that `activeKcal` is rounded once while its parts are not. Re-reading `daily-energy.ts`
against current `main` — the standing rule to re-verify a plan before implementing it — showed
`computeActiveEnergy` **already rounds all three parts** and sets `total` to their sum, which the
service passes through as `activeKcal`. So the parts are integers that already add up, and the
apportionment was arithmetic guarding a case its producer cannot produce.

It is deleted. What replaces it is a test that pins the guarantee *against the real
`computeActiveEnergy`* across four inputs: if Lane A ever stops rounding, or `total` stops being the
sum, the display's assumption breaks and the test says so. Mutation-checked by removing one of the
three `round()` calls upstream, which fails three of the eleven tests.

## The threshold is mirrored, and that is a deliberate exception

Importing `STEP_BASELINE` from `@trainingai/shared/health/daily-energy` **took `/nutrition` to a
500**. The chain is `daily-energy` → `workout-energy` → `lib/oura-models/constants`, which reads
`node:fs/promises`; Turbopack fails the client chunk with *"the chunking context (unknown) does not
support external modules"*. **No client component had ever imported `daily-energy`** — this was the
first, and it only wanted one number to print.

So `components/nutrition/movement-breakdown.ts` declares its own `3_000` with the reason above it,
and the test imports the shared constant — tests run in node, where the chain is harmless — and
fails if the two disagree. It cannot drift silently. It is still a second copy of a number, so
**LB-43** (Lane A, it edits `packages/shared/**`) proposes splitting the plain constants into a leaf
module, after which the mirror is deleted.

**`pnpm dev` is what found this. `tsc` was clean throughout.**

## Verification

- **Rendered, both branches, against a live server.** The earned line reads *"2,478 base + 1 earned
  from movement (1 activity)"*. Moving the seed's two activity rows off today reached the zero
  branch: *"2,478 base — nothing earned from movement yet; steps count above 3,000/day"* — the
  owner's exact question, answered on the screen that raised it. The seed was restored afterwards.
- **Eleven tests, six mutations, all killed**: removing one of the service's three `round()` calls,
  a drifted mirror, re-adding the server-only import, reverting the zero-earned copy, reverting
  either explainer, and dropping the breakdown render.
- **One guard could not fail as written, in the mirror image of the usual way.** The check that the
  server-only import is *absent* reused a source reader that **strips import lines** — added
  precisely so other guards cannot pass on the line naming their symbol. Here that removed the thing
  under test. It now reads a comment-stripped, import-preserving copy. Mutation found it; reading
  did not.
- `pnpm check:rules` — **Ran 67 of 67**. `tsc`, `pnpm lint`, backlog-pointers, doc-links all exit 0,
  each read by exit code.

**Not exercised.** The two *"calories out"* explainer strings changed inside a paragraph that
already renders, and are guarded by source tests, but were not separately rendered — a probe spec's
click into that collapsed block timed out and was not worth more time than the change is worth.
Nothing here has been on the S25: this is copy at the bottom of a dense card, so line-wrapping at
S25 width is the device check it owes.

**Deliberately not done: the live step count.** The entry's example copy included *"— 1,196 so far"*.
None of the three call sites holds a step count, and threading `body-metadata` into all three to
echo a number the owner can already see on the same screen is not worth the fetch. The **threshold**
is what the entry's own ⚠ asks for, and it is what answers the question.

**Deliberately not touched: `STEP_BASELINE` itself.** The entry is explicit — it is the guard against
double-counting, and changing it silently re-scores every historical day. That is a Tuning proposal
with the owner's sign-off, not a copy fix.
