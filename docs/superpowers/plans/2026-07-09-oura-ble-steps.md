# Plan — Steps from the Oura ring over BLE

> **⚠️ Superseded (2026-07-09) by
> [`2026-07-09-oura-ble-own-step-counter.md`](2026-07-09-oura-ble-own-step-counter.md).** Tasks 1–2
> (enable `REAL_STEPS` + tester capture levers, #373) and the frame dump (#376) shipped, and the
> on-device capture proved the `0x7e`/`0x7f` frames are the ring's step-model **feature vectors, not a
> count** (Task 3's premise). The count can't be decoded — it's a downstream model output fed
> capability-locked raw ACM. The follow-on work (build our OWN step estimate from the motion signals we
> *can* get) lives in the own-step-counter plan. This doc is kept for its capture history + the finding.

**Goal:** get real daily step counts off the ring directly over BLE, the same way live HR now
works. Follows the [feature-enablement playbook](../../oura-ble-feature-playbook.md) — read that
first. This is the **case (b)** path: the enable and event tags are known, but **no one has
decoded the step events**, so the field layout must be cracked from captured on-device data.

**Branch:** `feat/oura-ble-steps`
**Status:** **Tasks 1 & 2 shipped** (`claude/real-steps-decoder-tester-o3rje3`) — REAL_STEPS is now
enabled on every connect and the tester exposes the capture levers. ⛔ **Tasks 3 & 4 still blocked
on an owner APK rebuild + an on-device step walk** (the decode can't be written until we have real
`0x7e`/`0x7f` frames from a known step count). Next physical step: rebuild the APK
(`npx cap sync android && ./gradlew assembleDebug`), wear the ring, walk a counted distance, Sync,
and capture the `0x7e`/`0x7f` hexes.

---

## Why

Post the 2026-07-07 re-key the Oura Cloud is frozen, so ring-sourced steps are dead; the only
steps the app sees now are whatever Health Connect (phone pedometer via Tasker) provides. The
ring counts steps itself — we just have to turn the feature on and decode its events. Live HR
proved the pipeline; steps is the same shape.

## What's known (grounded) vs unknown

| | Status | Source |
|---|---|---|
| Feature id | `REAL_STEPS = 0x0b` | skill §6 / `ring-features.md` |
| Enable command | `SetFeatureMode(REAL_STEPS, AUTOMATIC)` = **`2f 03 22 0b 01`** | `OuraProtocol.reqSetFeatureMode(0x0b, 0x01)` |
| Enable works over BLE? | **Yes** — `open_oura` enabled REAL_STEPS by hand on their Ring 5, returned SUCCESS | skill §6 note |
| Event tags | `0x7e` = `API_REAL_STEP_EVENT_FEATURE_ONE`, `0x7f` = `…_TWO` | open_ring `PROTOCOL.md` §5.1 |
| **Field layout** | ❌ **UNKNOWN** — open_ring lists the tags with zero byte detail; open_oura + our `decodeRealSteps` both `_status:"unvalidated"` | must be cracked |
| Cumulative vs delta / daily reset | ❌ unknown | must be cracked |

Our current `decodeRealSteps` (`lib/oura-ble/decode.ts`) is a **guess** (14-byte record, 9-bit
counts packed as `byte×2 + carry`, surfaced as raw `fields[]`). Treat it as a starting hypothesis
to test against real data, not a truth.

## The critical gotcha (why steps has produced nothing so far)

`OuraProtocol.enableMeasurementSequence()` currently enables **only** `DAYTIME_HR + SPO2`. So
`REAL_STEPS` has **never been enabled**, the `0x7e`/`0x7f` events are **never produced**, and the
step table is empty. Cracking the layout is impossible until Task 1 ships and the owner wears the
ring with it. **Enable first, then crack.**

---

## Tasks

### Task 1 — Enable REAL_STEPS (native, APK rebuild) — ✅ DONE (pending device)
- ✅ Added `REAL_STEPS = 0x0b` to `OuraProtocol.FeatureId`.
- ✅ Added `reqSetFeatureMode(FeatureId.REAL_STEPS, FeatureMode.AUTOMATIC)` to
  `enableMeasurementSequence()` so the ring records steps automatically after every connect
  (idempotent, like HR/SpO₂) — also fired by the service `enableMeasurement()` lever and queried by
  `featureStatus()`.
- ✅ Tester button **"Enable steps"** (isolation lever) fires REAL_STEPS→AUTOMATIC alone via the
  existing generic `setFeatureMode({feature: 0x0b, mode: 0x01})` — the playbook's reusable generic
  lever, so no bespoke plugin method was needed.
- ✅ Kotlin test pins `reqSetFeatureMode(0x0b, 0x01)` → `2f03220b01` and the 3-command
  `enableMeasurementSequence`.
- **Gate:** Android CI compiles it; ⚠️ owner APK rebuild required to run on-device.

### Task 2 — Capture `0x7e`/`0x7f` (JS diagnostic, no rebuild) — ✅ DONE (pending device)
- ✅ No new capture code needed: the tester's generic per-tag Frames counter already buffers **every**
  tag, and `EVENT_NAMES` maps `0x7e`/`0x7f` → `real_step_event_feature_1`/`_2`, so they surface as
  soon as they arrive. The `SampleInspector` already shows the newest decoded sample per tag with its
  raw hex (copyable). The device-smoke-checklist §7 now has the walk-and-watch step.
- After Task 1's APK is worn a while, confirm in the tester's per-tag counts that `0x7e`/`0x7f`
  now appear at all (they should tick up as the owner walks). **If they don't appear, Task 1's
  enable is wrong** — do not proceed to decode; tap **Feature status** and re-check the `0x0b` mode
  against the RE sources.

### Task 3 — Crack the field layout — ⚠️ ON-DEVICE FINDING: 0x7e/0x7f are NOT a count

**Captured on-device 2026-07-09** (before + after a counted 100-step walk, both tags):

| tag | before (05:07) | after +100 (05:17) |
|---|---|---|
| 0x7e | `88824ca85557625864de41114b5f` | `69ee4423465b4b9a74a842873561` |
| 0x7f | `50675c0950165a353582af696b76` | `685b57dd5a3449525496a2388800` |

**Every byte changes with high entropy; no byte, LE16 pair, or packed field moves by
~100.** These are per-window **accelerometer feature vectors** (the ring's step-model
inputs — the name literally says `..._FEATURE_ONE/TWO`), not a plaintext count. Bodies
are plaintext (we decode HR/temp/SpO₂ fine), so it's feature data, not encryption. The
`activity_information` (0x50) MET tail *did* jump (`3.3, 6.6` = the walk as intensity) but
that's MET, not a count. **Conclusion:** the running step total is computed downstream
(phone/ecore, tier-2, which we don't reimplement) and is not on the `0x7e`/`0x7f` frame.
`decodeRealSteps` stays a raw passthrough with this finding recorded in its doc comment.

**RE source confirms it (open_oura, 2026-07-09).** `ring-features.md`:
`REAL_STEPS (0x0b) → real_step_event_feature_1/2 (0x7e/0x7f) → stepmotion` — a **pipeline**: the
`0x7e`/`0x7f` frames are *features* feeding `stepmotion`. `activity-model-runner.md`: `stepmotion` is
a 12-col stride/gait series produced by the `steps_motion_decoder_2_0_0.pt` **model fed raw ACM** —
"the capability-locked RData path" — which open_oura themselves can't source ("stub with NaN"). Raw
ACM is the same firmware-locked RData class as raw PPG (§1 of the skill: can't enable over the wire on
a consumer ring). **So the step count is a model output, not a plaintext field on the ring, and the
input a real counter needs (raw ACM) is locked.** open_oura's own verdict: *"Without it, type
classification stays weak; detection is the usable capability."* — i.e. we can *detect* stepping
motion but not accurately *count* it from BLE alone. This is a strong signal that even an
activity-summary hunt (below) may find no plaintext count.

**Pivot (chosen 2026-07-09): hunt the count in a summary event.** Added an admin frame-dump
(`GET /api/oura-ble/samples/raw?tags=…`, `repo.getOuraRawSamplesByTags`, tester **"Dump step
frames"** button → log console) so all recent step/activity-family frames are inspectable,
not just the inspector's newest-per-tag. Next capture: walk a known count, **Dump step
frames**, and look for a step total in `activity_summary_1/2` (0x51/0x52 — not yet observed
in our syncs) or a step field riding `activity_information` (0x50). If no plaintext total
ever appears, fall back to our own accel step-counter (Phase 5) or accept Health-Connect steps.

### Task 3 (original) — Crack the field layout (the real work)
- Owner protocol: with the ring worn, **walk a known number of steps** (e.g. 100, counted), then
  Sync and capture the `0x7e`/`0x7f` hexes spanning that window. Repeat at a second known count to
  disambiguate cumulative-vs-delta and find the daily-reset boundary.
- Find the field in `decodeRealSteps`'s `fields[]` (or a re-derived layout) whose value tracks the
  known count. Determine: which of feature_1/feature_2 carries the count, cumulative vs per-event
  delta, and the per-day reset (compare across a midnight boundary).
- Rewrite `decodeRealSteps` to the validated layout; **pin it to the captured hex as a unit test**;
  drop `_status:"unvalidated"`.
- ⚠️ This is empirical and iterative — budget for 2–3 capture/decode rounds. It's the same "crack
  from captured data" work the skill flags for all `unvalidated` decoders.

### Task 4 — Store + display (server/JS, no rebuild)
- The ingest route already stores every raw frame in `oura_raw_samples` — once `decodeRealSteps`
  is real, the decoded step count is available there.
- Graduate to `body_metrics.steps` in the rollup (`aggregateOuraRawSamples`), with `source='ble'`,
  respecting the Cloud partial-day/`COALESCE` rules (don't overwrite a Health-Connect value with a
  smaller partial-day BLE value — treat "today" as partial like the wornHours lesson).
- Surface on the existing health/activity step displays (they already render `body_metrics.steps`);
  this is a sibling-sweep, not new UI.
- **No battery gating** — step counting is passive on the ring (unlike the PPG burst), so
  `REAL_STEPS = AUTOMATIC` just rides along with the existing hourly drain.

## Risks / open questions
- **Layout may resist cracking** — if `fields[]` never matches a known count, the packing guess is
  wrong; fall back to a fresh byte-diff of two captures at known counts (Δbytes vs Δsteps).
- **REAL_STEPS server-gate** — it's server-flagged off, but open_oura enabled it over the wire, so
  the `SetFeatureMode` should stick; confirm the `2f 06 21 0b …` status response shows it enabled
  (Task 2 can query `reqFeatureStatus(0x0b)`).
- **EXERCISE_HR (`0x03`) "tries to enable REAL_STEPS first"** — enabling AWHR may be an alternate
  path; note if the burst work already nudged it.

## Verification (on-device is the only real gate)
- Task 1: Android CI green; owner rebuilds, wears the ring.
- Task 2: `0x7e`/`0x7f` counts climb in the tester as the owner walks.
- Task 3: decoded count ≈ the walked count (±a small margin) across two known walks + a midnight.
- Task 4: `body_metrics.steps` fills with `source='ble'` and matches the ring's own count; health
  step display shows it. Not exercisable in-sandbox (native + real movement) — device is the gate.
