## 2026-08-17 — the Q-536 migration rolled back on every boot, so the redecode rebuilt the same wrong times (v1.318.2)

The owner deployed v1.318.0, ran the full-history redecode as asked, and sent a screenshot of Health
still showing midday bedtimes — 10:45 am, 9:54 am, 12:30 pm.

**The redecode was not at fault. Migration 189 never applied.**

### How it was established

`/api/version` reported `1.318.0`, so the deploy had landed. Three reads settled the rest:

- `claude_ro.oura_ble_clock_anchors` still held **four epochs**, with epoch 3's p10 lag still
  ~14 h off epoch 2's. Nothing had been merged.
- `claude_ro.schema_migrations` topped out at **188** — 189 was absent.
- `oura_rollup_state` still read `epoch: 3`, and 189's last statement deletes that row. So the
  transaction had rolled back **whole**, not partially applied.

`ensureSchema` catches a failed migration, logs `[ensureSchema] FAILED`, records nothing, and
carries on — its own comment says such a file "is retried on every boot, which is why one of these
can print forever and still be real". It had been failing since the deploy.

### Cause

189 relabelled `oura_raw_samples` in the same transaction: **434,707 rows on the 667 MB table**, four
indexes. The pool sets `statement_timeout = 15s` (`lib/data/postgres/client.ts:39`).

Verified rather than assumed, through the exact execution path `ensureSchema` uses — one
`pool.query()` with the whole file text:

| what was run | result |
|---|---|
| pool at 15 s, `pg_sleep(20)` | `FAILED [57014] canceling statement due to statement timeout` |
| `SET LOCAL statement_timeout='60s'; pg_sleep(20);` | completed |
| `SET LOCAL statement_timeout='200ms'; pg_sleep(2);` | `FAILED [57014]` |

So the pool's limit does bite, and `SET LOCAL` genuinely overrides it inside the implicit
transaction of a multi-statement simple query — in both directions, which is what rules out it being
silently ignored.

**What went wrong in the making: the migration was verified against an 8-row fixture.** That proved
correctness and said nothing whatever about scale, on the largest table in the database. The local
test passed, CI passed, and neither could see the only property that mattered.

### The fix, and why it is a split rather than a bigger timeout

The two halves are not equally important, and that is what makes splitting them right rather than
merely convenient:

- **189** — merge the **anchors** (~5,400 rows) and drop the stale watermark. This is the entire
  repair: the offset every derived timestamp depends on comes from `oura_ble_clock_anchors`, via
  `currentEpoch(anchors)` and `robustOffsetMs(anchors)`.
- **190** — relabel `oura_raw_samples.epoch`. That column is written at ingest
  (`adapter.ts:4888`) and **read by nothing**. It matters only for a future per-row resolver, and
  leaving samples labelled 1/2/3 while every anchor says 0 would hand that resolver labels which
  disagree with the clock they index.

Both carry `SET LOCAL statement_timeout`. Separating them means the expensive, inert half can no
longer roll back the cheap, load-bearing one — if 190 times out on real data, 189 still stands and
the sleep times are still correct.

**190 introduced a hazard of its own, caught before it shipped.** It re-derives the mapping from the
anchors *after* 189 merged them, and the obvious re-derivation — `MIN(epoch) GROUP BY user_id` —
would also collapse a user whose epochs 189 deliberately left split, destroying a genuine re-key.
It now only touches users left with exactly one surviving anchor epoch, and skips anyone ambiguous.
Mutation-checked: removing the `HAVING COUNT(DISTINCT epoch) = 1` guard fails the re-key test.

Editing 189 in place is safe **only because it never reached `schema_migrations`**. That is not
licence to edit an applied migration — `ensureSchema` tracks by filename, so an edit to an applied
file never runs. Both files say so.

### Verification

Two new tests (7 total in the file): 189 alone repairs the clock, and 190 leaves a genuine re-key's
sample labels alone. Both migrations applied cleanly through `scripts/local-db/migrate.js`.
`npx tsc --noEmit` clean · full suite **478 files / 3,900 tests passed**, 2 files / 54 skipped.

### Still owed

⚠️ **The redecode has to be run again.** The one the owner ran against v1.318.0 could not have
worked — the migration under it had rolled back. Nothing about that run was wasted effort beyond the
time, and nothing was corrupted by it.

### Not exercised

- **Nothing was run against production.** The diagnosis is read-only over `claude_ro`; the fix is
  verified locally and by CI's clean-database migration job. **Nobody has yet seen a corrected sleep
  window** — that remains true from the previous entry and is the whole point of the re-run.
- **The 434,707-row UPDATE has never been executed at production scale.** 190's 30-minute budget is
  reasoned from the row count and the fact that `epoch` is in no index (so the updates are
  HOT-eligible), not measured. If it times out, it rolls back alone and costs nothing.
