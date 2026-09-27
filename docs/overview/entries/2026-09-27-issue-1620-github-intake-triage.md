# 2026-09-27 — the first GitHub intake under OR-185: one issue, two inbound PRs, and a live migration collision (BF-211/212/213)

OR-185 made BugFix the GitHub watcher. This is the first pass under it, prompted by the owner asking
what else there was to review.

## What was unwatched

**One open issue** — `#1620` (`jsboiss`, 2026-09-25), assigned to the owner, two days old and
un-triaged. CLAUDE.md's own OR-185 line already names it as the case the rule was written about.

**Two inbound PRs** — `#1607` and `#1608`, neither with a queue entry. All three are now filed.

## The issue is right about the duplication and wrong about the fix, and `main` proves it

`#1620` asks to drop the hand-maintained *Next free Postgres migration* row and derive the number
from filenames. The number really is derived twice: `check-backlog-pointers.js:558-573` already
computes `max(filenames) + 1` and fails when the Markdown disagrees.

**But the migrations directory reads `…284, 285, 288, 289` — 286 and 287 are missing**, reserved in
that row's prose by the unmerged `#1749`. Filenames see only what merged. Had LA-161 derived its
number that way it would have taken 286, which `#1749` already uses.

The author anticipated this and proposed catching duplicates before merging. Right instinct, wrong
moment for this repo: a collision found at merge time means rebuilding a migration *and* its
`claude_ro` twin.

Recommendation filed: derive it from **every branch** rather than from `main` —
`git log --all --diff-filter=A --name-only -- lib/data/postgres/migrations/` gives the convenience
the issue wants and still sees `#1749`.

## `#1608` is that failure already happening

It adds `288_apple_health_samples.sql` and `289_claude_ro_views_apple_health_samples.sql`. `main`
holds `288_training_load_grid_dimensions.sql` and `289_claude_ro_views_grid_dimensions.sql`.

**The duplicate number is the smaller half.** Every twin opens
`DROP SCHEMA claude_ro CASCADE; CREATE SCHEMA claude_ro;` and recreates every view from the database
it was generated against. The two 289s sort by filename, so `…apple_health_samples` runs first and
`…grid_dimensions` runs second — generated before that table existed. **The new view is created and
then dropped in the same deploy**, with no error anywhere.

A contributor derived the number from what they could see. That is the issue's proposal, executed.

## One correction to my own earlier work

In the PR-register rewrite I recommended **merging `#1608`**. That was wrong under the rule the owner
restated today — an outside contributor's PR is theirs to merge, and we stop at review, comment,
approve. Orchestrator's rewrite of `TN-80` had already removed it from `main` before I could; checked
rather than assumed.

## Not exercised

Docs-only. No product code, nothing run on the device, and **nothing posted to GitHub** — the
`#1608` finding is concrete and blocking, but posting the review is Review's channel and the comment
is offered to the owner rather than sent.
