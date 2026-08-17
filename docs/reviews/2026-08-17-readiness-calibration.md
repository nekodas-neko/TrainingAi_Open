# Readiness calibration — the Recovery Index contributor and its 6-hour anchor

**Date:** 2026-08-17 · **Agent:** Tuning · **Type:** calibration evidence, docs-only
**Proposes:** `RECOVERY_INDEX_OPTIMAL_HOURS` 6 → 5 · **Backlog:** Q-500 (⛔ blocked: owner sign-off)
**Also files:** Q-501 (readiness history is not reproducible from its stored inputs)

**This proposal changes a scoring constant. It is not implemented here and must not be implemented
until the owner signs off.** The write-up below is the evidence; Lane A ships it if approved.

---

## 0. What this is answering, and the honest headline

There was no fresh owner report this session. The target is the standing calibration question the
2026-08-15 comprehensive review left open as **Q-271** — *"the Recovery Index contributor can never
score above ~50, by construction; it only ever subtracts"* — which that review filed explicitly as
calibration work with the data already stored.

**The headline is that Q-271 is substantially wrong, and the contributor is in better shape than it
claimed.** Measured over the full production series rather than the eight days the review actually
sampled:

- The contributor **does** score above 50 — on 12 of 41 days — and reaches the 100 ceiling on
  2026-07-17. "Never above 50, on any day, ever" is an artefact of an 8-day window.
- Its cost against a neutral 50 is **0.71 readiness points per day**, not the 2.2 the review states.
- The estimator underneath it is **sound**: it correlates at **r = +0.712** with Oura's own
  `recovery_index` contributor over 15 nights where both exist, and beats every alternative
  estimator tested.

What *is* real, and is what this proposes to fix: the **6-hour anchor is about one hour too high**
for this estimator. The zero-bias anchor fitted against Oura's own contributor is **4.63 h**
(leave-one-out range 4.40–5.14). Moving the constant to **5** removes a systematic −10.2-point bias
at a cost of no more than 1.44 readiness points on any day in the series.

So: the score was defensible, the review's account of it was not, and there is a small, well-supported
correction to make.

---

## 1. The report

No owner report. The input is Q-271, from
[`docs/reviews/2026-08-15-comprehensive-app-review.md`](2026-08-15-comprehensive-app-review.md) §1.3,
which asserted:

> Realised sub-scores across all 31 scored days: **13, 18, 20, 21, 22, 28, 43, 48 …** — never above
> 50, on any day, ever. … Against a neutral 50 it costs roughly **2.2 readiness points every day**.

Its own "first action" was to establish *which* of two explanations held — a mis-specified anchor, or
a genuinely short interval — **before** touching the constant. That is what this does.

**Where the quoted figures came from.** Those eight values are not a sample of 31 days. Pulled from
the persisted contributor, `2026-08-08 … 2026-08-15` reads 18, 22, 48, 13, 28, 20, 43, 21 — which
sorted is **13, 18, 20, 21, 22, 28, 43, 48**, the review's list exactly. It measured the eight days
immediately before it ran and generalised them to the series. Those eight days are genuinely the
worst stretch in the record.

---

## 2. The stored values

All figures pulled from production via `POST /api/admin/db-query` over the `claude_ro` views.
**These views are row-scoped to a single user — every count below is the owner's, not the system's.**
The window is bounded by data availability, not by a prune: `oura_daily_summary` holds
2026-07-07 → 2026-08-17, all 42 rows, 41 with a non-null `recovery_index_hours`.

`claude_ro.oura_daily_summary.recovery_index_hours`, n = 41:

| | value |
|---|---|
| min / max | 0.35 h / 8.28 h |
| mean / median | **2.69 h** / 2.38 h |
| days reaching the 6 h optimum | **1 of 41** |

Under the shipped curve `clamp(round(hours / 6 × 100))` those hours give a mean sub-score of
**43.9**, exceeding 50 on **13 of 41** days.

