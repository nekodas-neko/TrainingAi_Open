# 2026-08-05 — Q-64: voice logging never worked on the APK, for two stacked reasons

**Domain:** workouts · platform — v1.258.0, **native — needs the new APK**

The Voice button on the active set card turned itself off the instant it was pressed on the S25. No
transcript, no logged weight or reps. Two independent causes, both hit before any speech could be
recognised.

**1. `RECORD_AUDIO` was never declared in the Android manifest.** Capacitor's
`BridgeWebChromeClient.onPermissionRequest()` does intercept the WebView's `AUDIO_CAPTURE` request
and tries to runtime-request the permission — but Android silently fails a runtime request for a
permission the manifest doesn't declare, so `isGranted` came back false, the request was denied, and
`SpeechRecognition.start()` fired `onerror` in the same tick. `rec.onerror = () => setListening(false)`
flipped the button straight back to "Voice". That is the reported symptom exactly.

**2. Declaring it would not have been enough.** An embedded `android.webkit.WebView` — which is what
every Capacitor app runs — has no bundled continuous recognition service. `webkitSpeechRecognition`
exists on the object, which is why the button rendered at all, but it produces no transcript. This is
a longstanding WebView limitation, not a permission problem. `planned_upgrades.md` still lists voice
logging under the never-really-built Batch O remainder for this reason; the button was added later
without ever being tried against the real target.

## What shipped

- **Manifest:** `RECORD_AUDIO`, plus an Android 11+ `<queries>` intent for
  `android.speech.RecognitionService`. Without the latter, package-visibility filtering hides the
  recogniser and `SpeechRecognizer` reports "not available" even when one is installed — a second
  silent failure waiting behind the first.
- **Native path:** `@capacitor-community/speech-recognition@7.0.1`, which wraps Android's own
  `SpeechRecognizer`. Its peer range is `@capacitor/core >=7.0.0` and this repo is on `^8.3.4`, so the
  plan's "compatibility TBD against Capacitor 8" is resolved — the peer accepts it, and CI's Android
  job compiles it.
- **Visible failures.** Denied permission, no recogniser, nothing heard, and a transcript that parses
  to nothing each set their own message under the button. The old behaviour — silently flipping back
  to "Voice" — is indistinguishable from the bug being fixed, so it could not stay.
- **The web path is byte-identical.** It exists so `pnpm dev` renders, per the Canonical Runtime rule,
  and must never grow behaviour the device path lacks. Both transcript sources feed the same
  `parseVoice` → `clampVoiceLogResult` pipeline; only the source differs.

`VoiceLogButton` moved out of `set-card.tsx` into its own file (422 → 327 lines — that file is on the
CLAUDE.md hotspot list), and `parseVoice` moved to `components/workout/utils.ts` beside
`clampVoiceLogResult`, where it is testable as plain logic rather than trapped in a `.tsx`.

## Verification

**Web path, in a browser against `pnpm dev`:** drove a real workout to an active set card at the S25
viewport. The Voice button renders (so the extraction and the new `available` resolution work),
tapping it does not crash, and the screen stays put. Headless Chromium has `webkitSpeechRecognition`
on the object but no speech service, so it errors and reverts — the same behaviour as before this
change, which is the point. No page errors.

`parseVoice` gained six tests it never had while it lived inside the component: both word orders, the
`×`/`x` form, single values, fractional plates, and the empty case (it must return nothing rather than
guess — the caller now shows "Heard …" instead of logging a guess).

**NOT verified, and it is the actual fix:** whether Android's recogniser produces a usable transcript
on the S25. Nothing in the sandbox can test that — no microphone, no Android runtime, and the native
plugin resolves to null off-device.

**On-device smoke test:** open a set card mid-workout, tap Voice, grant the mic prompt, say "eighty
kilos five reps", confirm the dial and rep counter update. Tap it again without re-granting
(confirms the grant persists). Then deny the permission once and confirm it says "Microphone
permission denied" rather than going quiet. Only after that does this get marked verified — per
CLAUDE.md, never mark an issue fixed from intent.

## Found while verifying — filed as Q-80

The workout screen logs a CSP violation for **every** exercise GIF and image:
`Refused to connect to 'https://raw.githubusercontent.com/nekodas-neko/exercises-dataset/…'`.

That host is in `next.config.ts`'s `images.remotePatterns` with a comment naming it as the exercise
dataset, but it is in **neither `img-src` nor `connect-src`** in the CSP defined directly above —
confirmed against the production response header, not just locally. Impact is partial, which is
presumably why it went unnoticed: `getThumbnail` prefers a same-origin S3 proxy URL when one exists
and only falls back to the dataset URL otherwise, so exercises with an S3 GIF render and the rest
show nothing. Queued as Q-80 rather than fixed here, to keep this PR to one thing.
