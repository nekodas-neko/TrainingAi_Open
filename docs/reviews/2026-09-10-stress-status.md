# The stress metric: what shipped, what did not, and what cannot be tested yet

**Filed:** 2026-09-10 · **Agent:** Tuning · **Entries:** TN-33, amends TN-22 ·
**Owner:** *"can you give me the update on our stress reading/calculation? give me the history; what
it did; what it does now — how does it work? how can we test it works?"*

**Two answers, and they point opposite ways.** The storage defect TN-22 found is **fixed and
holding** — verified today, 10 of 10 days. The sign problem TN-22 claimed to have *explained and
reversed* is **not resolved**, and ten more days of data have made it look worse rather than better.

---

## 1. How the calculation works

The ring measures HRV densely only during sleep. Daytime HRV is **imputed**, and everything else
follows from that number:

1. **Impute daytime HRV** (`lib/health/daytime-stress.ts`) from a short window of skin temperature,
   MET and heart rate plus personal baselines — ten features, the Preprocessor ported verbatim.
   D5 added a second path (`daytime-hrv-model.ts`): a per-user OLS fit of
   `ln(rmssd) = a + b·hr + c·temp` trained on **this owner's own night-time `0x5d` HRV events**.
2. **stress = dhrv − dhrv_baseline** — negative means below your own baseline, i.e. stressed.
3. **Scale it** through saturation curves anchored on the night-HRV baseline into a level in
   **[−1, +1]** (`daytimeStressLevel`).
