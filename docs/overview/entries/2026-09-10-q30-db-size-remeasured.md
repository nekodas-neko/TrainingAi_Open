# 2026-09-10 — the database shrank 46% while an entry projected it would nearly double (Q-30)

**PR:** `lane-a/q30-db-size-remeasure` · **Lane A** · docs only, nothing implemented.

## I ran the session-start checks late, and one of them mattered

CLAUDE.md's session-start ritual requires reading `error_events` and the database size. **I did
neither at the start of this session** — fourteen PRs in before running them. Recording that plainly
because the omission is the kind that costs nothing until it doesn't, and one of the two reads turned
out to change a queue entry's argument.

## `error_events`: nothing new

Nine signatures over seven days, all known:

- **`bf110 resume dom-intact …`** (client, 8 of 9) — deliberate instrumentation. BF-110's own entry
  says *"Check `error_events` for `bf110 resume` afterwards"*. Not faults.
- **`/api/oura-ble/samples#aggregate`** (server, 1 hit, 2026-09-03 08:04:43Z) — already recorded and
  diagnosed in full, down to the same timestamp and the same `Connection terminated due to connection
  timeout` cause chain inside the rollup worker.

Nothing owed a Known-Issues row, which is the outcome the ritual is supposed to be able to produce
and rarely gets stated.

## Database size: the finding

| when | `pg_database_size` | `oura_raw_samples` |
|---|---|---|
| 2026-07-21, post-REINDEX | 205 MB | — |
| 2026-08-08 | 421 MB | 306 MB / 881,603 rows |
| **2026-09-10** | **227 MB** | **75 MB / 195,769 rows** |

Q-30's 2026-08-08 note projected the database *"returns to the ~924 MB alarm level in roughly six
weeks whether or not [the console actions] run"*, and stated that **"only D4 or a retention policy
changes the direction."**

Four and a half weeks on it is **227 MB — down 46%, not up**, and the table blamed for 73% of the
total has lost **78% of its rows**. The packing work plus the retention window did what D4 was
projected to be needed for.

**What that does and does not settle.** It removes the *urgency*, not the decision. The owner's
stated reason for D4 was the multi-user ratio — ~36 GB/year for ten users server-primary against
~160 MB/year device-primary — and a shrinking single-user database says nothing about a ratio. The
entry now says so explicitly, because "the database is fine" is exactly the wrong lesson to draw and
the easy one.

**One number replaces the one that expired:** `oura_raw_samples` now carries **44 MB of index against
30 MB of heap**. CLAUDE.md's advice to read `total` *and* `idx` exists because the 2026-08-17 outage
was index and dead-tuple bloat with the payload unchanged, and an index larger than its table is
where that starts.

## Q-30 also gets a `Gate: owner`

Everything still open in it is D4 (a destructive server-raw drop) or a retention policy — data
deletion either way, and confirm-first by CLAUDE.md's rule. It was printing as ordinary READY work
while its own body said the remaining half is confirm-first. **Fifth field/prose mismatch this
session**, and the second I have fixed rather than fallen into.

**Not exercised:** no code changed. Both figures are from `/api/admin/db-query`;
`pg_stat_user_tables` is not row-scoped, so the sizes are the whole database, while the
`error_events` counts are the owner's rows only.
