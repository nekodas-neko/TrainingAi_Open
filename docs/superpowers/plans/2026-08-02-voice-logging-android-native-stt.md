# Voice Logging — Fix on the Canonical APK Target (Native STT)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The "Voice" button on the active-set card (`components/workout/set-card.tsx`) turns
itself off the instant it's pressed on the S25 APK — no transcript, no logged weight/reps. Root-
cause it and ship a fix that actually works on the canonical Android target, not just in a desktop
browser.

**Tech Stack:** Kotlin (Android manifest + a small native plugin), Capacitor 8, TypeScript/React
client. Touches `android/**` and `capacitor.config.ts` → **needs a new APK**, not just a Railway
deploy (see CLAUDE.md → Canonical Runtime → "Getting a new APK").

---

## Root cause

`VoiceLogButton` (`components/workout/set-card.tsx:53-105`) is a thin wrapper around the browser
**Web Speech API** (`window.SpeechRecognition`/`webkitSpeechRecognition`). Two independent problems,
both hit before any transcript is ever produced:

1. **`RECORD_AUDIO` is not declared in the Android manifest at all**
   (`android/app/src/main/java/com/trainingai/app/AndroidManifest.xml` — confirmed by grep, no
   match). Capacitor's own `BridgeWebChromeClient.onPermissionRequest()` (source:
   `@capacitor/android` `BridgeWebChromeClient.java:99-116`) *does* intercept the WebView's
   `AUDIO_CAPTURE` permission request and tries to runtime-request
   `Manifest.permission.RECORD_AUDIO` — but Android silently fails any runtime request for a
   permission the manifest never declared (`isGranted` comes back `false`). That flows straight into
   `request.deny()` → the page's `SpeechRecognition.start()` immediately fires `onerror` → this
   component's `rec.onerror = () => setListening(false)` (line 79) flips the button back to "Voice"
   in the same tick. This is the "press it and it turns off straight away" symptom, exactly.
2. **Even with the permission declared, Android's WebView does not reliably implement actual
   speech-to-text for `webkitSpeechRecognition`.** Unlike Chrome for Android, an embedded
   `android.webkit.WebView` (which is what every Capacitor app runs) has no bundled continuous
   recognition service — this is a longstanding, widely-documented WebView limitation, not
   something fixable from the manifest/permission side. `planned_upgrades.md` still lists "voice
   logging" under the unplanned/unbuilt Batch O remainder for this reason; the button in
   `set-card.tsx` was added later without ever being made to work against the real (WebView, not
   Chrome) target.

So: adding the manifest permission alone would very likely still not produce transcripts on-device
— it only fixes the instant-shutoff symptom, not real recognition. The correct fix for the canonical
APK target (per CLAUDE.md's Canonical Runtime policy — "when behaviour must diverge, the device
wins", and the AI/plugin-integration section — prefer native modules over an unreliable browser API)
is a **native Android speech-recognition plugin**, with the existing Web Speech API path kept
*only* as the logic-free `pnpm dev` fallback (same pattern as every other native-vs-web split in
this app: BLE, camera, geolocation).

---

## Fix

### Task 1: Declare the permission (cheap, necessary either way)

**Files:**
- Modify: `android/app/src/main/java/com/trainingai/app/AndroidManifest.xml`

- [ ] Add `<uses-permission android:name="android.permission.RECORD_AUDIO" />` next to the other
  runtime-permission declarations (near `CAMERA`). Without this, no speech path — native or
  web — can ever get microphone access in the APK.

### Task 2: Add a native speech-recognition plugin

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml` (new dependency)
- New/modify: Android native plugin registration (`MainActivity.java` or a dedicated
  `VoicePlugin.java`, following the existing pattern of `.oura`/`.scale`/`.polar` native services —
  a Capacitor plugin class, not a foreground service, since this only needs to run while the sheet
  is open)
- Modify: `capacitor.config.ts` if the chosen plugin needs config

- [ ] **Step 1:** Evaluate `@capacitor-community/speech-recognition` (uses Android's native
  `SpeechRecognizer`/`RecognizerIntent` — on-device or Google-app-backed, works inside WebView-hosted
  apps because it's a native Kotlin/Java plugin, not a page-level Web API) for Capacitor 8
  compatibility (this repo is on `@capacitor/core` `^8.3.4`) — confirm the installed version's peer
  range before adding it. If it's stale/incompatible, a small hand-rolled plugin wrapping
  `android.speech.SpeechRecognizer` directly is the fallback (same shape as the existing native
  plugins in `android/app/src/main/java/com/trainingai/app/`).
- [ ] **Step 2:** Wire the plugin's permission request (`SpeechRecognition.requestPermissions()` or
  equivalent) — this is a *runtime* prompt on top of the Task 1 manifest declaration, same two-step
  shape as Health Connect/camera in this app.
- [ ] **Step 3:** Confirm the plugin's recognition results arrive as a promise/callback the JS side
  can await — the existing `parseVoice(transcript)` parser in `set-card.tsx:12-42` stays as-is; only
  the transcript *source* changes.

### Task 3: Branch `VoiceLogButton` by runtime

**Files:**
- Modify: `components/workout/set-card.tsx`

- [ ] Detect native context the same way the rest of the app does (check for the existing
  Capacitor-native guard pattern used by other dynamic-imported native-only components — grep
  `Capacitor.isNativePlatform()` usage first rather than inventing a new check).
- [ ] **Native (APK):** call the new plugin's start/stop + result callback instead of
  `getSR()`/`webkitSpeechRecognition`.
- [ ] **Web (`pnpm dev` only):** keep the existing `webkitSpeechRecognition` path completely
  unchanged — it already correctly no-ops (`hasSR` guard, line 85-86) when the browser doesn't
  support it, and Canonical Runtime rules require the web fallback to stay logic-free. Don't add any
  new behavior to the web path.
- [ ] Keep `clampVoiceLogResult` (already used at the call site, `set-card.tsx:189`) as the single
  place weight/reps get sanity-bounded — both native and web transcripts flow through the same
  `parseVoice` + `clampVoiceLogResult` pipeline, only the raw-transcript source differs.

### Task 4: Verification

- [ ] `pnpm dev` — confirm the button still no-ops silently on a browser without
  `webkitSpeechRecognition` (e.g. confirm no crash), and still works as before on a browser that has
  it (Chrome desktop) — this path must not regress.
- [ ] **New APK required** (native manifest + plugin change) — build via CI
  (`.github/workflows/android.yml`, path-gated on `android/**`/`package.json`) and install on the
  S25 Ultra.
- [ ] **On-device smoke test (this is the actual bug fix — nothing above proves it):** open a set
  card mid-workout, tap Voice, grant the mic permission prompt if shown, speak "eighty kilos five
  reps", confirm the weight dial and rep counter update. Repeat once more without needing to
  re-grant permission (confirms the runtime grant persists). Test denying the permission once to
  confirm the button fails **visibly** (e.g. reverts to "Voice" without a silent freeze) rather than
  reproducing today's confusing instant-shutoff with no explanation.
- [ ] Mark this Known-Issue-verified only after the on-device step above actually ran — per CLAUDE.md
  "never mark an issue fixed from intent."

---

## Scope note

This plan deliberately does not touch: the `parseVoice` grammar/parser (already reasonably
tolerant), `clampVoiceLogResult` (already shipped, per the `docs/reviews/2026-07-10-workout-system-
review.md` UI-12 finding), or the AddedWeightToggle/RPE UI around the button. Those are unrelated to
why the button currently does nothing.
