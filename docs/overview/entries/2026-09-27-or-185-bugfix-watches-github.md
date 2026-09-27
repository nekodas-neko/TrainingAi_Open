# One watcher for GitHub, and reviews that say only what is wrong

Orchestrator, 2026-09-27. Docs only. Two owner instructions, both corrections to what shipped hours
earlier in OR-183.

## BugFix watches GitHub — all of it

OR-183 split the channel: issues to BugFix, inbound pull requests to Review. The owner moved the
watching to one role — *"make that part of our rules that we are monitoring github from bugfix"* —
and that is the better shape. **A channel watched by two roles is a channel where each assumes the
other looked**, which is the exact failure that let `#1620` sit for two days.

So: **BugFix reads `list_issues` and `list_pull_requests` at session start** and files everything not
authored by the agent account. It triages an issue itself and hands an inbound PR to Review with a
`Lane:`. **One watcher, two readers.** Neither merges one — outside code entering the app, and both
live PRs hit a carve-out (`#1607` auth, `#1608` storage).

## The reviews get posted, and they are short

*"Yes write comments but make sure they are very concise. No fluff."* Two instructions, and the
second is the one that gets lost — so it is written as rules rather than as an adjective:

- No preamble, no praise, no restating what the PR does. The author wrote it.
- One finding per comment: the problem, the fix, and the `file:line` or rule that makes it one. **A
  finding with no cited rule is an opinion.**
- Nothing wrong → one line. Not a summary of everything checked.
- The attribution footer stays; that is the harness's rule, not padding.

One thing added unasked, because it follows from writing to a contributor rather than to the owner:
**name the rule rather than assuming it, and never imply their approach was careless when it is
simply not what this repo does.**

## The three live items

`OR-184` records the answer and routes them: `#1620` to BugFix to triage, `#1607` and `#1608` filed
by BugFix and read by Review, merges the owner's. **`#1607` gets checked against `Q-1a` first** —
same area, client half, and a conflicting design is the likely finding.

**They are now covered by the standing rule rather than by the entry**: BugFix's next session finds
all three without being told, so `OR-184` self-clears when it does.

## Deliberately not done

**No `Lane: BF`.** The routing gap is real — the next action on `OR-184` is BugFix's and no lane
names BugFix — but `OR-150` waited for fifteen entries and three sweeps before `Lane: T` earned its
place, and this is one entry. A fifth lane value for a single case is a channel nobody reads.
