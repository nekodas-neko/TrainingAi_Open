# Both recalibrations are live in production — verified on the first row each one wrote

**Date:** 2026-08-18 · **Agent:** Tuning · **Type:** verification, docs-only
**Closes:** the "verify the shipped recalibrations against production" item · **Updates:** Q-501

PR #77 measured, hours earlier the same day, that neither shipped recalibration had reached a stored
row: **0 of 96** derived rows carried a `readiness` model version and every stored score was
pre-recalibration. It predicted where the change would first appear — *"the first row carrying
new-model values **and** the `v3:ri5:2026-08-18` stamp will be the next day actually scored."*

That row now exists. This is the verification.

---

## 1. Readiness — stamped, and the JSONB merge held

**1 of 96** rows now carries a readiness model version, written **2026-08-18 04:38:27**:

```
day             2026-08-18
model_versions  {"bodyComp": "atlas_2_1_0", "readiness": "v3:ri5:2026-08-18"}
readiness_score 76
readiness_source ble-derived
```

Two things confirmed at once:

1. **The stamp is exactly the shipped constant** — `v3:ri5:2026-08-18`.
2. **`bodyComp` survived** — the readiness write's own merge is correct.

> **⚠️ CORRECTED 2026-08-18, same day.** This section originally concluded that the shared-JSONB merge
> *"is now observed working against production data rather than argued for"*. **That was true at
> 04:38:27 and false by 10:18:40**, when a sibling writer rewrote the row as
> `{"bodyComp": "atlas_2_1_0"}` — the `readiness` key gone, stamped rows across the table back to
> **0**. `upsertOuraDailyDerived` sets every column with `COALESCE(excluded, existing)`, which for a
> `jsonb` column replaces the document whole, so the merge is left to each caller and only the
> readiness one does it. **The readiness write merges correctly; the result does not survive the next
> body-composition backfill.** Filed as **Q-518**,
> [`docs/reviews/2026-08-18-model-version-clobber.md`](2026-08-18-model-version-clobber.md).

---

## 2. Sleep — no stamp, so it was verified by recomputation

Sleep shipped without a model version, which is the known gap that left an unmarked step in its trend
chart. But the recalibration is testable without one: v1.319.0 added a final `SCORE_CALIBRATION` on
top of the weighted blend, and `interp` is **not** the identity anywhere in the usable range. So the
stored score tells you which model wrote it.

Both days' contributors are persisted, so the blend can be recomputed exactly:

| day | stored | raw weighted blend (old model) | calibrated (new model) | verdict |
|---|---|---|---|---|
| 2026-08-17 | **78** | **77.91** | 70 | **old model** |
| 2026-08-18 | **92** | 86.07 | **92** | **new model** |

Unambiguous — the two candidates differ by 8 and 6 points respectively, and each day matches exactly
one of them. **The step in the sleep trend falls between 2026-08-17 and 2026-08-18.**

**Be precise about what this proves.** Each row's `sleep_contributors` are whatever sub-scores *that
row's own model* produced, so the test asks only one question: is the stored score the plain blend of
them, or the blend passed through `SCORE_CALIBRATION`? That identifies whether the **final calibration
step** ran — the recalibration's distinguishing addition — and it is decisive for that. It does **not**
independently verify the nine re-shaped contributor curves, because a curve change is invisible once
its output is persisted as a sub-score. The curves shipped in the same release (v1.319.0) as the
calibration, so the inference that they are live too is sound, but it is an inference and not a
measurement.

### 2.1 The recalibration is not a uniform reduction, and this night shows it

2026-08-18's score went **up**: raw blend 86.07 → calibrated 92. That is the calibration working as
designed, not a contradiction of "the mean fell 84.1 → 69.5". `SCORE_CALIBRATION` compresses the
bottom, stretches the middle downward, and lifts the upper-middle — a genuinely good night still
reads as a genuinely good night. Anyone checking "did the recalibration land?" by looking for a
*lower* number on a good night will conclude wrongly.

### 2.2 This is a reusable test

Where a model ships without a version stamp, **checking whether the stored score is the plain
combination of its own persisted inputs or the post-processed one** identifies which model wrote the
row, provided the two differ by more than rounding that day. It cost one query and one short script.

Its limit is the one in §2 above and it is worth stating as a general caveat, because it is easy to
over-read: **the test only sees post-processing steps, never changes upstream of the persisted
intermediate.** Persisted contributors are already the new curves' output on a new-model row and the
old curves' output on an old-model row, so nothing about the curves themselves can be recovered from
them. A worked example of getting this wrong: applying `SCORE_CALIBRATION` to *historical* rows'
contributors and reading the result as "what the new model would have scored that night" produces a
hybrid — new post-processing over old curves — that is not either model. It reads as the recalibration
*raising* the mean, which is backwards.

So this substitutes for a stamp on the last stage only. It does not replace the stamp.

---

## 3. What this changes

- The **"nothing has landed"** finding in PR #77 and in Q-501 is now **superseded for both pillars** —
  it was true when measured and is no longer true. Both are live.
- **95 of 96 rows are still pre-recalibration** and will stay that way: stored scores are only
  rewritten when the route recomputes, which happens on app open for the current day. History is not
  back-filled. Any trend chart spanning 2026-08-17 → 08-18 crosses a model change.
- **Q-501's substance is unaffected.** The finding there is that a stored derived row cannot be
  re-derived from the inputs stored beside it, and that `updated_at` does not identify the writing
  model. Both still hold — §2 above worked only because sleep's *contributors* happen to be
  persisted alongside the score.

---

## 4. What was not exercised

- **Nothing on-device**, and no code changed.
- **The nine re-shaped sleep curves were not independently verified** — only the final calibration
  step was, for the reason in §2. They shipped in the same release.
- **The band consequences of the sleep recalibration are not re-opened here.** They were measured and
  deliberately accepted at ship time (`scoreBand()`: the 50 boundary 1 → 6 days, the 70 boundary
  12 → 15), and the recalibration review records that more days reading "Low" is the point rather than
  a side effect.
- **The readiness score itself was not recomputed** — unlike sleep, its contributors alone do not
  determine the score without the baseline state, so §1 rests on the stamp rather than on arithmetic.
- **A single row.** One stamped readiness row and one new-model sleep row is enough to prove the code
  is live; it is nowhere near enough to characterise the new distributions in production. The
  distribution work in the two recalibration reviews was done on replays and stands separately.
- Every figure is **the owner's** (`claude_ro` is row-scoped), pulled 2026-08-18 ~05:00 UTC.
