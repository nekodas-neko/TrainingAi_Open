# 1,562 branches → 45, and the two repository settings that were wrong

**Owner-driven, 2026-09-26.** He asked *"we have 1500 branches — why do we have so many open. Do we
need a setting that closes them as they merge"*. Yes, and it was one unticked checkbox.

## What was measured

| | |
|---|---|
| Remote branches | **1,562** |
| Open PRs | 7 |
| Closed but **never merged** | 28 |
| Merged PRs (1,534 unique head names) | 1,640 |

The repo is six weeks old, so 1,562 branches is ~37/day — exactly the merge rate with nothing
cleaning up. **"Automatically delete head branches" was off.** The proof was immediate rather than
inferred: branches from PRs merged twenty minutes earlier were still present.

## Two claims in CLAUDE.md were false, and both are corrected here

**It asserted auto-delete was ON**, and built the stale-local-refs ritual on that premise. It was off
for the repository's entire history.

**It asserted `enable_pr_auto_merge` does NOT work here**, citing *"Protected branch rules not
configured for this branch"*. That is the `ProtectMain`-was-`Disabled` signature again — the same
root cause as OR-164, now Active. **Allow auto-merge is enabled**, and the line is marked stale
rather than flipped, because **it has not been tested**. Third time today a passage has been wrong in
both directions; asserting the opposite without measuring is what produced the first two.

## The trap worth keeping

**`git branch --merged` reported 3 merged out of 1,562.** Not because they were unmerged — because
squash-merge writes a brand-new commit, so a merged branch's tip is *never* an ancestor of `main`.

This matters more than the cleanup. A naive "delete merged branches" script deletes nothing. A script
"fixed" by ignoring ancestry deletes the **28 closed-but-unmerged** branches, which are precisely the
ones holding work that never landed (CLAUDE.md names four: #1426, #1428, #1430, #1435, *"all
abandoned with sound diffs"*). Any branch cleanup must key on **PR state**, not git ancestry.

## What ran

Ruleset checked first, deliberately: `ProtectMain` enforces a `deletion` rule, and had it targeted
all branches rather than `main`, both auto-delete *and* the manual cleanup would have failed
silently. It targets `main` only — confirmed on screen before anything else was touched.

Then: intersect merged-PR head names with what is actually on the remote, subtract open PRs and
`main`. 1,516 branches deleted in batches of 50.

**Result: 1,562 → 45**, matching the prediction exactly — 1 `main` + 7 open + 28 closed-unmerged +
~9 that never had a PR at all. Those nine were correctly excluded: a branch with no PR is the one
category where the script cannot tell shipped work from unshipped.

## Not done by the agent, and why

**The sandbox cannot delete remote refs.** Two attempts returned a bare `HTTP 403` with no `remote:`
message — the session's git credential is push-scoped. A ruleset rejection would have arrived as
`GH013: Repository rule violations found`, which is how the two were told apart before blaming the
wrong one. The owner ran every deletion from his own machine.

**Auto-merge is untested.** Enabling the checkbox is not evidence it works.
