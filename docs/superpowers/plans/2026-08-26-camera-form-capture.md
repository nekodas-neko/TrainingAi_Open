# Camera form capture — on-device pose, stick-figure playback, summary-only sync

**Status:** design proposed 2026-08-26 from an owner conversation. Nothing implemented, nothing
measured on device. **Phase 0 is a feasibility gate and everything after it is conditional on that
number.**
**Backlog entry:** PS-7 (Phase 0 spike only — later phases are not queued yet, on purpose).
**Domain:** [`workouts`](../../domains/workouts/README.md) · [`devices`](../../domains/devices/README.md)

Point the phone at yourself from a tripod, and the app turns the set into a stick-figure animation
plus a set of numbers about how you moved. The camera frames never leave the device and are never
written to disk. The animation lives on the phone for a rolling window; only a small numeric summary
reaches Railway.

---

## 1. The owner's requirements, verbatim in effect

From the conversation on 2026-08-26, these are constraints, not preferences:

1. **Stored on device, not on Railway.** Railway keeps a summary only.
2. **Review the last 7–14 days** of workouts as stick-figure animations.
3. **Tap "start set" → the camera screen comes up**, live stick-figure overlay, phone on a tripod
   further back. Cues tell you when to move on. After the set you walk back, complete the set, and
   go into rest as normal.
4. **Ideally driven from a watch**, so the phone stays on the tripod and never has to be touched.
5. Storage cheap, security concerns minimal.

Requirements 1–3 are what this plan builds. Requirement 4 is costed in §9 and **recommended
against for this feature** — the camera solves the same problem for free, and the watch is a second
supported runtime.

---

## 2. Why the privacy property is free

This is the part worth being precise about, because it is the reason the feature is worth building
at all.

Pose estimation is not "send video to an AI". It is a ~4 MB convolutional model that runs on the
phone. A frame goes in, 33 landmark coordinates come out, the frame is discarded. There is no
round-trip and nothing to intercept.

So the trust boundary looks like this, and each line is a hard rule for the implementation:

| Layer | What exists there | Where it goes |
|---|---|---|
| Camera frames | `MediaStream` video frames, in RAM | **Nowhere.** Consumed by the landmarker, discarded. Never `MediaRecorder`, never a blob, never a file, never a network call. |
| Landmark series | ~17 landmarks × N frames, packed binary | **Device SQLite only.** Rolling window, never synced, no outbox domain. |
| Per-set summary | Angles, tempo, ROM, bar-path drift — numbers | Postgres, `user_id`-scoped, like every other metric. |
| AI coach input | A sentence of numbers | Gemini. No landmarks, no images, ever. |

**Two rules that must survive future sessions**, because both are the kind of thing a later change
makes look reasonable:

- **Never add a "save the video" option without treating it as a separate decision.** The moment a
  frame reaches disk, every claim on this page stops being true and the Play Store data-safety
  answer changes from "no video collected" to something that needs a consent flow.
- **Never send landmarks to a multimodal model.** A skeleton is still a recording of a person's
  body. The coach gets prose derived from numbers computed in our own code — see §6.

Two consequences worth stating outright:

- **Bystanders in a commercial gym are not a data problem here.** MediaPipe's Pose Landmarker tracks
  one person by default, and no frame is retained regardless, so nobody in the background leaves a
  trace. This is also the honest answer if a gym asks about a filming policy: nothing is being
  filmed.
- **The Play Store data-safety declaration stays clean.** Camera permission is declared; video
  collection is "no"; sharing is "no". That is a strong position and it is worth protecting, given
  the Health Connect declared-use-case review already gates real multi-user support
  (see CLAUDE.md, Canonical Runtime).

---

## 3. What already exists in this repo that this leans on

Nothing here is a from-scratch capability:

