# 2026-09-24 — the field that sets your prescribed weight stores zero on 42 loaded sessions

**Branch:** `tuning/estimated-1rm-zeros` · **Agent:** Tuning · **Docs-only.**

With TN-73's instrument validated, the obvious next target is the number that actually decides what the
owner is told to lift: `estimated_1rm`, from which `target_80` — the prescribed weight — derives.

## The measurement

Of 494 non-deleted exercise logs, **42 store `estimated_1rm = 0`** (8.5%) and **38 store `target_80 =
0`**. None are NULL; every row carries a number, and for 42 that number is zero.

**They are not bodyweight movements** — my first hypothesis, and wrong. The zero logs carry Sumo
Deadlift at 82.5 kg, Barbell Shrug at 87.5 kg, Hip Thrust at 85 kg, at normal rep counts. Only Pull-Up
and Hanging Leg Raise among the 25 affected exercises are unloaded.

## The mechanism, and the part it does not explain

Logs with no `use_for_1rm` set carrying weight: **30 of the 42 zeros (71%)** against **138 of the 452
non-zeros (31%)**. Mean flagged sets per log is 0.76 on the zeros versus 1.79 elsewhere. So "nothing
eligible to compute from" covers most of it, and `calc1RM` returning `weight` when `weight <= 0` is how
that lands as a stored 0 rather than a NULL.

**The leftover is the finding.** Twelve zero logs *do* have a loaded flagged set. And 138 non-zero logs
have *no* eligible set yet store a positive 1RM. The same input condition gives 0 thirty times and a
positive number 138 times — so **`estimated_1rm` is not a function of the log's own sets.** Something
else supplies it much of the time, and when that supplier is absent the field falls to zero. Finding the
supplier is the first task, not touching the formula.

## A correction to my own first reading

I measured the stored 1RM-to-weight ratio rising with rep count — 1.246 → 1.352 → 1.467 → **1.663** at a
mean 17.4 reps — and read it as an uncapped formula, which would have been the historical "wrong high-rep
guard → inflated PRs" bug. The code is more careful than that: `repFactor` averages Epley with a Brzycki
term **frozen at its 20-rep value**, and `amrapScaleFactor` de-rates high reps deliberately (1.0 / 0.97 /
0.93 / 0.88). **And the ratio cannot test the guard anyway** — `estimated_1rm` is per exercise-log, so
dividing by each contributing set's weight attributes one estimate to several sets. The rise is largely
that join artefact. Written onto the entry so nobody re-runs it and files the wrong defect.

Filed **TN-74, `Lane: A`**, with the acceptance criterion that a log with no eligible set should store
**NULL** rather than 0 — downstream needs to tell "no estimate" from "an estimate of zero" — and noting
four logs that pair a zero 1RM with a *positive* target80, which is the inverse inconsistency.

## Not exercised

Nothing runs. Read-only `claude_ro` queries, **row-scoped to the owner**, plus source reading. **Not
established:** what supplies the positive 1RM on the 138 logs with no eligible set; why 12 loaded logs
still read zero; and whether a zero ever reached a prescribed weight the owner actually saw — that needs
the surface rather than the table, and is the part a device pass could answer. `pnpm check:rules` result
below.
