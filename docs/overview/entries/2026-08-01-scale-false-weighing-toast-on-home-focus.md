# 2026-08-01 — Fix false "Weighing you…" toast on every Home-tab visit

Branch: `claude/bluetooth-scale-integration-jcuvs2`

Owner confirmed the persistent-connection design (#972) is working — weigh-ins now succeed first
try consistently, matching the "holding a connection" theory. Immediately after, reported a new
symptom: the "Weighing you…" toast pops up every time they switch to the Home tab, even with
nobody on the scale.

## Root cause

Traced through `ScaleBlePlugin.setHomeScreenActive` and `ScaleBleService`: leaving Home stops the
persistent service outright (`context.stopService(...)`, added 2026-08-01 alongside the
persistent-connection redesign, to bound its now-unbounded battery cost to Home-screen dwell
time). Returning to Home re-arms the BLE scan, which can pick up the paired scale's advertisement
even with nobody on it — the scale keeps genuinely re-advertising for a while after real use as it
settles back to sleep (already documented, `GIVE_UP_COOLDOWN_MS`'s doc comment). That re-links the
service through a fresh CONNECTING → PREPARING → WAITING cycle, and `onState()`/`onFailure()`
broadcast all of those to JS unconditionally — there was no signal distinguishing "just
re-established the link" from "someone is actually standing on it right now".

Confirmed directly from the `chrome://inspect` log captured earlier this session (used for the
connect-latency writeup, PR #978): a connection linked at `16:24:08.887` sat completely idle for
**22 seconds** before the first real unstable reading arrived at `16:24:30.946` — the toast would
have been showing "Weighing you…" that entire time with nobody on the scale.

## Fix

`ScaleBleService.kt`: added `hasSeenActivityThisWake`, set only by `onUnstableReading` (the one
signal that's real proof — the scale is reporting live weight data, not just that a GATT link
exists). Gated on it:
- `onState()`'s CONNECTING/PREPARING/WAITING broadcast to JS (extends the existing
  `hasCapturedThisWake` guard rather than replacing it — both conditions suppress independently).
- `onFailure()`'s "retrying" broadcast + native notification text.
- `onCycleDeadline()`/`onFailure()`'s give-up-path `notifyWeighInFailed()` notification.

Also softened the initial foreground-service notification text from "Weigh-in detected —
connecting…" to "Scale nearby — connecting…", since at that point we only know the scale is
advertising, not that anyone's on it.

No JS changes — `capacitor-native-init.tsx`'s toast logic already keys off the `scaleStatus` event
shape unchanged; it now just receives far fewer (or no) spurious events for a stray re-link.

**Trade-off, accepted:** a genuine step-on whose connect attempt fails before ever receiving a real
weight packet (never reaches `onUnstableReading`) now also fails silently — no "Didn't catch that"
notification. There's no BLE evidence available to distinguish that narrow case from a spurious
Home-focus re-link, and the spurious case is the far more common one given how often the owner
navigates the app during testing.

## Verified

- **Not run this session** — Kotlin-only, compile-gated in the sandbox (no Android SDK). CI's
  "Android (Kotlin tests + debug APK)" check is the real compile gate.
- `projectOverview.md`'s scale Known-Issues entry updated with the finding and fix.

## Not verified

- **The whole fix, on-device.** Needs a rebuild, then: (1) repeated Home-tab navigation with
  nobody on the scale — should show nothing now; (2) a real weigh-in — should still show the
  toast, starting from the first unstable reading rather than bare connection state, which should
  be an imperceptible delay (well under a second in practice) rather than a noticeable one; (3) a
  step-on where the connect never succeeds — will now fail silently, worth confirming that's
  acceptable in practice rather than confusing ("I stepped on and nothing happened at all").
