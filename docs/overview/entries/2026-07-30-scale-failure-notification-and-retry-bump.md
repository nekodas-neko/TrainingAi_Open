## 2026-07-30 — Scale: failure notification, one more retry, and a reframed root-cause theory

Follow-up to #944, #947, and #948 (v1.246.6-1.246.7), all now device-verified. This session's goal
shifted from "does the fix work" to "how do we close out remaining gaps for a final iteration" —
the owner explicitly asked what else could make the flow more failure-proof before wrapping up.

### The theory got better, not just the fix
Re-reading the owner's actual test procedure (step on the scale → wait for its own display to say
"complete" → check the phone → nothing yet → step back on → *that's* when a reading landed) against
every capture so far revealed something the original theory missed: the scale's 11-byte handshake
frame has shown up in **100% of attempts**, success or failure alike. That means the notify-subscribe
was never the flaky part — it always works. What varies is whether a real reading follows it, and
the pattern points at a race: the scale's own local measurement cycle finishes faster than the
phone's full BLE pipeline (scan-detect → connect → discover services → subscribe → write the
request), so the request can go out after the person has already stepped off, with nothing new to
report.

### What shipped (`ScaleBleService.kt`)
1. `notifyWeighInFailed()` — a new low-priority notification ("Weigh-in not captured — step on the
   scale again") fires when a wake exhausts all attempts. Previously this path notified nothing at
   all — the "Retrying…" foreground notification just disappeared, so a failed weigh-in and a
   successful one looked identical from the notification shade unless you happened to be watching
   `chrome://inspect`.
2. `MAX_ATTEMPTS` bumped 2→3 (owner's explicit choice via a direct trade-off question — one more
   bounded ~8-30s retry cycle to catch a delayed re-engagement, accepting a longer worst-case wake
   before giving up), and the retry notification text changed from "Retrying…" to "Retrying — stay
   on the scale…" to reinforce the actual correct behavior given the race theory above.

### Testing
No Robolectric/instrumentation test infra exists for `ScaleBleService` (it's an `android.app.Service`
heavily coupled to `NotificationManager`/`Handler`/`SystemClock` — the project's only Kotlin unit
tests, `ScaleProtocolTest.kt`, cover pure-logic decoding on the plain JVM, no Android framework
deps). Adding Robolectric just to cover a retry-count/notification-text tweak was judged
disproportionate for this change's size — flagged rather than silently skipped. The existing
`ScaleProtocolTest.kt` suite is untouched and unaffected (no changes to `ScaleProtocol.kt` this
round). Real verification is the owner's on-device rebuild+retest, same as every native change this
session.

### Also raised, not implemented: scale-side history
Owner asked whether the scale buffers recent readings the way the official Renpho app appears to
show — `ScaleProtocol.kt`'s `FFE2_INDICATE` was flagged at the original integration as "never
observed firing... unused by this firmware revision as far as captured," a real clue but not
evidence of a working mechanism. Not guessed at or implemented — added as backlog Q-36
(`docs/implementation-backlog.md`) since confirming it needs a dedicated BLE capture of the official
app's own history pull, the same rigor as the original Phase 0 capture, not code written from
memory.

### Version bump
1.246.8 (patch — bug fix + small UX addition).

### Not yet confirmed
Compile-reviewed only — no Android SDK/Bluetooth hardware in this sandbox. Needs the owner to
rebuild and confirm: (1) the failure notification appears after a wake that exhausts all 3 attempts,
(2) the "Retrying — stay on the scale…" text reads correctly, (3) no regression to the already
device-verified success/retry paths from v1.246.7.
