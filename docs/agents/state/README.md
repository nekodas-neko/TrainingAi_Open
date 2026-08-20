# Agent batons

One file per standing agent, at a stable path, **overwritten** at every handoff. A successor
session reads its own baton first and continues from it under the same name.

| File | Agent |
|---|---|
| `implementation-lane-a.md` | Implementation Lane A (engine) |
| `implementation-lane-b.md` | Implementation Lane B (surface) |
| `bugfix.md` | BugFix |
| `tuning.md` | Tuning |
| `review.md` | Review |

## What a baton is for

**State, not narrative.** Where the agent is right now, what is in flight, what is next, what is
blocked. A successor should be able to act from it within a minute of reading.

The narrative — why decisions were made, what dead ends were hit, what a cluster of work amounted
to — goes in a dated `docs/handoff-YYYY-MM-DD-<domain>-<title>.md` written with the `handoff` skill.
Batons are always current and always overwritten; handoffs are dated and never edited after the
fact. Keeping them separate is what stops the baton growing into another accreted document.

## Rules

- **Rewrite it in full at handoff.** Do not append. A baton that is half last week's is worse than
  no baton, because it will be trusted.
- **Commit it.** The container is ephemeral and the repo is re-cloned each session; an uncommitted
  baton is a lost baton. Fold it into the open PR if there is one.
- **Never claim something is done unless it is in a committed diff and was observed working.** Name
  the failure surfaces you did not exercise.
- **Keep it short.** If it is over a screen, the narrative has leaked in — move that to a handoff
  doc. Batons are size-ratcheted in `docs/doc-size-baseline.json`, shrink-only: they are what the
  other lane reads before claiming a path, and one nobody finishes reading is not doing that job.

## Template

```markdown
# <Agent> — baton

**Updated:** YYYY-MM-DD · **By:** <session/branch> · **Next ID:** <letter>-NNN

## Now
What I am in the middle of. Branch and PR number if one is open, and its CI state.

## Next
The next one or two things, in order, with enough context to start without re-deriving.

## Blocked
Anything waiting on the owner, on another lane, or on a device check. Say who it is waiting on.

## Claimed paths
Files outside my lane's listed ownership that I have claimed, and until when.

## Do not re-litigate
Decisions already made that a fresh session would otherwise reopen.
```
