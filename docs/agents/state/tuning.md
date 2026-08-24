# 🎶 Tuning Agent — baton

> **Successor sessions are titled `🎶 Tuning Agent 🟢`** — exactly, both emoji. Leading emoji = role,
> trailing = this session's status, set by the session itself. See `docs/agents/README.md` §4.

**Updated:** 2026-08-24 · **By:** `session_01VVfZtbCftbwaUHtBLJoxVr` · **Next ID:** `TN-8`.
Find next free: `grep -rhoE '\bTN-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1`. Legacy `Q-` numbers
stay valid. **Rewritten in full, never appended** — narrative lives in the linked reviews.

**Compacted 2026-08-24 from 582 lines** (the PS-4 outlier). Everything cut is in the reviews below.

## Now

**Nothing is blocked on the owner, and nothing is blocked on you.** Every decision this batch needed
was asked plainly and answered on 2026-08-24 — see the block under the table. TN-2's offset is the
only thing still open, and it is a fit Lane A must run, not a decision.

Filed this session, all propose-only, all in the queue:

| ID | What | State |
|---|---|---|
| **TN-2** | Body Battery charge window is below the owner's 5th-pct waking HR; floors by ~12:30pm | direction signed off, offset unfitted (**+8…+12**) |
| **TN-3a/b** | per-bucket stress series is computed then discarded — no hour-of-day question is answerable | 3b `Needs: 3a` |
| **TN-4** | `/api/body-battery` 500s on a stress-model failure | **SHIPPED** #415; root cause still open |
| **TN-5** | `SCORE_CALIBRATION` gain varies 8-fold | **signed off** — build it |
| **TN-6** | temp baseline 0.363 °C low → −16 pts/day on 89% of days | **signed off**; batched with Q-506 + **BF-13** |
| **TN-6a** | suspend the temperature penalty until the baseline is centred | **signed off**, ships alone, outside the batch |
| **TN-7** | TN-4's catch only `console.error`s, disarming LA-20's verification | one line, Lane A |

**Owner decisions, 2026-08-24 — all recorded on the entries, nothing left gated on them.** TN-5 and
TN-6 signed off; **TN-6a** added (suspend the temperature penalty on a self-clearing condition, ships
outside the batch, must cover all three consumers). **History policy: leave stored days alone and
stamp the new model** — which leans on a stamp Q-518 says gets erased, so **Q-518 is now load-bearing**.
On **BF-13** (BugFix's entry, whose root cause supersedes TN-6's): re-derive the baselines, fix the
seed for all six, re-derive only what is measurably wrong. **Measured: only `temp` is** (gap +2.80 sd,
100% of nights above; the other five are ≤0.28 sd).

Reviews: [battery](../../reviews/2026-08-24-body-battery-charge-window-collapse.md) ·
[sleep](../../reviews/2026-08-24-sleep-score-volatility.md) ·
[temperature](../../reviews/2026-08-24-readiness-temperature-penalty.md) ·
[handoff](../../handoff-2026-08-24-readiness-scores-owner-batch.md).

**Lane A is already working from these** — #415 shipped TN-4, #417 landed a TN-2 enabling refactor,
and `426cbfbb` records that TN-2's fit **cannot run from a session container** (vendored constants
Q-49 removed; `oura_raw_samples` holds ~7 of the 56 days needed; `decoded` NULL on those).

## Next

1. **Re-measure after Lane A lands any of TN-2/5/6 or Q-506** — each carries its own pass test.
2. **Activity volatility at n ≥ 20.** It read 7.2 → 12.2 day-to-day, which would be a real change of
   character for the most compressed score in the app. **Six deltas cannot tell that from a run of
   unusual days** — deliberately not filed.
3. **Earlier open findings, none built:** illness radar cannot fire (Q-506) · stress override fires
   on the *best* days (Q-507) · resilience has emitted one value ever (Q-508/510) · BLE input drift,
   anchor must not move (Q-509) · battery anchor flip (Q-511) · ACWR call-site windows (Q-512/513) ·
   64% of back-off cuts are a clamp artefact (Q-514) · rest/active boundary shrinks with fitness
   (Q-515) · `PEAK_BANDS` unreachable (Q-516) · adaptive-TDEE below BMR (Q-517) · model stamp erased
   (Q-518) · manual bedtime (Q-519) · partial-night flag (Q-520) · battery drain model (Q-527) ·
   `replaceOuraDailySummary` delete-before-guard (Q-528) · chronic stress (Q-525, TN-1).

