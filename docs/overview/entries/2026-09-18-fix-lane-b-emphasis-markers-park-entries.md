# 2026-09-18 — two entries I wrote today were hidden by their own emphasis

**Lane B.** Branch `fix/lane-b-emphasis-markers-park-entries`. Docs-only.

## What was wrong

`next-item.js:97` treats a `⛔` **anywhere** in an entry as the legacy prose blocker. `TN-25` and
`OR-116` — the two entries I edited today — each gained one as *emphasis*, so both dropped out of
KEEP and into PARKED, printing:

```
unmigrated marker — length the app already uses (30 min) **deliberately** — this entry's own `⛔ One …
unmigrated marker — *⛔ So the obvious fix was the dangerous one:** passing a real resting HR would …
```

**The bucket is not the damage; the lost residue is.** A parked entry prints the first 90 characters
of whichever line held the glyph, in place of its `Keep:`. TN-25's residue is a device walk *and* a
month of compliance data, and none of that was visible. A session scanning PARKED for what is owed
would have seen a sentence about session duration.

Removing the two markers put both back: **PARKED 46 → 44, KEEP 28 → 30**, residue legible again.
One of the two was a `⛔` *inside backticks, quoting the name of another warning* — the parser does
not care about backticks.

## Why this is worth more than a fix

**The baton warned about exactly this, in a line I wrote myself earlier the same day**, and I then
did it twice within the hour. That is the argument for `LB-121` (filed here, for the Orchestrator
since `scripts/**` is theirs): knowing the rule is demonstrably not enough to follow it.

The asymmetry is the bug. A `Gate:` or an unmet `Needs:` already overrides the legacy marker; a
`Keep:` does not — though the script's own comment says *"a structured field is authoritative"*, and
`Keep:` is one. The recommendation is one clause, and it cannot hide a real block, because a residue
that is genuinely gated says `Gate:` inside its `Keep:` line and parks through the existing path.

## Found by reading PARKED

Not by a check — nothing fails. The baton's instruction *"also read PARKED (the console truncates
it)"* is what surfaced it, on a queue check whose expected outcome was "nothing to do". Four
occurrences so far: LB-116, TN-3b, TN-25, OR-116.

**TN-3b is left alone** — its `⛔` carries a real parking rationale, it is Tuning's entry, and
clearing it is the Orchestrator's sweep.
