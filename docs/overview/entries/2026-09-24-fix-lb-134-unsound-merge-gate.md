# LB-134 — the merge is not a green check, and CLAUDE.md said it was

**PR:** `fix/lb-134-unsound-merge-gate` · **Lane:** O · docs only. No code, no CI change.

## What was verified

`LB-134` reported that PR #1467 merged while its `Tests` job was failing. Re-read from the API
rather than taken from the entry:

- Merged at **10:18:18Z**.
- `Tests` (job `107136618616`) reported **failure at 10:18:29Z** — eleven seconds later.
- `E2E` also failed, at 10:47.

So the merge went past a **PENDING** check, not a reported failure. That is a sharper falsification
than the entry claimed: CLAUDE.md's exact words were *"it cannot merge a genuinely pending check"*,
and it did.

## The mechanism, confirmed the same day

`enable_pr_auto_merge` was re-probed on a **green** PR at 09:15 UTC and still answers *"Protected
branch rules not configured for this branch"*. `main` is protected by a Ruleset with no classic
branch-protection rule beside it — so the merge API neither enforces the required checks nor offers
auto-merge. **One missing setting causes both**, which makes this entry's remaining half and `LB-52`
the same fix.

## What changed

Two CLAUDE.md passages that instructed every agent to trust an unsound gate:

1. The Standing Instruction claiming branch protection *"requires a PR with all CI checks passing"*.
2. The CI/CD line calling the merge *"the reliable green check"*.

Both now state that the checks are not enforced at merge, cite the measurement, and point at the
real read — `get_job_logs` with `failed_only: true`, where an empty list is the green signal and the
output does not flood context the way `list_workflow_jobs` does.

## Why this matters more than it was filed as

`owner-branch-protection` was put to the owner as a **throughput** problem: auto-merge is unavailable
so every merge is hand-caught against a moving base. It is also the reason **no merge in this repo is
gated on its tests**. The batch is now marked as a correctness question, to be said plainly when it
is next raised.

## Not done

Turning the required checks on is the owner's and stays in `LB-52`. The test-assertion half of
`LB-134` (`expect(getActiveProgram).not.toHaveBeenCalled()`) is unrelated to this correction and is
untouched here.

## Not exercised

Documentation only.
