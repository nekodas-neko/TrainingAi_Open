# 2026-09-02 — a scale argument on the meal log (LB-49)

**Lane A · branch `lane-a/meal-log-scale` · no version bump**

`logMealItems` takes an optional `scale`, applied at write time to each item's
`quantityMultiplier`. It defaults to 1, so nothing changes until Lane B ships the control that
passes one — which is why there is no changelog entry and no version bump.

## Three things the entry said that are not true

**`logMealFromSaved` does not exist.** The function is `logMealItems`. The three write sites the
entry cites by line number are correct, which is what makes the wrong name easy to miss.

**Its lane justification is false.** The entry says it is *"the single shared write function both
server paths call, which is the Canonical-Runtime rule the push branch is CI-gated on."*
`logMealItems` is client-side — its only callers are `food-logger-sheet.tsx:248` and
`saved-meals-sheet.tsx:451`, and neither an API route nor the `pushMutations` branch touches it.
Lane A is still the right lane, because `packages/shared/**` is Lane A's by the ownership contract.
Right answer, wrong reason.

**Its sync-chain warning contradicts its own decision, and is unnecessary.** It demands *"Local
table column, `queueMutation` payload, `pushMutations` branch and pull mapping in the same PR"* and
calls the change un-batchable. But the decision it also makes — **scale at write time, never store
the factor** — is precisely what removes that work: the payload already carries
`quantityMultiplier`, so the scaled value flows through the local row, the queued payload, the
optimistic object and the web-fallback POST with no schema change, no new payload field, and
nothing to mirror in the push branch.

## …and one thing it undercounted

It names three write sites. There are **five**: the two it missed are the optimistic pushes, on the
offline path and the fallback path. Those are the pair that decides whether the diary agrees with
the database — scale the stored multiplier and not the optimistic one and the user sees a single
serving while the row holds one and a half, which is the optimistic-vs-stored divergence this repo
has hit repeatedly. The scale therefore also goes on `savedMealItemToWithItem`, which is what builds
that row.

## The decision that is carried forward unchanged

The factor is **not stored**, and that is the owner-facing cost worth restating: *"I ate 1.5×"* is
not recoverable afterwards — only the scaled per-item amounts are. The rows are point-in-time
snapshots (the function copies the definition's multipliers rather than referencing them), so a
meal-level factor every reader had to remember to apply would put a second multiplier in the system
and break that. BF-3 went the other way for supplement doses because there the dose *is* the datum;
here the datum is the food.

## Verification

- Full suite: **6,281 passed / 59 skipped / 742 files**. `pnpm check:rules` — **Ran 67 of 67**.
  `tsc` clean; `check-test-typecheck` 320 across 90, none above baseline.
- Five new assertions: every write site scales and the stored row matches the optimistic one; the
  day gains 300 kcal at 1.5× against 200 at 1× (**absolute**, so a mutation moving both sides cannot
  survive it); `scale = 1` is byte-identical to passing nothing; and a 0.5 per-item multiplier
  becomes 0.75 rather than being replaced.
- **Mutation-tested twice.** Dropping the scale from the optimistic pushes fails two tests;
  dropping it from the queued payload fails one.

**Not exercised:** no UI passes a scale yet, so there is nothing to click. The APK (JS only — this
reaches the device through Railway), safe-area, Samsung WebView and drifted production data are all
untouched by a defaulted parameter with no caller.

## What is next

Lane B wires the control. The one thing it must not do is store the factor.
