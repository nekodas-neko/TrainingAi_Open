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

### ⚠ REVISED 2026-09-23 — overnight charging is OUT, and the fit is better without it

**This supersedes the first version of this section, which proposed a `SLEEP_CHARGE_RATE`.** Q-272 —
the pre-existing Body Battery entry, which this plan had not read — argues that *"overnight recharge
here is handled by the morning anchor reset rather than accumulated charge, which is a defensible
difference"*. That argument is right, and charging overnight **on top of** an anchor derived from
readiness/sleep counts the night twice. It also showed up in the measurements as 13–14% of days pinned
at 100, which is what double-counting looks like.

Re-fitted with no overnight term, the result is **strictly better on every axis**:

| | shipped | first proposal (sleep charge) | **revised (no sleep charge)** |
|---|---:|---:|---:|
| median daily net | −85.1 | −0.2 | **+0.5** |
| mean end value | 14.8 | 59.2 | **61.4** |
| sd of end value | 26.4 | 28.0 | **25.3** |
| days ending at 0 | 66% | 5% | **0%** |
| days pinned at 100 | 0% | 8% | **9%** |

### Recommended constants — gain 0.40, no overnight term

| constant | shipped | proposed |
|---|---:|---:|
| `CHARGE_RATE` | 0.20 | **0.120** |
| `DRAIN_RATE` | 0.60 | **0.080** |
| `STRESS_DRAIN_RATE` | 0.20 | **0.020** |
| `REST_THRESHOLD` | 0.05 | **0.05** (unchanged) |
| overnight charge | — | **none — the wake anchor keeps that job** |

Gain 0.30 (`0.090 / 0.060 / 0.015`) takes railing to 6% at sd 22.8 if the pinning shows in use.

**⚠ `DRAIN_RATE` falls 7.5×, and that needs one check this plan cannot make.** Q-521 measured that
drain already tracks *wear time* rather than exertion (`corr(hr_sample_count, drained)` = **+0.518** vs
`corr(steps, drained)` = **−0.153**). Weakening drain further could make a hard session even less
visible. Before shipping, confirm a workout day still separates from a rest day; if it does not, that
is a **separate defect** (drain is keyed on the wrong input) and must not be patched by raising
`DRAIN_RATE` back, which would restore the −30/day countdown.

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

## 6a. Reconciliation with Q-272 and Q-502 — read this before believing either

**This plan is Q-272's missing proposal.** Q-272 has said since 2026-08-15 that *"the next action is
Tuning's, not theirs"* and that no proposal existed. It does now; the two entries are one line of work
and TN-55 points here.

**⚠ Q-272's acceptance test DOES NOT REPLICATE, and it was about to be used to sign off this change.**
The entry records *"v5 end-of-day battery → next-day readiness is r = +0.67 (n = 11)"* and instructs a
later session to *"re-run the r = +0.67 check after the change"*. Re-measured 2026-09-23 over **70
days**: **r = +0.252** — and readiness's own day-to-day autocorrelation is **+0.361**, which is
*higher*. So the battery's end value predicts tomorrow's readiness **worse than yesterday's readiness
does**, and it carries no independent predictive signal. The n=11 figure did not survive the sample
growing.

**Consequences, both of which matter:**
- **Do not use r = +0.67, or any battery→readiness correlation, as the pass test.** Use the
  distributional test in §3. A change cannot be validated against a relationship that is not there.
- **Q-272's argument that *"v5's level carries real signal; its shape within the day is wrong"* loses
  its evidence.** The shape is still wrong — §1's four defects are independently measured — but the
  claim that the level is sound rested on that correlation, so it is withdrawn rather than inherited.

**Q-502 says `REST_THRESHOLD` is the lever; §1 says the ceiling is not the binding constraint. Both
are right about different things.** Q-502 refuted raising `CHARGE_RATE` *alone*, because the window is
active on only ~6.7% of waking samples — that refutation stands and this plan does not raise
`CHARGE_RATE`. Where it goes further than the evidence is in concluding the *threshold* is therefore
the lever: widening it to TN-52's p10 quantile moves it 60.1 → 61 bpm and buys 2.8% → 3.7% of the day.
The window is barely active for a different reason than its width — sleep is excluded from the walk and
the ramp zeroes at the ceiling, so the samples inside the window earn almost nothing. Flattening the
ramp makes the *existing* window productive, which is what Q-502 was reaching for by widening it.

## 7. What this does NOT establish

- **The stress term's shape within a day.** The harness infers one mean level per day from the
  residual; it does not replay `buildDaytimeStressSeriesFromModel`. Any conclusion needing the
  intraday stress curve needs the real series.
- **That 5% railing is achievable in production.** These are full-day replays. The route persists
  partial days (11 to 4,676 samples), so live behaviour depends on when it runs — worth its own
  entry if it shows up after this ships.
- **Anything device-side.** No APK involved; this is server arithmetic reaching the WebView on a
  normal deploy.
