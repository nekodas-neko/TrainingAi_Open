# RV-163 — one date, two nights, four rules for picking between them

**Branch:** `lane-a/rv163-one-night-selection` · **Lane A** · 2026-09-24

`ALWAYS_NIGHT_MIN_HOURS` promotes any sleep window over four hours to "night" wherever it sat on the
clock, so one wake date can carry two night periods. `nightSessions` returns both, and every caller
then broke the tie itself — by four different rules.

Production, 2026-09-23: an overnight of 21:27–06:01 (7.92 h, efficiency 92) and a daytime window of
10:42–17:25 (6.17 h, efficiency 91). The stored sleep contributors matched the **daytime** one, so
the sleep score was **42** against about 76, and readiness took that 42 as the previous night and
came out **44**. Body Battery anchored its wake at 17:25 and stored **2** HR samples against the
ring's 203 — which is the unidentified trigger TN-20 was left holding, and the anomaly Review sweep
56 flagged on LA-134 this morning.

**This class has shipped twice.** `nightPeriodsByDate` exists because the BLE rollup kept its own
last-wins copy of the rule (PS-17), which on 2026-08-27 let a 4.75 h daytime window replace a 7.42 h
night in `oura_daily_summary`.

## What was actually there

The entry named four consumers. There were **five**, and one it named is not a consumer at all:

| site | rule | in the entry? |
|---|---|---|
| `readiness-payload.ts:360` | latest | yes |
| `body-battery/route.ts:180` | latest-for-date | yes |
| `score-audit/sleep.ts:45` | earliest | yes (under a stale `lib/` path) |
| `ai/health-insight/route.ts:119` | earliest, then latest | yes |
| **`progress-summary/route.ts:57`** | latest | **no — and it is user-facing** |
| `admin/rederive-baselines/route.ts:156` | — | listed by me in error; see below |

`progress-summary` renders "last night's sleep" on a card, and its own comment says `.at(-1)` is
last night. `rederive-baselines` I started to change and then reverted: its `nights` is a locally
built `NightOutcome[]`, one per night by construction from a replay loop, so there is no tie to
break and `nights[length - 1]` is correct there.

The stale path is the documented `lib/` → `packages/shared/src/` drift (Q-153) — line number and
code matched exactly.

**And `latestNight` already existed, with zero callers** — a helper written for this exact question
while five sites hand-rolled it. Same shape as the dead `ALLOWED_IMAGE_MIME` found earlier today.

## The fix, and the scope it deliberately did not take

`latestNight` now resolves the latest **date** first and lets `nightPeriodsByDate` pick that date's
real night. Two new helpers, `canonicalNightForDate` and `canonicalLatestNight`, answer the same two
questions for callers holding `nightSessions`' aggregated output rather than raw sessions.

**Not fixed inside `nightSessions`,** which was the tempting one-line version. Eighteen call sites
read it, most of them summing weekly and trend totals — collapsing a date there would also silently
decide whether a long daytime rest counts as sleep *at all*. That is a different question and nobody
asked it.

## The guard, widened by shape rather than threshold

TN-20's rule was `excluded.hr_sample_count > 0`, which counts a day as measured on a single sample —
so 09-23's two-sample read passed a guard written to stop exactly this.

TN-20 explicitly ruled out a monotonic `excluded >= stored`, because it freezes a day at a bad value
and blocks a legitimate downward correction. That reasoning holds, and a "fewer than N samples"
floor is the same rule with an invented constant.

So the guard now refuses **measured → unmeasured**: never overwrite a day that recorded movement
with one that recorded none. All four days TN-20 measured, and this one, share `charged = 0 AND
drained = 0`; a day that genuinely moved never looks like that whatever its sample count. No
constant is chosen, and it still repairs — a later read that does see movement overwrites the flat
row.

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | `latestNight` back to the last element | killed |
| 2 | `canonicalNightForDate` takes the last match, not the longest | killed (3) |
| 3 | the guard back to the count-only rule | killed |
| C | the latest-date scan written with `reduce` | survived (correct) |

## A fixture that lied

The first version of the date-ordering test built "last week's night" by spreading the overnight and
editing its `date` field. `groupSleepPeriods` derives the date from `sleepEnd` and stitches nearby
windows, so the clone merged into one 17.42 h night. Real timestamps a week earlier fixed it — the
repo's standing rule about deriving fixtures rather than hand-setting one side, in a shape its
existing examples do not cover.

## Failure surfaces not exercised

No device. **The two damaged days are not re-scored** — that is RV-170's recompute, and rewriting
stored scores is the owner's call rather than a lane's. Until it runs, 2026-09-23 and 2026-08-27
keep the scores the old rule produced.
