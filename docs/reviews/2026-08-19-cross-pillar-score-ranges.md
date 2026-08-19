# Every pillar's range side by side — and why range alone is the wrong test

**Date:** 2026-08-19 · **Agent:** Tuning · **Type:** cross-pillar synthesis, docs-only
**Filed as:** no new Q — every component is already filed; this is the **comparison**, which existed
nowhere · **Lane:** n/a (nothing to implement)

The owner asked whether all pillars actually move through the range — near-100 on good days, under 50
on bad ones — and whether that is a useful statistic to judge a score by.

**Answers: no, only one does; and it is a good first filter but a bad verdict.**

---

## 1. The comparison

Stored production rows, `claude_ro`, pulled 2026-08-19:

| score | n | range | mean | sd | < 50 | ≥ 85 |
|---|---|---|---|---|---|---|
| **Body Battery** (`body_battery_daily.end_value`) | 51 | **0 – 100** | 50.7 | **29.6** | 24 | 5 |
| sleep — **old model** | 36 | 15 – 97 | **85.3** | 16.4 | 2 | **27** |
| readiness | 35 | 29 – 87 | 68.2 | 13.4 | 5 | 1 |
| **activity** | 23 | 64 – 91 | 75.2 | **6.0** | **0** | 1 |
| illness *(inverted — low is good)* | 46 | 0 – 38 | 7.3 | 7.2 | — | 0 |

### 1.1 Reading it

- **Only Body Battery genuinely spans**, and even that overstates itself: **5 of 51 days sit exactly on
  0 or 100**, so part of the span is the clamp rather than resolution.
- **Sleep's 85.3 is the OLD model** — 27 of 36 nights at 85+. That top-heaviness is exactly what Q-503
  recalibrated; the replay of the shipped curves gives **mean 69.5, sd 16.6, range 32–99**. Stored rows
  have not caught up, and **Q-518** explains why even the one row that did was partly rewritten.
  **Do not read the 85.3 as the current model's behaviour.**
- **Activity is the most compressed thing in the app** — sd **6.0**, **zero** days under 50, everything
  inside 64–91. Q-505's redesign exists for this.
- **Readiness** sits mid-range and reaches neither end often (one day ≥ 85 in 35).
- **Illness** is inverted and never crosses its own `watch` threshold of 40 — Q-506.

---

## 2. Why range is a good first filter

It is one query, and it catches the **"stuck score"** class immediately. Everything it caught this
sweep:

| finding | what range showed |
|---|---|
| Q-508 resilience | **one value ever** — level 5, granular pinned at the 5.99 clamp, 13/13 rows |
| Q-506 illness radar | peaked at 38 against a threshold of 40 — **never fired** |
| Q-137 `strengthFreq` | **exactly 100 on all 91 days** |
| Q-505 activity | sd 6.0, no day under 50 |
| Q-516 `PEAK_BANDS` | 2 of 5 bands **structurally unreachable** |

A score that cannot move cannot inform anything, and no amount of correlation analysis is needed to
see it. **Start here.**

---

## 3. Why it is a bad verdict — three ways it misleads

### 3.1 Clamping manufactures range

Body Battery reaches both rails partly *because* it clamps to 0–100. **Spanning a range is not the
same as resolving it.** A score that saturates at both ends looks maximally healthy on this statistic
while carrying less information than its span implies.

### 3.2 It says nothing about whether the movement is CORRECT

**This is the important one, and Q-507 is the worked example.** `stress_high_minutes` has a perfectly
respectable spread — 0 to 180, a defensible 16% firing rate — and it correlates **+0.40 with
readiness**. The four days that trip the deload override average readiness **79**; the twenty-one that
do not average **65**. The signal moves beautifully, and it points the **wrong way** for the decision
it drives.

**A score can have a textbook distribution and be wrong.** Range cannot see this. Only a comparison
against something the score did not come from can.

### 3.3 A wide range can be amplified noise

Sleep's `SCORE_CALIBRATION` deliberately turns ~4 blend points into ~12 displayed points around the
median. That is how the range was bought, and it is a **stated cost** — the baton already carries an
instruction to flatten the 74–85 segment if the new spread reads as jitter rather than signal.

Widening a score's range is easy. Widening it without inventing resolution that is not in the inputs
is the hard part.

---

## 4. The statistic to use instead

A **pair**, not a single number:

1. **Does it move?** — spread and band shares. Cheap, catches the stuck-score class.
2. **Does it move with something it did not come from?** — a correlation against an independent signal.

Step 2 is what separates Q-507 (moves, wrong direction) from Q-503 (moved too little, fixed) — and
nothing in step 1 could have told them apart.

**A useful third, where it exists:** how many days sit exactly on a clamp bound. It is one `CASE WHEN`
and it distinguishes real span from saturation — 5 of 51 for Body Battery, 13 of 13 for resilience's
granular value.

---

## 5. What was not exercised

- **No code changed and no new measurement was taken** beyond the aggregates above — every underlying
  finding is already filed under its own Q number, with its own caveats. **This document adds the
  comparison, not evidence.**
- **The rows are stored values, so they reflect whichever model wrote them** — most importantly sleep,
  where 36 rows are the pre-recalibration model and the current model's behaviour is known only from
  replay. Q-518 means the stamp that would identify the writing model does not survive, so **this table
  cannot be re-derived per-model from stored data.**
- **`n` differs per score** (23–51) because coverage differs; the columns are not the same days, and
  no attempt was made to restrict them to a common window.
- **Activity's 23 rows predate Q-505's redesign**, which is unbuilt — so its sd 6.0 describes the
  current implementation, not what is planned.
- Every figure is **the owner's** (`claude_ro` is row-scoped).
