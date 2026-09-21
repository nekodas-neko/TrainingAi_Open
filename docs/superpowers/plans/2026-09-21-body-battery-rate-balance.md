# Body Battery — the cure, fitted offline against 64 days

**TN-55.** Written 2026-09-21 by Tuning. Lane A implements; the owner signs off on the final
constants, which **cannot be fitted before 2026-10-04** (see §6).

Replay harness: [`scripts/tuning/body-battery-replay.cjs`](../../../scripts/tuning/body-battery-replay.cjs).
Run `--validate` and read the output before trusting anything below.

---

## 1. What is actually wrong

Four defects, measured. They multiply, which is why single-lever fixes barely move the result.

| # | defect | measured effect |
|---|---|---|
| 1 | **The stress term dominates** | **61% of all drain.** Exceeds HR drain on **49 of 65 days**; correlates **−0.61** with the day's end value |
| 2 | **Sleep cannot charge** | the walk starts at `wakeTime`, discarding the longest low-HR stretch of the day |
| 3 | **The charge ramp zeroes at the ceiling** | full rate only at/below resting HR, where the owner logs ~0 min; mean multiplier **0.30–0.50** |
| 4 | **`DRAIN_RATE` is 3× `CHARGE_RATE`** | 0.60 vs 0.20, on top of the three above |

Result on a full-day replay of 64 days with the shipped constants: **median net −85/day, 66% of days
end at zero.** (The persisted rows read −30 rather than −85 because they are partial-day snapshots —
`hr_sample_count` ranges from **11 to 4,676** depending on when the route last ran.)

**⚠ The charge ceiling is NOT one of the four.** TN-2 and TN-52 both frame it as the problem. It is
not: 220 minutes below the ceiling produced **zero** charge on 2026-09-18, and widening it to TN-52's
p10 quantile moves it 60.1 → 61 bpm, buying 2.8% → 3.7% of the day. Widening the ceiling adds time at
the *bottom* of defect 3's multiplier, which is the least valuable place to add it.

## 2. The proposed model

Three changes to `walkBodyBattery`, then one global gain on the rates.

1. **Charge through sleep.** Integrate from `wakeTime − 8h` at a flat `sleepChargeRate`.
2. **Flat charge ramp.** At or below the rest ceiling, charge at the full rate — delete the
   `(1 − hrr/restThreshold)` multiplier. The ceiling already decides *whether* the user is resting;
   the ramp then second-guesses it with a factor that is near zero wherever he actually sits.
3. **Cut the stress weight** (see §4 — this is a trust decision, not an arithmetic one).
4. **Scale all four rates by a global gain** to control day-to-day swing without disturbing balance.

### Recommended constants — gain 0.5

| constant | shipped | proposed |
|---|---:|---:|
| `CHARGE_RATE` | 0.20 | **0.075** |
| `DRAIN_RATE` | 0.60 | **0.200** |
| `STRESS_DRAIN_RATE` | 0.20 | **0.050** |
| `SLEEP_CHARGE_RATE` | — | **0.060** |
| `REST_THRESHOLD` | 0.05 | **0.05** (unchanged) |

## 3. Measured outcome, 64 days

| | shipped | proposed |
|---|---:|---:|
| median daily net | −85.1 | **−0.2** |
| mean end value | 14.8 | **59.2** |
| sd of end value | 26.4 | **28.0** |
| days ending at 0 | **66%** | **5%** |
| days pinned at 100 | 0% | 8% |

The **spread is preserved** (sd 28) — that is the test that a fix calibrated rather than flattened.
A variant that centres every day near 50 with sd 5 would score well on net and be useless.

Gain is a clean dial with balance held at zero throughout, so Lane A can move within this range
without refitting:

| gain | sd | at rails |
|---:|---:|---:|
| 1.0 | 34.0 | 19% |
| 0.5 (recommended) | 28.0 | 13% |
| 0.3 | 23.9 | **5%** |

Drop to 0.3 if the rails still show in use; below that the battery stops moving within a day.

## 4. The part that is not arithmetic

**The Body Battery is mostly a rendering of the daytime-stress metric** — 61% of drain, −0.61
correlation with the day's end. And that metric's **sign is unvalidated**: TN-33 says it cannot be
settled from stored data, TN-21 found the series is 55% night buckets with night and day carrying
opposite signs, and TN-22's apparent reversal was an eight-day artefact. The owner declined the
three-week `perceived_recovery` log on 2026-09-21, so it stays unvalidated.

So the recommended `STRESS_DRAIN_RATE` of 0.05 is **a deliberate de-weighting of an untrusted input,
not a calibration of a trusted one.** It makes the battery predominantly HR-driven, which *is*
validated. Two consequences to carry:

- **Do not raise it back** on the argument that stress "should" matter more, until TN-33 validates
  the sign. A metric that may be inverted should not be the dominant term in a number the owner reads daily.
- **If TN-33 ever validates it**, this constant is the dial to revisit first, and the fit must be re-run.

## 5. Implementation notes

- `walkBodyBattery` takes every constant as a parameter already; `sleepChargeRate` and the ramp
  change are the only new surface. Keep the constants declared in `app/api/body-battery/route.ts` —
  it stays the one place they are chosen.
- **Bump `MODEL_VERSION`.** It encodes the constants (`v5:rest0.05:chg0.2:...`) and stored rows are
  compared across it.
- **History recompute:** the owner decided 2026-08-26 to recompute rather than freeze. That decision
  stands and this change re-scores all 84 stored days.
- `body-battery-walk.test.ts` pins the shipped shape against hand-computed values — update it, and
  keep a case covering the flat ramp at `hrr` just under the ceiling, which is where the old and new
  models differ most.

## 6. When this may be fitted — not today

The owner's dose went **0.5 mg → 1 mg on 2026-09-13**, eight days ago. The backlog's
calibration-period rule (fit ≥21 days after the last dose change, ≥28 days of data) puts the earliest
honest fit at **2026-10-04**.

The numbers in §2 are fitted across a window that **spans** that change, so treat them as **the
structure plus a starting point, not final values**. The four structural changes in §2 do not depend
on the window and can ship now; re-run `--sweep` after 2026-10-04 and adjust the gain.

**⚠ Do not fit against 2026-09-13 → 2026-10-04.** The implied stress level runs 0.56–0.62 in the last
four days against 0.14–0.41 before the step, so a fit anchored there encodes the titration as normal.

## 7. What this does NOT establish

- **The stress term's shape within a day.** The harness infers one mean level per day from the
  residual; it does not replay `buildDaytimeStressSeriesFromModel`. Any conclusion needing the
  intraday stress curve needs the real series.
- **That 5% railing is achievable in production.** These are full-day replays. The route persists
  partial days (11 to 4,676 samples), so live behaviour depends on when it runs — worth its own
  entry if it shows up after this ships.
- **Anything device-side.** No APK involved; this is server arithmetic reaching the WebView on a
  normal deploy.