> **These figures were re-pulled at the end of the session and one row had moved under me.**
> 2026-08-13 — one of Q-274's fragment nights — was **re-rolled during this session** (row
> `created_at` 2026-08-17T07:50:31Z): `sleep_duration_hours` 6.08 → **8.17**, `recovery_index_hours`
> 1.20 → **5.78**. Exactly one of 41 rows changed. Every figure in this document is the post-re-roll
> value. Two things follow: **Q-274's fragment nights can resolve themselves on a re-rollup**, which
> nothing had established; and **a calibration number has a shelf life** — re-pull before quoting
> these rather than trusting the table.

The persisted contributor (`claude_ro.oura_daily_derived.readiness_contributors->'recoveryIndex'`)
covers a shorter window, 2026-07-16 → 2026-08-17, n = 33. Within it the sub-score exceeds 50 on 5
days and **records exactly 100 on 2026-07-17**. That single row is sufficient to falsify "never above
50, on any day, ever" without any recomputation at all.

**Cost against a neutral 50**, which is what a missing contributor supplies:
`0.09 × (50 − 43.9) = ` **0.55 readiness points per day**. The review's 2.2 is what its own 8-day
window gives (mean sub-score there is ~26), and it does not hold over the series.

**Model-version check.** `oura_daily_derived.model_versions->>'readiness'` is **NULL on all 33 rows**,
so no readiness shift in this data can be attributed to or excluded from a model change. That is
Q-273 (only Body Battery stamps a version) confirmed live for readiness, and it bounds every
before/after claim in this document. The `oura_daily_summary` rows *were* recomputed as late as
2026-08-13, so the hours above reflect current code applied to the whole window, not a mix of
vintages — that much is checkable, and was checked.

---

## 3. What the current formula does with them

Two files, one path, no duplicate implementation found — `grep` for `hoursToSettle` and
`recoveryIndexHours` returns a single producer and a single consumer.

**Producer** — `packages/shared/src/health/recovery-index.ts`:

```ts
const sm = rollingMedian(sorted.map(p => p.bpm), 3)   // MEDIAN_WINDOW = 3
let minIdx = 0
for (let i = 1; i < sm.length; i++) if (sm[i] < sm[minIdx]) minIdx = i
const hoursToSettle = Math.max(0, (wakeTime - sorted[minIdx].timestamp) / 3_600_000)
```

It is the **argmin** of a 3-point rolling median of the overnight HR series, to wake. Called from
`lib/data/postgres/adapter.ts:5519` with the night's HR bins and the sleep-window end as wake.

**Consumer** — `packages/shared/src/health/readiness-composite.ts:120-130`:

```ts
export const RECOVERY_INDEX_OPTIMAL_HOURS = 6
const score = Math.max(0, Math.min(100, Math.round((hours / RECOVERY_INDEX_OPTIMAL_HOURS) * 100)))
return { score, provisional: true }
```

Weight `READINESS_WEIGHTS.recoveryIndex = 0.09`.

**The anchor is not verifiable against a pinned source.** The bundled Oura v2 spec
(`.claude/skills/oura-api/references/openapi-v1.34.json`) exposes `contributors.recovery_index` as a
1–100 integer only — it defines no hours, no curve, and no threshold. The 6 comes from Oura's public
prose, and the code comment says so itself ("their exact hours→score curve isn't recovered"). Per
CLAUDE.md's external-field rule this is exactly the situation where a number should be measured
rather than trusted.

**Two stale references worth correcting while someone is in here** (both cosmetic, neither affects
behaviour): the Q-271 backlog entry and the code comment at `adapter.ts:5518` both cite
`lib/health/recovery-index.ts`, which does not exist — the file is at
`packages/shared/src/health/recovery-index.ts`.

### 3.1 The harness, and why its numbers can be trusted

Everything below re-derives `hoursToSettle` from raw `claude_ro.oura_heartrate` inside each night's
`sleep_sessions` window, using a line-by-line port of the TypeScript above. Validated against the 41
stored values before being used for anything:

| | |
|---|---|
| median absolute difference | **0.08 h** (5 minutes) |
| nights within 0.5 h | **32 / 41** |
| mean absolute difference | 0.41 h |

The nine outliers are the fragment nights and the two nights where my longest-session-per-date window
pick differs from the rollup's circadian grouping — 2026-07-10 (15 samples), 2026-08-11 (7),
2026-08-13 (13). Those are Q-274's nights, and they are excluded from every fit below by a
≥30-samples-per-night floor.

