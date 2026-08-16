# The deferred measurements, taken

**Date:** 2026-08-16 · **Against:** `main` at `a5c2265` · **Type:** review, docs-only
**Sixth in the series.** This one adds no new Q numbers — it **answers questions four existing
entries told an implementer to answer first**, and one of those answers changes what the fix is.

| entry | what it said to measure | result |
|---|---|---|
| **Q-304** | does a style accompany the 13+ rep sets? *"may close the entry"* | **CONFIRMED — does not close** |
| **Q-300** | split Q-289's buckets by rest adherence | **rest is NOT the confound; Q-289 stands alone** |
| **Q-298** | find how a zero is produced | **pinned to two lines; one-line fix** |
| **Q-292** | systematic pass over the other 109 insights | **done — 7 imperial, 12 superlatives, 1 quasi-medical** |

**⚠️ And one claim in this document's own first draft was retracted before merge** — see §3. A
prescribed-vs-unprescribed comparison turned out to be a comparison of *data eras*, which narrows
**Q-289** and weakens **Q-306's** headline. Both are amended.

---

## 1. Q-304 — the qualifier confirms the finding rather than closing it

Q-304 was filed with an explicit escape hatch: `prescriptionFactor` rescales by
`1 / ((pct/100) × repFactor(targetReps))` when a style supplies both, so where a style is present
the high-rep inflation may already be absorbed. **Closing the entry as measured-and-rejected was
named as an acceptable outcome.** It is not the outcome.

Sets that feed the 1RM estimate (`use_for_1rm = true`), by rep band:

| rep band | feeding the 1RM | **with `planned_pct`** |
|---|---|---|
| ≤ 12 | 613 | 249 (41%) |
| **13–20** | **27** | **1 (4%)** |
| **21+** | **2** | **0** |

**28 of the 29 high-rep sets carry no prescription pct**, so `prescriptionFactor` returns 1 and the
raw `repFactor` stands with no AMRAP correction.

**The proxy is exact, not approximate.** `log-exercise.ts:233` writes
`plannedPct: progressionStyle?.[i]?.pct` — the same value `prescriptionFactor` consumes via
`estimateOneRm(..., { style: progressionStyle })` at line 196. So `planned_pct IS NULL` on a row
means `prescriptionFactor` returned 1 for that set.

Q-304 stands. Its entry is amended to record that its own escape hatch was tested and did not fire.

---

## 2. Q-300 — rest adherence is not the confound

Q-300 named two outcomes and said to establish which before recalibrating anything:

> - the miscalibration largely disappears within the on-target band → rest is the confound, add a rest term;
> - it persists across all three bands → the curve is genuinely mis-shaped, and Q-289 stands alone.

**It persists across all three bands.** Delta = actual − expected:

| expected RPE | on-target (n=120) | rushed (n=96) | overlong (n=42) | unknown (n=311) |
|---|---|---|---|---|
| 5 | +1.00 | +1.10 | +1.25 | **+2.36** |
| 8 | −0.59 | −0.67 | −0.86 | −0.04 |
| 9 | −1.13 | −1.33 | −1.00 | −1.00 |
| **10** | **−1.75** | **−2.80** | **−2.33** | **−2.21** |

Rest is *a* contributor — the on-target band is consistently the mildest — but the shape error
survives in every band, and **expected-10 clears the 1.5 dead band in all four**. The
non-monotonic top end survives too.

**Q-289 stands alone. Do not wait on a rest term to fix it.** Q-300's own value is now the
secondary one it also carried: rest adherence as a coaching signal.

---

## 3. ⚠️ A synthesis I had to retract, and what survives it

**First draft of this section claimed the prescribed/unprescribed split showed `prescriptionFactor`
doing real work — r = 0.499 vs 0.297. That claim is confounded and is withdrawn.**

Checking *why* 72% of sets carry no `planned_pct` shows it is not freestyle training, not a dropped
write, and not prescription expiry. It is a **feature boundary**:

```
2026-07-16    0/15 sets with planned_pct
2026-07-17    0/3
2026-07-18   18/18     ← migration 126_set_log_planned_snapshot.sql
2026-07-19   13/14
2026-07-20   14/14
```

Zero before 2026-07-18, ~100% after. Across all history: **49 days with none, 11 fully prescribed,
7 mixed.** So "unprescribed" is a synonym for "older than 2026-07-18", and the r = 0.30 vs 0.50
difference measures **era**, not prescription. Only ~15 unprescribed sets exist post-cutover — far
too few to decouple the two. **The comparison cannot be made with this data.**

### What survives: Q-289 is real, and narrower than filed

Re-running the buckets split by era rather than by prescription:

| expected RPE | **PRE-cutover** (n=291) | **POST-cutover** (n=278) |
|---|---|---|
| 5 | **+2.36** ← clears band | **+1.09** — does *not* clear |
| 6 | +0.91 | +0.75 |
| 7 | +0.72 | +0.15 |
| 8 | −0.04 | −0.68 |
| 9 | −0.97 | −1.24 |
| **10** | **−2.16** ← clears | **−2.29** ← still clears |
| r / MAE | 0.324 / 1.04 | 0.483 / 0.94 |

