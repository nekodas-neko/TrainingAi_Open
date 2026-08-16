# Steps were inflated by live windows claiming impossible cadences

Owner-reported (2026-07-28): the app showed **4,903 steps** for the day while Samsung Health showed
**911** at 11:11.

## Diagnosis

Running the real shipped pipeline over the day's own 539 raw gait windows reproduced the stored
number exactly:

| | steps |
|---|---|
| Oura's `step_counter` model over today's frames | **1,578** |
| \+ one live-accel window claiming 3,605 steps | **4,903** ← exactly what production stored |

That window claimed **3,605 steps between 09:22 and 09:35 — 289 steps/min**, against a 350 ms
refractory (`MIN_STEP_GAP_SEC`) and a gait band topping out at `GAIT_CADENCE_MAX_HZ = 2.8` Hz
(168 steps/min). Something was 72% past the counter's own ceiling. (**Which** half was wrong — the
count or the window — is settled in "Root cause" below: it is the window.)

`POST /api/oura-ble/live-steps` accepted it. The schema bounded steps (≤20,000) and window length
(≤4 h) but never checked the two against each other. And because `mergeStepCounterWithLive` gives
live windows priority over the model **for the whole span they overlap**, one bad row did not add
noise — it *replaced* good model output.

Three stored windows were impossible, and each is a day's inflation:

| window (Brisbane) | claimed | duration | cadence |
|---|---|---|---|
| 2026-07-28 09:22 | 3,605 | 12.5 min | **289/min** |
| 2026-07-27 13:25 | 1,894 | 10.0 min | **190/min** |
| 2026-07-24 10:51 | 1,716 | 1.5 min | **1,145/min** |

## What shipped

`isPlausibleStepWindow(steps, startMs, endMs)` in `lib/health/step-estimate.ts` — the One-Formula
home for steps math. The ceiling is derived from `GAIT_CADENCE_MAX_HZ`, the detector's **own** band
edge, rather than a new magic number, plus a 2-step grace for strides cut by a window boundary. It is
deliberately a statement about what the counter can emit, not about human physiology.

Applied in three places:

1. **`/api/oura-ble/live-steps`** rejects with `400 implausible_cadence`. Reject, not clamp: a count
   above the detector's ceiling means the counter faulted, and there is no honest way to guess what
   it should have been. Checked *before* the clock-anchor lookup so the response for bad input does
   not depend on account state.
2. **`/api/oura-ble/accel-chunks`** (which counts server-side) keeps the raw chunk — it is the
   evidence for a recount — but does not promote a faulted count to a Tier-2 window. The response
   carries `implausible: true` so a zero-window reply is distinguishable from "you were sitting
   still".
3. **`mergeStepCounterWithLive`** filters implausible windows before they claim their span. Ingest
   alone is not enough: the three bad rows are already stored, and without this the model's own count
   for those spans stays suppressed.

## Verified against production

Re-running the guarded merge over the real frames for each affected day:

| day | stored | with the guard | change |
|---|---|---|---|
| 2026-07-24 | 7,691 | 5,972 | −1,719 |
| 2026-07-27 | 6,981 | 5,922 | −1,059 |
| 2026-07-28 | 4,903 | **1,578** | −3,325 |

1,578 against Samsung's 911 is a believable gap — the ring is worn continuously, the phone is not.

## Not done: correcting the three stored days

The rollup's max-merge guard (`> existingSteps`) means a day's stored count can only ever rise, so
these three will **not** self-correct. Lowering them is destructive and already has an owner-gated
lever (`?allowStepsDecrease=1` on the redecode route, with a read-only preview at
`/api/oura-ble/samples/step-backfill-preview`). Left for an explicit decision.

## Verification

Full suite **2,486 passing** (20 new), typecheck, lint and both custom-rule checks clean. Unit tests
pin the three real impossible windows as rejected and a 150 steps/min walk as accepted; merge tests
prove the model reclaims the span a dropped window had taken; route tests drive the real handler for
both the ds and wall-clock body shapes.

## Root cause — found, and it is the window, not the count

The first write-up guessed the count was inflated by a wrong time base. That guess was wrong, and the
tests disprove it.

**The count cannot be inflated relative to the accelerometer data behind it.** `StepPeakCounter`
applies its 350 ms refractory *in samples*: 60 s of a maximal alternating spike train — the most
step-like signal constructible — yields 167 steps, 2.78/s, under the 2.86/s ceiling. So
`count / accel_seconds ≤ 1/MIN_STEP_GAP_SEC`, always.

**The posted window's end comes from a different stream.** `steps` accumulates from the 0x33 accel
stream, but `endDs` was `lastGateDs + GATE_WINDOW_SPAN_DS` — derived from the **0x7e/0x7f gate**
stream, which stalls whenever the ring power-gates its radio or automatic measurements are off. Three
of the four post paths (`onDisconnect`, `forceStop`, the live-HR yield) use it. With no gate frames
at all, `onDisconnect` posts a **30-second** window for a burst that may have run up to 20 minutes.

**Together that is exactly the production symptom.** 3,605 steps needs ≥ 3,605 × 0.35 s = **21.0
minutes** of accel data. Production posted it over **12.5 minutes**. The count is reachable; the
window is not. The "289 steps/min" was never a real cadence — it divided a count from one stream by a
duration from another.

### Fixed at source

`StepPeakCounter` now exposes `elapsedSec` (its own processed accel seconds, `null` until a rate byte
is seen), and the orchestrator takes `max(gateEnd, startDs + elapsedSec)` — the longer of the two.
Longer, not simply the accel span: the gate end can legitimately exceed it when the accel stream drops
out mid-burst, and over-stating a window only under-states cadence, which is the safe direction. It is
the same rule the capture path already used.

### What this means for the guard

The ingest/merge guard still belongs — a window whose cadence is impossible cannot be trusted, and
dropping it lets the model refill the span. But note the consequence honestly: for the three stored
days those steps were probably **real**, just attributed to too short a window, and the guard
discards them rather than recovering them. The true end is unrecoverable for rows already written, so
the model's own estimate is the best available answer for those spans.

**Still not established, and not claimable without the device:** whether the rate byte is also
sometimes wrong. A misreported `sampleRate` would shrink the refractory in real time and let a
stride's double peak count twice, on top of this. The bound in test A is relative to *reported*
samples, so it cannot rule that out. Needs an on-device counted walk.

**Not exercised — on-device.** The orchestrator change runs only in the WebView on the APK.