| Needed | Already present |
|---|---|
| WASM inference in the WebView | `onnxruntime-web` is a dependency with a node↔web parity test; `'wasm-unsafe-eval'` is in the CSP on purpose (Q-546) so WASM sessions can start |
| Camera permission | `android.permission.CAMERA` already in `AndroidManifest.xml` (the meal scanner uses it) |
| Native plugin pattern | Four Kotlin Capacitor plugins to copy — `OuraBlePlugin`, `ScaleBlePlugin`, `PolarBlePlugin`, `MediaSavePlugin` |
| Packed-blob storage precedent | `oura_raw_packed` — packing took `oura_raw_samples` from 563 MB to 50 MB |
| Device-local rolling window precedent | The Oura 14-day local raw window (owner decision, 2026-08-02): raw frames are input to a rollup, not an archive |
| Save an image to the gallery | `MediaSavePlugin.saveImage` — for an export-a-clip button later |
| Voice input | `@capacitor-community/speech-recognition` is already a dependency |

---

## 4. Architecture

### 4.1 Where the model runs — WebView first, native only if it has to be

**Recommendation: `@mediapipe/tasks-vision` (BlazePose) in the WebView, WASM + WebGL delegate.**

The alternative is a native Kotlin plugin wrapping CameraX + `com.google.mediapipe:tasks-vision`.
It would be faster, would keep frames out of the WebView entirely, and gives real control over
frame rate and the NNAPI/GPU delegate. It is the better end state if the JS path is too slow.

It is the wrong *first* move because of the repo's own delivery asymmetry: JS ships through Railway
into the WebView with no APK rebuild, native does not. Phases 1–4 below are all capture UI, storage
model, rep detection, playback and metrics — none of which the choice of capture layer changes.
Building them behind an APK cycle per iteration would cost more than the frame rate is worth. If
Phase 0 says the WASM path can't hold ~15 fps, swapping in a native capture layer replaces one
module and leaves everything downstream identical.

**Reversal cost: low.** The interface is "a callback that receives 17 landmarks and a timestamp".
Both implementations satisfy it.

A pose model via `onnxruntime-web` was considered and rejected: MediaPipe's pipeline is more than
the raw model (person detector → tracker → landmarker, with temporal smoothing), and re-implementing
that to reuse a runtime we already ship is a bad trade.

### 4.2 Two things Phase 0 must confirm, because both are silent failures

- **The MediaPipe assets must be self-hosted.** The documented setup is
  `FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm")`, and
  the CSP is `connect-src 'self' …` with no jsdelivr — so the default path is CSP-blocked. The WASM
  bundle and the `.task` model (~9 MB for `pose_landmarker_full`) get served from our own origin and
  added to the service worker's precache, which is also what makes the feature work offline.
- **`worker-src` is not in the CSP**, so it falls back through `child-src` to `default-src 'self'`.
  MediaPipe may spawn a blob-URL worker. If it does, the CSP needs `worker-src 'self' blob:` — a
  one-line change, but it fails invisibly (no session starts, no obvious error), which is exactly
  the shape of the bug Q-546 already was.

### 4.3 The capture state machine — this is what replaces running back to the phone

The owner's flow has a hole in it: you tap "start set", walk to the bar, do the set, then walk back
to stop it. The camera removes the first half of that, because the pipeline is already watching you.

```
armed        camera on, skeleton overlay live, framing guide drawn
             ↓ full body in frame AND still for ≥1.5 s
ready        big countdown, audible cue — readable/hearable from 3 m
             ↓ motion exceeds threshold
recording    landmarks buffered, live rep count in very large type
             ↓ N reps then stillness ≥4 s, OR the user leaves frame
complete     auto-stop, buffer kept, summary drawn on screen
             ↓ user walks back
confirm      reps/weight prefilled from detection, user adjusts, → rest
```

Everything on the `armed → complete` path is hands-free. The only touch is the confirm at the end,
which happens while you are walking back anyway.

