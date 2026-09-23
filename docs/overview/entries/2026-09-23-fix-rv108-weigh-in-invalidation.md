# 2026-09-23 — RV-108: a weigh-in cleared 3 of 202 cached keys

**Branch:** `fix/rv108-weigh-in-invalidation` · **Lane:** B · one write path, one sweep, two queue calls

Measured on the S25: logging a weight cleared **3 of 202** cached keys. The sheet's local-store
branch ended at a bare `pushMutations`, and the only invalidation was the *consumer's* — which takes
its `invalidateReadinessInputs()` arm when `onSaved` receives a fresh row, so the body-metric keys
were never evicted at all. Recovery was TTL expiry.

The fix is the one the entry named: copy `water-log-sheet.tsx` exactly — `pushThenRevalidate(userId!,
invalidateBodyMetricWrite)` **and** an immediate `invalidateBodyMetricWrite().catch(() => {})`.

Both halves are load-bearing for different reasons. The immediate call repaints the device that
wrote the row; the post-push one covers what the server derives. An offline write's push never
resolves usefully, so a push-only invalidation repaints nothing.

## The sweep narrowed the fix rather than widening it

Every `pushMutations` call site in `app/`, `components/` and `lib/` was read. **Only this one had no
invalidation at all.** The rest are filed as LB-132, split by how wrong they are: two with no
invalidation in a different domain, five with the immediate half and no post-push half. Two more —
`more-content.tsx`'s pull-sync and `sync-health-card.tsx`'s failed-mutation retry — push without
writing and are correct as they stand.

**`log-value-sheet.tsx` was nearly "fixed" and must not be.** Home's quick-log writes the same
`body_metrics` domain through the same shape, and a ±10-line window around its push shows no
invalidation, so it reads as this defect byte-for-byte. It calls `invalidateBodyMetricWrite()` and
`invalidateReadinessInputs()` **39 lines later, inside the same `try`**. The patch was written and
its own assertion refused to match — patching it would have double-invalidated a correct file.

That is the third time in one day a fixed-line window produced a false finding: a three-line call
whose timezone argument sat on line 3, an over-count of unnamed switches labelled on the next line,
and now this. The baton lesson is widened accordingly — read the enclosing block, not a window.

## Two queue heads re-channelled, because both were blocked at their next action

Working top-down put DV-12 and RV-113 ahead of this, and neither is buildable by Lane B as it
stands. Both were left in `Lane: B` at the head of the queue, where every Lane B session pays to
rediscover that. CLAUDE.md's lane rule separates them cleanly:

- **DV-12 → `Lane: DV`.** Its own "Not established" line says the next step is a CPU profile of one
  tap to name the component that dominates. That is a measurement nobody has taken, with an
  objective output, on hardware only the device agent has. The fix will still be Lane B's.
- **RV-113 → `Lane: O` + `Gate: owner`.** Its two open questions "decide whether this is worth doing
  at all", and both are **looks** judgements on the app's most frequent interaction — is a 180 ms
  blink perceptible, does `bg-page` resolve transparent under the owner's wallpaper. The rule sends
  a feels-right judgement to the owner, not to the device agent. Building the one-line fix first
  risks changing a daily interaction he never asked to have changed.

**`check-backlog-pointers.js` caught a real defect in that edit**: `Gate: owner` written inline on
the `Lane:` bullet is ignored, so RV-113 would have stayed READY with a gate that did nothing. It
has its own bullet now, and the runner parks it.

## Not done, and not claimed

**`Verify: device` + `Keep:`** — log a weight on the S25 and confirm the surfaces reading
`body-metadata`, `day-log:` and `energy-balance:` move without waiting for TTL. The sandbox proves
the calls are present; it cannot watch 202 keys on a phone.

**Still not established, and it bounds LB-132's worth:** whether `pushMutations` → `pullDelta`
reliably fires `invalidateBiometrics` on the device that wrote the row. RV-108 left that open and
this PR does not close it.

Also not exercised: Samsung WebView rendering, native SQLite / Capacitor, drifted production data.
