# Three more step faults, found by auditing the class rather than the instance

After fixing the mis-timed live window earlier today, three agents swept for (a) the same
cross-stream time-base shape elsewhere, (b) ingest routes bounding fields individually but never
against each other, and (c) the step pipeline end to end. The step sweep found the **larger** bug.

## 1. The posted count was never gait-gated on the default path — the real inflation

`step-orchestrator.ts` posted `counter.count`, a raw `StepPeakCounter`. It replaced that with the
gait-gated count **only inside `if (capturing)`**, and `capturing` requires `isAutoCaptureEnabled()`
— a localStorage flag that **defaults to off**. So the default runtime path posted the ungated count.

`gait-step-count.ts`'s own header documents what that counter does: the owner's capture peak-counted
**114 "steps" over 61 s of cooking with zero real steps.** That is ~112 steps/min — comfortably
**under** the 168/min cadence ceiling, so this morning's `isPlausibleStepWindow` gate cannot catch it.
A plausible-looking phantom count that then *overrides* the ring's own model for its span.

This is almost certainly the bulk of the long-run inflation, and it is a different failure from the
mis-timed window: that one produced impossible cadences, this one produces believable ones.

**Fixed:** every posted window is now gait-gated, capture or not. `countGaitGatedSteps` is documented
as *"the ONE place walking is separated from non-walk hand motion"* — it now actually is. The raw
counter stays for the live on-screen number only. Magnitudes are buffered on every burst (and cleared
per burst) since gating needs them.

## 2. Overlapping live windows were summed

`mergeStepCounterWithLive` summed every live window unconditionally. `upsertStepLiveWindow` conflicts
on `(userId, startDs)` **only**, so a retry landing a decisecond later inserts a *second* row rather
than replacing the first. Production holds **15 overlapping pairs** — including four rows whose
starts differ by 1–3 ds covering the same ~4 minutes, plus two shorter windows inside them; the plain
sum credited 375 steps for that span.

**Fixed:** `dedupeOverlappingWindows` — greedy by descending count, take the largest, then any window
overlapping nothing already taken. Overlapping windows cannot all be true and there is no way to tell
which is right, so this never adds them. It can only lower a total, never raise one. That cluster now
credits 301 (175 + 126, the two non-overlapping bests).

## 3. A midnight-crossing window was counted on both days

A live window was credited **whole** to the day containing its start, and its span was then absent
from the next day's live list — so the next day's model windows over those same minutes were never
dropped and the overlap was paid for twice.

**Fixed:** split pro-rata at the local-day boundary, using the shared `dateStrMidnightInTz` rather
than a second definition of midnight (which also handles DST).

## 4. A wrong comment of mine, corrected

This morning's fix claimed *"this is the same rule the capture path below already applies"*. It
wasn't — the capture branch **assigned** `endDs`, silently overriding the `max()` above it. The
branch now only restores the ring's automatic measurements; the max resolves to the capture span on
its own, because `accelEndDs` derives from the same buffer.

## Backfill preview — recomputed every ring-era day

| | |
|---|---|
| days recomputed | 20 (2026-07-09 → 07-28) |
| stored total | 106,902 |
| recomputed total | 104,458 |
| net | **−2,444** |

Most days barely move. Three drop materially — **07-24 −1,719**, **07-27 −1,059**, **07-28 −3,326**
— and two rise (07-12 +2,696, 07-13 +1,327).

⚠️ **This preview is indicative, not authoritative.** It buckets frames by `measured_at` while the
rollup buckets by `dayForDs` via the mutable clock anchor, and the anchor has moved since those days
were written. The two rising days are the most likely artefacts of that. The real backfill must be
run through `/api/oura-ble/samples/step-backfill-preview`, which uses the rollup's own bucketing.

## Still open, filed not fixed

The sweeps returned more than this. The highest-value remainder, in priority order: the accel-chunk
window span is sample-derived while the chunk flushes on wall-clock (same shape as the bug we fixed,
still live); the clock anchor is a single mutable row applied to all of history, so a ring clock
reset silently zeroes every post-reset day; `previewStepsBackfill` is a hand-copied duplicate of the
rollup block, so the preview the owner authorises from is computed by different code than the write.
Filed in `docs/implementation-backlog.md`.

## Verification

Full suite **2,501 passing**, typecheck, lint and both custom-rule checks clean. New tests pin: a
112 steps/min phantom passing the cadence gate (why gating is needed on top of it), the gait gate
rejecting aperiodic hand motion the naive counter credits, the real production overlap cluster
resolving to 301 not 375, and a DB-backed midnight-crossing split.

## ✅ Device-verified 2026-07-29 — and it clears the model

The owner did a guided walk and compared totals:

| source | steps |
|---|---|
| this app (`step_counter` model) | **3,716** |
| Samsung Health (phone) | **3,759** |
| difference | **43 (1.1%)** |

Over a real ~28-minute walk against an independent reference. **The ring's step model is accurate.**

This matters beyond the calibration, because it isolates blame. During the check the model reported a
near-constant ~115 steps/min across 47 minutes, which looked like saturation until the owner
confirmed it was a genuine guided walk. It wasn't over-counting — it was measuring.

So the entire inflation came from the **live-accel tier**, not the model:

| source | verdict |
|---|---|
| `step_counter` model | accurate (1.1% vs an independent reference) |
| live-accel windows (ungated naive counter) | the whole of the inflation |

That retro-validates the 2026-07-28 diagnosis exactly: 4,903 stored = 1,578 model + 3,325 from one
bogus live window. The model was right the whole time and the live tier was overriding it — which is
precisely what the gating change above stops.

**One residual, still not settled:** no live window was posted for the counted walk at all, so the
orchestrator did not fire during it. Whether that is correct behaviour (the gate never detected a
walk) or a missed trigger is unresolved. Worth checking on the next device pass — though with the
model now trusted and the live tier gated, a missed live window is the *safe* direction.

## Follow-up 2026-07-29 — Q-22 §1 fixed, the last live instance of this bug class

The accel-chunk path had the *same* fault, still live: `continuous-capture.ts` flushes a chunk on
**wall clock** (`Date.now() - chunkStartedAtMs >= CHUNK_MS`) while the route derived the window end
from **sample count** (`magnitudes.length / sampleRate`). The accel stream gaps by design — firmware
time-boxes it at ~5 min, a 90 s stall watchdog re-arms it, a reconnect re-arms it — so a chunk
occupying 120 s of wall clock routinely holds only 40–90 s of samples. The steps were stamped minutes
before they happened, and the model then re-counted the surrendered remainder.

Fixed by sending the client's real `endedAt` and taking `max(sampleDerived, client)`. The sample
duration remains a floor, so a backwards client clock cannot shrink a window below the data it holds.

**A test that would have proved nothing.** My first version asserted the `implausible` flag. That
flag can never distinguish these cases — the gait counter's refractory caps cadence against its own
samples, so a too-short window still reads as plausible. Rewritten to assert the **written window
span** (120 s, not 60 s), and confirmed by reverting the fix and watching it fail. Second time today
I have caught myself writing a vacuous assertion; both times the tell was that the test passed
immediately without ever having been red.

**Not exercised — on-device.** The orchestrator changes run only in the WebView on the APK. Notably
this changes what gets posted, so an on-device counted walk is now the highest-value verification
available — it would settle both the gating change and the one open question from this morning
(whether the sample-rate byte is ever misreported).
