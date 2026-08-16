# Oura BLE — LF/HF frequency-domain HRV as an independent REM signal

**Date added:** 2026-07-11
**Branch:** `feat/oura-ble-lfhf-rem-signal`
**Relation:** Phase-1 extension of backlog item 4 (`2026-07-09-oura-ble-accurate-sleep-staging.md`).
That item's Phase 1 (breathing-rate variability, `lib/health/breathing-rate.ts`) shipped and was
declared at its ceiling (session 250: REM ~8–17% vs the ~23–28% Cloud baseline). This adds a
*genuinely new axis of information* to the heuristic — autonomic balance — rather than re-weighting
the signals already in the stager. It does **not** claim Oura parity (that remains item 4's Phase 2
SleepNet route); it is the strongest remaining un-tried heuristic lever.

## Why this is a real, different lever

The stager (`lib/health/sleep-staging.ts`) currently discriminates REM from deep with **time-domain**
cardiac signals: `cardiac = zHrv − zHr` (RMSSD + mean HR), between-epoch HR stability (`zStab`),
within-epoch HR spread (`zHrVar`), and breathing-rate irregularity (`zBreath`). All are time-domain
views of the same beat stream.

**LF/HF is frequency-domain and physiologically independent.** Heart-rate variability partitions into
bands: **HF (0.15–0.40 Hz)** tracks parasympathetic (vagal, respiratory) tone; **LF (0.04–0.15 Hz)**
is a mixed sympathetic/baroreflex band. Their ratio **LF/HF** is the classic autonomic-balance index:
- **REM** — sympathetic-leaning → **LF/HF up**.
- **Deep NREM** — parasympathetic-dominant → **LF/HF down**.

This is a standard REM/NREM discriminator in the cardiorespiratory sleep-staging literature, and it is
*not* a re-slice of RMSSD/HR-spread — it is a different decomposition of the tachogram. That
independence is the whole point: a new term can move REM where re-tuning correlated terms could not.

**Honest caveat, stated up front — the interpretation is contested and the signal is density-gated:**
- The "LF = sympathetic" reading is debated in the HRV literature; LF is not purely sympathetic. We do
  not rely on the *mechanism* — only on the *empirical* REM>NREM separation of LF/HF, which holds in
  wearable studies. It is a discriminative feature, not a physiological claim.
- LF/HF needs **dense, continuous beats** within the epoch — more than breathing does, because the LF
  band (periods 6.7–25 s) needs a longer clean window to resolve. On epochs where the ring's IBI is
  sparse (the recurring `beats`-below-threshold problem), it must return null and stay neutral, exactly
  like `breathVar`. So it helps on beat-dense epochs and is silent on sparse ones — it raises the
  ceiling, it does not remove the density wall.

## What we already have to build on

`lib/health/breathing-rate.ts` already:
- filters IBI to a physiological band (300–2000 ms),
- builds beat-times and **resamples the tachogram onto an even 2 Hz grid** via linear interpolation
  (`grid[]`), then detrends it for the respiratory band.

LF/HF needs the **same even-grid resampled tachogram** but the *full* spectrum (no breath-band
detrend — instead a linear/mean detrend to remove DC), integrated over the LF and HF bands. FS = 2 Hz
gives a Nyquist of 1 Hz, comfortably above HF's 0.40 Hz upper edge. So the resampling machinery is
reusable; only the spectral step is new.

## Design

### Task 1 — factor out the shared resampler (small refactor)
Extract the "IBI → clean tachogram → even-grid resample" step from `breathing-rate.ts` into a small
shared helper (e.g. `lib/health/tachogram.ts` — `resampleTachogram(ibiMs, fs): number[] | null`),
returning the evenly-resampled series (or null when too few/short beats). Re-point `breathing-rate.ts`
at it so there is **one** resampler (One-Formula-One-Place). Keep `breathing-rate.ts`'s behaviour
byte-identical (its existing unit tests must still pass).

### Task 2 — `lib/health/hrv-frequency.ts` (new, pure)
`lfhfFromIbi(ibiMs: number[]): { lfhf: number | null; lf: number | null; hf: number | null }`:
1. `grid = resampleTachogram(ibiMs, FS=2)`; return nulls if null or too short.
2. Mean-detrend + Hann window the grid.
3. Periodogram via a small radix-2 FFT (zero-pad to the next power of two) — the grid is *evenly*
   resampled, so a plain FFT periodogram is correct (no Lomb-Scargle needed). Include a compact
   self-contained FFT (no new dependency) or a direct DFT over the ~600-sample epoch (cheap enough at
   5-min epochs; server-side, once per epoch).
