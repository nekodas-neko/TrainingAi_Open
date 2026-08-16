# Rest-timer status-bar chip (Android 16 Live Update / promoted ongoing notification)

> **IMPLEMENTED 2026-07-14 (v1.145.0, session 292).** Built in-session at the owner's request.
> One deviation from the plan below: the native side is a lightweight **`AndroidRestChip`
> JavascriptInterface bridge added to `MainActivity.java`** (mirroring the existing
> `AndroidPip`/`AndroidScreen`/`AndroidMotion` UI bridges) rather than a standalone
> `RestTimerPlugin` Capacitor plugin — same design, less plumbing, and no plugin registration.
> Everything else (OS-ticked chronometer anchored to `lastSetRestStartMs`, `setTimeoutAfter`
> self-clear, tap deep-link, guarded no-op JS bridge, Preferences toggle) landed as specified.
> Chunk 5 (ProgressStyle expanded view + count-up overtime state) was deliberately **not** built
> — the chip auto-clears at the rest boundary instead. **Native half is NOT device-verified**
> (sandbox has no Android SDK); needs an owner APK rebuild + the on-device smoke run.


**Owner directive (2026-07-14):** when a rest timer is running, show a live countdown
in the Android status-bar pill (next to the clock) — the same chip the system Clock app
and YouTube Music use. The owner's device is a **Samsung S25 Ultra on Android 16 / One UI
8.5**, so the real chip (not just a shade notification) is available. Primary value: a
glanceable rest countdown while the phone is on another app, and a **one-tap way back into
the workout** — tapping the chip re-opens TrainingAI on the active-workout screen.

## Goal

While `workoutPhase === 'rest'` during an active workout, post an **Android 16 promoted
ongoing notification** whose status-bar chip shows the rest countdown ticking down (e.g.
`⏳ 01:23`). Tapping it deep-links back into the running workout. It clears the instant the
rest ends (set started, rest skipped, exercise/workout finished, or workout left).

## Non-goals

- No iOS Live Activity (this app's only supported runtime is the Android APK — Canonical
  Runtime policy). Android only.
- No new server/DB work. This is entirely on-device: native Kotlin + a thin JS bridge.
- Not a general notifications framework — one purpose-built chip for the rest timer.

---

## How the Android 16 chip actually works (verified against the platform docs)

