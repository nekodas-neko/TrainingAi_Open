# 2026-09-24 — resilience published five weeks of "5", then never reached 5 again

**Branch:** `tuning/resilience-two-regimes` · **Agent:** Tuning · **Docs-only.**

Still looking for a score with an independent comparator. Found that one of the comparators does not
exist, and that a metric nobody has looked at has switched regimes.

## Two disjoint regimes

| regime | days | levels seen | mean confidence |
|---|---:|---|---:|
| 2026-07-24 → 2026-08-29 | **16** | **5, and only 5** | 0.464 |
| 2026-09-07 → 2026-09-22 | **14** | **1, 2, 3, 4 — never 5** | 0.434 |
| everything else | 99 | none published | — |

No value in common, an eight-day gap between them, and a 1–5 band that spent five weeks pinned at the
top and has not touched it since. The model's own `confidence` is ~0.45 in both, so nothing in its
self-assessment marks the change.

**`confidence` is not a gate.** `stress-resilience.ts:310` computes it as `validCount / windowLength`,
so 0.464 means fewer than half the window's days were valid and the level published anyway.

## Mechanism: candidates, none established

Five rollup/stress commits land in or before the gap. **PS-30** (#923) is the interesting one — it
repaired a wear-time defect holding **22 consecutive days (2026-08-14 → 09-04) at 81,000–85,500 s of
non-wear**, overlapping the tail of the level-5 run, and resilience gates on daytime-stress coverage.
**But the level-5 run starts three weeks before PS-30's span**, so it cannot explain the regime and is
not written up as the cause.

**One tempting reading is wrong.** `daytime_stress_coverage_min` is NULL across the whole level-5 regime
and 191 min in the September one, which looks like the missing input. It is not: the column was added on
2026-09-02 (#817), so its absence is the column's age.

**The decisive test is cheap** — re-run the rollup over 2026-07-24 → 08-29 with PS-30 and the September
fixes in, and see whether those 16 days still come back as 5. Filed `Lane: A`, since the rollup is
engine territory and the test is a re-run rather than a calibration.

## Two dead columns, recorded so nobody re-derives them

- **`sleep_sessions.sleep_score`: 0 of 123 nights.** That is Oura Cloud's own sleep score, so **no
  independent comparator for our sleep score exists** — zero nights carry both. Another validation route
  closed, alongside TN-67's.
- **`oura_daily_derived.worn_hours_ble`: NULL on all 129 days**, and `oura_daily.resilience_level` on all
  rows — so the derived resilience is ours, not a Cloud passthrough.

## Not exercised

Nothing runs. Read-only `claude_ro` queries, **row-scoped to the owner**, plus source and git-history
reading. **Not established:** why the regimes differ, whether either is correct, or whether the level-5
month was ever right. This is a measurement and a test, not a diagnosis — and per TN-67 there is no
external validation for this score either, so "correct" can only mean "what the vendor model yields on
sound inputs". `pnpm check:rules` result below.
