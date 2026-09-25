# 2026-09-25 — the ruleset was `Disabled`, and two recorded mechanisms were wrong

**Branch:** `docs/or-164-branch-protection-active` · **Lane:** O · docs-only

`main` is now genuinely protected. It was not, for five and a half weeks, and the reason is one field
nobody opened.

## What was actually wrong

The `ProtectMain` ruleset was created **2026-08-17** with six required checks already configured and
its **Enforcement status set to `Disabled`**. Every rule in it — required checks, `deletion`,
`non_fast_forward`, PR-before-merge — was listed and inert.

That single fact explains both symptoms the queue had been carrying as separate mysteries:

- **PR #1467 merged at 10:18:18Z with `Tests` still running**, and that job reported failure eleven
  seconds later. `main` took a red commit.
- **`enable_pr_auto_merge` answered *"Protected branch rules not configured for this branch"*** on
  three separate probes. That error was **literally true** and was read as a statement about
  Rulesets.

## The part worth keeping: both explanations on file were guesses

`LB-134` and two CLAUDE.md passages blamed *"a Ruleset with no classic branch-protection rule beside
it"*. `LB-52` was filed as *"GitHub's auto-merge API does not see a Ruleset"*. Neither was true.

Both were plausible, both were written with confidence, and both sent sessions looking for a classic
branch-protection rule that was never the answer — including me, hours earlier, telling the owner to
add one. **Nobody opened the ruleset and read its enforcement field**, which is the cheapest check
available and the first one a person would make. The API error was taken as evidence for a theory
instead of at face value.

CLAUDE.md's opening instruction has now been **wrong in both directions**: it first said the checks
were enforced, then that they were not, and neither version had the mechanism right.

## The other half, which is worse

The same disabled ruleset held `deletion` and `non_fast_forward`. So CLAUDE.md's standing claim that
*"`main` blocks force-pushes and deletions"* was **also false** for those weeks, and no session had
reason to doubt it. Nothing appears to have exploited it — the sandbox git proxy cannot push to
`main` regardless — but the guarantee every agent was reading did not exist. It does now.

## The configuration as it stands

Read back from the API rather than the settings screenshots, after the owner's edits at 19:11:30
+10:00:

| | |
|---|---|
| Enforcement | **Active** |
| Required checks | `Lint, Tests, Build, Migration Check, Custom Rules` — **E2E deliberately absent** |
| Merge methods | **squash only** |
| Approvals | **0** |
| Bypass list | **empty** |
| Other rules | `deletion`, `non_fast_forward`, PR-before-merge |
| `strict` (branch up to date) | **off, on purpose** |

**`strict` is off deliberately and the reason should survive.** `main` takes a commit roughly every 8
minutes against a ~7-minute CI run, so requiring a current base can livelock — one docs-only PR
needed **seven** re-merges on 2026-09-24 without it. Revisit only once `enable_pr_auto_merge` is
confirmed working, which it plausibly now is, since its refusal had the same single cause.

**Two consequences to expect.** A flaky job now blocks a merge instead of slipping through. And **if
CI itself breaks there is no path to push the fix** — every fix needs green CI. The escape hatch is
adding the owner to the bypass list temporarily; it is deliberately not pre-configured, because a
standing bypass is the thing that made this ruleset useless in the first place.

## What changed here

`LB-52` removed. `LB-134` closed with the mechanism corrected rather than quietly deleted. `Q-297`'s
second residue closed and the `owner-branch-protection` batch struck from the live pointers.
`BF-106`'s inherited branch-protection notes marked superseded, its own `VACUUM FULL` gate untouched.
Both CLAUDE.md passages and `projectOverview.md` rewritten to state what is enforced and to flag that
the pre-2026-09-25 record cannot be trusted on this point.

No product code. The claim that the ruleset is Active is read from
`/repos/.../rulesets/20923840`, not from the settings page.
