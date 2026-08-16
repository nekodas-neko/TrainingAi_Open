# 2026-08-02 — the local SQLite store failed to open cleanly on every launch (Q-37)

**PR:** #988 · **Branch:** `fix/local-sqlite-init-recovery` · **Version:** 1.249.6

## What was wrong

Three faults compounding on every launch of the owner's S25, all in `lib/sqlite/sqlite-service.ts`.

**WAL had never been enabled.** `PRAGMA journal_mode=WAL` *returns a row*, and it was going through
`execute()`, which cannot return rows. The call threw every time and was swallowed by a
`console.warn`, so every write has been slower and more lock-prone than intended for as long as this
shipped.

**The v13 upgrade was retried forever.** `ALTER TABLE mutations_outbox ADD COLUMN attempts` fails
with `duplicate column name` on a partially-applied version. The fallback reopened at version 1 but
never wrote the version back, so the same poisoned upgrade ran, failed and fell back on every
launch.

**A leaked registration was misdiagnosed.** `CreateConnection: Connection trainingai already exists`
came from the *first* `createConnection` — a registration left behind by an earlier init attempt,
not an upgrade fault — and landed in the upgrade-fallback arm.

Plus the reporting: `applyDelta` sat outside `pullPage`'s try, so a device-side schema fault
propagated into a bare `.catch(() => null)` and surfaced as the same generic "Sync failed" toast as
a network failure. That is why this stayed invisible.

## What shipped

WAL via `query()` with the resulting mode checked. Stale registration closed before opening.
`reconcileSchema()` returns whether it fully succeeded, and `user_version` is stamped forward
**only on a clean reconcile** — stamping a partial one would retire the repair path with work
outstanding. `applyDelta` failures caught, logged, and returned as a failed page so the existing
backoff applies. Backoff windows get their own toast copy.

## Decisions worth not re-litigating

**The backoff check is sampled before the sync calls, not after** (the plan said after). A genuine
first-page pull failure *sets* `pullBackoffUntil` itself, so reading it afterwards would relabel
every real failure as "backing off after an earlier error" and make the failure branch unreachable.

**The `RECONCILE_COLUMNS` mirror test became load-bearing.** Stamping the version forward retires
the versioned upgrade path, so any `ALTER`-added column that test misses would never be applied
again. It already existed and passed; it was case-sensitive, so it is now case-insensitive. All 146
`ADD COLUMN` statements in the tree are uppercase today — the flag guards the future.

**The earlier "hold until device-verified" recommendation was withdrawn, and it was wrong twice
over.** It was circular: the APK is a WebView loading from Railway, this PR is pure TypeScript, so
merging *is* how the code reaches the device — there was nothing to sideload. And the downside was
overstated: the K4 dead-store guard means a failed open falls back to the online API path with a
banner, so the worst case is online-only operation, not lost writes.

## ⚠️ Still unverified on device

The `projectOverview.md` Known-Issues row **stays until someone checks on the S25**:

- `PRAGMA journal_mode` actually reports `wal`
- the v13 upgrade no longer fails on launch
- `user_version` stamped to 21 after one clean run
- no `Connection trainingai already exists` on a cold start

None of this executes under `pnpm dev` (`initSQLite` early-returns without the Capacitor plugin),
and this file has silently killed the local DB twice before (#27, #85). Do not strike the row on
intent.

## Process note

The post-merge bookkeeping for the *previous* PR (#987) was skipped — merged without the journal
entry or version bump `CLAUDE.md` requires *before* the merge fires. Caught only because a
scheduled check-in happened to restate it, and corrected in #989. With self-merging there is no
human beat to catch this; the rule exists precisely because it is easy to skip.
