# ACWR — the thresholds are right, and two of the three things computing them are not

**Date:** 2026-08-18 · **Agent:** Tuning · **Type:** calibration evidence, docs-only
**Filed as:** Q-512 (dead path) · Q-513 (band divergence) · **Lane:** A implements (this proposes only)
**Scope note:** the **workouts** pillar had **zero** calibration coverage — this is the first review of
it. The earlier sweep covered the health/recovery *scores*; `ACWR_THRESHOLDS` drives deload decisions
and had never been checked against the owner's own distribution.

**Headline: do not change the thresholds.** They are well-placed. The findings are that one caller's
ACWR is structurally always null, and the two that do work disagree on the band **38% of the time**.

---

## 1. The thresholds are correctly placed — recorded as clean

Replaying `computeVolumeAcwr` faithfully over **77 completed sessions / 109 days**
(2026-05-01 → 08-18), using the window the **decision-driving** caller passes (`signals.ts`, 28 days):

| | value |
|---|---|
| non-null days | 88 / 110 |
| mean | **0.99** |
| median | 1.05 |
| sd | 0.32 |
| range | 0.00 – **1.48** |

| band | days | share |
|---|---|---|
| `low` — "Undertraining" (< 0.8) | 16 | 18.2% |
| `optimal` (0.8 – 1.3) | 61 | **69.3%** |
| `high` (1.3 – 1.5) | 11 | 12.5% |
| `very_high` (> 1.5) | **0** | 0.0% |

Centred on **1.0** with about 70% optimal and a modest tail each side. That is what the literature
says a well-managed athlete looks like, and `{lowMax: 0.8, optimalMax: 1.3, highMax: 1.5}` divides it
sensibly. **Nothing to move.**

### 1.1 The emergency deload has never fired, and that is fine

`emergency-deload.ts` triggers at `acwr > 1.5`. The observed maximum is **1.48** — it has never fired
in 110 days.

**This is deliberately NOT filed as a finding**, and the contrast with Q-506 is the point. The illness
radar peaked at 38 against a threshold of 40 and *was* filed, because its input was provably broken
(one biomarker's baseline deviation was 18.7× too large). Here the input is healthy: a well-behaved
distribution centred on 1.0. A near-miss is a symptom, not a diagnosis — **the rule is "check the
input first", not "never touch a threshold that just misses".**

And an emergency deload that fires often is not an emergency. Zero firings across a period containing
no overreaching incident is the system working. Lowering 1.5 to make it fire would be manufacturing
alarms.

---

## 2. Q-512 — `health-insight`'s ACWR is null on 110 of 110 days

`app/api/ai/health-insight/route.ts` calls `computeVolumeAcwr` with
`repo.getWorkoutSessionsFrom(userId, subDays(new Date(), 7))` — a **7-day** session list.

`computeVolumeAcwr` gates on `spanDays >= minSpanDays` where `minSpanDays = 21`, and `spanDays` is
measured from the earliest session **in the list passed to it**. A 7-day list can never span 21 days,
so the gate can never pass.

**Confirmed by replay: 0 of 110 days produce a value.** This is not a data-coverage problem that
better history would fix — it is structural. The route computes a load object and reads `.acwr` from
it every time, and every time it is `null`.

**Proposal:** either widen that fetch to 28 days to match `signals.ts` (the fix, if the insight is
meant to mention training load) or drop the `computeVolumeAcwr` call and the `.acwr` read (the fix, if
it is not). Both are small. What must not happen is lowering `minSpanDays`, which would make *every*
caller's ACWR less trustworthy to rescue one that is mis-wired.

---

## 3. Q-513 — the audit panel and the engine disagree on the band 38% of the time

Three callers pass three different windows into the same function:

| caller | window passed | effect |
|---|---|---|
| `ai-periodization/signals.ts` | **28 days** | the intended 7:28 ratio — drives the next-session engine |
| `health-insight/route.ts` | **7 days** | always null (§2) |
| `score-audit/build-day-audit.ts` | **all history** | chronic = **lifetime** weekly average |

The chronic term is `chronicLoad / dataSpanWeeks` over whatever list it is handed, so passing the full
history turns ACWR from *this week vs the last four* into *this week vs the whole training history*.

Replaying both live variants across the same days:

| | 28-day (engine) | all-history (audit panel) |
|---|---|---|
| mean | 0.99 | **1.07** |
| median | 1.05 | 1.16 |
| `optimal` share | **69.3%** | 49.4% |
| `high` share | 12.5% | **29.2%** |
| `very_high` share | 0% | **3.4%** |
| days > 1.5 | **0** | **3** |

Mean absolute difference **0.150**, max **0.395**, and they land in a **different band on 33 of 88
days — 38%**.

### 3.1 Mechanism, and why it gets worse

The lifetime weekly average is **lower** than the recent baseline: 20,572 kg/week lifetime against
23,239 kg/week over the last 28 days, a ratio of **1.13×**. Dividing by the smaller denominator
inflates the ratio — which matches the observed inflation (1.07 / 0.99 ≈ 1.08).

**So the divergence grows with any sustained increase in training volume.** An athlete who
progresses makes the audit panel drift further from the engine, indefinitely. It is not a fixed offset
that could be tolerated.

### 3.2 Why it matters more than a display nit

`build-day-audit` is the **score-audit panel** — the surface whose entire purpose is to show a score
alongside *the inputs that produced it*. On 38% of days it shows a training-load band that is not the
one the engine used when it made the decision. On three days it shows `very_high` / past the
emergency-deload line while the engine saw at most `high`.

**Proposal:** pass a 28-day window in `build-day-audit`, matching `signals.ts`. The audit panel's
contract is to reproduce the decision, so it must use the decision's window. If a lifetime view is
independently wanted, it needs a different name — it is not ACWR.

**Then re-measure §1**, because the band shares above are the engine's; the thresholds were judged
against the correct variant, but the audit panel's numbers will move to match it.

---

## 4. What was not exercised

- **No code changed and no constant altered.**
- **The replay is a faithful port of `computeVolumeAcwr`, not the shipped function.** It reproduces
  the gates (`minSpanDays 21`, `minSessions 6`, `minChronicWeeklyLoadKg 100`), the rounded day span
  and the acute window. It was **not** validated against a stored ACWR, because **no ACWR is
  persisted anywhere** — there is no stored value to reconcile against. That is a real limitation of
  this review and the reason §1 is stated as "the thresholds fit this distribution" rather than "the
  shipped code produces these numbers".
- **Volume is `sum(weight_kg × reps)` from `set_logs`**, which is how the callers compute it
  (`ex.volume`), but bodyweight-load handling (`bodyweight-load.ts`) was not traced — three sessions
  carry zero volume and were left as zero rather than imputed.
- **`build-day-audit`'s `programTooNew` gate** (28 days from program start) is not modelled; it can
  null the audit ACWR independently, which would *reduce* the 38% disagreement on affected days.
  So 38% is an upper bound for the days the panel actually renders a band.
- **Nothing on-device**, and no owner-reported symptom prompted this — it is a proactive audit of an
  uncalibrated pillar.
- Every figure is **the owner's** (`claude_ro` is row-scoped), 77 sessions over 2026-05-01 → 08-18.