Source: [Create live update notifications (Views)](https://developer.android.com/develop/ui/views/notifications/live-update)
and [Progress-centric notifications](https://developer.android.com/about/versions/16/features/progress-centric-notifications).
A notification is "promoted" to the status-bar chip / Now Bar only when **all** of these hold:

- Manifest permission **`android.permission.POST_PROMOTED_NOTIFICATIONS`** (plus the normal
  runtime `POST_NOTIFICATIONS` on Android 13+).
- Built with `Notification.Builder.setRequestPromotedOngoing(true)` (or the
  `EXTRA_REQUEST_PROMOTED_ONGOING` extra).
- `setOngoing(true)` and a non-empty `setContentTitle(...)`.
- One of the allowed styles: **Standard**, `BigTextStyle`, `CallStyle`, **`ProgressStyle`**,
  or `MetricStyle`. **No** custom `RemoteViews`, **not** a group summary, **not** `setColorized(true)`.
- The system still decides — apps *request*, the OS promotes. Query support with
  `Notification.hasPromotableCharacteristics()` and `NotificationManager.canPostPromotedNotifications()`;
  the user can revoke via `Settings.ACTION_MANAGE_APP_PROMOTED_NOTIFICATIONS`.

**What the chip displays** (max ~96dp): `setShortCriticalText(...)` wins if set; otherwise it
falls back to `setWhen(finishTimeMs)` with `setUsesChronometer(true)` + `setChronometerCountDown(true)`.

### The key architectural insight — let the OS tick, don't tick from JS

The rest timer today lives in the WebView (`active-workout-screen.tsx`, computed from
`restStartMs`/`currentRestSec`). **WebView JS is throttled/suspended when the app is
backgrounded**, which is exactly when the chip matters — so JS cannot reliably re-post a
new value every second. The fix is to post **one** notification with the rest **finish
timestamp** and let the OS render the ticking chronometer:

```
setWhen(restStartMs + currentRestSec * 1000)
setUsesChronometer(true)
setChronometerCountDown(true)
```

This matches the screenshot exactly (an auto-ticking `MM:SS`) with **zero** per-second work
from us. JS only fires three discrete events: **start**, **stop**, and (rarely) **update**
(e.g. superset rest handoff changes the target). We deliberately avoid `setShortCriticalText`
for the countdown because it would require a re-post every second — the whole point is to
avoid that. `setShortCriticalText` is reserved for the fixed-string overtime state (below).

---

## Architecture

A small dedicated Capacitor plugin, modelled on the existing `OuraBlePlugin` /
`OuraRingService` pair (`android/app/src/main/java/com/trainingai/app/oura/`), but **much
simpler — no foreground service and no BLE**. Just post/update/cancel a notification.

```
active-workout-screen.tsx / workout-store.ts   (rest phase transitions)
        │  guarded dynamic import (Capacitor plugin pattern, try/catch)
        ▼
lib/native/rest-timer-chip.ts   (thin JS wrapper: start/stop/update, no-op off-device)
        │  Capacitor bridge
        ▼
RestTimerPlugin.kt   @PluginMethod start / stop / update
        │
        ▼
NotificationManager.notify(REST_CHIP_ID, promotedOngoingNotification)
        │  tap → PendingIntent → MainActivity (deep-link back to workout)
        ▼
Android 16 Now Bar chip  ⏳ 01:23  (OS ticks the chronometer)
```

Why **no foreground service**: a promoted notification is just a posted notification; it
does not need a service to survive the app backgrounding, and the OS ticks the chronometer
itself. Adding a foreground service here would be dead weight and another failure point.
(Zombie-notification safety is handled by `setTimeoutAfter` — see risks.)

---

## Implementation chunks

### Chunk 1 — Native `RestTimerPlugin` (Kotlin) — the whole feature lives here

New file `android/app/src/main/java/com/trainingai/app/RestTimerPlugin.kt`
(`@CapacitorPlugin(name = "RestTimer")`, modelled on `OuraBlePlugin`). Methods:

- **`start({ durationSec: number, finishAtMs: number, label: string })`** — build and
  `notify(REST_CHIP_ID, …)` the promoted ongoing notification:
  - channel `rest-timer` (create once, `IMPORTANCE_LOW` so no sound/heads-up — the chip is
    the point, not an alert), a small monochrome timer icon (add a vector drawable — do
    **not** reuse the BLE bluetooth glyph).
  - `setContentTitle(label)` (e.g. the exercise name — "Rest · Bench Press"),
    `setContentText("Rest")`, `setOngoing(true)`, `setRequestPromotedOngoing(true)`.
  - **Chip countdown:** `setWhen(finishAtMs)` + `setUsesChronometer(true)` +
    `setChronometerCountDown(true)`. Pass `finishAtMs` from JS (`restStartMs + currentRestSec*1000`)
    so it's anchored to the same clock the on-screen ring uses — no native/JS drift.
  - `setTimeoutAfter(durationSec*1000 + OVERTIME_GRACE_MS)` so a missed `stop` (process
    death, force-quit) self-clears instead of stranding a zombie chip.
  - **Tap intent:** `PendingIntent` (FLAG_IMMUTABLE) to `MainActivity` with an extra
    (`open=workout`) so the WebView routes to the active-workout screen — this is the
    "easy way back into the app" requirement.
- **`update({ finishAtMs, label })`** — re-`notify` the same `REST_CHIP_ID` with a new
  anchor/label. Used only on superset rest handoff or a mid-rest target change (rare).
- **`stop()`** — `cancel(REST_CHIP_ID)`.
- **`isPromotable()`** — return `canPostPromotedNotifications()` + Android version, for the
  JS permission-UX chunk. On < Android 16 return `promotable: false`.

**Graceful degradation:** on API < 36 (Android 16), skip `setRequestPromotedOngoing` and just
post a **plain ongoing chronometer notification** — no status-bar chip, but a live-ticking
countdown still shows in the shade + lock screen. Same builder path, guarded by
`Build.VERSION.SDK_INT >= 36`.

### Chunk 2 — Manifest + registration

- Add `<uses-permission android:name="android.permission.POST_PROMOTED_NOTIFICATIONS"/>`
  to `android/app/src/main/AndroidManifest.xml` (confirm `POST_NOTIFICATIONS` is already
  declared for Android 13+).
- `registerPlugin(com.trainingai.app.RestTimerPlugin.class)` in `MainActivity.java` (next to
  the existing `OuraBlePlugin` registration at line ~167).
- Handle the `open=workout` intent extra in `MainActivity` (route the WebView), matching how
  the app already handles deep-links.

### Chunk 3 — JS bridge + wiring into the rest lifecycle

- New `lib/native/rest-timer-chip.ts`: guarded dynamic `import` of the plugin inside
  try/catch (the CLAUDE.md Capacitor-import pattern), exposing `startRestChip`,
  `stopRestChip`, `updateRestChip`. **No-op** when the plugin is absent (web/dev sandbox),
  so `pnpm dev` is unaffected.
- Wire the three events at the single source of truth for the rest phase —
  `lib/stores/workout-store.ts` and `components/workout/active-workout-screen.tsx`:
  - **start** when the phase becomes `'rest'` with a real anchor (a set was logged →
    `lastSetRestStartMs` set, `currentRestSec` known). Pass
    `finishAtMs = lastSetRestStartMs + currentRestSec*1000`.
  - **stop** when `setWorkoutPhase('set')` fires (Start pressed / rest skipped), when the
    exercise-summary/done modes are entered, and on leave-workout (confirm-leave dialog) —
    grep every `setWorkoutPhase`/mode transition so no exit path is missed (sibling-surface
    sweep).
  - **update** on superset rest handoff, where `restStartMs`/`currentRestSec` change without
    passing through `'set'`.
  - All calls are **fire-and-forget** (no `await` blocking the UI) — the on-screen ring stays
    the source of truth; the chip is a mirror.

### Chunk 4 — Permission & discoverability UX

- On first rest of a session (or in Settings), ensure runtime `POST_NOTIFICATIONS` is
  granted (Android 13+); if denied, the chip silently no-ops (never block the workout).
- Add a **Settings toggle** "Rest timer in status bar" (default **on**) so the owner can
  disable it; when on but `canPostPromotedNotifications()` is false, show a one-line hint
  linking to `Settings.ACTION_MANAGE_APP_PROMOTED_NOTIFICATIONS`.
- Follow existing settings patterns; no new persisted-store transient-state pitfalls (it's a
  durable boolean, so exclude nothing special — just a normal setting).

### Chunk 5 (optional, phase 2) — richer expanded view + overtime state

- Use `Notification.ProgressStyle` for the **expanded** drawer view (a progress bar that
  fills as rest elapses). Note the bar itself won't self-advance (needs a re-post), so keep
  it coarse or accept a static bar — the **chip** stays the auto-ticking chronometer.
- **Overtime:** when rest passes target, the on-screen UI flips to "Overtime" counting up.
  For the chip, switch to `setShortCriticalText("Go")` (or a count-*up* chronometer:
  `setChronometerCountDown(false)` anchored at target) so it reads "rest's over, back to it"
  rather than sitting at `00:00`. Decide the exact copy with the owner during implementation.

---

## Edge cases & risks

- **Zombie chip after force-quit / process death** — a posted notification survives the
  process. Mitigated by `setTimeoutAfter(duration + grace)`; also cancel on app resume if no
  rest is active (defensive re-sync from the store on `MainActivity` resume).
- **WebView JS throttling in background** — the reason the OS must own the tick (design
  above). Do not attempt per-second re-posts.
- **Clock drift** — anchor the chip to the *same* `restStartMs` the on-screen ring uses, not
  a fresh native `System.currentTimeMillis()`, or the chip and the in-app ring disagree.
- **Superset rest handoff** — `restStartMs` vs the buffered per-exercise anchor is a known
  footgun (see the comments at `active-workout-screen.tsx:37`); use the same `lastSetRestStartMs`
  the ring reads, via `update`, not a second computation.
- **Rapid set logging / double-fire** — `notify` on a stable `REST_CHIP_ID` is idempotent
  (re-posts replace), so repeated starts just re-anchor; no guard needed, but `stop` must be
  cheap and safe to call when nothing is posted.
- **Battery** — negligible: a handful of `notify`/`cancel` calls per workout, OS-rendered
  chronometer, no service, no wakelocks, no polling.
- **Notifications globally disabled** — chip no-ops; workout unaffected. Never a hard dependency.

---

## Verification (device-only — state this plainly)

- **This is APK-only, native-heavy.** The sandbox has no Android SDK and the Gradle download
  is proxy-blocked, so the implementer can **compile-gate the Kotlin only** and cannot run
  it. `pnpm dev` still passes (the JS bridge no-ops off-device) but proves **nothing** about
  the chip — green `pnpm dev` is necessary, not sufficient (Canonical Runtime).
- **Real verification requires an owner APK rebuild** (`npx cap sync android &&
  ./gradlew assembleDebug`) and the on-device smoke run: start a workout → log a set → home
  out → confirm the chip ticks down next to the clock → tap it → land back on the workout →
  start the next set → confirm the chip clears. Plus: rest overtime state, force-quit
  mid-rest (chip self-clears within grace), notifications-denied path.
- Until that runs, the implementing PR ships a **Known-Issues row in `projectOverview.md`**
  marking the chip **not-yet-device-verified**, per the device-verification gate.

## Files touched (implementation PR)

| File | Change |
|---|---|
| `android/app/src/main/java/com/trainingai/app/RestTimerPlugin.kt` | **new** — the whole native feature |
| `android/app/src/main/res/drawable/ic_rest_timer.xml` | **new** — monochrome chip icon |
| `android/app/src/main/AndroidManifest.xml` | add `POST_PROMOTED_NOTIFICATIONS` |
| `android/app/src/main/java/com/trainingai/app/MainActivity.java` | register plugin + handle `open=workout` intent |
| `lib/native/rest-timer-chip.ts` | **new** — guarded JS bridge (no-op off-device) |
| `lib/stores/workout-store.ts`, `components/workout/active-workout-screen.tsx` | fire start/stop/update at rest transitions |
| Settings screen | "Rest timer in status bar" toggle (Chunk 4) |
| `projectOverview.md` | Known-Issues (not-device-verified) + roadmap tick |

## Rollout

User-visible feature → **minor** version bump in `package.json` + a `lib/changelog.ts` entry
in the implementation PR. Native half needs the owner rebuild; JS half is inert until then,
so it's safe to merge ahead of the rebuild.
