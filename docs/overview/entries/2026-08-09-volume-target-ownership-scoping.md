# 2026-08-09 — The volume-target methods now scope themselves (Q-174)

**Branch:** `security/volume-target-ownership-scoping` · **Domains:** `workouts`, `platform`

## What was wrong

Four repository methods took a `programId` and **no `userId`**, over `program_volume_targets` — a
table with no `user_id` column. Ownership therefore lived entirely in the caller, with nothing in the
signature to say so. `replaceVolumeTargets` was an unscoped
`DELETE FROM program_volume_targets WHERE program_id = $1` plus re-insert: the same
delete-and-reinsert-by-parent-id shape as the `saveProgressionStyle` incident.

**Not a live bug.** Every caller was checking. `ai-periodization/weekly-volume` even does the full
`listPrograms(userId)` → 404 dance for its client-supplied `programId` — which is the fragile
arrangement, not a reassurance: the safety was load-bearing in four separate call sites and invisible
from the method it protected.

## What changed

- `listVolumeTargets(userId, programId)` — scopes via an `innerJoin` to `programs`.
- `replaceVolumeTargets(userId, programId, targets)` — an ownership pre-check with a **row-count
  guard** inside the transaction, before the DELETE, matching what `saveProgram` and
  `saveProgressionStyle` already do.
- `upsertVolumeTarget` and `deleteVolumeTarget` **deleted**. Zero callers anywhere: dead code with an
  unscoped signature is what the next feature reaches for.

Five call sites updated (three routes, one shared signals module, one adapter).

## Verification

Three tests, all mutation-checked. Two prove rejection; the third proves the **owner still can**:

> Without a positive case, a guard that rejected every caller would pass the rejection tests. Proving
> the reject path is only half the property.

The same risk on the read side was checked on a running dev server rather than in a test: with a
volume target seeded for the logged-in user, `GET /api/ai-periodization/weekly-volume` returns
`{"targets":{"chest":16}}` on both the explicit-`programId` and active-program paths, so the new join
does not over-filter. A forged `programId` returns **404**, not 500.

39 ownership tests now, 39/39 failing under mutation. Full DB suite 72 files / 372 tests green.

## A false alarm worth naming

The first full-suite run reported **3 failed | 19 skipped**. The dev server had just been killed in
the same command and was still releasing pool connections — the exact case CLAUDE.md's
"stop `pnpm dev` first" note describes. A clean re-run with the server gone was 372/372. Recorded
because a red suite immediately after a code change is the most tempting thing in the world to
attribute to the change.

Also: `pkill -f "next dev"` matched the shell running it and killed the command mid-way, silently
skipping a commit. `pgrep | xargs kill` on a narrower pattern, or just leaving the server, is safer.
