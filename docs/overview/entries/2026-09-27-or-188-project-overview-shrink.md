# The lean index was 79% Known Issues

Orchestrator, 2026-09-27. Docs only. First half of the repo cleanup the owner asked for.

## The measurement that decided the order of work

`projectOverview.md` — the file `CLAUDE.md` calls *"a lean index"* and sends every session to before
its first useful action — was **13,028 lines**. Broken down:

| section | lines |
|---|---|
| Current Status | ~2,600 |
| Waiting on the owner | 23 |
| **Known Issues & Risks** | **10,230 — 79%** |
| What's Left To Do | ~95 |
| Document Map | ~55 |

Every session was reading ten thousand lines of open-issue detail to find out what the project's
status was. `Q-220` measured the cost of that months ago and had been gated since.

## The move

The whole section is now `docs/overview/known-issues.md`. **Nothing was rewritten, reordered or
archived — 451 headings in, 451 out.** `projectOverview.md` is **2,812 lines**, and its Document Map
says plainly that a new Known Issue goes in the new file *"or the 79% grows back"*.

**One file rather than one per pillar**, which was the structural call made when this was unblocked:
`grep -n '^### .*\[sleep\]' docs/overview/known-issues.md` works exactly as it did, and the standing
rule depends on that grep. Per-pillar files would force an issue tagged `[sleep][platform]` to live
in one and go missing from the other. Verified after the move: the sleep grep returns 28.

## What the move broke, and how it was caught

**215 relative links.** The section was written when the file sat at the repo root, so every
`](docs/…)` resolved correctly; from inside `docs/overview/` they all pointed at
`docs/overview/docs/…`. `check-doc-links` named two, which is what a checker does — it reports what
it can prove, not the class. Rewriting the class rather than the two it named turned up **214 of one
shape and one of another** (`e2e/README.md`, which needed `../../`).

That is rule 1 from OR-187 arriving the same day it was written: **the two the checker named were
candidates, not the count.**

## Also here

The journal hit its 60-file ceiling again and is folded — **81 → 36**, one new
`history-2026-09-27-folded-2.md`. `check-doc-links` clean across 864 files.

## Deliberately not done

**The new file is not ratcheted.** A Known-Issues list should grow when issues are found, and a
ceiling would put pressure on not recording one — the opposite of what **No orphaned findings**
wants. The control is the archive rule that already exists: move an entry out when nothing is still
owed.

**`CLAUDE.md` compaction is the other half** and is a separate PR — a 10,000-line move and a rewrite
of the rules file do not belong in one diff.
