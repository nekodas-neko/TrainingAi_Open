## 2026-07-27 — Run status-bar chip

Implements the "Run status-bar chip" cardio backlog item
(`docs/superpowers/plans/2026-07-27-cardio-run-status-chip.md`), per the owner's request: whatever a
run's actual goal is (a distance target, a duration target, or a freeform run with no plan) should
show up live in the Android status-bar pill, the same surface the lifting rest-timer chip already
uses.

### What shipped
- **`chooseRunChipMode`/`formatDistanceChipText`** (`lib/running/run-chip-text.ts`) — pure functions
  deciding which of the three chip modes applies to today's prescription, and formatting the
  distance-mode text. Confirmed by reading every `lib/running/frameworks/*.ts` file that only the
  `density-progression` ("Go further" / Endurance) framework ever sets a distance target — every
  other framework only prescribes a duration + HR-zone target, and no framework persists a pace
  target anywhere. No new goal-picking UI was needed — `PlanSetupSheet` already asks for the goal
  and a session-length baseline; this plan only makes the pill reflect what's already chosen there.
- **`lib/native/run-status-chip.ts`** — a JS bridge wrapper mirroring `lib/native/rest-timer-chip.ts`
  exactly in shape (bridge lookup, its own `ta_pref_run_chip` preference gate, no-op off-device),
  talking to a new `window.AndroidRunChip` bridge.
- **`RunChipBridge`** (`MainActivity.java`) — a new native chip on its own notification ID/channel
  (`RUN_CHIP_ID`/`run-status`), parallel to the existing `RestChipBridge`: a duration/elapsed
  chronometer mode (reuses the exact same countdown/count-up mechanism the rest chip already has)
  and a distance-mode static-text mode (re-posted by JS on each GPS fix — reliable here, unlike the
  rest chip's chronometer-only design, because `startGpsWatcher` already runs a real Android
  foreground service that keeps the WebView process alive during a run). Tapping the chip reopens
  the app to `/activity`.
- **`RunActiveScreen`** now starts/updates/stops the chip as `activity-store` state changes —
  (re)anchoring the duration-mode countdown on every pause/resume (since `accumulatedPauseMs` shifts
  the real finish instant forward), and re-posting the distance-mode text as distance/pace change.
- **A new "Run in Status Bar" preference toggle** (`components/more/profile-tab.tsx`), mirroring the
  existing "Rest Timer in Status Bar" one, defaulting on.

### Verification
- 7 new unit tests for `chooseRunChipMode`/`formatDistanceChipText` — full suite green (2221 tests).
- Manual/Playwright verification (web sandbox): injected an active-run state into
  `ta_activity_state` localStorage, confirmed `RunActiveScreen` renders correctly with the new chip
  effects wired in (no crashes, no new console errors — the only errors present were pre-existing,
  unrelated `/api/oura/sync` 401/400s from the local sandbox having no real Oura token). Confirmed
  the new "Run in Status Bar" preference row renders under "Rest Timer in Status Bar", toggles, and
  persists `ta_pref_run_chip` across a reload.
- No Android SDK/Gradle in this sandbox (proxy-blocked, per `CLAUDE.md`) — did a careful manual
  read-through of the native diff instead: confirmed brace balance across the whole file
  (`MainActivity.java`, 614 lines, depth returns to 0), and confirmed every `@JavascriptInterface`
  method signature in the new `RunChipBridge` matches exactly what `lib/native/run-status-chip.ts`
  calls (`startClock(String,String,String)`, `updateText(String,String)`, `stop()`), and that no
  existing rest-chip code was disturbed.
- **Not verified: the native chip itself, on-device.** This entire feature's actual payoff — the
  chip appearing in the Android status bar / One UI Now Bar during a real run — cannot be exercised
  in the web/dev sandbox at all. It needs an owner APK rebuild (`npx cap sync android && ./gradlew
  assembleDebug`) and an on-device smoke test per `CLAUDE.md`'s Canonical Runtime rule before it can
  be marked device-verified. Only the JS-side wiring (screen doesn't crash, prefs toggle persists)
  was exercised in-sandbox.
