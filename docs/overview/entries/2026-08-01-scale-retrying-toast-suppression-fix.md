# 2026-08-01 — Fix the scale toast reopening on a post-capture reconnect retry

Branch: `claude/bluetooth-scale-integration-jcuvs2` · v1.249.2

Owner rebuilt the APK after the #965–#974 catch-up (PR #975) and ran the first real on-device test
of the persistent-connection redesign via `chrome://inspect`. Findings from that log, and the fix
that came out of it.

## What the on-device log showed

- **The #974 duplicate-reading dedup works.** A weigh-in produced a stable reading (71.75 kg +
  impedance), and two repeat transmissions of that same frame were correctly logged as "ignored —
  scale repeated the same frame it already reported."
- **The stuck-toast fix was only half-effective.** After the successful capture, the scale
  disconnected on its own (`connectionStateChange status=19` — its normal post-weigh-in behavior).
  The background reconnect went through `ScaleGattClient.Listener.onFailure()`'s retry branch,
  which broadcasts `scaleStatus=retrying` to JS **unconditionally**. #974 added a
  `hasCapturedThisWake` suppression guard, but only to `onState()` (which handles
  CONNECTING/PREPARING/WAITING) — the `retrying` state is broadcast directly from `onFailure()`,
  a different call site the guard never touched. Result: the JS toast reopened as "Still trying —
  stay on the scale…" right after a successful weigh-in — the same user-visible bug #974 aimed to
  fix, just reached through a different code path with different wording.

## Fix

`android/app/src/main/java/com/trainingai/app/scale/ScaleBleService.kt` — `onFailure()`'s retry
branch now checks `!hasCapturedThisWake` before both the `scaleStatus=retrying` broadcast and the
paired "Retrying — stay on the scale…" foreground-notification update, mirroring the exact guard
`onState()` already had. When a reading was already captured this wake, a retry silently continues
in the background (the notification stays on whatever it already said, e.g. "Connected — listening
for weigh-ins") with no user-facing state change at all — matching the intent of the original #974
fix, now applied consistently across both places `retrying`/`waiting` reach JS.

## Verified

- **Not run in this session** — no JS/TS changed, only Kotlin + docs + changelog data. Kotlin is
  compile-gated only in the sandbox (no Android SDK); CI's "Android (Kotlin tests + debug APK)"
  check is the real compile gate.
- `projectOverview.md`'s scale Known-Issues row updated with the on-device findings and this fix.

## Not verified

- **This exact fix, on-device.** Needs another owner rebuild
  (`npx cap sync android && ./gradlew assembleDebug`) and the same back-to-back weigh-in test —
  confirm the toast now stays on the success state (or silently updates nothing) through the
  scale's post-capture disconnect/reconnect, instead of reopening as "Still trying…".
- Everything else flagged NOT-yet-device-confirmed in the #965–#974 catch-up entry (the #973
  Home-screen scoping path, and general persistent-connection behavior beyond this one bug) is
  still open — this session only chased the one bug the owner's log surfaced.
