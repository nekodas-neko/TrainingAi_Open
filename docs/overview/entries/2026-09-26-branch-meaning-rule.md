# Every branch has a reason, or it goes — and the four that nearly went by mistake

**Owner, 2026-09-26:** *"make sure all the open branches are open for a reason - ideally we want
every branch to have meaning."* This is the rule that answers it, and the audit that found the
exception which makes the rule safe.

## The rule

**A branch has meaning only if it has an open PR.** Auto-delete now clears merged branches, so
anything left is a branch whose PR closed unmerged or one that never had a PR. **Work worth keeping
gets a draft PR** — that is the marker, it costs nothing, and it puts everything in one list.

## Why not the `Branch:` field, which was the obvious answer

The backlog already has one, on **199 entries**. It was rejected on measurement: it records a
**plan**, not a fact, and it is already wrong. `Q-44`'s entry names `refactor/de-oura-identifiers`
while its live branch is `lane-a/q44-phase3-pr1-table-rename`. `OR-127` and `RV-99` have live
branches and no field at all.

A draft PR is a fact GitHub maintains and cannot drift. A prose field is one more thing to keep in
sync, and it demonstrably is not.

## The audit, and the part that matters

48 branches. 9 open PRs + `main` have a reason. That leaves **38**.

**Four hold unmerged work for entries STILL IN THE QUEUE:**

| branch | entry | size |
|---|---|---|
| `chore/or-127-device-cdp-harness` | **OR-127 — rank 1 in `DV`** | 12 files, 7 commits |
| `lane-a/q44-phase3-pr1-table-rename` | Q-44 | 13 files, 4 commits |
| `lane-a/rv99-score-band-theme-tokens` | RV-99 | 14 files, 4 commits |
| `lane-a/fix-gate-pin-q305` | Q-305 | 1 file, 1 commit |

**This is the finding.** "No open PR → delete" is the rule anyone would write, and it would have
discarded a head start on the top-priority device item. Filed as `OR-174` with a recommendation to
open draft PRs for all four.

**Two are provably dead** — 0 commits ahead, 0 files differing from `main`:
`claude/implementation-agent-lane-a-ztkb3m` and `lane-a/tn46-baseline-already-retained`. Note TN-46
is *still queued* while its branch is empty, so a branch matching a live entry is not automatically
worth keeping. **Check the diff, not the name** — that cuts both ways.

**The remaining 32 are sweepable**, and none had a merged PR, because the earlier cleanup would have
taken it.

**Two violate the naming rule outright** — `claude/implementation-agent-b-s1m4qs` and
`claude/implementation-agent-lane-a-ztkb3m` are exactly the auto-generated shape CLAUDE.md forbids.
The rule did not stop whatever produced them, which is worth a thought on its own.

## One method note worth more than the snapshot

A diff against `main` does **not** prove work is unlanded — three-dot diff measures from the
merge-base, so squash-merged work still shows. What proves it here is that the earlier cleanup
deleted every branch with a merged PR, so by construction each survivor is closed-unmerged or
never-PR'd. And `git branch --merged` remains useless: 3 of 1,562.

## Also in this PR

**The vitest teardown flake, ninth sighting** — a fifth distinct file
(`nutrition-goals-recommend-route.test.ts`), on a docs-only PR, `2498 passed / 1 error`. Re-ran
clean, **nine for nine**.

Two things the existing write-up predates. **`Tests` became a required check on 2026-09-25**, so
this now *blocks the merge button* rather than costing a re-run — which is why it is finally filed
(`LA-146`) after nine sightings and zero entries. And **the re-run no longer has to be a push**:
`rerun_failed_jobs` re-runs only the failed job and leaves E2E alone, where the doc still describes
a re-run as restarting a 34-minute job.

## Not done

**Nothing was deleted.** The sandbox credential cannot delete remote refs (bare `HTTP 403`, no
`remote:` line — a ruleset rejection would say `GH013`), and the four live-work branches need the
owner's call first.

**Auto-merge is still untested.** `enable_pr_auto_merge` on #1679 returned *"already in clean status
… auto-merge only applies when checks are pending"* — that is the **tool** declining, not GitHub
refusing, and it is a different error from the `"Protected branch rules not configured"` the claim
rests on. It neither confirms nor refutes. A real test needs a PR with pending checks, attempted on
this one.
