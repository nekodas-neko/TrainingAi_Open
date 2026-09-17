# 2026-09-17 — TN-46: the snapshot it called urgent was already on disk

**Branch:** `lane-a/tn46-baseline-already-retained` · **Lane A** · docs-only · no migration, no code

## What happened

TN-46 was filed as urgent: the owner's resting HR and HRV have moved sharply against two Retatrutide
doses, and the entry argued the pre-intervention baseline was being erased by the rolling EMA, so a
snapshot had to be captured before the comparison became unanswerable. Its recommended fix led with
a schema change to store that snapshot.

**The arithmetic was right and the conclusion did not follow.** `updateBaseline` does move ~1/32 per
night once mature — `ageDays > 14` takes `ashrRound(delta + bias, 5)` — so the live baseline is
genuinely being dragged from ~53 toward the new resting HR. What the entry missed is where baselines
live: **`oura_daily_summary` stores them per night, per row**, alongside `n_history`. Every historical
night keeps the baseline as of that night. Later drift cannot reach the 2026-09-06 row.

Verified against production **before** writing any code:

| row | stored RHR baseline | stored HRV baseline |
|---|---:|---:|
| 2026-09-06 (night before dose 1) | **52.875** | **56.125** |
| 2026-09-18 | 54.250 | 51.750 |

74 rows back to 2026-07-07, 73 carrying baselines, nothing pruning them. The snapshot a migration
would have created is already there with a date on it.

## What the entry keeps

The half that was never about storage: **join `supplement_logs` into the score audit and the
advisory**, so a flagged day names the medication and the most recent dose instead of implying
illness, and plot dose against vitals with a 2–4 day lag. No schema change, no deadline. That is now
the whole entry.

## The generalisable form

**A rolling aggregate that is checkpointed per period has no erasure problem, however fast it
adapts.** Before adding storage to preserve a value, check whether the value is already written down
somewhere with a date on it.

This is the **fifth** entry this session whose measurements were true and whose conclusion was not —
after LB-110, LA-110, TN-44, TN-37 and BF-137. The pattern is consistent enough to be worth naming:
the measuring is reliable, the inference from measurement to cause is not, and the cheapest guard is
to re-verify the *conclusion* against the code before building to it. That guard cost one production
query here and saved a migration.

## One correction carried forward

The entry's dose-response table ends at 09-17. The 09-18 row reads RHR **59.4** (from 64.9) and HRV
**47** (from 19) — the 1 mg excursion has begun to turn at day 5, matching how 0.5 mg behaved. The
entry's *"still falling at day 4"* was accurate when written and is no longer current. Recorded
because a stale trajectory about someone's own physiology is worth correcting explicitly rather than
letting the next reader infer it.

**Not exercised:** no code changed, so nothing to run beyond the queue checks. The production figures
are reads, not re-derivations — `rhr_baseline_mean_x8/8` as stored, not recomputed from raw nights.
