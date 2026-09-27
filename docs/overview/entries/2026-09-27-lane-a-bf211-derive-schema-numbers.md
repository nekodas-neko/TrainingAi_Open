# BF-211 — the migration number is derived by a command now, and the pointer it replaces could never have reserved anything

**Branch:** `lane-a/bf211-derive-schema-numbers` · **Lane A** · docs + tooling, no product code.

Closes `BF-211`, filed from GitHub issue **#1620** (`jsboiss`), which asks for the next migration
number to be derived from the filenames instead of hand-maintained in
`docs/implementation-backlog.md`.

## The entry's counter-argument is refuted by the repo it describes

`BF-211` recommends keeping the hand-maintained row, on the grounds that filenames cannot see an
unmerged branch while the row can: *"286 and 287 are missing, reserved in that row's prose by the
unmerged #1749."*

**The row cannot reserve anything, and this is checkable in ten seconds.**
`check-backlog-pointers.js` required `row === max(merged filenames) + 1`. Measured — set the row to
292 with the directory head at 289:

```
• Migration pointer says 292, but the directory head is 289 so the next free number is 290.
```

So the *number* was always exactly `max + 1`, a restatement of the directory. The reservation it was
credited with lived in a free-text parenthetical beside it that no check read. Two journal entries
record it drifting anyway — **eleven** behind the directory once, five another time.

That inverts the decision. The issue author is right that the number is derivable; where they are
wrong is *what to derive it from*, and the entry is right about that without its stated reason
holding.

## What shipped

`node scripts/next-schema-number.js` — fetches, then reads **every ref**, not just the merged tree:

```
Next free Postgres migration number: 290
  287 on origin/main, 51 other ref(s) read.

Claimed by a branch that has not merged:
  286  286_drop_dead_derived_columns.sql  (origin/lane-a/la142-drop-dead-derived-columns)
  287  287_claude_ro_views_drop_dead_derived.sql  (origin/lane-a/la142-drop-dead-derived-columns)
  288  288_apple_health_samples.sql  (origin/health-sample-storage)

Next free local SQLite schema version: v44
  origin/main tops out at v43.
  claimed elsewhere: v42  (origin/lane-a/la142-drop-dead-derived-columns)
```

- It covers the **SQLite version too**. The removed table had both rows with the same defect, and
  leaving one of them would have been an incoherent half.
- The `v42` line is the reservation working: main runs 41 → 43, and 42 is genuinely held by an
  unmerged branch. A version below main's top is still a claim, so the report is a **set
  difference**, not "above the maximum".
- Pure logic in `scripts/lib/migration-claims.js`; the git reading is in the CLI. 8 tests.

## Two things the tool found on its first run

1. **It reproduces `BF-213` independently** — `288: merged: 288_training_load_grid_dimensions.sql vs
   origin/health-sample-storage: 288_apple_health_samples.sql`, and the same at 289. That entry is
   amended to say so, because a renumber that can be verified beats one that is argued.
2. **A dead branch reads exactly like a reservation.** `origin/lane-a/q44-phase3-pr1-table-rename`
   holds 273/274 and has no open PR. Recorded on `BF-213` as explicitly *not* work, so nobody
   renumbers around a branch nobody is going to merge.

## It fetches by default, and that is not a convenience

Writing this, an un-refreshed remote-tracking ref reported `#1608` as holding **284/285** — numbers
it had been renumbered off. I nearly filed that as a correction to `BF-213`, which was right all
along. A stale pair reads exactly as authoritative as a fresh one, so the fetch is inside the
script rather than in the instructions beside it.

## What did NOT change

`scripts/check-migration-numbers.js` is still the CI gate and its failure condition is untouched: a
duplicate number in one tree. That is the half the issue author also proposed, it already existed,
and it is what catches `#1608` the moment that branch is updated to `main`. CI clones one branch at
depth 1, so a branch-aware check could never run there — the new command is deliberately **not** a
gate. What replaced the removed pointer check is narrow: the backlog must still name the command, so
removing the answer cannot quietly become no answer.

`GRANDFATHERED` (081/087/146/161 — applied duplicates that must not be renamed) now lives in
`scripts/lib/migration-claims.js` and both consumers read it there.

## Verification

- `scripts/__tests__/migration-claims.test.ts` — **8 passed**.
- **Mutation pass: baseline survives, 4 killed, 1 equivalent control survives.** Killed: dropping
  the already-merged guard; deriving `next` from the merged tree alone (the removed pointer's own
  behaviour, kept as a mutant because it is the thing being argued against); dropping the
  grandfather filter; comparing claim *count* instead of filename. The last one **survived the first
  pass** and the gap was real — a branch cut from another carries the same file, two claims and one
  migration — so a test was added and it now kills. Control: sorting by `localeCompare`.
- Control-run on the replacement check: renaming the command in the backlog fails it by name.
- `check-backlog-pointers` 0 · `check-migration-numbers` 0 · `check-doc-links` 0 · Custom Rules and
  the rest below.

## Not exercised

Nothing runs on the device or in production; this is tooling and docs. The command's cross-branch
output depends on which refs the clone has — it fetches, but a ref the remote does not serve (a
contributor's fork branch) is still invisible to it, and no check can see one.

## Left for the owner

**The issue author is owed a reply and I have not posted one.** Commenting on a shared surface is
confirm-first. The answer worth sending is more interesting than the request: the duplicate
detection they proposed already exists, the command they asked for now exists and is branch-aware,
and their own PR is the live example of why filenames alone were not enough. Say the word and I will
post it.
