# 2026-09-25 — RV-68: the supplement tick paints on the tap, not after the writes

**Branch:** `lane-b/rv68-supplement-tick-paints-first` · **Lane:** Implementation B

`applyOptimistic()` sat behind three awaited local writes and a native call, so the tick appeared
only once they had all returned.

## Why this is a measurement, not an intuition

"The local write is fast" is true almost always, and that is what makes this hard to see. The repo
had already hit the identical shape and written down why it fails: the Capacitor SQLite plugin has
**one connection**, so a tap landing during the sync pull's `applyDelta` transaction queues behind
the whole delta — which left the mood sheet's button reading "Saving…" for about two minutes on
2026-08-13 (`components/mood-checkin-sheet.tsx`). Supplements write to that same store from the
Nutrition tab, which is where `pullDelta` also lands.

So the fix copies that file's shape exactly: paint first, run the store writes and
`cancelSupplementReminder` in an un-awaited block, reconcile after.

## Two things the entry did not cover

**There is no haptic in this file.** The entry says to move "`applyOptimistic()` and the haptic"
above the `try`. None was added — that is new device behaviour on a surface used daily, with no way
to verify it from here, and the entry's phrasing reads as though one already existed.

**Painting first means failure has to undo it.** The old `catch` could stay silent and let the
checkbox "snap back" precisely because nothing had been painted yet. It now calls an explicit
`revertOptimistic()`, which hands back the same array `applyOptimistic` maps from — that array *is*
the pre-tap state.

## The guard is deliberately not released with the paint

Moving the writes off the await path has a consequence the entry does not mention: `setToggling(null)`
sat in a `finally` that would now run almost immediately, clearing the in-flight guard and re-opening
the double-tap window — the class that once turned five rapid taps into four `complete-workout`
POSTs. It now clears when the write settles. **What comes back instantly is the tick, not the ability
to tap again**, which is the right trade: the complaint was never that the row was briefly disabled.

## The guard test

The property is an **ordering**, and no assertion about rendered output could catch it — on an
uncontended store the old code looks fine, and contention is exactly what the sandbox cannot stage.
So `rv68-supplement-tick-paints-first.test.ts` asserts on the source: the paint precedes the first
`await`, the catch reverts, and the guard is released in a `finally` after the paint. 2 of its 3
assertions fail against `origin/main`; the third pins a premise that already held.

**Not exercised:** `getLocalStore()` returns null off the APK, so the contention was never reproduced
here — which is precisely why the entry named a device look as its verification, and why RV-68 keeps
its entry with `Verify: device` rather than being struck.
