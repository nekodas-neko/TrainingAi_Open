# LA-129 — the backlog leaves the doc-size ratchet and is reported instead

**PR:** `fix/la-129-unratchet-backlog` · **Owner approved** 2026-09-25, on the narrow fix rather than
the entry's original proposal.

## What changed

`docs/doc-size/docs/implementation-backlog.md.size` is deleted. `check-doc-index-size` now prints

```
check-doc-index-size: UNRATCHETED — docs/implementation-backlog.md 32015 lines (reported, not enforced; LA-129).
```

on every run, after the `OK —` line. The other nine tracked documents are unchanged and still fail
the build when they grow past their number.

## Why, and why not the thing the entry was originally filed to do

The entry proposed **generating all baselines in CI**. That was approved in a first pass and then
**not built**, because opening the entry surfaced its own `⚠ RE-VERIFY BEFORE BUILDING` warning:
`RV-134` had considered and rejected it. Generating a baseline makes every increment inherited, which
removes the **ceiling** — and the ceiling is the whole point. `projectOverview.md` once reached
**9,647 lines** while its own opening line called it a lean index.

So the question was re-measured instead. **Of the last 63 `.size` changes on `main`, 54 were this one
file** — against 7 for `projectOverview.md` and 1 each for three others. The churn was never diffuse;
it was one document, and `RV-134`'s slack band could not fix it, because a band cannot help a file
that genuinely grows past it.

**The membership rule is this script's own first line** — *"the documents every session reads before
it can start"* — and the backlog is not one. CLAUDE.md sends an implementer to
`node scripts/next-item.js`, and nobody reads 32,000 lines to orient. Its size is already governed by
the protocol that removes a finished entry, and by the compaction sweep.

This session was itself the evidence: **four separate merge conflicts on that single line in one
evening**, across three PRs, each resolved identically and each costing a CI cycle.

## The test that pinned the opposite

`scripts/__tests__/doc-size-baselines.test.ts` asserted the backlog *"must stay tracked"*, listing it
among the orientation docs. That is what stopped the first attempt: two independent signals
contradicting the premise is where building stops and asking starts.

It is now **inverted rather than deleted**, and the choice matters: an absent expectation would let a
future `--fix` run silently re-create the baseline, which is exactly how this would come back. The new
assertion fails if `docs/implementation-backlog.md` reappears in the baselines, and its message says
to delete the file rather than raise it.

Verified empirically that `--fix` does **not** re-create a baseline for a file with no `.size`.

## Two things the change dragged in

**CLAUDE.md named the deleted file.** `check-claude-md-paths` caught it. The passage was wrong in a
more interesting way than a dead path, so it was rewritten rather than patched: the "one PR per filing
sweep" rule cited the `.size` line as making conflicts *guaranteed*. That mechanism is gone; the rule
stands anyway, because N PRs editing the backlog still have N-1 chances to collide in the file itself.
The dead path is now in that script's `DELIBERATE` list with its reason — CLAUDE.md names it
**because** it was deleted.

**CLAUDE.md grew 5 lines** and its own baseline was raised, with a note. The ratchet working on a file
it should work on, in the same PR that removes it from one it should not.

## Not done

`enable_pr_auto_merge` is still recorded in CLAUDE.md as not working on this repo, with the error
*"Protected branch rules not configured for this branch"*. That error was almost certainly the
`ProtectMain` ruleset sitting at Enforcement `Disabled`, which the owner set **Active** earlier today
(OR-164) — so it may now work. **Untested, and left claiming what it has always claimed** rather than
flipped on inference. This is the second passage today found to have been wrong in both directions;
guessing a third time is not the fix.

## Verification

`Ran 79 of 79` Custom Rules steps. 39 script test files, **381 tests**, all passing.
`check-backlog-pointers` OK, 511 entries. `--fix` confirmed not to re-create the dropped baseline.
