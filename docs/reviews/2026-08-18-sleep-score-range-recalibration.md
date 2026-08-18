# Sleep Score recalibration — using the range instead of the top of it

**Date:** 2026-08-18 · **Agent:** Tuning · **Type:** calibration + implementation
**Owner-directed:** *"Readiness/sleep and all the pillars are currently deemed non accurate while we
are tuning… free reign to continue changing this until it makes more realistic values — this should
be determined by days getting close to full and some days being low."*
**Shipped:** v1.319.0 · **Q-503** · Follows
[`2026-08-17-readiness-calibration.md`](2026-08-17-readiness-calibration.md)

The owner's acceptance test is a **distribution**, not a day: some days near full, some days low, and
a spread in between. This measures every pillar against that test, fixes Sleep (the one the owner
named), and hands over Readiness and Activity with the analysis done but not shipped — §6 says why.

---

## 1. All three pillars, measured against the owner's test

`claude_ro.oura_daily_derived`, every day with a score:

| pillar | n | range | mean | sd | ≥85 | <50 | verdict |
|---|---|---|---|---|---|---|---|
| **Sleep** | 35 | 31–97 | **87.4** | 11.4 | **27** | 1 | bunched at the ceiling |
| Readiness | 34 | 29–87 | 68.8 | 13.0 | 1 | 4 | best spread, but never reaches full |
| Activity | 22 | 56–91 | 74.6 | **7.3** | 1 | 0 | most compressed of the three |

Sleep is the one the owner called out — *"Sleep always hits high; but it does vary"* — and the data
agrees emphatically: **27 of 35 days ≥ 85, and not a single night between 40 and 69.**

---

## 2. Why Sleep pinned — two real defects, and one structural cause

### 2.1 Eight of ten contributors averaged ~90

Realised contributor sub-scores over 35 nights:

| contributor | mean | ≥90 | <70 |
|---|---|---|---|
| schedule | 94.4 | 20/23 | 1 |
| hrv | 92.8 | 21/27 | 2 |
| timing | 92.6 | 30/35 | 1 |
| hr | 92.0 | 17/23 | 2 |
| latency | 91.5 | 25/35 | 1 |
| rem | 91.3 | 27/35 | 1 |
| efficiency | 89.3 | 21/35 | 1 |
| totalSleep | 87.0 | 18/35 | 3 |
| restfulness | 84.1 | 10/35 | 2 |
| **deep** | **71.3** | 7/35 | **13** |

Only `deep` discriminated. Two causes were genuine defects rather than taste:

**Scoring your own baseline returned 90.** `HRV_RATIO` mapped a ratio of 1.0 — exactly your personal
norm — to **90**, and `HR_RATIO` mapped it to **86**. A self-referencing contributor whose *median*
input scores 90 cannot separate anything. Both now put 1.0 at **70**.

**The REM ceiling sat below the owner's median.** `REM` reached 100 at 2.2 h and 97 at 1.8 h. The
owner's median REM is **1.86 h** — so the median night scored ~97 on that contributor. Ceiling moved
to 3.0 h; 1.86 h now scores ~77.

The same pattern held across the curves generally, measured against the owner's own percentiles
(n = 65 main sleeps): median duration 7.84 h scored 89; median efficiency 92 % scored 90.

### 2.2 The structural cause, which the curves could not fix

Re-shaping all nine curves so a typical value lands mid-range moved the **mean** from 84.1 to 73.6
and left the **spread almost untouched — sd 15.9 → 14.9.** That is not a tuning failure, it is
arithmetic: the blend averages ten contributors, so its spread shrinks by roughly 1/√10 against
theirs.

The number that makes it concrete: **the blend's interquartile range was 6 points** (86–92 before,
74–81 after re-shaping). Half of all nights inside a six-point band. No amount of per-curve work
widens that.

So the fix is split in two, and this is the transferable part:

> **The contributor curves decide the RANKING of nights. A final calibration on the blend decides the
> RANGE.** They are separate problems and need separate levers.

---

## 3. What shipped

**`packages/shared/src/health/sleep-score.ts`** — nine curves re-anchored on the owner's measured
distribution, plus a new `SCORE_CALIBRATION` applied to the weighted blend (before the fragmentation
cap, whose anchors are written on the display scale).

**`packages/shared/src/health/rest-day-guidance.ts`** — `LOW_SLEEP_SCORE` 60 → **42**. See §5.

Result over the same 65 nights, **run through the shipped TypeScript**, not the analysis harness:

| | before | after |
|---|---|---|
| mean | 84.1 | **69.5** |
| sd | 15.9 | **16.6** |
| range | 21–97 | **32–99** |
| nights ≥ 90 | 31 of 67 | **7 of 65** |
| nights < 50 | 6 | **8** |
| empty bands | 40s–60s nearly empty | **none** |

Band histogram after: `30s:4 · 40s:4 · 50s:9 · 60s:16 · 70s:9 · 80s:16 · 90s:7`.

Ordering sanity — the top and bottom are the right nights:

| night | score | why |
|---|---|---|
| 2026-07-13 | 99 | 9.17 h, 95 % eff, 1.58 h deep |
| 2026-08-03 | 96 | 10.00 h, 92 % eff |
| 2026-08-12 | 70 | 8.50 h, 97 % eff — but only 0.75 h deep |
| 2026-07-11 | 33 | 7.00 h at 81 % eff, HRV 41 |
| 2026-05-29 | 34 | 4.02 h |

