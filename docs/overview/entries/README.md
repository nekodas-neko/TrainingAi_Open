# Session journal — per-entry files

**One file per merged PR / session note. Never prepend to a shared history file.**

This directory holds the **uncompacted recent** session journal. Each session/PR writes its
end-of-session note as its **own new file** here instead of prepending to a batched
`docs/overview/history-*.md`. A periodic **compaction** sweep folds these loose files into the
batched history and deletes them.

## Why (the problem this solves)

The end-of-session journal note used to be prepended to the top of the single newest
`history-*.md`. Every parallel or back-to-back PR therefore edited **the same first lines of the
same file**, so each landing PR forced the next one to rebase-resolve a journal conflict — the
single most frequent merge conflict in this repo's multi-PR runs (observed on every PR of the
2026-07-17 batch). Two PRs writing **different files** cannot conflict, so per-entry files take
that conflict class to zero. It's also **safer**: hand-resolving a prepend conflict is exactly
where a botched merge could silently drop someone's entry; separate files can't lose one.

This preserves the original rule's intent — the note **rides in the same PR as the code**, so it
only ever lands if that PR merges (no stale "done" claims from abandoned PRs).

## Convention

- **Filename:** `YYYY-MM-DD-<branch-slug>.md` — e.g. `2026-07-17-feat-illness-signal-wiring.md`.
  The branch slug is unique per PR, so two same-day PRs never collide. `ls` sorts them by date;
  read them oldest-to-newest for the timeline.
- **Content:** exactly what the batched-history entry used to contain — a `##`-headed session note
  (what shipped, verification, what wasn't exercised, version bump). Copy the shape of any existing
  `history-*.md` entry.
- **Where it rides:** commit it on the **feature branch, last, right before merge** — same timing
  as before. It lands with the PR or not at all.

## What still goes in the feature PR (unchanged)

- This entry file (above).
- The **backlog-entry removal** for the item you completed (`docs/implementation-backlog.md`) —
  each PR deletes a *different, non-adjacent* block, so these rarely conflict.
- The `package.json` version + `lib/changelog.ts` bump when user-visible. **Note: this convention
  does NOT solve the version/changelog conflict** — those still collide because every PR bumps the
  same lines; re-bump on rebase as before. Eliminating that needs a separate changelog-fragment
  (`changesets`-style) change, deliberately out of scope here.

## What to KEEP OUT of a feature PR (moved to the compaction sweep)

To avoid re-introducing shared-line conflicts, do **not** edit these in a feature PR — they're
updated in the periodic docs sweep instead:

- The serial-track **"Next on the track: …"** pointer line in `docs/implementation-backlog.md`.
- `docs/planned_upgrades.md` batch **tick marks** (✅) for shipped review findings.

(Striking the shipped **backlog queue entry** itself stays in the feature PR — that's the
non-conflicting removal above. Only the shared *pointer/tick* lines defer.)

## Compaction chore (prevents unbounded growth — do not skip)

Loose entries are a **holding area, not permanent storage.** Fold them in on this trigger:

> **When `docs/overview/entries/` holds ≥ ~20 note files (excluding this README) OR ~100 KB of
> notes**, a session compacts them: append every entry (oldest-first) into the newest
> `docs/overview/history-*.md` — starting a **new** `history-*.md` when it nears ~250 KB, per the
> existing history-file rule — then `git rm` the folded entry files. One docs-only PR; because only
> one session runs it, it never conflicts.

### Two things the sweep must do that this file did not say (measured 2026-08-18)

The first attempt at a sweep failed the `No broken relative links in docs` rule twice, in two
different ways. Both are mechanical; neither is obvious until it happens.

1. **Do not fold an entry that another doc links to.** Durable docs cite entries by path —
   `projectOverview.md` Known-Issues rows, `docs/domains/*/README.md`, and the agent batons.
   Folding all 61 loose entries broke **48 links**, several of them inside another lane's baton,
   which is not a file a sweep should be rewriting. Fold the **unlinked** ones and leave the rest;
   `grep -rl <entry-filename> --include='*.md' .` tells you which is which. (61 → 32 that way, which
   is under the 60-file runaway limit and enough to unblock CI.)
2. **Rewrite `](../../` → `](../` in every folded body.** An entry lives in
   `docs/overview/entries/`; the history file is one level up in `docs/overview/`. Every relative
   link inside the entry loses a level when it moves. Missing this left 6 broken links pointing one
   directory too high.

**The floor is measurably rising — second sweep, 2026-08-18 (same day).** 62 entries, of which
**41 were linked** by a durable doc and only 21 were foldable, so the sweep went 62 → 41 where the
first went 61 → 32. Nine days' worth of new entries arrived and the *linked* count grew by nine.
The runaway limit is 60, so on this trend the next sweep clears fewer than it needs to and the one
after that clears nothing. This is now a dated problem, not a theoretical one.

**The standing tension worth naming:** a fold-everything sweep and durable docs linking entries are
incompatible, and today the docs win — which means the loose directory has a floor that grows.
Resolving it properly means either the sweep rewriting citations to the history file it folded into
(with an anchor), or durable docs citing the batched history rather than a loose entry. Not decided;
recorded so the next sweep does not rediscover it from a red CI run.

This is a standing chore in the same spirit as Dependabot remediation: it lives here permanently and
is worked on a threshold, not every session. Below threshold, leave the entries; above it, compact.

## Considered risks (reviewed before adopting — read before "improving" this)

- **Unbounded directory growth** if compaction is skipped — the whole benefit assumes the sweep
  actually happens. Mitigated by the explicit threshold above; the files are tiny (~1–3 KB each, so
  20 ≈ 40 KB — a tidiness concern, not a git-perf one), but don't let them pile into the hundreds.
- **Loss of the single chronological read** — "recent history" is now N files, not one scroll. The
  `YYYY-MM-DD-<slug>` naming keeps `ls` chronological; compaction restores the single-file read for
  anything past the current window. Accept the small ergonomic cost for zero conflicts.
- **Discoverability** — a session that reads only the batched `history-*.md` would miss the last few
  sessions. The `projectOverview.md` Document Map points here explicitly; keep it doing so.
- **Half-fix honesty** — this removes the journal + shared-pointer conflicts, **not** the
  version/changelog one. Don't claim otherwise.
- **Stale plan-doc instructions** — implementation plans written before this convention (their
  "Task Final" steps) still say "append the session note to the most recent `history-*.md`". That is
  superseded: CLAUDE.md's per-entry-file rule wins (it "OVERRIDES any default behavior"). The plans
  weren't bulk-edited to avoid churn/conflicts with the live queue — follow this convention, not their
  stale line.