## Pillar coverage

Every pillar with a scoring surface is measured except **cardio**, deliberately skipped (~13
run/treadmill sessions, newest 2026-07-24 — too thin to fit five boundaries to).
sleep ✅ · readiness ✅ · activity ✅ · body ✅ · devices ✅ · workouts ✅ · heart-rate 🟡 · nutrition ✅.
**So do not go looking for a pillar to measure.** The useful work is re-measuring after a fix lands.

## Do not re-litigate

- **A calibration curve cannot reduce displayed volatility — its total rise is conserved.** Uniform
  gain moved night-to-night |Δ| 13.53 → **13.75**. Diagnose "the score jumps around" by
  reconstructing the pre-calibration blend first; if its |Δ| is unchanged, no curve change helps.
- **Any coverage/percentile measurement on the BLE HR series must be TIME-weighted.** The ring
  power-gates its PPG, so a per-sample percentile read ~20% where the time-weighted answer was 1.6%.
- **+18 bpm overshoots Body Battery** into a permanently-full tank (mean 90.8, a third of days at
  100). "It floors too often" invites exactly that; a full tank carries no information (Q-57).
- **Get a fixed-point factor from the CALL SITE, never by inference.** Inferring each baseline's
  scale as the best-fitting power of ten is right for temp (×100) and wrong for sleep (**×60**), and
  produced a phantom "sleep baseline 4.768 h against a true 8.010" that would have caused an
  unnecessary production data change. `daily-summary.ts:102-112` has all six, four lines apart.
- **To ask whether a baseline is centred, use `% of nights above it`, not the raw gap.** 100% for
  temperature, near 50 when healthy. Pair it with gap/nightly-sd: hrv reads 87.8% above on a gap of
  0.04 sd, which is an EMA lagging a rising metric, not a defect.
- **⛔ `pg_stat_user_tables` row counters are planner ESTIMATES** — `last_analyze` is NULL on every
  table here. Its **size** columns are exact. To ask whether a table is empty, run `count(*)`. A
  predecessor filed a data-loss incident (Q-528) off `n_live_tup` that had never happened.
- **`claude_ro` views are row-scoped to ONE user** and `error_events` prunes at 30 days. Write every
  count as "the owner's, recently", never "the system's".
- **A hardening fix can delete the evidence another open investigation needs** (TN-7). When a fix
  turns a 500 into a fallback, check what was waiting on that 500.
- **The threshold is usually right and the input usually wrong** — Q-506, Q-512, Q-514, now TN-6.
  Check the input's distribution before touching any constant.
- **Do NOT lift the sleep scale toward its old mean** — sleep/readiness agreeing is load-bearing for
  the Body Battery anchor (Q-511).
- **A threshold on a display scale is calibrated to that scale's distribution.** Re-anchor in the
  same PR as a range change, preserving the firing *rate*.
- **Contributor curves set the RANKING; a calibration on the blend sets the RANGE.** Do not fix a
  range problem with curves.
- **A range calibration transfers to neither Readiness** (breaks three composite invariants) **nor
  Activity** (its ranking disagrees with its most variable input).
- **Do not assert a permanent absence from a short observation** (Q-529 claimed a score is never
  recomputed; it recomputed nine minutes later).
- **A constant value is as often a retired question as a broken one** — check the last write date
  *and* the write site before filing.
- **A replay must reproduce stored values before any counterfactual on it means anything.**
- **Production data moves under you mid-session.** Re-pull before quoting; record the pull time.
- **`/api/admin/db-query` truncates at 1000 rows**, can 401 under burst, and can lock out for
  minutes. Budget queries rather than iterating.
- **SQL integer division silently zeroes a ratio** — cast to numeric. It made every HR sample read
  as "resting" in a replay here before it was caught.
- **`git log` cannot date anything before 2026-08-19** — history was cut at the public-repo migration.

## Claimed paths

**Nothing claimed.** Every entry above is docs-only and propose-only.