4. Integrate power spectral density over **LF [0.04, 0.15] Hz** and **HF [0.15, 0.40] Hz**.
5. Return `lfhf = lf / hf` (guard hf>0), plus lf/hf for the debug dump. **Require a minimum beat count
   and minimum resampled span** (stricter than breathing's `MIN_BEATS`, e.g. ≥ 90 beats / ≥ 4 min of
   grid) — below that, return nulls so the term stays neutral. Values calibrated to the physiological
   band, not to one night.

Guardrails (match `breathing-rate.ts`): pure, deterministic, returns nulls on sparse/short input,
never throws. Bounds/clip `lfhf` to a sane range before it reaches the z-score.

### Task 3 — feed it into the stager
In `aggregateOuraRawSamples` (`lib/data/postgres/adapter.ts`), the epoch builder already collects
`b.ibi` per epoch and computes `breathVar = breathingFromIbi(b.ibi).variability`. Add
`lfhf = lfhfFromIbi(b.ibi).lfhf` to the `SleepEpoch`. In `lib/health/sleep-staging.ts`:
- add `lfhf?: number | null` to `SleepEpoch`,
- z-score it over the epochs that carry it (`zLfhf`, self-neutralising like `zBreath` — a night with
  too few beats leaves it 0 and all prior behaviour/tests are unchanged),
- add it as a REM term with a new tunable weight `W_LFHF`: high LF/HF ⇒ REM, low ⇒ deep — same sign as
  `zHrVar`/`zBreath`. It enters **only** the REM-advantage / depth scores, i.e. it rides through the
  existing per-bout Viterbi decode (session 259) unchanged.
- **Deep and the wake rules are untouched** (LF/HF is only another REM/light discriminator; it does not
  enter step 1 wake detection or the DEEP_Z cutoff's non-cardiac terms beyond the symmetric REM/deep
  contribution already used by the other variability terms).

### Task 4 — debug dump + tuning surface
Add an `lfhf` column to the `/admin/oura-ble` "Sleep epochs (debug)" per-epoch dump (alongside
`hrVar`/`brVar`), and to the `SleepNightDebug` type, so `W_LFHF` can be tuned against real nights the
same way `REM_Z`/`W_BREATH` were — and so the density-gating is visible (null `lfhf` = too few beats
that epoch).

## Testing
- `hrv-frequency.test.ts`: synthetic tachograms with a **known injected oscillation** — a signal with
  power concentrated in the HF band yields low LF/HF; one concentrated in the LF band yields high
  LF/HF; a flat/too-short/too-sparse input yields nulls. (Mechanics + null-safety, not tuned to a
  cutoff value — mirrors `breathing-rate`/`sleep-staging` test philosophy.)
- `tachogram.test.ts`: the extracted resampler reproduces `breathing-rate.ts`'s prior grid on a fixed
  vector (guards the refactor).
- Stager: a uniform/absent `lfhf` produces identical stages to omitting it (self-neutralising, exactly
  the `breathVar` neutrality test); a synthetic REM block with high-LF/HF tachograms grows REM
  proportionally.
- DB rollup: extend the staging-rollup test so the epoch builder passes `lfhf` through end-to-end.

## Verification & tuning (owner, post-merge)
Redecode real nights; read the new `lfhf` column in the debug dump. If REM is still under-read, `W_LFHF`
is the lever (raise it); check the `beats` column first — `lfhf` is null when the epoch's beat stream
is too sparse, in which case no weight change helps (the density wall). Compare per-night REM% against
the ~23–28% Cloud baseline and against nights the owner remembers.

## Honest limits
- **Density-gated:** silent on sparse-beat epochs (the ambiguous ones are often exactly these).
- **Unverifiable for true accuracy without ground-truth nights** — judged on ribbon plausibility +
  REM% vs baseline, same as the whole heuristic arc. It adds real independent information (best chance
  of actually moving REM), but it is not the trained-model parity path.
- **Not a parity claim.** Item 4's Phase 2 (SleepNet-moonstone, gated on owner model-key extraction)
  remains the only route to Oura-equivalent REM. This is the strongest *heuristic* lever left; it
  raises the floor, it does not reach the ceiling.

## Scope / runtime
Server/JS only (`lib/health/*`, the adapter epoch-builder, the admin debug dump). No APK rebuild.
Runs in the rollup off stored `body_hex`; Redecode restages history. User-visible (REM%), so an
implementer session ships it with a version bump + changelog + journal per CLAUDE.md.
