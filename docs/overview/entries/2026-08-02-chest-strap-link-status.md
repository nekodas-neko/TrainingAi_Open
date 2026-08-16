# 2026-08-02 — the chest-strap card said "Connecting…" forever (Q-40)

**Branch:** `fix/chest-strap-link-status` · **Version:** 1.250.3 · Run-list item 4 of the
[batch queue drain](../../handoff-2026-08-02-platform-batch-queue-drain.md). Plan: Workstream E of
the [owner bug batch](../../superpowers/plans/2026-08-02-owner-bug-batch-sync-anchor-prescription-strap.md).

## What was wrong

Two faults that compounded into a label that could never be right.

**The label was derived from two booleans.** `gattConnected` (`nativeState === 'ready'`) and
`active` — and `active` is true from app start, because ambient mode runs all day. So every native
state that isn't `ready` — `idle`, `connecting`, `preparing`, `disconnected`, `closed`, `stopped` —
collapsed into "Connecting…", including a service that had already given up.

**The native service died silently.** `PolarStrapService.scheduleRetry()` calls `stopSelf()` after
exhausting its backoff ladder (~4 minutes) without emitting a final status, so the WebView held its
last-seen state forever. `onDestroy()` didn't emit either. Nothing was connecting, and the card kept
saying it was — permanently, with no recovery short of restarting the app.

## What shipped

`StrapLinkStatus` now carries the service's own `state`, typed as `PolarBleStatus['state']` —
reusing the plugin contract rather than declaring a second vocabulary that could drift. The
in-WebView fallback path has no state machine, so its one bit maps onto the same words and the label
function has a single input shape.

The label moved out of the component into `lib/live-hr/strap-link-label.ts` with seven tests. It now
distinguishes connecting from retrying from stopped, and a live link outranks a stale service state.

A **Connect** button appears on the card whenever the link is down. Before this the only way to
recover a strap the service had given up on was restarting the app.

On the Kotlin side, the service emits a final `stopped` status in both teardown paths — the
give-up branch in `scheduleRetry()` and `onDestroy()`. The give-up branch emits separately rather
than relying on `onDestroy()` because that is the state the card needs and the moment it needs it.

## Verified

- Seven unit tests over the label's full state matrix, including the two states the bug produced.
- `pnpm dev` at 412px, More → Profile: the card renders its unpaired "Pair a heart-rate strap"
  state and throws nothing. That is all the web build can show — it has no paired strap and no
  native plugin.
- Full suite green, lint and typecheck clean, custom rules pass.

## ⚠️ Not verified — and one honest gap

**The Kotlin change did not compile locally.** The sandbox has no Android SDK: `npx cap sync android`
succeeds, but `./gradlew compileDebugKotlin` fails with *"SDK location not found"*. This is the known
sandbox limitation, not a shortcut. **CI's Android job is the compile gate** — the workflow is
path-gated on `android/**`, which this PR touches, so it built the Kotlin and produced an APK.

**No part of the connected/retrying/stopped label has run against a real strap.** Those states are
device-only by construction. The E3 behaviour in particular — that the give-up path now announces
itself — can only be seen on the S25 after ~4 minutes with the strap out of range, and needs a new
APK because it is Kotlin. Both checks are on the owner checklist in the batch handoff, and a
`projectOverview.md` Known-Issues row says which surfaces were not exercised.