Two consequences, both narrowing earlier claims:

1. **Q-289's low-end error is largely a pre-cutover artefact.** The **+1.93 at expected-5** quoted in
   that entry (and in `projectOverview.md`) is a pooled figure; on current data it is **+1.09**, well
   inside the dead band. **The finding should be re-scoped to the top of the range**, where
   expected-10 still reads **−2.29** and clears the −2 two-rep-bump threshold.
2. **Q-306's premise weakens materially.** That entry says the emergency-deload trigger (`> 2.0`)
   sits 0.07 from a systematic +1.93. On post-cutover data the expected-5 delta is **+1.09** — not
   close to 2.0. **The trigger is not sitting inside the error band on current data.** Q-306 keeps
   its second half (ACWR at three thresholds) but loses its headline.

The non-monotonic top end survives in both eras and is the durable part of Q-289.

## 4. Q-298 — pinned to two lines, and the fix is one of them

Source confirms what the production data implied. `packages/shared/src/workout/log-exercise.ts`:

```ts
188:  const isAnyDeload = currentPhaseType === 'deload' || sessionIsEarlyDeload;

196:    { exerciseType, style: progressionStyle, isBaseline,
       deloaded: exerciseDeloaded === true || (isAnyDeload && !isBaseline) },   // ← zeroes the 1RM

264:    exerciseDeloaded: exerciseDeloaded ?? false,                            // ← stores ONLY the AI flag
```

Line 196 zeroes the estimate when **either** the AI per-exercise flag **or** the phase says deload.
Line 264 records **only** the AI flag. So a static-program deload phase zeroes the 1RM and writes
`exercise_deloaded = false` — exactly the 2026-08-09 `Pull` rows.

The file's own comment at 190–191 states both cases must not feed the estimate. They don't. Only one
of them is recorded.

**The fix is line 264 storing the same predicate line 196 uses.** Amended into Q-298.

---

## 5. Q-292 — the systematic pass over all 117 insights

The earlier review read 8 closely and said a systematic pass would size the problem. Done, over all
117, with the caveat that pattern-matching finds candidates and each was read before counting.

| pattern | hits | verdict |
|---|---|---|
| **Imperial units** (Fahrenheit, miles, lbs) | **7** | real — all in `sleep`, all Fahrenheit, to a metric user |
| **Absolute superlatives** ("perfect", "record") | **12** | real — see below |
| **Quasi-medical inference** | **1** | boundary case, hedged, benign advice |
| Train-through-illness | 1 | **false positive** — reading it shows it describes the illness radar, not advice to train |
| Certainty language ("clearly", "proves") | 4 | stylistic, not filed |

**The superlatives are the substantive half, and one is now double-confirmed.** The earlier review
caught *"leading to a perfect activity score"* on a day the stored score was **80**. The systematic
pass finds *"a perfect recovery index"* (2026-07-05) and *"a perfect resting heart rate baseline"*
(2026-06-29) — and **Q-271 measured that the Recovery Index contributor has never exceeded 50 on any
of the 31 scored days, because its 6-hour anchor is unreachable.** The model asserted "perfect" for a
contributor that structurally cannot reach it.

**The one worth reading in full**, 2026-07-19:

> *"Your body temperature is elevated by 1.9°C above your personal baseline, which is a significant
> deviation that often suggests your immune system is working hard to fight off an infection. **Even
> without a formal readiness score**, this spike indicates your body needs immediate recovery focus.
> Prioritize getting at least nine hours of sleep tonight…"*

Hedged ("often suggests"), and the advice is sleep — benign. But it is the app inferring infection
from a temperature reading, and it says out loud that it is advising **without a readiness score** —
the Q-278 / Q-303 class, stated explicitly by the model itself.

Q-292 is amended with the sizing: **7 unit errors and 12 superlatives across 117**, i.e. roughly
**16% of insights carry at least one**.

---

## 6. Surfaces NOT exercised

- No device, emulator, browser or `pnpm dev`.
- **One user's data**, via row-scoped `claude_ro` views.
- The AI audit is **pattern-match plus read-back**, not an independent judgement of every insight's
  clinical or coaching quality.
- The prescribed/unprescribed split uses `planned_pct` as the marker. It is exact for
  `prescriptionFactor` (§1) but does not prove the *whole* style array was present.
- Cell counts at the extremes are small (expected-10 prescribed is n = 4).

## 7. Still open — and what it needs

- **Railway per-query RTT** (Q-308). Cannot be measured from the sandbox. Owner action; instructions
  in the session summary.
- **Degradation matrix against a running app** (Q-294). Now less blocked than it was — an E2E job
  exists in CI as of #1376 — but still needs the scenarios defined before tests can assert anything.
