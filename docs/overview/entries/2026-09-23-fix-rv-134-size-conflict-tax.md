# 2026-09-23 — RV-134: the conflicts were not the ceiling, they were slack detection

**Branch:** `fix/rv-134-size-conflict-tax` · **Lane:** O · `scripts/` + one test

## The measurement the entry was missing

Counted across one night's work on this repo:

| branch | re-merge commits |
|---|---|
| `chore/or-125-owner-decisions` | **12** |
| `fix/dv1-windows-ci-local` | 5 |
| `docs/or-126-raw-archive-brief` | 3 |
| `chore/or-132-owner-decisions` | 2 |
| `fix/or-133-dv-lane-starved` | 1 |

**23 re-merge commits across five branches in one night**, nearly every one of them resolving a
one-line `docs/doc-size/<path>.size` file where **neither side was wrong** — the merged tree's own
count was the answer, and no human judgement was involved in any of them.

## The cause was not where the entry looked

RV-134 described a ratchet that "blames a branch for a shrink it did not cause", which reads as a
problem with the *ceiling*. It is not. The ceiling only fails a branch that grows past it, and that
is rare and genuine.

**Slack detection was the cause.** The rule failed on *any* gap between the file and its number, so
every PR that shrank a tracked doc by even one line had to edit the baseline file — and a one-line
file is the one thing two concurrent PRs cannot both write. Striking a completed backlog entry
shrinks the backlog, and striking a completed entry is what almost every PR does.

So the conflict was not a side effect of the ratchet. It was **slack detection putting a shared
one-line file into nearly every diff in the repo.**

## The fix, and what it deliberately does not do

`check-doc-index-size.js` now tolerates slack within **`max(25, 2%)`** of the baseline and fails only
beyond it.

**Slack detection is kept, not removed**, and that is the whole design constraint. It exists because
CLAUDE.md once sat **429 lines** under its number — the most-read file in the repo able to grow by
half its own length with nothing complaining. 429 against a ~900-line baseline is far outside any
band, and a test pins exactly that case.

**Why a scaling band.** The tracked docs run from a 53-line baton to a 27,000-line backlog. A flat 25
would fail the backlog on 0.1% drift; a flat 500 would let a baton double. The floor carries the
small files and the percentage the large ones, and a test pins that no document's band ever reaches
half its own length.

**Growth is untouched and still fails at the first line over.** The asymmetry is deliberate: growing
past the ceiling is the thing the ratchet exists to catch and the fix there is moving prose. Slack is
a stale number, and a number that is 0.08% stale is not worth a merge conflict.

**Tolerated slack is printed, never silent.** A check that quietly accepts drift is how the 429-line
gap accumulated. The band changes who has to act and when — not whether anyone can see it.

## It demonstrated itself while being written

Striking RV-134 from the queue shrank the backlog by 32 lines. Under the old rule that would have
forced a `.size` edit on this branch, conflicting with the two PRs already in flight. Under the band
(543 for a 27,170-line file) it reported and passed, and this PR touches no `.size` file at all.

Both of the night's real cases fall inside their bands: 23 lines under 27,128, and 7 under 877.

## What remains, correctly

Two PRs that both **grow** past the same ceiling on the same day still conflict. That is a genuine
disagreement about one number and the case a ratchet should conflict on. `LB-120` is annotated with
this rather than struck, since it describes the same subject and should be re-verified against the
new behaviour before anyone builds from it.

## Not done

- **No merge driver.** It was the other candidate and it loses: `merge.<name>.driver` has to be
  configured in every clone — CI, this sandbox, the Windows device machine — and silently does
  nothing where it is missing, which is the current behaviour wearing a disguise.
- **Baselines are still stored, not derived.** Deriving them from the base branch removes the
  ceiling altogether: a file could grow ten lines per PR forever, each increment "inherited". That
  trades a merge conflict for the thing the ratchet is for.

## Gate

`pnpm ci:local` — exit 0, **Ran 75 of 75** Custom Rules steps. Full log kept, not tailed.
