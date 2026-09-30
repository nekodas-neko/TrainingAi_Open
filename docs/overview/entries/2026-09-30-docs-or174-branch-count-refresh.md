# 2026-09-30 — a refreshed branch count, and the baton line my own next PR made stale

**Branch:** `docs/or174-branch-count-refresh` · docs-only, no version bump

Lane B's queue is empty and this is the last useful thing in reach. Two small corrections, both of
them things that were true when written and are not now.

## OR-174's count has grown, and it was measured properly

`OR-174` recorded **45 branches, 39 sweepable** on 2026-09-27. Measured today: **54 non-main remote
branches, 7 with an open PR, so 47 sweepable.**

Two things about *how*, because this entry's own lesson is that the method is where it goes wrong:

- **After `git fetch origin --prune`.** A partial fetch under-counts — my first read said 53 and was
  missing a branch whose PR is open, because I had only fetched `main`.
- **The open-PR figure is from `list_pull_requests`**, not from a name match. `OR-174` exists partly
  because an earlier pass called four branches live work on a name match and not one of them held
  anything.

**None of the 7 open PRs is this lane's**, and four are explicitly held for the owner (#1902, #1849,
#1847, #1499 — auth/security and column-dropping migrations), so a sweep must not touch them.

**Two branches are named `claude/…`**, which the owner banned outright on 2026-09-27. Neither has an
open PR, so both fall inside the sweep rather than needing their own decision — worth naming because
they are the visible half of that rule on a public repo.

## What I deliberately did NOT do

**I did not sweep.** Deleting 47 remote branches is a wide-blast-radius action on a public repo, it
belongs to `OR-174` (Orchestrator's), and that entry itself records the first application of the
rule being wrong about four branches. A refreshed count is what a passing lane can usefully
contribute; the deletions are not.

## The baton line that went stale between two of my own PRs

#2029's baton rewrite recorded `LB-106` as *"pass test is ten clean CI runs; ~3 observed"*. **#2030
then resolved it** — its cause is named, and it is a symptom of `LB-149` rather than its own
investigation. Corrected, because the baton is what survives a compaction and a stale line in it
sends the next session to re-investigate something finished.

Worth noting as a pattern rather than a one-off: **a baton written mid-session describes the session
as it was, not as it ended.** Re-read it before the last PR, not only when rewriting it.

## Verified

`check-backlog-pointers` OK · `check-doc-index-size` OK, baton at 59 within its ratchet. No code
changed.

## Not exercised

- **Nothing was run.** Two counts and a documentation correction.
