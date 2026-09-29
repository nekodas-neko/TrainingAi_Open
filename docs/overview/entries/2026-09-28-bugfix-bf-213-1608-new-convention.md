# 2026-09-28 — inbound sweep: #1608 adopted BF-214's conventions on its own

**Agent:** BugFix intake, second firing of the daily inbound GitHub watch (OR-185). **Docs only.**

## The sweep

- **Open issues: 0.**
- **Open PRs: 10, of which 2 are not ours** — `#1607` and `#1608`, both `jsboiss`. Both already
  carry entries (`BF-212`, `BF-213`), so nothing was unfiled.

## `#1608` moved, and the entry was stale again

Head went `0bb5a87e` → `5d680b16`. What changed is the part `BF-213` had predicted would need doing:

- The migration is now **`202609280817_apple_health_samples.sql`** — BF-214 ②'s `YYYYMMDDHHMM_<what>`
  form, not a sequence number.
- The `claude_ro` views are an **in-place edit of `lib/data/postgres/claude-ro-views.sql`**, not a
  numbered twin migration — BF-214 ①.

So the numbered scheme is gone from this PR entirely and **there is no number left to collide on**.
The entry's line saying its `291_claude_ro_views_…` twin "must be deleted once BF-214 merges" was
satisfied by the author without being asked.

**The green is not stale, checked rather than assumed:** no commit on `main` has touched
`claude-ro-views.sql` or added a migration since his run at 08:43Z, so the one shared file this PR
edits has not moved underneath it. All ten jobs completed and success; `mergeable_state: clean`.

## What I did to the entry, and why

`BF-213` had accumulated **three contradicting layers** — the original 288/289 collision, the
09-27 correction to 290/291, and the BF-214 prediction — describing two states that no longer
exist. Rewrote the body to lead with current state and compress the history into one bullet.

**The lesson is procedural, not technical:** an entry describing an inbound PR describes a moving
object, and re-reading it costs one call. This entry has now been wrong twice, both times because
the contributor fixed the thing before we re-read it.

## One claim I corrected before committing

I first wrote that Review should read "the ingest route's Zod schema next to it". **There is no
ingest route in this PR** — 4 files, storage only, and the author says so plainly. Rewritten to put
that check on the follow-up PR that adds the route.

## `#1607` unchanged

Head still `6f6fd763`, `updated_at` still 2026-09-27. `BF-212` already records it. No change.

## Not exercised

Docs only. **Nothing merged, closed, pushed or commented on either inbound PR** — the ceiling there
is review, comment, approve, and no comment was posted.
