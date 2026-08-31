# 2026-08-31 — BF-2 steps 1–2: the DEXA correction exists, and nothing reads it yet

**Branch:** `feat/dexa-body-fat-calibration` · **Lane A** · JS/server only, no APK needed.
**No behaviour changed** — that is deliberate and is the point of the split.

Steps 1 and 2 of [the plan](../../superpowers/plans/2026-08-31-dexa-filter.md): the calibration as a
pure function, and the one repository read that derives it. Steps 3 (the sweep of the consumers) and
4 (the payload field) are **not** built, so no calorie goal, protein dose, RMR or panel has moved.

## No table, no migration — the pairs are derived

The entry assumed a stored set of `(scan, scale)` pairs. Both halves are already first-class rows —
`dexa_scans.scanned_on`/`pct_fat` and `body_metrics.date`/`body_fat_pct`, keyed by
`source_map->>'body_fat_pct'` — so a stored pair is a **stored counter wearing a different hat**, and
every one of those in this project has drifted. `getBodyFatCalibration` reads both sides and pairs
them in TS.

The pairing is in TS rather than SQL for a specific reason: the rule that has to be tested is the
rule (±3 days, nearest wins, each row used once), and it is testable as a pure function only if it
lives in one. Neither side is large — a handful of scans against one row per day.

## Offset, not ratio, and the reason is about the future

At n = 1 the two forms agree exactly on the observed point and diverge everywhere else. A ratio
asserts the bias scales with the reading — at 5 % it would imply a gap of 0.6 points. An offset
asserts only the gap that was measured. One pair supports neither, so prefer the one that makes no
claim about readings never observed.

The property that says the form fits its own measurement is pinned as a test: re-correcting the very
reading the calibration came from lands **exactly** on the DEXA's 28.5 %.

## Two distinctions the code refuses to collapse

**`null` calibration is not a zero offset.** `deriveBodyFatCalibration([])` returns `null`, and
`CorrectedBodyFat.corrected` is set from *whether a calibration applied*, never from
`pct !== rawPct` — an offset can legitimately round to zero, and "not corrected" and "corrected by
0.0" are different claims that the UI says differently. Both are mutation-proven.

**An unknown instrument is not this one.** A reading whose `source_map->>'body_fat_pct'` is `null`
reads uncorrected, which is **two-thirds of the owner's history**: measured in production, the three
instruments occupy contiguous eras — no provenance 2026-05-07 → 06-23 (40 rows), `health_connect` to
08-01 (11), `scale_ble` from 07-29 (31). Those 40 rows are *probably* the same scale, and "probably"
is exactly how a calibration reaches an instrument it was never measured on, which the owner's own
refinement ("per measurement system, not global") rules out.

## Verified

- **19 unit tests + 6 DB-backed tests. Thirteen mutations, all killed:** the source check, a `null`
  source treated as a match, the plausibility refusal, empty-pairs-as-zero-offset, `corrected`
  inferred from the value, the ±window, nearest-vs-first, one reading pairing twice, the source
  filter in pairing, the candidate sort (order dependence), and — on the adapter — each of the two
  `user_id` predicates and the `source_map` key path.
- **Exercised against production-shaped rows** on the dev server: three contiguous instrument eras
  seeded as production has them, one DEXA on 2026-08-27. Result: offset **+3.2**, **3 of 11**
  readings corrected, the scan day landing on exactly 28.5, every other era untouched with
  `corrected: false`.
- Full suite **679 files / 5,723 tests** green · `pnpm check:rules` **Ran 63 of 63** · `tsc` clean.

## What step 3 has to decide, and the number that decides it

`listBodyMetrics` has **22 call sites**. That makes correcting *inside* the read attractive — a missed
consumer becomes impossible, which is what the sibling-surface rule actually wants — and dangerous,
because a read-then-write path would persist a corrected value into the raw column, and the whole
design rests on `body_metrics.body_fat_pct` staying archival. **Measure which of the 22 write back
before choosing.** That measurement was not done here, which is why step 3 is not in this PR rather
than being in it half-considered.

`personalRmr` is the consumer that must not be missed when step 3 lands: feeding it the uncorrected
scale number re-scales a measured RMR's residual onto **+45 kcal/day** of fat-free mass the owner
does not have.

## Not exercised

No runtime surface — nothing calls the new code yet, so there was no route or screen to exercise on
`pnpm dev`. Device, safe-area, native SQLite and WebView paths do not apply. The production reads
behind the era table are **row-scoped to one user**, so the counts are *the owner's*.
