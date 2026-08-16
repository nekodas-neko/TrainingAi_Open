# 2026-08-05 — Q-67: the scale's "listening" notification drops to IMPORTANCE_MIN

**Domain:** platform · devices — v1.257.3, **native — needs the new APK**

The owner reported (screenshot, 2026-08-03) that the scale's ongoing "Connected — listening for
weigh-ins" notification is noise. It carries nothing actionable, unlike "Weigh-in logged", which is
the event they actually want.

`ScaleBleService` runs `START_STICKY` and has been a persistent connection since 2026-08-01, so that
notification is effectively always up. Android requires *a* notification for a running foreground
service, so it cannot be removed — only made less intrusive.

## What changed

`IMPORTANCE_LOW` → `IMPORTANCE_MIN` on the ongoing-status channel: no status-bar icon, and the shade
entry collapses to the bottom. The four one-shot event channels — "Weigh-in logged", "Unusual
weigh-ins", "Body composition skipped", "Weigh-in not captured" — are untouched.

**The channel id had to change** (`scale-ble` → `scale-ble-v2`). `NotificationChannel` objects are
immutable once created and Android will not retroactively lower an existing channel's importance, so
on an upgraded install the old `IMPORTANCE_LOW` channel would have survived and nothing would have
changed. The old id is deleted on first run so it doesn't linger in notification settings as an
orphan the owner can still see and toggle.

## Not verified

Kotlin is compile-gated only in the sandbox (no Android SDK, Gradle download proxy-blocked) and this
is a notification-channel change, so nothing about it is observable without the APK. CI's
`android.yml` builds it; download `apk-latest` after merge.

**On-device check:** confirm the scale's ongoing notification no longer shows a status-bar icon and
sits collapsed at the bottom of the shade — One UI's `IMPORTANCE_MIN` treatment sometimes differs
from stock AOSP, so the actual behaviour is worth looking at rather than assuming. Then confirm
"Weigh-in logged" still shows normally after a real weigh-in, and that the scale still connects and
logs — this is a notification-only change, but the service must not have been disturbed.

## The sibling question, still open and deliberately unanswered

The plan's Task 2 flagged that the Oura ring and chest-strap services show the same persistent
"Connected" notification — visible in the same screenshot that reported this one — and said not to
change them without asking. That still stands.

It matters more now than when the plan was written: **v1.257.0's strap auto-retry restarts the
strap's foreground service roughly every 4 minutes while the app is foregrounded and the strap is
off**, because the native service exhausts its backoff ladder and stops, and the new tick restarts
it. So "Connecting to strap…" will cycle rather than sit still. That is the intended trade for
having the strap reconnect at all, but it makes the notification more noticeable, and quieting that
channel the same way is the obvious follow-up — if the owner wants it. The ring's "Connected · 37%
battery" line may genuinely be useful to them. Not guessing either way.
