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
2. **`bodyComp` survived.** The readiness stamp is written into a JSONB column shared across pillars,
   and that write was deliberately built as a merge rather than a replace. The concern was real
   (PR #77 found the 70 rows carrying any versions carried *only* `bodyComp`), and the merge is now
   observed working against production data rather than argued for.

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

### 2.1 The recalibration is not a uniform reduction, and this night shows it

2026-08-18's score went **up**: raw blend 86.07 → calibrated 92. That is the calibration working as
designed, not a contradiction of "the mean fell 84.1 → 69.5". `SCORE_CALIBRATION` compresses the
bottom, stretches the middle downward, and lifts the upper-middle — a genuinely good night still
reads as a genuinely good night. Anyone checking "did the recalibration land?" by looking for a
*lower* number on a good night will conclude wrongly.

### 2.2 This is a reusable test

Where a model ships without a version stamp, **recomputing both candidate models from the persisted
contributors and checking which one the stored score matches** is a complete substitute, provided the
two differ by more than rounding on the day in question. It cost one query and one short script here.
It does not replace the stamp — it needs the inputs persisted and the old model still legible — but it
means an unstamped recalibration is not unverifiable.

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
- **The readiness score itself was not recomputed** — unlike sleep, its contributors alone do not
  determine the score without the baseline state, so §1 rests on the stamp rather than on arithmetic.
- **A single row.** One stamped readiness row and one new-model sleep row is enough to prove the code
  is live; it is nowhere near enough to characterise the new distributions in production. The
  distribution work in the two recalibration reviews was done on replays and stands separately.
- Every figure is **the owner's** (`claude_ro` is row-scoped), pulled 2026-08-18 ~05:00 UTC.
