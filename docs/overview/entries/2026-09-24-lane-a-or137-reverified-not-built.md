# 2026-09-24 — OR-137: re-measured, still premature, not built

**Branch:** `lane-a/or137-reverify-defer` · **Lane A** · docs only. **The entry stays queued**, one
position lower and carrying the measurement.

## Why nothing was built

OR-137 reached the top of the startable list and asks for an admin route that returns one feedback
screenshot by id — the `claude_ro` view withholds the bytes on purpose, so a triaging agent sees
*"screenshot, 240 KB"* and nothing else.

**Its own last bullet defers it**, and the deferral is the kind that expires with usage rather than
with time, so it needed re-measuring rather than re-reading:

| | filed 2026-09-23 | measured 2026-09-24 |
|---|---|---|
| `feedback_submissions.n_tup_ins` (lifetime inserts) | 1 | **1** |
| `n_live_tup` | 1 | **1** |
| the owner's reports (`claude_ro`) | 0 | **0** |
| of those, with a screenshot | 0 | **0** |

Unchanged. The feature this would serve has produced **one submission in its lifetime and none of
the owner's**, so the route would be built against no example of the thing it fetches — and its
shape (what to return, how to frame it for triage) is exactly what one real report would settle.

## What shipped instead

The entry moved below the startable defects, with the measurement recorded. It reached position 3
only because everything above it shipped — the queue working correctly, not a signal to start.

Two design constraints from the entry are restated on it, because they are the easy things to lose
when it is finally built: **the bytes must not enter the `claude_ro` view** (500 KB dragged into
every `SELECT *` on that table makes ordinary triage unusable), and **the route must scope on
`current_setting('app.claude_ro_owner', …)`** exactly as the view does, or it becomes a way to read
another user's attachment.

## One thing that changed under it today

**OR-138 shipped the ability to pivot `app.claude_ro_owner` per request** (PR #1499, awaiting the
owner). That changes what *"scope it the way the view does"* has to mean here: the setting is no
longer a fixed property of the role for the life of a connection. Noted on the entry so whoever
builds this checks OR-138 first rather than writing the scoping against a world that has moved.

## Not done

- **No route, no code.** Building it now would be guessing at a shape one real report would fix.
- **Failure surfaces not exercised:** none apply — nothing executable changed.