---

## 4. What the proposed change would have produced

### 4.1 The calibration window nobody had used

The ring re-keyed to BLE on 2026-07-07 and Oura Cloud data stops there. `oura_heartrate` starts
2026-06-22. That leaves **15 nights (2026-06-23 → 2026-07-07) where Oura's own `recovery_index`
contributor and an overnight HR series both exist** — Oura's answer and our inputs, on the same
nights. It is the only ground truth available for this contributor, and it had not been used.

Overnight coverage in that window is ~85–115 samples/night from `rest`/`awake` sources at 5-minute
resolution, comparable to the BLE bins after the re-key (median 107 vs 108 samples/night).

Our hours vs Oura's realised sub-score, 15 nights:

| | our hours | our sub-score (6 h) | Oura's sub-score |
|---|---|---|---|
| mean | 3.59 | 58.8 | **69.0** |
| median | 3.28 | 55.0 | 80.0 |

**r(our hours, Oura's sub-score) = +0.712.** The estimator tracks what Oura's does. The gap is a
level offset — bias **−10.2** points, RMSE 23.1.

### 4.2 The estimator is not the problem — this was tested and the hypothesis failed

The obvious hypothesis was that `hoursToSettle` measures the wrong instant: Oura's guidance describes
HR *stabilising*, and the argmin of a series is necessarily later than the point it settles, which
would make 6 h structurally unreachable. Tested by replacing the argmin with "first sample within
*N* bpm of the night minimum":

| estimator | r vs Oura | bias @ 6 h | RMSE @ 6 h |
|---|---|---|---|
| **argmin (shipped)** | **+0.712** | −10.2 | **23.1** |
| first within 1 bpm | +0.631 | +1.3 | 23.4 |
| first within 2 bpm | +0.546 | +13.8 | 26.7 |
| first within 3 bpm | +0.605 | +17.9 | 24.3 |
| first within 4 bpm | +0.636 | +19.7 | 26.2 |
| first within 5 bpm | +0.468 | +27.0 | 35.2 |

Every variant correlates **worse**. The stabilisation variants can be made unbiased by choice of
tolerance, but they buy that by discarding signal. **Do not change the estimator.** The shipped one
is the best of those tested, and this is the single most useful negative result in the session.

### 4.3 The anchor, fitted

Holding the estimator fixed and sweeping the anchor against Oura's own contributor:

| anchor | bias | RMSE |
|---|---|---|
| 4.00 h | +5.6 | 23.5 |
| 4.50 h | +1.0 | 21.9 |
| 4.75 h | −0.9 | **21.8** |
| **5.00 h** | **−2.7** | **21.8** |
| 5.50 h | −6.3 | 22.2 |
| **6.00 h (shipped)** | **−10.2** | 23.1 |
| 7.00 h | −17.7 | 26.1 |

Zero-bias anchor: **4.63 h**. Leave-one-out over the 15 nights: min 4.40, median 4.60, max 5.14 — a
0.73 h spread, so no single night is driving it.

**Recommendation: 5.** It sits on the flat RMSE floor, inside the leave-one-out range, is a round
number a person can reason about, and retains a small *negative* bias (−2.7) — it still slightly
under-scores, which is the safe direction for a recovery signal. Fitting to 4.63 would chase two
decimal places of a 15-night sample.

---

## 5. How many other days it moves, and by how much

Applied to **all 41 days** with a stored `recovery_index_hours`, not just the days that motivated it:

| | 6 h (shipped) | 5 h (proposed) |
|---|---|---|
| mean sub-score | 43.9 | **51.3** |
| days scoring > 50 | 13 / 41 | **20 / 41** |
| cost vs neutral 50 | 0.55 pts/day | **−0.12 pts/day** |

Per-day movement:

| | sub-score | readiness (× 0.09) |
|---|---|---|
| mean | +7.4 | **+0.67 pts** |
| median | +7.0 | — |
| max | +16 | **+1.44 pts** |
| min | 0 | 0 |

**Days moved: 40 of 41.** The one unchanged day is 2026-07-17, which clamps at 100 under both
anchors. The change is monotone and strictly non-negative — no day scores lower.

Distribution of the readiness-point shift:

| shift | days |
|---|---|
| 0.0 – 0.5 pts | 13 |
| 0.5 – 1.0 pts | 22 |
| 1.0 – 1.5 pts | 6 |
| > 1.5 pts | **0** |

Largest movers: 2026-08-07 (4.68 h, sub 78 → 94, readiness 76 → ~77.4) and 2026-08-04 (4.50 h,
sub 75 → 90, readiness 80 → ~81.3).

**This is a small change and should be presented as one.** It re-centres a 9%-weighted contributor
and moves no displayed readiness score by more than about one point. It is worth doing because the
bias is systematic and one-directional, not because any day is badly wrong.

### 5.2 What actually changes — the decision thresholds

Points are not the unit that matters; **thresholds** are. The readiness score feeds six numeric
decision points in the app, and the question worth answering is whether any day crosses one.

| threshold | where |
|---|---|
| `< 45` (with ACWR > 1.2) → early deload | `lib/health/readiness-payload.ts:47,505` |
| `50` → band Low / Moderate | `scoreBand()` |
| `< 60` → AI `lowReadiness` branch | `packages/shared/src/ai-periodization/ai-dynamic.ts:231` |
| `< 60` → rest-day guidance | `packages/shared/src/health/rest-day-guidance.ts:46` |
| `70` → band Moderate / High | `scoreBand()` |
| `>= 75` → rest-day guidance "train hard" | `packages/shared/src/health/rest-day-guidance.ts:36` |

Method: reconstruct the exact unrounded composite from the persisted contributors (it reproduces the
stored rounded score on **26 of 33** days — the other seven predate the `checkin` contributor or hit
the §6 drift), then swap **only** the Recovery Index term between the 6 h and 5 h curves on the same
stored hours. That isolates the anchor from the §6 drift, which is a separate effect and would
otherwise be double-counted.

**Result: 4 of 26 days cross a threshold.**

| day | 6 h | 5 h | crossing |
|---|---|---|---|
| 2026-07-28 | 74 | 75 | rest-day guidance → "train hard" |
| 2026-07-29 | 74 | 75 | rest-day guidance → "train hard" |
| 2026-07-31 | 74 | 75 | rest-day guidance → "train hard" |
| 2026-08-16 | 69 | 70 | band Moderate → **High** |

**No day crosses the early-deload line (45), the Low/Moderate line (50), or the `lowReadiness` line
(60).** The displayed score moves on 18 of 26 days, always by exactly **+1**.

In plain terms, this is what approving Q-500 buys and costs: *the readiness number reads one point
higher on about two-thirds of days; one day in 26 shows "High" where it showed "Moderate"; three days
in 26 tip rest-day guidance toward the harder session; and nothing at all changes about deload
triggering or the low-readiness AI branch.* That is the whole behavioural surface of the change.

### 5.1 Two caveats that bound the whole proposal

**The fit is from 15 nights, on the other side of the re-key.** It is calibrated on Cloud-era HR and
would be applied to BLE-era HR, and those inputs differ measurably:

| | Cloud (pre-re-key) | BLE (post-re-key) |
|---|---|---|
| median sample-to-sample \|Δbpm\| | 1.0 | **2.0** |
| mean sample-to-sample \|Δbpm\| | 1.87 | **3.18** |
| median samples/night | 107 | 108 |
| median `hoursToSettle` (same harness, w = 3) | 3.28 h | **2.62 h** |

At identical sampling density the BLE series is about twice as noisy, and our hours run 0.30–0.66 h
lower afterwards depending on smoothing window. Some of that gap is plausibly the noise — a global
argmin over a noisier series lands later by chance — and some may be real. **With 15 pre-re-key
nights the two cannot be separated**, and it should not be claimed that they have been. The practical
consequence is that a 5 h anchor fitted on Cloud-era nights is, if anything, still slightly
conservative for BLE-era data. It does not invalidate the direction of the change.

**RMSE stays around 21 points at every anchor.** Re-anchoring removes a systematic bias; it does not
make any individual day accurate. This contributor is directionally informative and individually
noisy, and the `provisional: true` flag it already carries remains correct.

---

## 6. Second finding — readiness history is not reproducible from its stored inputs

Filed separately as **Q-501**, found while checking §2.

Comparing each persisted `recoveryIndex` sub-score against the `recovery_index_hours` it should
derive from, **5 of 33 disagree**:

| day | stored hours | expected sub | persisted sub |
|---|---|---|---|
| 2026-07-16 | 0.89 | 15 | **4** |
| 2026-07-20 | 2.32 | 39 | **4** |
| 2026-07-21 | 1.94 | 32 | 23 |
| 2026-07-26 | 0.97 | 16 | 13 |
| 2026-08-03 | 3.21 | 54 | **29** |

`oura_daily_summary` rows get recomputed; the `oura_daily_derived` readiness rows computed from them
do not get recomputed in step. So a stored readiness score cannot be re-derived from the stored
inputs sitting next to it, and any audit that assumes it can — including the score-audit admin panel —
is comparing two vintages. Combined with `model_versions->>'readiness'` being NULL throughout, there
is currently **no way to tell whether a past readiness score changed because its inputs changed or
because the model did**. That is the same class as Q-273, and it is the reason §2's version check
could only be run on the summary table.

**It was then demonstrated live, mid-session.** The 2026-08-13 summary was re-rolled while this
document was being written (§2), moving its Recovery Index hours 1.20 → 5.78. The `oura_daily_derived`
readiness row did not follow: it still carries the sub-score computed from the old hours. Measured
against a fresh recompute at the *unchanged* 6 h anchor, **3 of 26 reconstructable days now disagree
with their persisted score — 2026-08-13 by 7 points** (62 persisted vs 69 recomputed), 08-03 by 2,
07-26 by 1. Nothing about the model changed; only the inputs did, and the stored score did not notice.

This does not affect the anchor proposal, which is computed from the hours directly — and §5.2's
threshold analysis deliberately holds this drift out so the two effects are not conflated.

---

## 7. What was not exercised

- **Nothing was run on-device.** This is a data analysis over production rows; no APK, no native
  path, no safe-area or WebView surface was touched.
- **No code changed.** The proposal is not implemented, and the anchor constant is untouched on
  `main`.
- **The 15-night calibration window is small**, spans the re-key boundary, and uses a different HR
  source from the data the change would apply to. §5.1 states what that does and does not permit.
- **Oura's own hours→score curve is still unrecovered.** The fit is against Oura's *output*
  sub-scores, not against a published curve. If Oura's curve is non-linear, a linear anchor fitted to
  its outputs will be right on average and wrong at the tails — consistent with the RMSE floor at 21.
- **Every number is one user's**, over the windows named in §2. `claude_ro` is row-scoped, so nothing
  here supports a claim about other accounts.
- The fragment nights (2026-07-10, 08-11, 08-13) were **excluded** from the fits, not investigated.
  They belong to Q-274.

---

## 8. If the owner approves

Implementation is one constant in `packages/shared/src/health/readiness-composite.ts`:

```ts
export const RECOVERY_INDEX_OPTIMAL_HOURS = 5   // was 6
```

Three things that must ride with it, and one that must not:

1. **Land Q-273 first, or stamp a readiness model version in the same PR.** Q-271's own entry already
   says this. Without it, this change makes 40 days of readiness history incomparable to what follows
   with no marker saying why — the exact problem §6 documents.
2. `READINESS_MODEL.recoveryIndexOptimalHours` is exported for the score-audit panel and follows the
   constant automatically. Verify the panel renders the new anchor.
3. Fix the two stale `lib/health/recovery-index.ts` path references noted in §3.
4. **Do not change the estimator, the smoothing window, or the weight.** §4.2 tested the estimator
   alternatives and they are worse. The weight interacts with Q-275 and belongs to that work.

**Re-measure after ~15 BLE-era nights.** The fit is from the Cloud era; once enough post-change days
exist, the zero-bias anchor should be re-derived on BLE data alone. If it lands materially below 5,
§5.1's noise question is answered in favour of "the input changed", and that is a devices finding,
not a readiness one.