A true 100 is still reachable (the `93` anchor keeps the ceiling live) but the owner's best real
night blends to 91, so 100 stays reserved rather than routine.

---

## 4. Verification

- **Full suite: 3,345 passed / 483 files.** `pnpm check:rules` **38 of 38**. Typecheck clean. Lint
  shows only pre-existing warnings in `lib/session-icon.tsx`.
- The distribution above was produced by importing `computeSleepScoreSeries` from the shipped source
  and running it over 65 real production nights — **not** by the Python harness used for design. The
  harness was validated first against the 35 stored scores (mean abs error 4.3, 30 of 35 within 5);
  it diverges on the fragment nights, which are Q-274 data defects and excluded by a ≥ 4 h floor.
- **Four tests changed, each for a stated reason** rather than to go green:
  - three asserted a near-perfect night reaches exactly 100. The ceiling is still reachable; the
    specific fixture (2.0 h REM) is no longer maximal now that the REM ceiling is 3.0 h, so it
    asserts ≥ 98 and the intent is preserved.
  - one asserted a stale all-time-mean baseline pins HRV/HR at exactly **100**. That literal was an
    artifact of curves that saturated at ratio 1.1. It now asserts the **relation** — the stale
    baseline scores *higher* than the correct one — which is the actual regression being guarded and
    survives any recalibration.

---

## 5. The threshold rule this surfaced

`LOW_SLEEP_SCORE = 60` was tuned against the compressed score, where it fired on **4 of 65 nights
(6 %)**. Widening the scale without touching it would have fired it on **17 of 65 (26 %)** — the
rest-day hint nagging about sleep three times as often, with no change in how often the owner
actually sleeps badly. Re-anchored to **42**, restoring 5/65 (8 %).

> **A threshold written on a display scale is calibrated to that scale's distribution.** Re-anchor
> every one of them in the same PR as a range change, preserving the firing *rate* — otherwise the
> recalibration silently ships a behaviour change nobody asked for.

Sleep has exactly one such threshold. Readiness has **five**, which is §6.

---

## 6. Readiness and Activity — analysed, deliberately NOT shipped

**Readiness carries the identical structural problem.** Even after the new Sleep Score feeds its
`previousNight` term (16 %), it measures mean 68.9, sd 11.6, **IQR 64.4–75.7 — 11 points**, nothing
above 87, nothing in the 30s or 40s. The same calibration technique works: anchored on its own
percentiles it gives **mean 66.8, sd 19.3, range 15–99, 4 days ≥ 90 and 6 below 50** — the owner's
test, passed.

**It is not shipped because of §5.** Readiness feeds five action thresholds, and the recalibration
moves **12 of 26 days across at least one**:

| threshold | where | days below, now → after |
|---|---|---|
| `< 45` early deload | `lib/health/readiness-payload.ts:47` | 1 → **4** |
| `50` band Low/Moderate | `scoreBand()` | 1 → 6 |
| `< 60` AI low-readiness | `ai-periodization/ai-dynamic.ts:231` | 4 → 8 |
| `70` band Moderate/High | `scoreBand()` | 12 → 15 |
| `≥ 75` rest-day "train hard" | `health/rest-day-guidance.ts:36` | 19 → 17 |

The band moves (50, 70) are the *point* — more days reading "Low" is what a working range looks
like. The **action** thresholds are not: shipping this as-is would quadruple early-deload firing,
which the owner did not ask for and would notice as the app suddenly demanding rest. Each needs
re-anchoring to preserve its rate, and they span `readiness`, `workouts` and the AI periodization
path — a wider blast radius than one file, and worth doing deliberately rather than at the end of a
long session.

**Activity (n = 22, sd 7.3, range 56–91) is the most compressed of the three and was not analysed
beyond §1.** It is Q-277.

---

## 7. What was not exercised

- **Nothing on-device.** No APK, native path, safe-area or WebView surface. Sleep Score renders in
  several places; none were viewed on the S25.
- **Historical scores are not recomputed.** `oura_daily_derived.sleep_score` rows keep their old
  values until each day is re-read, so the trend chart will show a **step** at the changeover, with
  older days ~15 points higher for model reasons rather than physiological ones. Sleep stamps **no
  `model_version`** (Q-273 covers exactly this), so nothing in the data marks where the step is. This
  is the single biggest known wart of this change.
- **Fitted to one sleeper.** `SCORE_CALIBRATION` is anchored on the owner's 65-night distribution.
  Another user inherits this person's percentiles and is mis-scored in proportion to how differently
  they sleep. A per-user rolling calibration is the real answer; this is the owner-only step toward
  it, consistent with the canonical-runtime policy, and the constant says so in its own comment.
- **Noise is amplified in the steep middle** — around the median, ~4 points of blend becomes ~12
  points of displayed score. That is the deliberate price of range. If it reads as jitter rather than
  signal over the next couple of weeks, flatten the 74–85 segment first.
- Every number here is **the owner's** (`claude_ro` is row-scoped), over 65 main sleeps ≥ 4 h.
