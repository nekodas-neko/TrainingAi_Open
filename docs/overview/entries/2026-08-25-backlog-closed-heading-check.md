# 2026-08-25 — the queue was handing out a closed entry, because the check had no word for it

**Branch:** `fix/backlog-closed-heading-check` · **Lane A** · `scripts/` + docs. LA-29.

`next-item.js` is what an implementer is told to start from — CLAUDE.md says so outright, *"do not
hand-scan the backlog, the script is the authority on what is startable"*. This morning it was
listing **Q-304b at READY #4**, an entry whose own heading reads `CLOSED 2026-08-25` and whose first
bullet reads *"This entry is closed, not parked."* I wrote that entry, and I left it in the queue.

## Why nothing caught it

`check-backlog-pointers.js` already has the rule — check 9, *no queue entry announces its own
completion* — and it already has the right escape hatch, a `- **Keep:**` bullet naming what is still
owed. What it had was a word list:

```
✅  SHIPPED  COMPLETE  DONE  SUPERSEDED  DROPPED  FIXED  RESOLVED
```

`CLOSED` is not in it. Adding it flagged two entries, both correct:

| entry | closed | lines | why it was still there |
|---|---|---|---|
| **Q-304b** | 2026-08-25 | 27 | closed hours earlier, by me, in the same PR that shipped migration 224 |
| **Q-27** | 2026-08-04 | 47 | *"CLOSED, not doing either item"* — three weeks in the queue |

## Widening a word list has a failure mode in the other direction

Two live, **open** entries use these words as ordinary prose: TN-2 — *"the Body Battery charge
window has closed"* — and BF-16b — *"the retired all-primary program"*. A case-insensitive match
flags both, and a check that cries wolf on its second day gets baselined into uselessness.

So the list is **case-sensitive**, which is not incidental: these are status stamps and the
convention writes them in caps. And **`ANSWERED` stays out of it**, which is the distinction worth
keeping — an investigation can conclude while the action it identified is still owed. LA-27 answered
*why* 76 estimates cannot be re-derived and still owes the fix; Q-547 answered the deploy-churn half
and still owes a quiet-window baseline. Both belong in the queue. `CLOSED` admits no such reading.

The list moved to [`scripts/lib/completion-words.js`](../../../scripts/lib/completion-words.js) —
the same shape as `keep.js` and `lane.js` — so both properties are pinned by
`scripts/__tests__/backlog-completion-words.test.ts` against the real headings that would break them.

## Where the two entries went

Neither was deleted, because both hold something a future session would otherwise re-derive.

**Q-304b → a `projectOverview.md` Known-Issues row.** "Leave it" is not free: 277 `exercise_logs`
carry an undiscounted high-rep estimate, an inflated PR shows on the badge and in the AI chat's
`getPersonalRecords`, and it drives a too-heavy prescription — **only** where an exercise carries a
PR with no recent log, since `resolveWorkingBasis` takes `lastNonDeload1rm` first. A
deliberately-unfixed user-visible defect is precisely what that section is for, and it was the one
place the accepted cost was not written down.

**Q-27 → the foot of [`docs/domains/README.md`](../../domains/README.md).** It is the decision *not*
to move the ~25 loose `docs/` root files into pillar folders (the indexes already carry 55 links to
them, which is the subject-based view the move was meant to create) and *not* to split the Known
Issues per pillar. That file is where someone arrives before proposing either again — the queue is
not.

## Verified

- `pnpm check:rules` **Ran 58 of 58**, all pass · `check-backlog-pointers` OK at **202 entries**
  (was 204) · `check-doc-links` OK (869 files) · `tsc --noEmit` clean.
- **`next-item.js --lane A` re-run**: Q-304b is gone from READY, which is the actual thing being
  fixed — not inferred from the diff.
- **The test is mutation-checked.** Four mutations — adding the `i` flag, adding `ANSWERED`, removing
  `CLOSED` again, removing the word boundaries — each fail **exactly one** test, and it is the one
  covering that property.
- Both size baselines re-derived from the files rather than adjusted: `projectOverview.md`
  7969 → **7973** (+4, the Known-Issues row), backlog 11799 → **11725** (−74).

## Not exercised

Prose and a CI script — no runtime code, no database, no schema. Nothing native, offline-first,
safe-area or gesture-related, so **no device smoke run is owed**.

## Worth saying plainly

The check exists because completion claims in headings had accumulated to seventeen by 2026-08-20 and
prose could not hold the rule. It held for five days and then missed a case **on the day the entry
was written**, by one word. The lesson is not that the list needs to be exhaustive — it is that a
guard whose configuration is a literal in the middle of a 380-line script gets extended by whoever
next trips over it, which is why this one now has a file and a test of its own.
