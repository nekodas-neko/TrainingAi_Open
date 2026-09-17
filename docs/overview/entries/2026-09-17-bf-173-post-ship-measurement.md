# 2026-09-17 — re-measuring BF-173 after it shipped: the defect is gone, the answer is not

**BugFix intake.** Docs-only. BF-171, BF-172 and BF-173 all shipped overnight (#1267, #1273, #1268,
#1274) while this session's container was down. This is the post-ship look the entries were owed.

## What was verified

The provenance option the owner chose was built as specified — `mood_logs.suggested_sore_muscles`
(migration 276, `claude_ro` twin 277, local SQLite v39), only lifter-added ticks clamp, provenance
recorded at write time, and LB-116 (#1274) wires the check-in sheet to send its own suggestion list
rather than leaving the server to re-derive it. The column exists in production.

## The correction

`projectOverview.md` carried *"it flipped the pick, Lower 74/Upper 84 as shipped against Lower 85/
Upper 84 without the leg ticks"*. Both numbers are right and both are **pre-BF-171**, measured on a
replication of the old engine. Run against the shipped engine on the same rows, with every tick
recorded as a suggestion:

| | Upper | Lower | Pull | Legs | Push |
|---|---|---|---|---|---|
| double count live (provenance unknown) | **85** | 76 | 84 | 62 | 47 |
| all ticks suggested (the fixed path) | **91** | 88 | 85 | 76 | 59 |

**Lower gains 12 points from the fix and still loses by 3.** BF-171's normalisation lifts the
sore-but-recovering muscles on both sides, so removing the double count raises every session rather
than reordering them. The entry fixed the defect it described; it did not change this particular
answer. Upper wins on merit now — half back work at 95%, six days overdue.

The overview paragraph is amended rather than struck: the counterfactual is still the clearest
statement of what the double count was doing, it just needed marking as a counterfactual.

## Two things the owner should know, neither a defect

- **Today's row scores the old way.** `suggested_sore_muscles` is `NULL` on the 2026-09-17 check-in,
  which predates the column, and the implementation treats NULL as *unknown* rather than *none* —
  deliberately, so a pre-migration row is not reinterpreted. The fix takes effect on the next
  check-in, not retroactively.
- **That row was edited at 21:37, 27 minutes after it was written**, dropping Quads, Hamstrings and
  Glutes from a seven-muscle list to four. Recorded as an observation only; nothing in the row says
  who changed it or why.

## What was not exercised

Nothing on the S25. The measurement is the shared scorer run against production rows in a harness —
it proves the engine's arithmetic, not what the phone renders. Whether the next real check-in
actually populates `suggested_sore_muscles` cannot be confirmed until one is written.
