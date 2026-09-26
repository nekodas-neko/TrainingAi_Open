# 2026-09-26 — Q-11: the backfill filled nothing, and that was the right answer

**Branch:** `docs/q11-backfill-discharged` · **Lane A** · docs-only · answers the Device Verification
agent's sweep-4a question

## The question

Device Verification ran Q-11's owner-authorised backfill on 2026-09-24: **33 sessions processed, 0
filled**, and asked why — *"pruned raw samples?"*

## The answer: the data never existed

Measured against production 2026-09-26:

| | |
|---|---|
| `oura_heartrate` oldest row | **2026-06-22** (newest 2026-09-26, 142,628 rows) |
| the 33 pending sessions span | **2026-04-30 → 2026-06-21** |
| of those, with ANY HR row between `started_at` and `completed_at` | **0** |
| pending sessions starting on/after 2026-06-22 | **0** |

Every one finished before HR collection began. **Pruning is ruled out** rather than merely
unlikely: the route's window is 180 days (back to ~2026-03-30), the table's oldest row is 96 days
old, and `HR_RETENTION_DAYS = 180` has never reclaimed a row.

So the backfill is **fully discharged**: every session that could be filled already is, and no
button will fill the rest. Q-11 is removed from the queue — not because it was completed in the
sense it hoped for, but because its remaining work is impossible, which is a different thing and is
recorded as such.

## Reproducing the 33 needed the route's real predicate

My first query used `NOT EXISTS (set_hr_stats)` and returned **3**, which disagreed with the
agent's 33 and would have sent me looking for the wrong fault. `listSessionsMissingSetHrStats`
(`oura.ts:1390`) is **coverage-aware**: it selects on `MAX(readings_count) = 0`, so it also catches
sessions that already have `set_hr_stats` rows that are all empty. That is Q-11's own Defect B fix
— a completion-time compute can run before the ring has drained, and its empty rows must not
permanently remove the session from the list.

Worth stating plainly because it is the kind of thing that gets "verified" wrong: **a naive
reimplementation of a work-list predicate is not a check on it.** Running the real one reproduced
the agent's number exactly, which is what made the rest of the measurement trustworthy.

## What survives: LA-150

Those 33 match the predicate forever, so **every future run reports the same *33 remaining, 0
filled***. That output is indistinguishable from a broken backfill — it is exactly what prompted
the question. Filed as LA-150: bound the scan at the earliest `oura_heartrate.timestamp` rather
than a flat 180 days, because the retention constant is the wrong floor while the table is younger
than its own window. The entry also records what **not** to do: writing a sentinel row for those
sessions walks straight back into Defect B.

## Not verified

The counts come from `claude_ro`, which is row-scoped to the owner — correct here, since it is his
data and his backfill, but they are his rows only and not a statement about the table overall.
Nothing was run on the device for this; the conclusion is a database measurement, and the reply to
the agent says so.
