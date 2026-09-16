# Journal compaction sweep — 60 foldable entries down to 30

**Lane A · branch `lane-a/journal-compaction-sweep` · docs only.**

## Why now

`check-doc-index-size` failed the RV-42 rebase: `docs/overview/entries/` held 61 foldable entries
against a limit of 60. `main` sat at exactly 60 — passing — and RV-42's own journal entry took it
over, so by BF-36's targeting rule the sweep fell to that branch.

**Doing it there would have been wrong.** RV-42 is #1098, an owner-gated security change that has
been waiting since 2026-09-11 and whose whole job is to stay minimal and mergeable. Folding forty
journal entries into it would bury a write-path ownership fix under a 44-file docs diff, in the one
PR whose diff most needs to stay readable. The chore belongs to `main`, so it ran on `main`.

It also unblocks everyone else: with `main` at exactly the limit, the *next* entry from any of the
six lanes would have failed the same way.

## What it did

`node scripts/fold-journal-entries.js`, dry-run first, per the README — the sweep has been a script
since 2026-09-10 and it repoints citations rather than refusing to fold cited entries.

- **40 entries folded** into `docs/overview/history-2026-09-16-folded-1.md`.
- **5 held back**, cited by an agent baton — the script refuses those deliberately, because
  rewriting them means one lane writing into another's live state file.
- Citations rewritten in 3 durable docs: `projectOverview.md`, `docs/implementation-backlog.md`,
  `docs/domains/nutrition/README.md`.
- **60 foldable → 30**, against a limit of 60. Thirty files of headroom.

Both link checks clean on the first pass — `check-doc-links` OK across 828 files,
`check-index-doc-paths` OK across 1,129 paths in 12 orientation docs. The README lists six traps
that broke earlier sweeps in six separate passes; the script now handles all of them, and this run
is evidence that it does.

## The cadence note is still right, and this run confirms the arithmetic

The README's LA-25 measurement says ~17 entries/day across the concurrent sessions, so a sweep
clearing 25 buys about a day and a half. This one cleared 30 from a directory that was at the limit,
which buys under two days at that rate. It is a near-daily chore, and the trigger is reliably *the
guard failing someone's PR* rather than anyone sweeping ahead of it.

The cheaper half remains the citation habit: when a durable doc needs to cite a session, cite the
review or handoff document rather than the loose journal entry. The linked floor is now 29 — those
are permanent weight that no sweep can reclaim.

## What is NOT done

Nothing in `#1098` itself. It gets re-merged onto this once it lands, which is the point.

## Failure surfaces NOT exercised

Docs only; nothing runs. `pnpm ci:local` green — **Ran 75 of 75 Custom Rules steps**, 922 files /
8,736 tests.