4. **Bucket it** into 30-minute buckets (`STRESS_BUCKET_MS`), persisted to
   `oura_daytime_stress_buckets` (TN-3a's persistence half).
5. **Summarise the day** (`summarizeStressDay`): `daytime_stress_scaled` is the mean level;
   `stress_high_minutes` counts buckets at or below **`STRESS_HIGH_LEVEL = −0.5`**;
   `recovery_high_minutes` counts buckets at or above **+0.5**.

**Where the number is consumed:** the Body Battery adds extra drain proportional to how far below
baseline the moment sits (`app/api/body-battery/route.ts`), the stress strip renders the buckets, the
weekly digest reads a scalar, and the next-session engine treats a day over
**`STRESS_HIGH_DAY_THRESHOLD_MIN = 120`** as deload-worthy.

---

## 2. The history

| when | what |
|---|---|
| — | **Q-507 filed**: high-stress minutes correlate **+0.40** with readiness — more stress on *better* days. |
| — | **Two mechanisms proposed and refuted.** Data density: r = −0.128 against HR sample count. TN-21's bucket count: −0.784. **Both explained an artefact of the stored value, not the model.** |
| — | **TN-21**: the "daytime" series is **55% night buckets** (126 of 230 between 22:00 and 06:00). Night mean **+0.266**, day mean **−0.413** — opposite signs, night in the majority, so a daily aggregate tracks the night/day mix. |
| — | **TN-3a's persistence half shipped** (migrations 212/213), which is what made everything below measurable. |
| 2026-08-31 | **The fix shipped** — commit `7c428a7f`, *"Give the daytime-stress strip and its scalars one producer"*. |
| 2026-09-01 | **TN-22 filed**, reporting that stored `stress_high_minutes` disagreed with the model's own buckets on **8 of 9 days**, and claiming this *"explains Q-507 and reverses it"*. |

**The root cause, from the fix's own commit message:** *"The rollup wrote the buckets and the route
wrote the three daily numbers, each from a series built off a different heart-rate baseline."* Two
producers, two answers, for the same day. The rollup now summarises the same points it buckets, in
the same block; the route computes a summary for its response and **stores nothing**;
`scripts/check-stress-scalars-one-writer.js` fails CI on a second persister.

**⚠ Note the ordering — the fix landed 2026-08-31 and TN-22 was filed 2026-09-01 against data the fix
had already corrected going forward.** The entry is still in the queue as if open.

---

## 3. What is fixed — verified 2026-09-10

Stored `stress_high_minutes` against the same quantity recomputed from `oura_daytime_stress_buckets`:

| window | days | verdict |
|---|---|---|
| **2026-09-01 → 09-10** | 10 | **10 of 10 match exactly** |
| 2026-08-24 → 08-31 | 8 | **8 of 8 disagree** — by +60 to +270 minutes, four of them storing **0** against 210–270 real bucket-minutes |

A clean break on the day the fix deployed. **The storage defect is closed.**

**⛔ Stored history before 2026-09-01 is still wrong and was deliberately left alone** — only 8 of the
38 rows carrying a value have buckets to re-derive from, so a partial recompute would leave the column
more mixed rather than less. **Any correlation run across that boundary is measuring two different
quantities.**

---

## 4. What is NOT fixed — and TN-22's sign claim does not survive

Recomputing high-stress minutes **from the buckets** on every day that has them — one consistent
quantity, immune to the storage defect — against readiness:

| window | n | corr(high-stress minutes, readiness) |
|---|---|---|
| pre-fix, 2026-08-24 → 08-31 | 8 | **−0.395** (the right way) |
| post-fix, 2026-09-01 → 09-10 | 10 | **+0.427** (the wrong way) |
| **all days pooled** | **18** | **+0.072** |

**The two halves point in opposite directions and the pooled answer is nothing.** The waking-window
variant behaves the same (−0.444 → +0.526, pooled +0.049), and the mean-level variant flips too
(+0.287 → −0.462, pooled −0.001).

**So TN-22's conclusion needs amending.** It found a real defect and the fix for it was correct. Its
second claim — that recomputing from buckets *"flips the sign to correct"* and therefore explains
Q-507 — rested on **eight days**, and the next ten reversed it. **Q-507 is not explained. The current
best reading is not "the sign is backwards" but "there is no measurable relationship at all"**, which
is the harder problem: a wrong sign is a bug to find, no signal may mean the metric carries no
information about this user's readiness.

**⚠ This is the third mechanism proposed for Q-507 and the third to fail.** The baton already says
*"stop proposing them"*; this review adds the reason the first two failed applies here too — **every
one of them was fitted on fewer than ten days.**

---

## 5. Why it cannot be validated right now, which is the real blocker

Readiness is a poor target: it is built from the same overnight autonomic signal the stress model
takes its baseline from, so agreement would be partly circular and disagreement is hard to read.

**The independent target is the owner's own check-in, and it currently has no variance:**

- **`perceived_recovery` is `3` on all 17 days that have both a check-in and buckets.** Across 29
  check-ins since 2026-08-24, **`perceived_recovery_touched` is 0** — the field has never been
  touched, so every value is the default.
- **`mental_drain` and `physical_tiredness` are NULL on all 29.**

**A constant cannot correlate with anything.** So there is presently **no target with variance** that
is independent of the Oura model, and no amount of additional days settles Q-507 without one.

---

## 6. How to test it — three levels, in order of what they can prove

**Level 1 — does the pipeline agree with itself? (automated, already shipped.)**
`scripts/check-stress-scalars-one-writer.js` fails CI on a second persister. The data-side check is
one query: recompute high-minutes from `oura_daytime_stress_buckets` and compare with
`oura_daily_derived.stress_high_minutes`. **Expected: exact match on every day from 2026-09-01.**
This proves consistency and nothing about correctness.

**Level 2 — does it respond to a known stressor? (the cheapest real test.)** Pick a day with a
genuinely stressful block the owner can name in advance — a hard meeting, a bad night, a deliberate
caffeine-and-deadline afternoon — record the window, and check whether the buckets in it go negative
relative to that day's own mean. **This is the first test that could actually fail**, and it needs one
day rather than a month.

**Level 3 — does it predict anything? (validation, currently blocked.)** Needs an independent target
with variance. **Fill `perceived_recovery` honestly for ~3 weeks** — it takes a tap, it is already on
the check-in, and it is the one signal in the system that owes nothing to the ring. Then re-run §4.
**⛔ Do not re-run §4 before that**: another ten days of readiness correlations will produce another
number between −0.4 and +0.4 and settle nothing.

**⛔ Do not build TN-16** (the prolonged-stress warning and calm-down prompt) **until level 2 passes.**
A warning fired off a metric that has never been shown to track anything is worse than no warning —
it converts a silent uncertainty into a demonstrated one, which is the TN-19 lesson.

---

## 7. Addendum — the owner asked for the chart, which unparks TN-3b and is the level-2 test

**Owner, 2026-09-10:** *"Can we have this displayed on a widget or chart so we can see when the
stress occurs. I will be able to match it up based on time to what I was doing around then."*

**Yes, and it should be built next.** TN-3b has been parked on Q-507's sign since 2026-08-24. **That
parking was right for a score and is wrong for a chart.** The owner is not asking for a verdict — he
is asking to see measured levels against a clock and supply the ground truth himself. §5 established
there is no independent target with variance; **his recall is the only one available**, and this is
the surface that collects it.

**⚠ TN-3a's stated blocker is also gone** — the bucket table is live with **478 buckets over 18
days**, which nobody had noticed on the entry.

### What the chart shows before anyone builds it

2026-09-10, by local time — **06:45 → 15:15 unbroken negative, six buckets past −0.5**:

```
06:45  -0.52 HIGH      12:15  -0.62 HIGH
09:15  -0.51 HIGH      12:45  -0.69 HIGH
11:15  -0.47           13:45  -0.74 HIGH
                       15:15  -0.80 HIGH
```

Against 00:15–06:15 running **+0.30 to +0.81**. **The daily scalar for that day is −0.02**, because
the night positives cancel the day negatives. **The chart is strictly more informative than the number
it summarises.**

### And it replicates TN-21 at eight times the sample

| window | share of buckets | mean level | high | recovery |
|---|---|---|---|---|
| **night 22–06** | **57%** | **+0.266** | 16 | **98** |
| day 07–21 | 43% | **−0.405** | **101** | 6 |

TN-21 measured 55% / +0.266 / −0.413 on 230 buckets; this is 478 and lands in the same place. **A
"daytime stress" average that is 57% night is mislabelled regardless of any correlation** — and it is
why §4's daily numbers carry no signal. **⚠ It does not follow that a waking-only aggregate would**:
§4's waking-restricted variant flips just as hard (−0.444 → +0.526).

### Design constraints, each measured rather than assumed

1. **Local-time axis, 30-minute resolution.** `components/body-battery/stress-strip.tsx` already
   renders today's series — as a **sparkline with no time axis**, which shows the shape and cannot
   answer *when*.
2. **⛔ Gaps stay gaps.** Coverage averages **26.6 buckets/day — 13.3 of 24 hours** (range 23–32), and
   2026-09-08 jumps **06:45 → 13:15**. A joined line invents stress that was never measured.
3. **Shade the night band**, or its systematic positivity reads as a compliment about your sleep.
4. **Mark zero and ±0.5** so "high" is legible from the shape.
5. **Past days reachable**, back to 2026-08-24 (TN-3a's back-fill `Keep:` still stands).
6. **⛔ No score, no verdict, no advice on this surface** — that is what makes it shippable while
   Q-507 is open, and what keeps it distinct from **TN-16**, which stays parked.
