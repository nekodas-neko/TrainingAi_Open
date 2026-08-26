# 2026-08-26 — closing the session's one orphaned finding

**Branch:** `fix/entries-limit-intake` · docs-only · BugFix Intake

## What this closes

The entries runaway limit blocked **PR #527** — a docs-only intake PR whose single new journal file
took `docs/overview/entries/` from 60 foldable to 61. The failure named none of that PR's four files,
and the resolution was not the sweep: merging `main` fixed it, because another session had run one
concurrently. So the blocked PR paid a CI cycle and a diagnosis for a condition it neither caused nor
fixed.

That was flagged in conversation and never written down. Per **No orphaned findings**, a finding
without a queue entry is a dropped finding — so **BF-36**.

## The argument is the targeting, not the threshold

The limit is right and the chore is real. What is wrong is **who pays**: the failure lands on
whichever PR is open when the count crosses, which is unrelated to whoever grew the directory. Every
session writes a journal entry, so the cost falls at random.

**It will recur within days.** The README's own arithmetic — limit 60, linked floor ~41 — leaves
**~19 files of slack**, which it measures at *"roughly twenty minutes on the busiest stretch of the
day and about half a day at the average rate."*

**The fix is small and the check already knows how to do it.** The doc-size ratchet a few lines above
prints *"N of which this branch added"*. Apply that here: over the limit **and** this branch adds an
entry → fail, because that PR is the growth. Over the limit and it adds none → the `console.log` note
that already exists for "sweep it when convenient".

Both obvious alternatives are worse, and the entry says so: raising the limit defers the collision by
about a week and makes the eventual sweep bigger — and sweeps have already failed the link checker in
five separate documented ways, so a larger fold is a worse fold. Warn-only is how the directory
reached 198 files.

## Session audit

Every entry this session touched was checked against `main`. The six no longer in the queue —
BF-25, BF-29, BF-30, BF-31, BF-32, Q-395c — each has a journal record, so they shipped rather than
went missing. Nothing else was left unfiled.
