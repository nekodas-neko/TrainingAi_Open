# 2026-08-03 — the implausible 1RM growth is real load progression, not estimator drift

_Branch `docs/1rm-growth-measured` · docs-only · domain `workouts`_

## The question

A same-day audit flagged four lifts growing 37–46% in estimated 1RM over seven weeks and offered two
candidate causes: loads ramping from a start well below true capacity, **or** estimator drift. It
mattered because `rm1Trend` gates phase-transition eligibility and autoregulation — if the estimator
were drifting, every prescription would be riding on a fiction.

Nobody had looked at the underlying sets. This did.

## What the sets say

Each of the four traced through production, session by session:

| Lift | first session | last session | bar weight | 1RM estimate |
|---|---|---|---|---|
| Bent-Over Barbell Row | 25 kg × 15 | 60 kg × 9 | **+140%** | +121% (37.5 → 82.8) |
| Incline Bench Press | 30 kg × 20 | 62.5 kg × 7 | **+108%** | +39% (56.8 → 78.8) |
| Barbell Shrug | 50 kg × 15 | 77.5 kg × 10 | **+55%** | +38% (78.5 → 108.0) |
| Barbell Calf Raise | 50 kg × 20 | 92.5 kg × 10 | **+85%** | +39% (94.8 → 131.3) |

**The weight on the bar grew more than the estimate did, in all four cases.** The estimator is
damping the raw load increase, which is the opposite of drift.

It is also well-guarded, which is worth recording since the question will come up again:
`repFactor` averages Epley and Brzycki, **freezes the Brzycki term past 20 reps** (its `36/(37−reps)`
blows up toward rep 36), and `REP_CEILING = 30` rejects anything beyond outright.

## Conclusions

**`rm1Trend` is reporting correctly.** Those lifts genuinely went up. The phase-transition gate and
autoregulation are reading real progression and need no change — which is the answer the audit was
actually after.

**The percentages themselves are a baseline artifact.** All four are measured from a 15–20-rep
opening set: the region where a rep-max formula is least reliable *and* where the lifter was
furthest below capacity. A big percentage from that starting point says something about the start,
not about the estimator.

**What stays open is the issue the finding pointed at, not a new one.** *Starting weights never
reach the bar* is already tracked, and this measurement corroborates it with four independent cases
— a first session at 25 kg × 15 for a lift that reaches 60 kg × 9 seven weeks later is a start far
below capacity. No new backlog entry: it belongs to that issue.

## Method

`POST /api/admin/db-query` against production, one query per lift, grouping `set_logs` by
`exercise_logs.logged_at` to get the top set's weight and reps alongside the stored
`estimated_1rm`. Read-only, owner-scoped.

No code changed.
