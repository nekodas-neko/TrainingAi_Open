# 2026-07-27 — Cadence: first treadmill capture, strap confirmed, ring path fixed

**Branch:** `claude/cadence-metric-ring-strap-6whk16` · **Version:** v1.211.2
**Follow-up to** [`2026-07-27-cadence-metric-ring-strap.md`](2026-07-27-cadence-metric-ring-strap.md).

Owner ran the first real capture on the APK: 30 s counted walk → 51 steps → 102 spm ground truth,
then a 33.5 s capture walking to another 51 steps.

## Strap — validated on real hardware

```
strapFrameType: 1   strapSampleRate: 50   readingCount: 21
series: t10 103.1 · t20 98.6 · t30 98.1   avg 99.4   final 98.5
```

**`frameType: 0x01` means the H10 emits RAW PMD frames, not delta.** That was the single most
uncertain thing in the whole build — open sources disagree on the encoding, so `parseAccFrame`
was written to decode both and to *report* the observed type rather than silently assume one.
Real hardware settled it, and the raw branch produced physiological values first try.

Accuracy vs 102 spm: first bin **+1.1**, mean −2.6, final −3.5 — inside the ±3–5 spm bar. The mean
reads low because the capture window (33.5 s) is longer than the counted 51 steps (~30.0 s at
102 spm); the start/stop edges are in the average. No `t=0` bin: the strap took ~10 s to produce
its first reading, worth watching but not wrong (BLE subscribe + control-point write + buffer fill).

**Still unproven:** running pace (where octave error is most likely to bite), battery cost over a
full session, n>1.

## Ring — produced nothing, and it was my design error

`ringStrideHz: null`, `ringWindowCount` would have read 0. Root cause, in the native service:

1. One gait window needs a **pair** of 0x7e/0x7f frames covering ~30 s → a 33 s capture yields at
   most one.
2. Decisively: `OuraRingService.kt:54` `DRAIN_INTERVAL_MS = 3_600_000` — the service drains ring
   history on connect then **hourly**, and gait frames largely reach JS with that drain.

So a short capture *cannot* produce ring cadence. The console was built assuming ring readings
appear live; they do not. Fixed by surfacing a gait-window count (so "ring sent nothing" is
distinguishable from "sent windows, none locomotor") and a **Sync ring** button calling the
existing `drainHistory` plugin method — JS only, no APK rebuild.

**D-2 (the `stride_frequency` units question) remains OPEN.** The capture that answers it hasn't
been taken yet.

## The bug that root-causing exposed

`cadence-tracker.ts` stamped every ring window with `Date.now()`. When an hourly drain lands it
delivers a burst covering the past hour — all stamped "now" — so ~120 stale windows would look
like live readings, jittering the display and swamping the saved activity average.

Fixed: dedupe on the ring's own `ds` (monotonic, so window *spacing* is trustworthy even though its
epoch isn't wall-clock), and rate-limit to one recorded reading per ~25 s.

**A first attempt at that fix was itself wrong, and the test caught it.** A burst arrives in
ascending `ds` order, so the naive gap-guard records the *first* window through — the oldest, an
hour stale — and skips the rest. The corrected version has later windows in a burst **supersede**
the earlier one, leaving exactly one reading: the newest. Regression tests cover the burst
collapsing to one newest reading, out-of-order windows being ignored, genuine 30 s-spaced windows
all being kept, and the pre-fix swamping behaviour.

## Verification

`tsc` clean, lint 0 errors, **2031 tests passing**, check-reconcile + check-push-mutations OK.
The tracker fix is exercised by pure unit tests; the console changes are BLE-gated and inert in
the sandbox as before.

## Next

Owner action: **Admin → Tools → Cadence calibration** → **Sync ring** → confirm the gait-window
count climbs → read which stride interpretation (×60 / ×120) matches the treadmill. That single
capture closes D-2 and unblocks the AD-2 Hz bands and step-counter trust. Then a run-pace strap
capture for the octave check.
