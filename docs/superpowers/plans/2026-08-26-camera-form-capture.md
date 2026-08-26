# Camera form capture — on-device pose, stick-figure playback, summary-only sync

**Status:** design proposed 2026-08-26 from an owner conversation; **all four open questions
answered by the owner the same day** (§10). Nothing implemented, nothing measured on device.
**Phase 0 is a feasibility gate and everything after it is conditional on that number.**
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
6. **The lift should not matter.** The workout already records whether an exercise is barbell,
   dumbbell or bodyweight, so the app should adapt to it rather than shipping for a whitelist of
   lifts. Raised by the owner as the important one of the four questions — §5.5.

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
Either way a 14-day local window is nothing on a phone. **Owner decision 2026-08-26: 14 days**,
matching the Oura local window, pruned on the same schedule. The numbers above are an estimate —
Phase 2 measures the real per-set size before the window is fixed, and if it lands far above this,
the keep-list or the frame rate gives way rather than the window.

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
midpoint of the two wrist landmarks is the bar**. One subtraction.

This generalises, which is what makes §5.5's equipment profile cheap: the hands hold the load on a
dumbbell and a kettlebell too, so the same landmarks give **two independent paths** for dumbbells
and a single wrist path for everything else. No bar, plate or dumbbell is ever detected. Object
detection would only add value for a trap bar, a lift where the hands are occluded, or catching a
mismatch between the logged exercise and what is actually being held — see §5.5.

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

### 5.5 The analysis profile comes from the exercise's equipment — no second model

**Owner decision, 2026-08-26.** The feature should not launch "for the barbell four". The workout
already knows what you are holding, so the app should adapt to it: dumbbells behave differently from
a bar, and the analysis should follow the exercise rather than the other way round.

**The app already has the field, and a classifier for it.** Measured against production on
2026-08-26:

- `exercise_library.equipment` is a populated `text[]`. Six values in production, and the same six
  locally: **dumbbell, barbell, cable, machine, bodyweight, kettlebell**.
- `exercise_library.exercise_type` is `weighted` (117) or `bodyweight` (24).
- **`equipmentClassOf(equipment)` already exists** in
  `packages/shared/src/workout/time-audit.ts:183`, returning
  `'barbell' | 'standard' | 'bodyweight' | 'unknown'`. It is already used to model inter-exercise
  transition times.

**Reuse that vocabulary; do not invent a second one** (One Formula, One Place). But
`equipmentClassOf` collapses dumbbell, cable, machine and kettlebell into one `standard` bucket,
and form capture needs dumbbell separated — so the form profile needs a **finer** classifier living
beside it in the same module, sharing the same input and the same tag strings.

| Class | Bar path | What is actually measurable | Camera |
|---|---|---|---|
| `barbell` | one path, wrist midpoint | ROM, tempo, forward drift, **bar tilt** (wrist height difference) | side-on |
| `dumbbell` | **two independent paths**, one per wrist | ROM, tempo, **left/right asymmetry** — impossible on a bar | side-on or front-on |
| `bodyweight` | wrist or hip, per movement | ROM, tempo, hip/knee angles. No external load | side-on |
| `machine` / `cable` | fixed by the machine | tempo and ROM only — the path is the machine's, not yours | low value; consider skipping |
| `kettlebell` | wrist path | ROM, tempo; swings are ballistic, so rep detection needs its own threshold | side-on |
| `unknown` | wrist midpoint | the generic profile — still useful | side-on, ask the user |

**The honest correction to the request.** The owner described the model *looking for* the equipment:
finding the full bar length and where the hands sit, or spotting one or two dumbbells. That is
**object detection — a second model** running alongside pose, costing more memory, more latency and
more thermal budget on a device that is already the binding constraint.

It is not needed, because **the hands hold the load in every one of these cases**. The wrist
landmarks give the bar path for a barbell, each dumbbell's path for dumbbells, and the movement path
for bodyweight — with no bar or plate ever detected. What the equipment tag has to decide is not
*what to look for* but **which metrics are valid, how to count a rep, and which camera angle to
ask for**. That is a lookup table, computed in our own code, deterministic and testable — and it
delivers what the request was actually after.

**Visual equipment detection is therefore deferred, not rejected.** It would buy two things the tag
cannot: catching a mismatch between the logged exercise and what is actually in your hands, and bar
tilt measured from the bar itself rather than inferred from wrist heights. Neither justifies a
second model before Phase 0 has established there is thermal headroom for the first one.

**Measured prerequisite: 23 of 149 production exercises carry no equipment tag** (15%), and 16
carry more than one. So the `unknown` row of that table is a real code path serving roughly one
exercise in seven, not a defensive branch — it must be genuinely useful, and the multi-tag case
(`['barbell','bodyweight']`) must resolve deterministically. Tagging the 23 is a cheap, separate
data chore worth doing before Phase 3, and it is not a blocker: the generic profile still produces
ROM, tempo and a wrist path.

### 5.6 The constraints a single camera actually imposes

- **2D.** BlazePose emits world landmarks in metres, but monocular depth is a hint. Treat it as one.
- **The angle is per-profile, not per-lift** — the table above carries it, and the capture screen
  states it before recording rather than silently scoring a set shot from the wrong side.
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
fixtures, plus §5.5's equipment-keyed profile — the finer classifier beside `equipmentClassOf` in
`packages/shared/src/workout/time-audit.ts`, sharing its tag vocabulary rather than starting a
second one. `set_form_metrics` (**Postgres migration 225 or later — Lane A only**), its write path
mirrored between the API route and the `pushMutations` branch through one shared function.

