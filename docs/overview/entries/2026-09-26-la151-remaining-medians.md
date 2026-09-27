# 2026-09-26 — LA-151: one `median`, one `lowerMedian`, and four that stay private

**Branch:** `refactor/la151-remaining-medians` · **Lane A** · closes `LA-151`, files `LA-154`.

`LA-148` consolidated six copies of the median into `packages/shared/src/stats.ts` and said four
remained. `LA-151` said eight. The census found **eleven**, and neither earlier count was low
because the work was hard — both were low because the grep was scoped. `LA-148` looked only in
`health/**`; `LA-151` looked where `LA-148` pointed, inheriting that blind spot and adding two of
its own.

The census that settles it is one line:
`grep -rn "length % 2" packages/shared/src lib app`, plus a scan for `function median*`.

## What moved

Nine consolidated: `hr-recovery-by-exercise`, `sleep-score`, `temperature-baseline`'s frame
series, `hrr-trend`, `cadence-tracker`, `auto-detection-service`, `daytime-stress`,
`device-comparison`, `oura-ble/decode` — plus `acwr.ts` earlier.

**No number moved.** Every one already averaged the two middles; what differed was the empty case,
and each was decided from its callers rather than swapped: `hr-recovery`'s NaN sat behind a
`length === 0` guard that made it unreachable, `cadence-tracker`'s `0` and
`auto-detection-service`'s `NaN` are kept as documented adapters because both feed a classifier
that takes plain numbers, and `decode`/`daytime-stress` already returned early on empty.

## `lowerMedian` is a concept, not a copy that drifted

Three callers want the LOWER of the two middles. `oura-models/daily-baselines.ts` and
`cumulative-stress.ts` mirror `torch.median` and their goldens pin it — 46.923 over 14 symmetric
values only comes out of the lower middle. `/api/oura-ble/step-counter-export` is a diagnostic
console where averaging `[1, 2, 3, 4]` into 2.5 Hz reports a stride frequency the ring never
decoded. It is now one named function in `stats.ts` with that reasoning attached, and a docstring
saying to use `median` unless you can name which of the two reasons applies.

**I consolidated that third one to `median` first, and the suite caught it** — a test named
"taking the LOWER median of an even count" whose comment said the route *"deliberately takes an
actual observed value rather than inventing one between two."* The reason was written down; I
changed the code before reading it.

## Four stay private, with the reason recorded so they are not re-swept

`sleep-staging.ts` is nearest-rank — a different definition, and the file's own `quantile` is used
at q=0.05 and `WAKE_MOVE_QUANTILE`, so moving the median alone would leave two definitions in one
file. `hrv-5min.ts` is pinned to a `torch.quantile` citation and equal to canonical at q=0.5.
`temperature-baseline`'s `median7` is `sorted[3]` of a fixed 7-slot ring buffer in a per-sample
loop. And `daytime-stress`'s `hrMinMedianMax` is **not a median** — it reads positionally from an
already-ordered `[min, median, max]` triple.

That last one bit me in both directions. A first pass read only the positional helper and
concluded the file had no median copy, which would have written a wrong correction into the
backlog; the census found the file's *other* function, a real median at line 186, which is now
consolidated.

## Verification

- Full suite green; lint **831**, exactly baseline; `check-test-typecheck` 317 across 88 files,
  none above baseline; Custom Rules **80 of 80**.
- Mutation pass, 3 real mutants + 1 equivalent control. `lowerMedian` returning the upper middle
  killed 2 (the export route and a torch golden); the temperature series taking the lower middle
  killed 1; the control (`=== null` → `== null` on an already-nullable) survived.
- **One mutant survived and it was worth chasing.** Removing `auto-detection-service`'s
  `Number.isFinite` filter killed nothing. It is not an equivalent mutant —
  `median([Infinity])` is `Infinity` filtered vs `NaN` unfiltered — but it is unobservable through
  every caller: `classifyGait` guards `Number.isFinite` on all three features itself and answers
  `idle`, and the only other consumer is a calibration console. Its sibling `cadence-tracker` has
  never filtered. That asymmetry is now a comment in the file saying it is belt-and-braces and not
  a bug to unify, because unifying it in the wrong direction would change device gait
  classification for no reason.

**Not exercised:** no device. `cadence-tracker` and `auto-detection-service` are both APK-only
paths — their callers decode live ring frames, and nothing in the sandbox produces one. The
consolidation is behaviour-preserving by construction (same tie-break, empty case unreachable at
n=1), and the ported-model goldens cover `lowerMedian`'s two other callers, but the gait path
itself was not run on hardware.

## Filed

`LA-154` — `typicalSessionVolumeKg` is a dead input threaded through ~6 files into a function that
never reads it, left behind when `Q-190` replaced the volume lane's denominator. Declined here
rather than widening a math consolidation into a type-surface change.
