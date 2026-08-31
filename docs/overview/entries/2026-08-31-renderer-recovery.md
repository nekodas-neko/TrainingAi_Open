# 2026-08-31 · Lane A — a dead WebView renderer is handled instead of fatal (BF-80)

Branch `lane-a/renderer-recovery`. **This one needs an APK** — it touches `android/**`, so unlike
the batch before it, merging is not the delivery.

## What the report was, and why nothing recorded it

The owner: *"when I tab out and tab back into the app the pages often crash and display a blank
page."* Screenshot: status bar, nav bar, nothing between them, **battery 10%**, another app
running. Production's `error_events` held three rows for the owner across three days and **none**
from a blank screen — and `app/error.tsx` exists, so a JS exception during render would have
painted a fallback and filed a row. The silence is the evidence: there is no JS left to throw, and
the reporter dies with the context it would have reported.

## The entry grepped `android/` for `RenderProcess` and found nothing. That was true and misleading.

Reading the pinned Capacitor 8.3.4 source settled it. `BridgeWebViewClient` **already overrides**
`onRenderProcessGone` and forwards it to every registered `WebViewListener` — so the app was never
missing a `WebViewClient`, which is why the grep came back empty while the behaviour persisted.
`WebViewListener`'s own default returns **`false`**, and false is the documented *"the app is
killed"* answer, not *"show nothing"*. The missing piece was a listener, and the behaviour it
replaces is worse than the symptom that was reported.

That is what makes this fix correct **whether or not the renderer-death hypothesis holds**: the
current answer to a dead renderer is process termination, and nothing wanted that.

## What shipped

- `RenderProcessRecovery.java` — returns `true`, stamps the death into SharedPreferences with
  `didCrash`, and **posts** `activity.recreate()`. Posted rather than called: the callback runs on
  the UI thread with the dying WebView on the stack, and `recreate()` tears that WebView down.
  `reload()` is not an option — a WebView whose renderer has gone is permanently unusable, so
  asking it to reload is asking a dead object to work.
- The **marker is the half that makes the hypothesis falsifiable.** The entry could only reason
  about the cause because nothing recorded it; SharedPreferences survives the recreate (the same
  store the ring key lives in), and `lib/renderer-recovery.ts` turns it into an `error_events` row
  on the next boot, via `window.AndroidRenderer`. `didCrash` separates a renderer crash from
  Android reclaiming it under memory pressure — different fixes, so it goes in the message rather
  than being flattened to "renderer died".
- `scripts/check-render-process-recovery.js` (Custom Rules, now **67**) fails on the listener
  going, on `return false`, on the `recreate` call going, or on the registration going. Any one of
  those silently restores the platform default. **Its first version passed a mutation that removed
  the recovery**, because the word `recreate` survived in the log line and a comment — it strips
  comments now, and looks for a call rather than the word.

## Not verified, and it cannot be here

**`Gate: device`.** Nothing about this runs in the sandbox: no Android SDK, and the JVM half is
compile-gated by CI only. The confirmation is on the S25 with a new APK — the app coming back
instead of showing nothing, and then the first `error_events` row reading `renderer reclaimed by
the system`. Until that row exists the diagnosis is still a hypothesis; what changed is that the
next occurrence leaves evidence instead of another blank screen.
