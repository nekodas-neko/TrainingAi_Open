# 2026-09-01 · Lane A — a `Keep:` that hides a build now says so (OR-100)

Branch `lane-a/keep-kind`. Tooling only: one new library, one advisory line, and a drift fixed on
the way.

## The problem, in the Orchestrator's words

`next-item.js` prints Keeps under a heading reading *"shipped; only the stated residue is owed.
**Not new work**"*. True of most of them, false of a few — and the few disappear from where
implementers look. The entry was written while answering *"B is still saying there is no work for
it"*, and measured four buildable Keeps on Lane B against nine READY.

It is the `Gate: device` failure one section over: a field written to mean *partly done* is read by
the runner as *do not start*.

## The entry undercounted its own problem

Across the **whole** queue rather than one lane: **13 buildable, 52 checks, 23 unclear.** Beyond the
four it named, the classifier surfaced `BF-83`, `BF-67`, `BF-41`, `BF-35`, `BF-33`, `PS-15`,
`TN-3a`, `Q-476`, `Q-501`, `Q-71`, `Q-11`.

**Two of those — `BF-83` and `BF-67` — were written by this same session, hours earlier.** That is
the argument for a check rather than a habit: I read the rule, agreed with it, and then wrote two
more instances of it the same evening.

It also found **Q-519** unprompted — *"the UI half, Lane B's. Nothing can write a bedtime yet —
there is no control"* — which is the flagship case the entry was written about. Finding the example
it was not told about is the difference between a classifier and a restatement.

## What shipped, and what deliberately did not

`scripts/lib/keep-kind.js` returns `check` / `build` / `unclear`. `check` wins ties, because a
device check on a half-shipped entry is still a check. **`unclear` is a real answer** — forcing it
into `build` manufactures work and into `check` hides some.

`check-backlog-pointers.js` prints the builds **by id, as a note, never a failure**. OR-100 is
explicit: enforcement stays off until the known cases are split, or CI goes red on entries nobody
has triaged. A count without ids would be a number nobody can act on, so it lists them.

**The splits are not done here.** The entry says not to batch a queue sweep with the runner change —
the verification is *"run both lanes before and after and diff the sections"*, and a sweep in the
same PR makes that diff unreadable.

## A second drift, found on the way

`check-backlog-pointers.js` carried its **own** `Keep:` regex — colon-only, bullet-anchored — and so
missed the em-dash form and anything inside a blockquote banner: **11 entries** `lib/keep.js` sees
and it did not. That flag suppresses the *"announces its own completion"* failure, so a missed Keep
is a **false CI failure** on a correctly-written entry. None of the 11 also announced completion in
a heading, so it was latent rather than live — the next one would not have been. Both readers now
go through `lib/keep.js`.

Worth noting the shape: this is the second time today the same file's private copy of a shared rule
has been the bug. The first was `lib/keep.js` itself being blind to blockquotes.

## Verification

Nine unit tests against fixtures, not the live backlog — a test that reads the real file changes
verdict as the repo does, which is the one thing a regression test for a counting rule must not do.
Three mutations, all dead: emptying either phrase list, and flipping which one wins a tie.

Nothing here runs at runtime, touches data, or reaches a device.
