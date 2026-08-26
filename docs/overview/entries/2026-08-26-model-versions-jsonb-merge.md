# 2026-08-26 — the model stamp that another pillar could erase (Q-273)

**Branch:** `fix/model-versions-jsonb-merge` · **Lane A** · no migration, no APK.

`oura_daily_derived.model_versions` is a **map** of pillar → model version. The shared upsert wrote
every column with `COALESCE(excluded.col, existing.col)` — replace-if-non-null. For a map that means
**the last pillar to stamp wins and every other pillar's key silently disappears.**

Not theoretical. `backfillBodyComp` writes `modelVersions: { bodyComp: … }` flat, so every day it
touched lost its readiness stamp. Readiness escaped only because `readiness-payload.ts` read the row
first and spread the result back — two statements, so a race, against a value that could already be
stale.

The stamp exists so a correlation computed across a model change can be split by model. **A stamp
another pillar can erase does not do that job, and the erasure leaves no trace.**

## The fix

`upsertOuraDailyDerived` now merges that one column inside the statement:

```sql
model_versions = COALESCE(existing.model_versions, '{}'::jsonb) || COALESCE(excluded.model_versions, '{}'::jsonb)
```

Every other column keeps `COALESCE`, which is right for a scalar. Each pillar writes only its own
key, no writer can clobber another, and the JS read-merge is deleted rather than copied to the next
three pillars that need a stamp.

## Verified

- **Five DB-backed tests, and they fail against the old code.** Reverting to plain `COALESCE` fails
  **3 of 5** — including *"a later pillar stamping its own key keeps the earlier one"*, which is the
  live sequence — while the two that should pass either way (a write omitting the field; the first
  stamp on a fresh row) still pass. That asymmetry is the point: the suite distinguishes the fix from
  the bug rather than merely exercising the code.
- The tests also pin that re-stamping the **same** pillar still overwrites that key, so merging did
  not freeze a version at its first value.
- **Full suite 599 files / 4,901 tests green** — exactly +5. `tsc --noEmit` clean ·
  `pnpm check:rules` **Ran 58 of 58** · lint 0 errors.

## The premise was partly stale, which is why it was checked first

Q-273 was filed 2026-08-15 saying no pillar but Body Battery records its model. By now the
`model_versions` column exists on `oura_daily_derived` and **two** pillars write it. Building the
entry as written would have re-added a column that was already there. What was actually missing was
not the column — it was that writing to it was unsafe.

**Q-273 stays in the queue with its residue stated.** Sleep, activity and training load still do not
stamp, and giving them one means *defining* their model versions: only two such constants exist in
the tree, and inventing three more in passing is a judgement about each pillar's model that belongs
with whoever owns it. The backfill half is untouched and should stay that way until someone decides
it — re-deriving history is the Q-304b hazard.

## A second cross-file test collision, same shape as this morning's

The new test file turned the suite red in `backfill-derived-scores` — a file this change never
touches — on `sleep_sessions_user_id_fkey`. Same class as `...05e3` earlier today: `...f002` is that
file's only test user **and** an incidental "other user" in `user-preferences-merge.test.ts`, which
deletes it. Parallel workers, one shared database, so the delete lands between the other file's seed
and its query.

Twice in one session is a class, so it was **measured rather than patched**: 603 test files hold
**233 distinct hardcoded UUIDs**, **10 shared across files**, **7 of them risky** (shared *and* some
holder deletes from `users`). Two are now fixed; the remaining six and a CI check to hold it at zero
are **LA-32**, filed with the table. Swept-but-unchecked is the weaker half, which is why the check
is in the entry rather than the sweep being done blind here.

## Also shipped: Q-273's scope item 3

`CLAUDE.md` gains *A Correlation Across a Model Change Is Not Evidence*, with the worked example —
four model versions pooled over 40 days produced **r = −0.06**, written down as evidence the model
had no outcome signal, where **v5 days alone give r = +0.67**. That stood in the docs for eleven
days. It also records two facts that are properties of a *pair* of files and invisible from either:
`model_versions` merges and must never regain a JS read-merge, and `updated_at` does not identify
the writing model.

## The compaction chore bit, and the recovery is the part worth recording

Merging `main` tripped `check-doc-index-size` at **61 foldable journal entries against a limit of
60** — Lane B was adding entries in parallel, so the shared count crossed on this branch. The
documented fix is the compaction sweep, so it was attempted, and it went wrong in two ways at once:

1. **It folded by DATE rather than by the unlinked list**, which is trap #1 in
   [`entries/README.md`](README.md) — *"do not fold an entry that another doc links to"*. 45 entries
   went in where only a subset was foldable, breaking six links immediately.
2. **It wrote to `docs/overview/history-2026-08-24.md`, which already existed** — a 228 KB file —
   and clobbered it.

Nothing was lost: the fold was never committed, `git merge --abort` restored the pre-merge tree, and
`history-2026-08-24.md` was verified **byte-identical to `origin/main`'s copy** rather than assumed
intact. **The lesson is the one in the README's own trap list**: a fold is driven by the *linked/
unlinked* computation, never by a filename glob, and a fold target is appended to, never written
over.

The sweep is Orchestrator's chore and was not re-attempted here after that. Instead this entry is
**cited from [`docs/domains/readiness/README.md`](../../domains/readiness/README.md)**, which takes
it out of the foldable set (61 → 60) and is honest rather than a dodge: the `CLAUDE.md` rule this PR
adds states the constraint, and this entry is the evidence behind it. It does cost the linked floor
one, permanently — `projectOverview.md` already flags that as the real price of the citation habit.

## Not exercised

No migration (the column already existed) and **no APK** — server-side only. Nothing native,
offline-first, safe-area or gesture-related, so **no device smoke run is owed**. The production
backfill has not been re-run; the fix is forward-only, so days whose readiness stamp was already
erased stay erased until something re-stamps them.
