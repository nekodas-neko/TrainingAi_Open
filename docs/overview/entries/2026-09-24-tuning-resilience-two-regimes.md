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

## TN-71 — the contributor share table LA-122 2b was waiting for

That item was deliberately parked until TN-60's tail fix shipped, because the fix moves the table. It has
shipped, so the measurement is now due: each stored day's contributor `input` (Q-501) re-driven through
the **current** composite, share of movement = weight × mean absolute deviation, normalised.

| contributor | weight | share | share ÷ weight | mean | range |
|---|---:|---:|---:|---:|---|
| `hrvBalance` | 15% | **27.7%** | 1.85 | 39.5 | 3–94 |
| `restingHeartRate` | 15% | 19.4% | 1.29 | 45.9 | 5–87 |
| `recoveryIndex` | 9% | **14.4%** | 1.61 | 52.6 | 15–100 |
| `sleepBalance` | 10% | 12.6% | 1.26 | 48.6 | 9–95 |
| `previousNight` | 16% | 11.4% | 0.71 | 55.5 | 15–88 |
| `checkin` | 10% | 8.5% | 0.85 | 58.2 | 30–72 |
| `prevDayActivity` | 9% | 2.8% | 0.31 | 68.2 | 57–79 |
| `activityBalance` | 6% | 2.1% | 0.36 | 68.3 | 54–82 |
| **`temperature`** | **10%** | **1.1%** | **0.11** | 85.3 | **81–89** |

**`temperature` is the finding:** a tenth of the model, an eight-point range across the month, 1.1% of
the movement. Not broken — *stable*, which for an illness signal may be correct — but a constant with a
weight suppresses the terms that do carry signal. Together, `temperature` and the two activity terms hold
**31% of the weight and deliver 6.1% of the movement**, which makes this one weight question rather than
three. Filed `Lane: O`; nothing changes until the owner answers, and it re-scores all history so it should
happen once.

**TN-60 worked, visibly:** `hrvBalance` was 22.8% of movement before the tail fix and is 27.7% now.

### The trap I nearly published

The stored `input` field is much sparser than the rows — contributors with a real input average **0.0 of
9 in July, 1.7 in August, 8.8 in September**. My first pass covered all 71 days, fed nulls for 41 of
them, got neutral 50s back and produced a plausible table that was **41/71 synthetic**. The real window
is **25 days, 2026-08-26 → 09-24**, and it is stated on the entry as one month rather than a year —
which matters most for a temperature term. Fourth time tonight that a coverage check changed a result.

### A stale comment in the file that defines the model

Lines 11–13 of `readiness-composite.ts` say Recovery Index *"has no calibratable hours→score mapping …
so it's always neutral/provisional … never scored"*. It **is** scored — `recoveryIndexScore` maps hours
linearly against `RECOVERY_INDEX_OPTIMAL_HOURS = 5`, ranges **15–100** here, and carries **14.4% of the
movement, third largest of the nine**. The function is right and its own comment is right (`provisional`
there means the *curve* is approximate — the Q-278 distinction); the header is stale, and it is the line
a reader checks first. **Fix the comment, not the code.**

## Not exercised

Nothing runs. Read-only `claude_ro` queries, **row-scoped to the owner**, plus source and git-history
reading. **Not established:** why the regimes differ, whether either is correct, or whether the level-5
month was ever right. This is a measurement and a test, not a diagnosis — and per TN-67 there is no
external validation for this score either, so "correct" can only mean "what the vendor model yields on
sound inputs". `pnpm check:rules` result below. For TN-71: the share table is **25 days**, so it says nothing about a
year, and a temperature term is exactly what would differ across seasons. It also describes which inputs
MOVE the score, never which ones should — per TN-67 there is no external validation to appeal to.
