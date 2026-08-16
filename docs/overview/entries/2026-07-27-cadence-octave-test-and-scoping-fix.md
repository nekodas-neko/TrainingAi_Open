# 2026-07-27 — Cadence: octave test passes, and the capture scoping was still wrong

**Branch:** `claude/cadence-metric-ring-strap-6whk16` · **Version:** v1.216.1
**Follow-up to** [`2026-07-27-cadence-metronome-reference.md`](2026-07-27-cadence-metronome-reference.md).

A 150 bpm metronome capture — the octave test, never previously run — validated the strap across
its full range and exposed a real bug in the capture scoping added the day before.

## The strap passes the octave test

```
truth 150 bpm   strap avg 147.3   series 145.9 – 148.3 (14 bins)   strength 0.797
```

Running cadence is where a periodicity detector is most likely to lock onto the **stride** rather
than the step and report half. **Not one of the 14 bins came back near 75.** Rhythm strength was
*higher* than at 120 bpm (0.797 vs 0.702).

Combined with 120 bpm (117.5) the offset is constant, not growing: −2.1% and −1.8%. That is
stepping lag, not instrument error — at 120 the ring independently read 117.1 against the strap's
117.5, and the ring's decode path shares no code with the strap DSP. **Strap cadence is validated
64 → 150 spm.**

## The bug: capture scoping assumed the drain lands at the end

Yesterday's fix scoped ring windows as `ds >= newestDs − captureDs`. That silently assumes the
newest window sits at the capture's **end**, which is only true if a drain happens to land as the
capture finishes. Checking the two captures' actual drain arrival times:

| capture | duration | drain arrived | newest window at |
|---|---|---|---|
| 120 bpm | 149.6 s | t+112.5 – 119.3 s | **80% through** ✅ |
| 150 bpm | 146.7 s | t+15.8 – 18.6 s | **13% through** ❌ |

So in the 150 bpm capture the filter reached 147 s *backwards* from a window near the start:
roughly **87% of the "in-capture" windows predated the walk entirely**. The scatter they showed
(81 / 115 / 139 / 159 spm) was pre-capture history — standing about, setting up — and says
nothing about the ring at running cadence.

**This is the third time drain timing has corrupted a ring conclusion, and the second time a fix
for it was itself wrong.** The pattern each time: the ring's data looks like it describes the
walk in front of you, and it doesn't.

### Fix

1. **Drain on capture stop**, then wait for the burst (`RING_DRAIN_WAIT_MS = 8 s`) before reading
   windows — so coverage no longer depends on where the hourly drain happened to fall. A failed
   drain never loses the strap capture.
2. **Scope by reconstructed occurrence time**, not a ds offset. `dateRingWindows` anchors on
   `(newest ds ↔ its arrival time)` — valid because a drain replays history *up to the present* —
   and dates every other window from its ds offset at 100 ms/unit. `ringWindowsWithin` then keeps
   only windows genuinely inside `[start, end]`.
3. **Export coverage**: `ringCoveredToSec` / `ringCoversCapture` / `ringDrainRequested`, so a
   partly-seen capture cannot be read as a complete one. That absence is what let the 150 bpm
   capture look like ring evidence.

Five regression tests reproduce the exact 150 bpm timing, including one asserting the *old*
scoping kept all four windows where the new one keeps one.

## Consequence for prior data

Ring numbers from any capture before v1.216.1 are trustworthy only if that capture's drain landed
near its end. The 120 bpm capture qualifies (80% through) and its ring/strap agreement to 0.4 spm
stands. The 150 bpm capture does not.

## Verification

`tsc` clean, lint 0 errors, **2104 tests passing**, check-reconcile + check-push-mutations OK.
JS-only, no APK rebuild. The drain-on-stop path is BLE-gated and inert in the sandbox — it needs
an on-device capture to confirm, which is the next owner action.

## Next

Re-run a ring-bearing capture on v1.216.1 and check `ringCoversCapture` is true before reading
anything into the ring numbers. Then octave-correct the ring against captures that genuinely
cover their walk.
