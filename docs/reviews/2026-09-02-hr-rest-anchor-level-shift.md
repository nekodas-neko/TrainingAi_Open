# Q-515: the recommended fix answers the owner's question too

**Date:** 2026-09-02 · **Agent:** Implementation Lane A · **Entry:** Q-515

Q-515 separates two questions and is careful about it:

> *(a) Is it stable?* No — a defect regardless of taste. *(b) Is 8.2% the right level?* **Unknown** …
> **Fix (a) alone**; if the fraction is raised at the same time the two effects become inseparable
> and neither is verifiable.

Its recommended fix — *"anchor the boundary to a slow-moving resting baseline (90-day trailing…)"* —
does not fix (a) alone. **It moves the level by more than the defect does**, in the direction the
entry reserves for the owner. Measured before implementing, per CLAUDE.md's rule that a proposal is
incomplete until it states how many other days the change moves.

## The measurement

The boundary is `restingHr + 0.05 × reserve`, and both consumers agree on it — `hrr = (bpm −
restingHr) / reserve`, active above `HR_REST_THRESHOLD` (`body-battery/route.ts` line 154,
`hourly-movement.ts` line 54). `restingHr` is `resolveHrProfile`'s **28-day mean** of
`body_metrics.resting_heart_rate`.

Replacing that 28-day mean with a 90-day trailing mean, over every day carrying both a resting
series and ≥50 waking BLE samples (07:00–21:59 Brisbane):

| | value |
|---|---|
| days measured | **57** |
| mean boundary shift | **+3.42 bpm** |
| mean share of waking samples at rest, 28-day anchor | **14.9%** |
| mean share of waking samples at rest, 90-day anchor | **25.9%** |
| days moved by more than 1 percentage point | **56 of 57** |

**A 74% relative increase in the at-rest share, on 56 of 57 days.** For comparison, the instability
the entry is fixing took the same statistic from 26.5% to 8.2% across a month. The proposed fix is
of the same order as the defect and points the other way — it is a level change wearing a stability
fix's clothes.

`maxHr` was held at **187** throughout, which is what `daily_zone_minutes` stores on all 88 of its
rows (min = max = 187 — the age-predicted value, never the observed ceiling). It barely matters:
`∂boundary/∂maxHr = 0.05`, so even a 16 bpm error moves the boundary 0.8 bpm, and it applies to both
anchors, so it **cancels out of the difference** above.

## Why the direction is structural, not an artefact of this dataset

During an improving trend the longer window necessarily sits **above** the shorter one, because it
still contains the older, higher values. Resting HR here fell 62.9 → 54.4 over one month, so on
2026-09-02 the 28-day mean reads **52.2** and the 90-day reads **56.1**. A slow anchor is stable
*and* higher for exactly as long as fitness keeps improving — the two properties are not separable
by choosing a different window length.

**And the window is not doing the work anyone thinks it is.** There are only **74 days** of resting
HR in total (2026-05-29 → 2026-09-02), so a 90-day trailing window today covers **72 of them** —
essentially all history. Its stability comes from having nothing to drop yet, not from the window,
and that will remain true for months.

## What fixes (a) alone

The entry's own second option: **freeze the anchor** — take the current 28-day mean as a stated
constant with a date on it, and stop it tracking. On the switchover day the boundary is unchanged by
construction, so question (b) is untouched; from then on a month of fitness gain cannot move the
classifier under its own data, so (a) is fixed. The cost is honest and worth stating: a frozen
constant goes stale silently, there is **no cron layer in this app** (`docs/module-map.md` §0) so
"re-derived quarterly" means a person remembers, and past days recompute against the frozen value.

The 90-day anchor remains the better shape *if* the owner also wants the level raised. That is the
point — it is one decision, not two, and it belongs to the owner.

## Reproducing

Production read-only via `/api/admin/db-query`. Build the per-day 28- and 90-day trailing means from
`claude_ro.body_metrics.resting_heart_rate`, form both boundaries at `m + 0.05 × greatest(30, 187 −
m)`, and take the share of `claude_ro.oura_heartrate` rows at or below each — **filtered to
`source = 'ble'`**, or 66,189 chest-strap workout rows contaminate the waking distribution.