Worth doing before this phase, separately and cheaply: **tag the 23 of 149 production exercises that
carry no `equipment` value**, so the `unknown` profile serves the genuinely ambiguous cases rather
than one exercise in seven. Not a blocker — the generic profile still yields ROM, tempo and a wrist
path — so it is a data chore, not a dependency.

**Phase 4 — surfaces.** Set-against-set and week-against-week comparison, bar-path overlay, coach
text summary.

**Phase 5 — deferred.** Live in-rep cues and voice control ("done", "next"). Same pipeline, analysis
per-frame instead of post-hoc; latency is not the blocker, deciding what is worth saying mid-rep is.
Let the metrics earn trust on post-set review first.

Phases 1–4 are **not queued** and should not be filed until Phase 0 returns a number. Filing five
entries for work gated on an unknown is how a queue rots.

---

## 9. The watch — the platform changed, and so does half the argument

**Owner answer, 2026-08-26: there is no Wear OS watch.** The interest is in buying an open-source
watch — a Pebble — *"to try make something on"*. That is a different platform, and it invalidates
most of what this section originally said, so the reasoning is rewritten rather than defended.

**What the original objection was, and why it mostly dissolves.** The costing here was against
Wear OS: a separate Gradle module, a native Compose UI, a new transport, and — the load-bearing
part — **a second supported runtime** against the canonical-runtime policy, doubling the
device-verification surface.

A Pebble is not that. PebbleOS was open-sourced in 2025 and the watch is, from the phone's point of
view, **a BLE peripheral** — and this app already runs three of those (`OuraBlePlugin`,
`PolarBlePlugin`, `ScaleBlePlugin`) with a foreground-service pattern for exactly this. A Pebble
remote is plausibly **a fifth Kotlin plugin in the existing module**, not a second runtime. The
watch-side app is small: three controls and a number. Battery life measured in days rather than
hours also suits something that has to be alive whenever you walk into a gym.

So the honest position: **the "second runtime" objection was against Wear OS and does not carry to
Pebble.** What remains is scope, not architecture.

**What still has to be verified before committing to it** — none of it checked here, and it should
not be assumed:

- Whether the current phone-side SDK is usable from a Capacitor app at all, and what it requires;
  the Pebble ecosystem changed hands and the tooling for current hardware needs reading, not
  recalling. Treat every SDK detail as unverified until the docs are open.
- Whether a background service can hold the connection through a session the way the existing three
  BLE services do.
- Which hardware actually ships and when.

**Recommendation, unchanged in conclusion and changed in reasoning: do not put the watch on the
critical path for form capture.** Not because it is architecturally expensive any more, but because
the camera already solves the problem it would solve. §4.3 gets the hands-free set boundary from a
pipeline that has to exist regardless, and voice ("done", "next") covers the rest through
`@capacitor-community/speech-recognition`, already installed. Gating a camera feature on hardware
nobody owns yet would be gating it on a purchase decision.

**If a Pebble is bought, scope it as a general workout remote** — rest timer, next exercise, live HR
from the H10, set logging — not as a form-capture accessory. That is the version worth a native
plugin, it is useful on every session rather than only the filmed ones, and it composes with this
feature for free: a remote that can end a set is a remote that can end a *recorded* set. Its own
planning session, its own entry, no dependency in either direction.

---

## 10. Decisions — all four answered by the owner, 2026-08-26

| # | Question | Owner's answer | Where it lands |
|---|---|---|---|
| 1 | Wear OS hardware owned? | **No.** Interested in buying a Pebble to build on | §9 rewritten — the platform objection does not carry to Pebble; still off the critical path |
| 2 | 7 or 14 days locally? | **14, "if we can afford it"** | We can — §4.4 puts the worst case near 10 MB. Confirmed as 14 |
| 3 | Which lifts first? | **"Ideally it doesn't matter"** — drive it off the logged equipment | §5.5 — an equipment-keyed analysis profile, not a lift whitelist |
| 4 | Off by default for other accounts? | **Yes** | Opt-in per user, off until enabled. Never on for someone who did not ask |

**On (2), the affordability is an estimate and not yet a measurement.** §4.4's ~10 MB assumes the
landmark keep-list and frame rate proposed there. Phase 2 measures the real per-set size on device
before the window is fixed; if it lands far above the estimate, the honest response is to shrink the
keep-list or the frame rate, not to quietly cut the window the owner asked for.

**On (4), off-by-default is a floor, not the whole answer.** A camera feature also needs a visible
recording indicator while armed, and the capture screen must be reachable only from a deliberate
action — never auto-opened by starting a set until the user has turned the feature on.

---

## 11. What has not been verified

Almost everything. This document is design only and no code was written.

**Four things WERE measured against production on 2026-08-26**, via `/api/admin/db-query`, and are
quoted rather than assumed: the six `equipment` values, the `exercise_type` split, that **23 of 149**
exercises are untagged and **16** carry multiple tags, and that `equipmentClassOf` already exists at
`packages/shared/src/workout/time-audit.ts:183`. Note the row-scoping caveat does not bite here —
`exercise_library` is a shared catalogue, not user rows.

**Nothing else is measured**, and none of these has been exercised: `getUserMedia` inside the Capacitor WebView on the
S25, MediaPipe under this app's CSP, sustained inference frame rate or thermals on the device,
the compression ratio estimated in §4.4, or rep-detection accuracy against any real lift. Phase 0
exists to replace the first four of those with measurements.
