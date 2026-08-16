# 2026-07-27 — Cadence: the ring doesn't track cadence; gated off

**Branch:** `claude/cadence-metric-ring-strap-6whk16` · **Version:** v1.214.1
**Follow-up to** [`2026-07-27-cadence-first-treadmill-capture.md`](2026-07-27-cadence-first-treadmill-capture.md).

Two more treadmill captures ended the D-2 units question by making it irrelevant, and reversed
this branch's own earlier conclusion.

## The finding

| counted truth | ring capture-period median | ×60 | ×120 |
|---|---|---|---|
| 64 spm (1.5 km/h) | 0.98 Hz | 59.0 | 118.0 |
| 114 spm (4.0 km/h) | 1.02 Hz | 61.2 | 122.4 |

The two walks are **1.8× apart in real cadence** and the ring reported **the same ~1.0 Hz** for
both. No scale factor rescues a signal that doesn't move with pace, so **D-2 (×60 vs ×120) was
the wrong question all along** — the right one is whether column 4 of `unpack27` is
`stride_frequency` at all.

**How the earlier ×60 evidence was wrong:** the 1.7–3.3 Hz readings that looked like a ×60 match
all arrived inside **4-second drain bursts** — the ring replaying its hourly backlog, not the walk
being measured. The capture-period `ds` scoping added the day before is what made that visible;
before it, the console was averaging a 3.4-minute walk against 19 minutes of unrelated history.

Retracted accordingly: the "×60 supported at two very different cadences" table in the previous
entry and in PR #811's original body. It was two points that happened to bracket zero, both
drawn from burst-polluted data.

## The gate

`RING_CADENCE_VALIDATED = false` (`lib/health/cadence.ts`), documented with the evidence above.
While false, ring windows never reach the live readout or the saved activity average — gated in
**both** `onRingWindow` and `pickLiveCadence`, since either alone leaves a path open. They stay
fully visible in the admin calibration console, which is where the column-order question gets
worked out.

The three ring/strap precedence tests now assert **against the flag** (`if
(RING_CADENCE_VALIDATED) … else expect(picked).toBeNull()`), so restoring the ring flips them
back automatically instead of leaving dead tests to be discovered later.

Why gate rather than leave it: a frozen ~60 spm reads as plausible on every walk. A wrong number
that never contradicts itself is worse than no number — nothing would ever have prompted a
re-check.

## Also shipped — the slow-walk fixes (64 spm capture)

1. **AD-2's walk/run bands were gating cadence.** `classifyGait`'s walk band starts at 1.4 Hz
   (~84 spm), so a genuine 64 spm walk classified `idle` and every window was discarded. Cadence
   now gates on motion (`hasGaitMotion`, a new export separating "no motion" from "motion outside
   the bands" — indistinguishable from the verdict alone). **AD-2's bands untouched.**
2. **One octave mis-lock skewed the average.** Bins `60.9, 140.8, 66.1, 61.5, 60.3, 69.8, 68.6,
   61.0` — the 140.8 is exactly 2× its neighbours. Mean 73.6 (+9.6); median 63.8 (−0.2).
   `summarizeCadence` now uses the median.

## Strap — the working path, with one open question

Tracked 64 → 96 → 114 correctly across every capture, and produced 60.3–61.5 spm readings that
were **impossible** under the old 72 spm floor (#808).

Open: the strap/counted ratio drifts with pace — **1.00 / 1.04 / 1.08 at 64 / 96 / 114 spm**. A
DSP scale error and a progressively low hand count are not separable from this data (at 114 spm
the owner is counting ~57 steps in 30 s, and hand counts run low at speed). Known-Issues row
added; the resolving capture is a **metronome-referenced** one, where ground truth is set rather
than counted.

## Verification

`tsc` clean, lint 0 errors, **2089 tests passing**, check-reconcile + check-push-mutations OK.
The gate is JS-only — no APK rebuild. The finding itself came from on-device captures; the
strap-scale question is **not** resolved and is not claimed to be.

## Next

Metronome-referenced strap captures at 80 / 120 / 150 bpm to settle the scale drift. 150 bpm
doubles as the **octave test**, which has still never been run — it is the range where a detector
is most likely to lock onto stride instead of step. Separately: audit `unpack27`'s column order
against `data_columns` to find what column 4 actually holds.
