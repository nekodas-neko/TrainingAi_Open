# 2026-09-09 — one implementation of the day's supplement exposure (LB-57)

**Branch:** `lane-a/lb57-shared-supplement-day-totals` · no migration, no user-visible change.

## Why there were two

`listSupplements` (the Postgres adapter) derived the day's totals on read, and **the device never
reaches that code**: the nutrition page's local-first branch returns early once the local store has
definitions, so BF-112 had to derive the same three rules again from `getSupplementLogs`. The
correct single home is `packages/shared/`, and both `packages/shared/**` and `lib/data/**` are Lane
A's — which is exactly why the lane that created the second copy filed this instead of hoisting it.

`summariseSupplementDay` now lives in `packages/shared/src/nutrition/supplement-day-totals.ts` and is
called by both. Placed in `nutrition/` rather than the entry's suggested `supplements/` because
`supplement-dose-freeze.ts` for the same domain already lives there; a new directory for one file
beside its sibling is worse than the entry's path is right.

## What the hoist had to reconcile

The two copies were not identical, and the difference is the one worth recording:

- The adapter tested `l.source === 'manual'`; the client tested `(l.source ?? 'manual') === 'manual'`.
- **Checked rather than assumed:** `supplement_logs.source` is `NOT NULL DEFAULT 'manual'` in
  Postgres, so the strict form never encountered a null server-side and the two agreed. The
  divergence only exists locally, where the row type marks `source` optional — every writer
  predating BF-69 omits it and `upsertSupplementLog` defaults it.
- The shared version takes the **tolerant** form. It is what lets one function serve both, and it
  changes nothing on the server.

The adapter also derived `loggedDose` — the manual row's own frozen dose — which the client copy did
not need. That moved into the shared function too rather than staying behind, so the manual-only rule
is stated once instead of twice.

## Verification

Ten of ten real mutants caught; one deliberately equivalent control (the `out.set` after mutating an
object already in the map) survived as expected. The adapter mutants are caught by **server-side**
tests and the shared-function mutants by the client's, so the hoist is load-bearing on both sides
rather than merely compiling.

**One mutant survived the first pass, and it is the classic fixture trap:** the unit's first-wins
rule. The existing "sums every live contribution" case used `'g'` on both rows, so first-wins and
last-wins agree there and neither is tested by it. Three cases added — two contributions that
disagree on the unit, a first contribution carrying no unit at all, and a day where a meal
contribution must not become the `loggedDose` the page unticks.

The test file stays at `components/nutrition/__tests__/supplement-day-totals.test.ts`, pointed at the
shared version: its cases were written against the adapter's semantics on purpose, so they are the
right ones to hold the shared function to. `applyManualToggle` stays in `components/` — it is the
page's optimistic update with no server analogue.

**Not exercised:** the APK. No behaviour changed on either path, so there is nothing new for the
device to show, but the device is the only place the local branch actually runs.
