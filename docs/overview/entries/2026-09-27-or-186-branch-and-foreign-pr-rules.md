# Two rules to the knowledge bank: branch names, and whose PR it is

Orchestrator, 2026-09-27. Docs plus one baseline. Both owner instructions, recorded as rules rather
than as this session's habit.

## The word `claude` never appears in a branch name

The existing rule said *"branch names must describe the change"* and gave `claude/vibrant-volta-0SkCX`
as the example of what not to do — which reads as a ban on **generated** names, not on the tool's
name. The owner's instruction is the stronger one: **not the `claude/…` prefix the harness suggests
by default, not anywhere in the name.**

The rule now asks for a **descriptor prefix naming the kind of change** — `fix/`, `feat/`, `bugfix/`,
`issue/`, `request/`, `chore/`, `security/`, `docs/` — so `issue/1620-migration-counter` rather than
anything tool-named. The repository is public and its branch list is part of how the work reads to
anyone looking; a branch named after the tool says nothing about the change, which is what the rule
was for in the first place.

## Never merge a pull request we did not author

This is a hard stop, and it goes in Safety & Reversibility beside the production-DB policy because
it is the same shape: **a rule that removes an authority the rest of the file otherwise grants.**
*"Merge a tested, CI-green PR without asking"* reads as blanket permission until something says it
covers our own PRs only — and it does.

On someone else's PR the ceiling is **review, comment, approve**:

- **We MAY approve.** An approval says *we read it and nothing blocks*, which is the useful half and
  the thing an author is actually waiting on. Withholding it while having nothing to say is just
  slower silence.
- **We never merge.** No exception for green CI, no exception for a one-line diff.
- **Cannot approve → comment and wait.** Do not close it, do not push to their branch, do not open a
  rival PR, and **do not merge it because the comment went unanswered.** A stalled PR that is theirs
  stays theirs.

The `docs/agents/README.md` Review section carried *"Review's authority is docs-only and a posted
review"*, written this morning, which was narrower than the owner wants — approval was not on the
list. Corrected there too.

## Note on ordering

`#1756` was still auto-merging when this branch was cut, so the one-line session-start summary of the
approve rule lands with that PR's text rather than this one. The binding statement is in Safety &
Reversibility either way; nothing here waits on it.
