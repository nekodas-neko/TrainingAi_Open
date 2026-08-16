# 2026-07-27 — Cadence: metronome reference closes D-2, clears the strap, corrects the ring verdict

**Branch:** `claude/cadence-metric-ring-strap-6whk16`
**Follow-up to** [`2026-07-27-cadence-ring-gated-off.md`](2026-07-27-cadence-ring-gated-off.md),
**whose central claim this entry retracts.**

One metronome-referenced capture (set **120 bpm**, 149 s) settled three open questions at once.
The capture is worth more than the five counted walks before it combined, for one reason: its
ground truth is **set, not counted**.

```
strap avg 117.5   series 116.4 – 119.2 (14 bins)   strength 0.702
ring  capture-scoped windows: 1.9468 1.9522 1.9522 1.9681 1.9735 → median 1.9522 Hz
```

## 1. D-2 is CLOSED — ×60 is correct

Ring median 1.9522 Hz. ×60 = **117.1 spm**; the strap, independently, read **117.5**. Agreement
to **0.4 spm** between two sensors sharing no hardware and no code. ×120 would be 234 — outside
`MAX_PLAUSIBLE_SPM` and nowhere near the strap. `stride_frequency` is a step rate.

## 2. The strap has no scale error — the ratio drift was manual counting

The open concern was strap/counted ratios of 1.00 / 1.04 / 1.08 at 64 / 96 / 114 spm, which
could have been a DSP scale term or progressively low hand counts. Two independent proofs it
was the counting:

- **Synthetic sweep** (now a permanent regression test in `lib/health/__tests__/cadence.test.ts`)
  over a realistic non-sinusoidal gait waveform — asymmetric footfall plus a stride harmonic,
  deliberately not a sine, because a sine has no harmonics and a parabolic autocorrelation fit
  is biased by harmonic structure. `detectCadence` returns **+0.1% flat from 64 to 170 spm**;
  120 spm across 109 window offsets returns 120.0–120.1. There is no scale term to find.
- **The capture itself.** Both sensors read ~2% *low* against 120 bpm. A shared reading error
  would need a mechanism the two do not share; the parsimonious reading is that the stepping was
  2% behind the metronome.

Hand counts run progressively low as pace rises (57 steps in 30 s vs 32). **The DSP was never
wrong.** Metronome reference is now the standard for cadence ground truth, and the domain doc's
calibration guidance says so.

## 3. The ring verdict was wrong — it is octave-ambiguous, not flat

The previous entry concluded the ring "does not track cadence", from a 64 spm walk reading
~0.98 Hz and a 114 spm walk reading ~1.02 Hz — flat across a 1.8× change. Fitting all three
captures against step rate *and* stride rate shows what actually happened:

| counted | ring Hz | vs step rate | vs stride rate |
|---|---|---|---|
| 64 spm | 0.98 | −8% ✅ | +84% |
| 114 spm | 1.02 | −46% | **+7% ✅** |
| 120 spm | 1.952 | **−2% ✅** | +95% |

The 64 and 114 captures landed on **opposite sides of an octave split**. Comparing exactly those
two — which is what the flatness argument did — is the one comparison that hides a working
signal. The same failure mode `bandAutocorrPeak` already corrects on the strap path.

This also retracts the retraction's *other* claim, that `unpack27`'s column order was the leading
suspect. A wrong column would not track cadence at all, and here it does.

**The gate stays FALSE.** One clean capture is not enough, and an uncorrected octave error ships
a number wrong by 2×, which is worse than none. But the path is now concrete — octave-correct the
ring, re-validate across metronome-set cadences — rather than a hunt for a decoding bug.

## Method note

Two counted walks disagreeing is not evidence about a sensor until the counting is ruled out.
Both wrong ring conclusions came from treating hand counts as ground truth. The lesson is in the
domain doc now: prefer a set reference over a counted one whenever the quantity being measured is
the same one the human is counting.

## Verification

`tsc` clean, lint 0 errors, full suite green. Three new regression tests pin the no-scale-error
result. No behaviour change — the ring stays gated, the strap DSP is untouched (deliberately:
tuning it against the same data used to judge it would make the next capture meaningless).

## Next

Metronome captures at **80** and **150 bpm** to pin the range; 150 doubles as the octave test,
never yet run. Then octave-correct the ring against those and reconsider the gate.
