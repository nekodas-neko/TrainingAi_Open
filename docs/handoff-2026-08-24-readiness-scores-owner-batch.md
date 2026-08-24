# Handoff — 2026-08-24 · the owner's readiness/battery batch, measured

_Domain: `readiness` (also `sleep`, `heart-rate`, `devices`) · Branches: `claude/tuning-agent-orientation-jx0zah`,
`tuning/sleep-calibration-gain`, `tuning/readiness-deload-trigger`, `docs/tuning-wrap-2026-08-24` ·
PRs [#409](https://github.com/nekodas-neko/TrainingAi_Open/pull/409),
[#414](https://github.com/nekodas-neko/TrainingAi_Open/pull/414),
[#426](https://github.com/nekodas-neko/TrainingAi_Open/pull/426) — **all merged**_

> **Read first:** `projectOverview.md` Known Issues (three new rows), then
> [`docs/domains/readiness/README.md`](domains/readiness/README.md), then the three reviews linked
> below. **Every production figure was pulled 2026-08-24** — re-pull before quoting.

## Goal

Four owner questions in one session, none of them from the backlog: is daytime stress real and can it
go on the HR graphs; why has Body Battery been at 0 since early afternoon; why are the scores so
varied lately; and why does "body temp elevated" keep forcing deload days.

## What shipped

**Docs only — Tuning proposes and does not implement.** Seven entries filed; Lane A has already built
two of them off this work.

| Entry | Finding | State |
|---|---|---|
| **TN-2** | Body Battery charges only below **57.8 bpm** — under the owner's 5th-pct waking HR of 62. **0.5% of waking time** can charge; 7 of 56 days end at 0, **5 of the last 8** | direction signed off; offset unfitted, bracket **+8…+12** |
| **TN-3a/b** | the 30-min stress bucket series is computed and discarded — no hour-of-day question is answerable from storage | queued, 3b `Needs: 3a` |
| **TN-4** | a stress-model failure 500'd the whole Body Battery card (31 × on 2026-08-23) | **shipped, #415** |
| **TN-5** | `SCORE_CALIBRATION` gain varies **8-fold** (4.00× at blend 79 vs 0.50× at 92) | `Gate: owner` |
| **TN-6** | temperature baseline **0.363 °C low** → −10 arm fires on **91.2%** of nights, −16.3 pts/day | `Gate: owner`, batched with Q-506 |
| **TN-7** | TN-4's catch only `console.error`s, so LA-20's verification can no longer fail | queued, one line |

## The three findings worth carrying

**1. Body Battery's charge window closed because the owner got fitter.** `restingHr + 0.05 × reserve`
= 57.8 bpm today. Resting HR fell 67 → 52 (real gain) and `hrMax` fell 187 → 168 when observed-peak
resolution replaced the age estimate — the ceiling shrinks from **both** ends. Q-515's mechanism with
a visible consequence. [`review`](reviews/2026-08-24-body-battery-charge-window-collapse.md).

**2. The sleep score's swing is real signal.** Stored |Δ| went 9.2 → 21.2 at the recalibration, but
the **pre-calibration blend moved 9.15 → 9.27 — unchanged**. Two things landed together on 08-19: the
calibration began applying at all, and the blend mean fell 87.1 → 71.1 into the curve's steep zone.
[`review`](reviews/2026-08-24-sleep-score-volatility.md).

**3. One temperature baseline is failing two consumers in opposite directions.** Its **sd is ~13×
too wide** → `tempZ` divides to nothing → the illness radar can never fire (Q-506). Its **mean is
0.363 °C low** → the absolute deviation is positive on **34 of 34 nights** → readiness is penalised
daily (TN-6). Correcting either half alone looks like it fixed both, so they are batched.
[`review`](reviews/2026-08-24-readiness-temperature-penalty.md).

## Decisions, with rationale

- **TN-5 is filed as an interpretability fix, not a jitter fix.** The baton's standing advice — flatten
  the 74–85 segment if the spread reads as jitter — **was tested and fails**: a curve's total rise is
  conserved, so flattening one segment steepens another and |Δ| goes 13.53 → **13.75**. The baton line
  was replaced rather than left to be retried.
- **The 0.3/0.5/1.0 temperature ladder is not touched.** Against a true nightly sd of 0.140 °C it sits
  at 2.1/3.6/7.1 sd. Fourth "the threshold is right, the input is wrong" in this pillar.
- **TN-3b sits behind TN-3a** rather than shipping today-only. Today's stress series is already in the
  `/api/body-battery` payload, so an overlay could ship alone — and would silently do nothing on every
  other day.
- **TN-4 was kept open after shipping**, correctly, because the root cause is unexplained.

## Gotchas that cost time here

- **A per-sample percentile is not a per-time percentile.** The ring power-gates its PPG, so the
  uncorrected charge-coverage figure read ~20% where the time-weighted answer is **1.6%** — an order
  of magnitude, and it would have gone into a proposal.
- **SQL integer division silently zeroes a ratio.** `(bpm - rhr)/res` on integer columns truncated to
  0, so every sample read as "resting" and the first replay returned every day at 100. Cast to numeric.
- **+18 bpm was the first Body Battery offset tried and it overshoots** into a permanently-full tank
  (mean 90.8, a third of days at 100).
- **`get_status` on a PR can read `pending` with `total_count: 0` while all six checks are green** —
  use `get_check_runs`, and attempting the merge is the reliable test.
- **`git fetch origin main` re-grafts the shallow clone** and makes `git merge origin/main` fail with
  *"refusing to merge unrelated histories"*. `git fetch --unshallow origin` first.

## Deliberately NOT done

- **No scoring change implemented.** TN-5 and TN-6 need the owner; TN-2's offset needs fitting against
  the shipped TypeScript with the stress term active — and Lane A has since measured (`426cbfbb`) that
  **this cannot run from a session container**.
- **Activity's volatility (7.2 → 12.2) was not filed.** Six deltas cannot distinguish a change from a
  run of unusual days. Re-measure at n ≥ 20.
- **Whether the owner was actually ill on any temperature-flagged night is not established** — only
  that a permanently-positive deviation cannot tell illness from baseline error.

## Failure surfaces not exercised

**No code ran in this session.** SQL against production plus source reading — no `pnpm dev`, no
device, no APK, no native/offline/safe-area path. Both replays (Body Battery walk, sleep blend) are
re-implementations in SQL/Python, validated against stored values first (battery: 13 pts mean
absolute error; sleep: ±1 on every night in both regimes). They are evidence for proposals, not
substitutes for fitting against the shipped code.

## Pickup prompt

```
Read docs/agents/prompts/tuning.md and follow it verbatim.
Set this session's title to `🎶 Tuning Agent 🟢` — exactly, both emoji included. Flip it to 🔴
only at your own handover, after everything has landed.

Read your baton at docs/agents/state/tuning.md first (it was compacted 582 → 99 lines on
2026-08-24 — the narrative it used to carry is now in the three reviews it links), then
docs/handoff-2026-08-24-readiness-scores-owner-batch.md.

Orientation reads, in order: docs/agents/state/tuning.md · docs/agents/README.md §1-2 and §4 ·
CLAUDE.md · projectOverview.md (three new Known-Issues rows: TN-2, TN-5, TN-6) ·
docs/domains/readiness/README.md. Do the two session-start production reads (error_events and
database size) via POST /api/admin/db-query.

Your entry IDs are TN-<n>, counting up forever. TN-7 is taken; find the next free with:
  grep -rhoE '\bTN-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1

DO NOT pick a pillar to measure — every pillar with a scoring surface is measured except cardio,
which is deliberately skipped for lack of data. The useful work is re-measuring AFTER Lane A
lands one of TN-2 / TN-5 / TN-6 / Q-506; each carries its own pass test.

Two proposals are waiting on the owner and must not be implemented without sign-off: TN-5 (the
sleep calibration's 8-fold gain spread) and TN-6 (the temperature baseline). TN-2's direction is
signed off but its offset is unfitted, and Lane A has measured that the fit cannot run from a
session container (commit 426cbfbb) — do not fit it without the stress term and ship anyway.

One measurement is genuinely open and cheap: activity's day-to-day volatility read 7.2 → 12.2
after 2026-08-19, on only six deltas. Re-measure at n >= 20 before filing anything.

Constraints you would otherwise re-discover:
- You propose; you do not ship. Any scoring change is the owner's sign-off and Lane A's to build.
  Your PRs are docs-only and merge without asking.
- claude_ro views are row-scoped to ONE user; error_events prunes at 30 days. Every count is
  "the owner's, recently" — never "the system's".
- pg_stat_user_tables row counters are planner ESTIMATES (last_analyze is NULL on every table);
  its SIZE columns are exact. To ask whether a table is empty, run count(*).
- Any coverage or percentile measurement on the BLE HR series must be TIME-weighted — the ring
  power-gates its PPG, and a per-sample percentile reads ~20% where the true answer is 1.6%.
- Cast to numeric in SQL before dividing integer columns; integer division silently zeroes ratios.
- git fetch origin main re-grafts the shallow clone and breaks git merge with "unrelated
  histories" — run git fetch --unshallow origin first.
- On a PR, get_status can read pending while every check is green; use get_check_runs, and
  attempting the merge is the reliable test.
```
