# 2026-09-10 — the journal ceiling counts entries nobody is allowed to fold (OR-107)

**Branch:** `chore/or-107-entries-ceiling` · one config number, one comment, one queue entry.

## The bind

`docs/overview/entries/` is meant to be a readable *recent* window, and two rules make that
impossible together:

- The entries README says **do not fold an entry another doc links to.** That rule is right — it was
  adopted after a sweep broke 48 links, several inside another lane's baton, which is not a file a
  sweep should be rewriting.
- **305 of 342 entries are cited** by a durable doc. `projectOverview.md` pins 198,
  `docs/implementation-backlog.md` 98, the domain READMEs most of the rest: 30 files, 467 links.

So the only entries a sweep is permitted to fold are the **newest** ones, and satisfying a ceiling on
the *total* means deleting the recent window to preserve the archive — backwards from what the window
is for. I did exactly that earlier today to unblock a PR: folded 20 entries from the previous two
days, because nothing older was foldable.

## Why raising the number is the right call and not a dodge

The check already carries two gates, and only one of them names an action a person can take:

| gate | counts | at | can it be satisfied? |
|---|---|---|---|
| `limit` 60 | **foldable** entries | 37 | yes — fold unlinked ones |
| `totalCeiling` 361 | **every** entry | 342 | no — 305 are unfoldable by policy |

The foldable limit is the working gate and it is healthy. The total ceiling measures something no
sanctioned action can reduce, so it fires as a tax on whichever PR happens to be open — **two
unrelated PRs in two days**, both mine, neither touching the journal. And at **~13.5 new entries a
day** no fixed total survives a week regardless of where it is set.

Raised to **600** and reframed in `check-doc-index-size.js` as a backstop against pathological growth
rather than a compaction trigger, with the reasoning in the file so it is not quietly lowered again.

## The actual fix, filed rather than improvised

**OR-107**: make folding **rewrite the citation** instead of refusing to fold. An entry moves into
`history-*.md` under a stable anchor and every `](docs/overview/entries/<name>.md)` becomes
`](docs/overview/history-<file>.md#<anchor>)`. Then "linked" stops meaning "unfoldable" and the window
sheds oldest-first. The form is regular enough to script — 194 of projectOverview's citations are
literally `[journal](docs/overview/entries/<name>.md)`.

**It is filed, not built, deliberately.** The README documents **five** measured link-breaking traps
from previous attempts, each found by a separate `check-doc-links` run, each looking like the last
thing that could be wrong. A change that rewrites 300+ links across 30 files — including other lanes'
batons — is a planned piece of work, not something to improvise at the end of a sweep. The entry
points at all five by name so the next session does not rediscover them one run at a time.

## Not done

- The fold itself. OR-107 is queued, Lane O.
- The 37 currently-foldable entries are left alone; `limit` 60 is not close.

**Surfaces not exercised:** none apply — no runtime code, no device path, no schema. `check-doc-links`
passes on 1087 files; `pnpm check:rules` **Ran 73 of 73**.
