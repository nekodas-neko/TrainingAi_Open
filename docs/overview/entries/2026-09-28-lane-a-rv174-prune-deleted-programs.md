# 2026-09-28 — RV-174: a deleted program or style now leaves the phone

Programs and progression styles are hard deletes with no `deleted_at`, and the sync delta carries
only rows whose `updated_at` moved. So nothing ever told a device a row was gone, and its read-only
mirror kept them forever. `assembleLocalActiveProgram` takes `find(isActive) ?? programs[0]`, so
after deleting active program A and activating B the mirror could hold two active programs.

## Why a roster rather than a tombstone

A `deleted_at` column is a migration plus a `claude_ro` regeneration, and both wait on BF-214. The
entry's other option, delete by absence, needs the delta to say what EXISTS, which it did not. Both
tables are tiny, so `getSyncDelta` now sends every id on every page, unwindowed and unpaged:
`programRoster` and `progressionStyleRoster`. A roster that stopped at a page boundary would delete
the rows it did not reach.

## What changed

- `lib/data/postgres/adapter.ts` / `repository.ts`: the two rosters on `SyncDelta`, user-scoped.
- `LocalStore.pruneProgramStructure` (`lib/local-store/sqlite-backend.ts`): deletes mirrored programs
  and styles not listed, with sessions, exercises, schedules, schedule days and style sets, and nulls
  a deleted style on the exercises that used it. The server's FK does the same (`ON DELETE SET
  NULL`) without touching the program, so no delta could ever carry it.
- `pullDelta` prunes after `applyDelta`. **An absent roster prunes nothing; an empty one prunes
  everything**, and the two must never be confused. The `programs` domain flag rises only when
  something was removed, so program caches are not invalidated on every sync.
- The mirror is read-only (nothing on the device creates a program), so no pending local row can be
  pruned.

## Verification

- Against a real in-memory SQLite (`node:sqlite`): deleting a program removes every child and leaves
  one active program; a deleted style loses its sets and leaves the exercise style-less; absent means
  no-op; empty means all; matching means no-op.
- `pullDelta`: roster passed through; absent → `undefined`, not `[]`; the flag rises only on a prune.
- DB-backed `getSyncDelta`: the roster names unchanged programs too, and nobody else's rows.
- **Mutation pass: 6 killed, 1 equivalent control survived.** Killed: roster built from changed rows
  only; roster not user-scoped; absent read as empty; flag not raised; deleted style left on the
  exercise; program sessions left behind.
- `sync-delta-connection-demand` and the LB-66 tombstone tests pass unchanged.
- `pnpm dev`: `/api/sync/pull` returned no changed programs and a roster naming the one program and
  one style.

## Not exercised

The device, where the pruning actually runs (`getLocalStore` is null on the web). A Known-Issues row
carries the S25 pass test.
