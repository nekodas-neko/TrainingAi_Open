# Can each score be re-audited later? Two of six say no

**Date:** 2026-08-19 · **Agent:** Tuning 🎶 · **Pillars:** `[readiness]` `[activity]` `[devices]`

Every calibration review this month had to **reconstruct** contributor sub-scores from raw inputs
rather than read them. This checks whether that was necessary — i.e. what each score actually leaves
behind — because a score that keeps no trail cannot be calibrated retrospectively at all, only
forward from the day someone starts recording.

Source: `claude_ro.oura_daily_derived`, **96 rows**, row-scoped to the owner.

| score | scored rows | trail stored | usable for a retrospective audit? |
|---|---|---|---|
| sleep | 36 | `sleep_contributors` — 10 real sub-scores | ✅ |
| readiness | 35 | `readiness_contributors` — sub-scores **+ `provisional` flags** | ✅ |
| illness | 46 | `illness_biomarkers` — all 4 z-scores, on **every** scored row | ✅ |
| **activity** | 23 | `activity_contributors` = **`{base, adjustment, trained}`** | ❌ **§1** |
| resilience | 13 (level) | — | Q-508 (dormant) |
| **chronic stress** | **0** | — | ❌ **§2 — never produced a value** |

Readiness's `provisional` flag is the reference for what a good trail looks like: it records not just
what each contributor scored but whether that score was trustworthy at the time.

---

## 1. Activity stores the wrapper, not the contributors — and that has already cost a measurement

`readiness-payload.ts` persists `{ base: activityBlend.base, adjustment: activityBlend.adjustment,
trained: activityBlend.trained ? 1 : 0 }`. That is the **blend wrapper** — the outer adjustment layer
— not `computeActivityScore`'s six components (`steps`, `activeEnergy`, `zoneMinutes`, `moveHours`,
`strengthFreq`, `strengthVolume`). The components exist in memory on the same request: they are
returned as `activityResult.components` and served to the client. They are simply not written.

**The cost, concretely.** The
[contributor audit](2026-08-19-activity-contributor-audit.md) had to rebuild all six from raw inputs
using the shipped formulas — and could only do so **at today's goals**, because
`strengthFreqGoal` changed 3 → 5 and the volume target changed basis on **2026-08-11**. So the
question *"what did `strengthFreq` actually score on 2026-08-02?"* is **not answerable**, and the
audit had to report a *predicted* sd ceiling (≈ 10.2) alongside the stored sd rather than the real
historical contributor spread. Sleep and readiness did not have this problem on the same days.

It also compounds with a known trap: **stored history is not back-filled after a model change**, so
each recalibration creates another segment. Without a stored trail there is no way to tell, later,
which segment a given day belongs to — `model_versions` is present on 71 of 96 rows and Body Battery
is still the only score that stamps one (Q-273).

**The fix is one line at the existing persist site** — merge `activityResult.components` into the
object already being written. Filed as **Q-526**; Lane A implements.

---

## 2. Chronic stress has never produced a value — 0 of 96

`chronic_stress_score` and `chronic_stress_contributors` are **empty on every row**. This is the
**third** dormant score, after the illness radar (Q-506 — never produced an action-bearing flag in 46
days) and resilience (Q-508 — one value, level 5, on all 13 rows).

The mechanism is a gate, and it is a demanding one. `adapter.ts`'s `chronic_stress` step returns
early unless the pass holds `CHRONIC_STRESS_MIN_DAYS` summary rows, then `computeChronicStress` runs
the golden-verified `cumulative_stress_1_2_2` port, which needs **21 complete nights of granular BLE
signals inside a trailing 31-night window**. The step's own comment states the binding constraint:

> *the intermediate history is built from THIS pass's stashed signals, so the first score requires a
> wide/full rollup pass covering ≥21 nights of real ring data (owner/device-gated).*

So it is not enough for 21 good nights to **exist** — they must all be present **in one pass**. An
incremental nightly rollup can never satisfy it, no matter how long it runs. Filed as **Q-525**.

**Distinct from Q-507.** Q-507 is `STRESS_HIGH_DAY_THRESHOLD_MIN` — *daytime* stress minutes driving
the session override, which does fire (on the wrong days). This is the separate vendored *cumulative*
model. They share a word and nothing else; do not merge them.

---

## 3. What was checked and found fine

- **Illness** stores all four biomarker z-scores on all 46 scored rows — the trail is complete, which
  is exactly why Q-506 could diagnose a poisoned temperature baseline from history rather than from a
  live capture. This is the counter-example that makes §1's cost concrete.
- **Sleep and readiness** store real per-contributor sub-scores; readiness additionally marks
  provisional ones.
- No score writes a trail it then fails to read: nothing here is a stale-column problem.

**Not checked:** whether the local SQLite mirror of these columns matches Postgres (a device
question, not a calibration one), and whether the 25 rows lacking `model_versions` predate stamping
or lost it to the Q-518 clobber — that belongs to Q-518, not here.