**Design constraints that follow from the phone being 3 m away:**
- The rep count and state must be legible at 3 m — that means display type far larger than anything
  else in the app, and state carried by colour *and* shape (the repo's colour-only-state rule).
- Audible and haptic cues, because you will not be looking at the phone mid-rep.
- A wake lock during `armed`/`recording`, and a dimmed high-contrast mode so an unattended phone in
  a commercial gym is not showing your whole workout to the room.

**Camera runs only inside the `armed → complete` window, never during rest.** Continuous GPU
inference for a 60-minute session is a thermal and battery problem; ~8 minutes of it is not. This
has to be designed in from the start, not retrofitted.

### 4.4 Storage — the numbers

Landmark keep-list: shoulders, elbows, wrists, hips, knees, ankles, heels, foot-index, nose ≈ **17
landmarks**. The face mesh points are useless for a squat.

Per frame: 17 × (x:int16, y:int16, visibility:uint8) = **85 bytes**. Normalised coordinates
quantised to int16 is far more precision than a 1080p frame carries, so this loses nothing.

| | Raw | After delta-encode + deflate (est.) |
|---|---|---|
| 40 s set @ 15 fps (600 frames) | ~51 KB | ~12–15 KB |
| Session, 25 sets | ~1.3 MB | ~350 KB |
| 14-day window, 8 sessions | **~10 MB** | ~3 MB |

Human motion is smooth and strongly autocorrelated, so the compression estimate is conservative.
Either way a 14-day local window is nothing on a phone — **recommend 14 days, matching the Oura
local window**, and prune on the same schedule.

**Postgres side: one row per set, not per rep.** A session of 25 sets × 8 reps is 200 reps; 200 rows
per session is row growth for no benefit, and the per-rep detail is only ever read together.

```
set_form_metrics                     -- one row per set_logs row
  set_log_id      uuid   FK, unique
  user_id         uuid                -- scoped like every other write
  reps_detected   smallint
  rom_mean        real                 -- primary joint range, degrees
  rom_worst_rep   real
  concentric_ms   smallint             -- mean
  eccentric_ms    smallint
  bar_drift_mm    smallint             -- horizontal deviation, wrist midpoint
  tempo_cv        real                 -- rep-to-rep consistency
  confidence      real                 -- mean landmark visibility; gates display
  reps            jsonb                -- per-rep detail, ~12 numbers each
  captured_at     timestamptz
```

~1 KB/set with the JSONB, so ~25 KB per session, ~100 KB/week, **~5 MB/year**. Against a database
growing 0.4 MB/day (≈146 MB/year, 171 MB total at the 2026-08-18 baseline) that is about a 3%
increase in growth rate. Acceptable, and small enough that the session-start DB-size read will not
notice it — but it is a real number and it should be quoted in the PR that ships it.

**No keypoints in Postgres. No outbox domain for the landmark table. Ever.** The local table is
deliberately outside the sync engine.

### 4.5 What is lost, and why that is the right trade

Device-local means **an uninstall or a device wipe destroys every animation**. The repo already has
a scar from this class (the Oura ring key in SharedPreferences), so it gets stated rather than
discovered:

- The **summary survives** — it is on the server, `user_id`-scoped, backed up with everything else.
  Trends, comparisons and coach input are permanent.
- The **animation does not.** Losing a 14-day window of stick figures is an inconvenience, not data
  loss, which is exactly why the split is drawn here.
- The APK signing keystore secret (`ANDROID_DEBUG_KEYSTORE_B64`) is what keeps in-place upgrades
  working, so a routine APK update does not touch the local store. Only an uninstall does.

### 4.6 Playback

Render the stick figure on a `<canvas>` from the stored landmark series at view time. Do not
generate a GIF.

A GIF would be a frozen, larger, worse copy of data already held: canvas playback scrubs, can
overlay two sets from different weeks to show a change, can re-render better when the metrics
improve, and costs nothing extra to store. `MediaSavePlugin.saveImage` is there if a share-to-gallery
export is wanted later — it would render client-side from the same series.

The 7/14-day review surface is a list of recent sets, each opening a scrubbable animation with the
bar path traced over it and the per-rep numbers beside it.

---

## 5. The movement analysis — deterministic code, not a model

### 5.1 Bar path is two landmarks

You do not detect the barbell. On any barbell lift the hands do not move on the bar, so **the
midpoint of the two wrist landmarks is the bar**. One subtraction. Object detection would only be
needed for a trap bar or a lift where the hands are occluded, and neither is worth building for.

### 5.2 Rep counting is signal processing

Pick the driving joint per exercise (hip-y for a squat, wrist-y for a press), smooth it, then detect
peaks and valleys with a hysteresis band and a minimum-rep-duration guard. Roughly 60 lines,
deterministic, and debuggable against a stored series — which matters, because a rep counter that is
occasionally wrong is worse than none.

### 5.3 Joint angles are `atan2` over three points

Knee angle from hip–knee–ankle, hip angle from shoulder–hip–knee, elbow from shoulder–elbow–wrist.

**All of this lives in `packages/shared/`** under One Formula, One Place, with captured landmark
series as test fixtures. None of it may be duplicated client-side. It also keeps the feature on the
right side of the rule that no LLM-reported number gates an action or is displayed as fact.

### 5.4 "Form quality" — relative, never absolute

An absolute score needs calibration for limb proportions *and* camera angle, and any fixed threshold
will be wrong for most bodies. The honest v1 compares a set against **your own** previous sets of the
same lift:

- Good: *"Rep 7's knee angle drifted 12° from your first three."*
- Good: *"Bar drifted 4 cm forward on the last rep, 1 cm on the first."*
- Not shippable: *"Your squat is 78/100."*

Gate every metric on the landmark visibility scores. An occluded hip must produce "not measurable",
never a confident number.

### 5.5 The constraints a single camera actually imposes

- **2D.** BlazePose emits world landmarks in metres, but monocular depth is a hint. Treat it as one.
- **Side-on** for squat, deadlift, bench and overhead press — the sagittal plane is where the cues
  live. **Front-on** for knee valgus and bar tilt. The app should say which, per exercise.
- **The phone must not move.** If it moves, the bar path you draw is the phone's path. Detect camera
  motion from the static background and invalidate the set rather than storing a lie.
- **Occlusion is the real enemy** — a rack upright, a bench, a plate across the hip.

---

## 6. What the coach receives

Text. For example:

> Back squat, 5 reps @ 100 kg. Hip below knee on reps 1–3, not on 4–5. Mean concentric 1.4 s,
> rep 5 at 2.9 s. Bar forward drift 4 cm on rep 5 against 1 cm on rep 1.

No frames, no landmarks, no image. That is a smaller and far less identifying payload than the meal
photos that already go to Gemini today. Prose routes import `PROSE_GUARDS`, so the model quotes the
given numbers and does not invent superlatives about them.

---

## 7. The risk that actually kills features like this

Not the model quality — the ritual. It only works if the phone gets placed correctly, side-on,
unmoving, whole body in frame, every session. That is a behaviour change in the middle of a workout,
under fatigue.

So the framing flow gets prototyped **as early as the metrics, not after**: an on-screen guide
showing where to stand, a "you're fully in frame" confirmation, a remembered per-exercise camera
position, and a refusal to record when the framing is wrong rather than recording something
unusable. If Phase 1 shows the setup is annoying, that is a reason to stop, and it is cheaper to
learn there than after Phase 3.

---

## 8. Phases

Each is independently useful and each ends somewhere it is sane to stop.

**Phase 0 — feasibility spike (PS-7, the only queued entry).** `getUserMedia` in the APK WebView
plus a self-hosted MediaPipe landmarker on a live preview. Measure sustained fps at 720p and 1080p
on the S25, confirm the CSP lets the WASM session and its worker start, confirm the model loads from
the service worker cache with the network off, and watch the thermals over ~10 minutes of continuous
inference. Output is a number and a go/no-go. `Gate: device` — the sandbox cannot answer any part of
this.

**Phase 1 — capture UI.** Framing guide, live skeleton overlay, the §4.3 state machine, cues sized
and timed for 3 m. Landmarks held in memory and discarded at the end of the set. No storage, no
metrics. This is the phase that tells you whether the ritual is tolerable.

**Phase 2 — storage and playback.** Packing, local SQLite table (**v30**; register it in
`RECONCILE_TABLES` in the same commit, per the local-migrations rule), the 14-day pruner, and canvas
playback with scrubbing. The 7/14-day review surface.

**Phase 3 — the metrics.** Rep detection, joint angles, bar path in `packages/shared/` with
fixtures. `set_form_metrics` (**Postgres migration 225 or later — Lane A only**), its write path
mirrored between the API route and the `pushMutations` branch through one shared function.

**Phase 4 — surfaces.** Set-against-set and week-against-week comparison, bar-path overlay, coach
text summary.

**Phase 5 — deferred.** Live in-rep cues and voice control ("done", "next"). Same pipeline, analysis
per-frame instead of post-hoc; latency is not the blocker, deciding what is worth saying mid-rep is.
Let the metrics earn trust on post-set review first.

Phases 1–4 are **not queued** and should not be filed until Phase 0 returns a number. Filing five
entries for work gated on an unknown is how a queue rots.

---

## 9. The watch — costed, and recommended against for this feature

**There is no Wear OS module in this repo.** `android/` contains one module, `app`. So this is not a
small addition:

- A Wear OS app is a **separate Gradle module** with its own manifest, its own APK and its own
  sideload/delivery story. It is native Kotlin/Compose. **Capacitor is not involved** — none of the
  WebView UI can be reused, so every screen on the watch is written twice.
- Phone↔watch messaging is the Wearable Data Layer (`MessageClient`/`DataClient`), which is a new
  transport to learn, debug and keep alive alongside the three BLE ones already here.
- It introduces a **second supported runtime**, against the standing canonical-runtime policy, and
  doubles the device-verification surface for anything it touches.
- None of it is testable in the sandbox. Every iteration is an APK cycle on two devices.

**Recommendation: do not build the watch for this feature.** The camera is already pointed at you
and already knows when you started and stopped moving — §4.3 gets the hands-free set boundary for
free, from a pipeline that has to exist anyway. Voice ("done", "next") covers the remainder using a
dependency already installed. A watch would be solving a problem the camera has already solved, at
the cost of a whole new runtime.

**What would revive it:** if Phase 1 shows pose-triggered boundaries are unreliable on-device *and*
voice is unworkable in a gym. Even then it should be scoped as a **general remote for the whole
workout screen** — rest timer, next exercise, live HR from the H10, set logging — because that is the
version that earns a second runtime. Not as a form-capture accessory.

**Open question for the owner: is there actually a Wear OS or Galaxy Watch to build against?** The
tracked hardware in this repo is an Oura Ring 5 and a Polar H10. If the watch is hypothetical, that
settles §9 without further discussion.

---

## 10. Open questions for the owner

1. **Wear OS hardware — owned, or hypothetical?** Decides whether §9 is a real option at all.
2. **Local window: 7 or 14 days?** Recommend **14**, matching the Oura local retention decision.
   Worst case ~10 MB on the phone, so the shorter window buys nothing.
3. **Which lifts first?** Recommend the barbell four, side-on, because the metrics are best defined
   there and the bar-path trick works cleanly.
4. **Other users:** off by default, opt-in per user? Recommend **yes** — the app has other real
   accounts, and a camera feature should never be on for someone who did not ask for it.

---

## 11. What has not been verified

Everything. This document is design only. No code was written and nothing was measured. In
particular, none of these has been exercised: `getUserMedia` inside the Capacitor WebView on the
S25, MediaPipe under this app's CSP, sustained inference frame rate or thermals on the device,
the compression ratio estimated in §4.4, or rep-detection accuracy against any real lift. Phase 0
exists to replace the first four of those with measurements.
