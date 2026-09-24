# Review sweep 57 — a census of the owner's own data

**2026-09-24 · Review · docs only. Every figure is a SELECT through `claude_ro` and covers the owner's
rows only. The window is 2026-07-26 → 09-24 unless stated.**

## Why this angle

Sweep 56's biggest find, 12 of 27 nights missing from `sleep_sessions`, came from looking at the
data rather than the code or the screen. So this sweep asked of every daily series the app shows
him: **is it complete, plausible, and consistent with the table beside it?** Four read-only agents
each took a quarter: sleep and recovery, training, nutrition and body, and activity, devices and AI.
Each read the writer's code before calling a gap a finding, and grepped the backlog before calling
anything new. This session re-checked every high-stakes finding against production or code.

**Most of the data is clean**, and that is worth recording so the next sweep can skip it:
- body metrics 61 of 61 days, with weight matching the scale's confirmed reading;
- food-log integrity: 0 orphans and 0 date/`logged_at` mismatches;
- exercise and set logs: 0 orphans, 0 duplicates, 0 out-of-range values;
- personal records: 40 of 40 agree with the logs;
- ring HR on every day, with 0 duplicate timestamps;
- the raw-frame archive is contiguous;
- 127 AI calls with 0 errors;
- nothing new in `error_events` in 30 days;
- one mood log per day, and no duplicate check-ins.

## New findings

| id | lane | finding | re-checked here |
|---|---|---|---|
| **RV-163** | A | **"Last night" is picked by four different rules** (longest, latest, latest, earliest). On 09-23 a 6.17 h daytime rest became the night: sleep 42, readiness 44, and a flat Body Battery with 2 samples against 203. This is TN-20's trigger | code, all four sites |
| **RV-164** | B | **A goal recommendation is marked "applied" without checking its writes.** The 09-14 one (1,618 kcal) says applied; the targets still read 1,660 and were last written 08-31 | production and code |
| **RV-165** | A | **The height correction never reached the stored scale composition.** Body fat shows a false +1.1 step on 09-01. The DEXA offset is fitted at 160 cm (+3.2 where it should be +2.2), so corrected body fat reads ~1 point high | agent's formula inversion |
| **RV-166** | B | **No prescribed run has ever been marked done:** 26 rows, 0 completed. 20 prescribed days had a walk; only runs link | production |
| **RV-167** | B | A walk whose strap cadence started late stored 584 steps against ~3,000 | agent |
| **RV-168** | A | `session_exercises.exercise_id` is wiped by every program save (Bankai 0 of 25) | agent |
| **RV-169** | A | **#1256's "self-heals over 21 days" did not happen:** 09-01 → 09-16 stress still counts sleep | agent |
| **RV-170** | **O** | **The history-row policy has never been asked.** It lived only as a paragraph in three entries since 09-16. It is now one owner question with eight members, a recommendation and BF-81's precedent | — |

## Existing entries updated

- **RV-159 is answered.** The 02:37 rewrite was the rollup's body-comp re-stamp: exactly the 104
  rows with `body_comp`, with no score recomputed.
- **BF-38 FAILED on real data:** 19 exact-duplicate foods since the fix, 2 of them from the path it
  covers.
- **BF-191:** two more live phantom walk rows, and its proposed detection signature misses both.
- **PS-17:** correction to sweep 56. On 09-18 the summary also took the afternoon window.
- **Q-298:** 15 rows, not 10.
- **RV-160:** production evidence that BF-155's and TN-57's fixes work.

## Decisions routed to the Orchestrator this session

Per #1508, an owner question is a `Lane: O` task near the top of the lane. `O` now opens with:
1. **RV-161** (five decisions from sweep 56);
2. **RV-157** (six owner sittings);
3. **RV-170** (the history policy, plus the two questions this census raised).

RV-161 and RV-157 had been filed at ranks 17 and 13, which is past `next-item.js`'s top-10 view.

## Unsure, recorded so nobody re-derives it

- `temp_mean_c` is null on 3 normal nights (07-25, 08-08, 09-12).
- Steps fell from ~7k/day in July to ~2.7k in September, and walked kilometres fell with them, so
  this is probably real.
- The AMRAP week (09-07 → 09-12) put 11 of 24 one-rep maxes 25–65% below their previous estimate.
  That is a Tuning question.
- `hrr1_best` values as low as 1.
- 12 of 35 prescription AI calls repeat a fingerprint.
