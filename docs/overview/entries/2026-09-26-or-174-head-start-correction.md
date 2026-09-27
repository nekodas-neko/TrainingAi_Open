# The four "head start" branches were stale, and the rule that found them needed one more step

Filed and corrected the same day. `OR-174` claimed four surviving branches held unmerged work for
still-queued entries and recommended draft PRs for each. **Diffed against `main` afterwards, not one
holds anything worth keeping.**

| branch | what the diff shows |
|---|---|
| `chore/or-127-device-cdp-harness` | **Superseded.** All five harness files are on `main`, and `main` is ahead — `scripts/device/README.md` is **+13 −208**. |
| `lane-a/rv99-score-band-theme-tokens` | **Landed.** `score-band.ts`, its test, `accent-card-style.test.ts`, `utils.ts` all **byte-identical** to `main`. |
| `lane-a/q44-phase3-pr1-table-rename` | **Unmergeable.** Adds migrations **273/274**; `main` already has both under different names. `ensureSchema` tracks by filename. |
| `lane-a/fix-gate-pin-q305` | One test file, **+10 −10**. Trivial. |

## What went wrong, precisely

The audit asked *"does this branch's name match an open entry?"* and treated yes as evidence of a
head start. **It is not.** An entry stays open for reasons that have nothing to do with its branch —
`OR-127`'s harness **shipped weeks ago**; the entry is open for the **on-device run it still owes**,
which no branch can supply.

Reasoning from the queue to the code inverts the direction of evidence. The queue records what is
*wanted*; only the diff records what *exists*.

## The rule as it should have been written

Matching a live entry is **necessary but not sufficient**. Three questions against `main`, in order:

1. Is the file on `main` at all?
2. Is it identical?
3. Is `main` **ahead**?

A branch whose name matches a live entry and whose content `main` has moved past is the **worst**
kind to keep — it is the one a later session is most likely to "restore" from, reintroducing older
code under a name that looks authoritative.

## Why this was worth catching now rather than at the sweep

The device agent is about to run a sitting and **`OR-127` is rank 1 in its lane**. Left uncorrected,
the entry told the next reader there was a 12-file, 7-commit head start sitting on a branch. Acting
on that means reading superseded code, or worse, restoring it over a `main` that is 208 lines
further on.

## Net effect on the sweep

**All four move from "keep, open a draft PR" to "sweep".** The branch-meaning rule itself is
unchanged and was vindicated — the audit it demands is exactly what surfaced this. What changed is
the depth that audit has to go to.
