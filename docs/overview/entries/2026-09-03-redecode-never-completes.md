# 2026-09-03 — the full-history redecode has not completed since 2026-08-17 (LA-56, LB-53)

**Branch:** `fix/redecode-never-completes` · docs-only, two measurements against production.

## LA-56 — "abandoned" was an inference; it is now a measurement

The entry hedged for a good reason: `reapStaleRedecodeJobs` is a pure `started_at` age check with no
heartbeat, so a job reaped at 30 minutes might have been slow rather than dead. Production settles it
without any instrumentation, because of a property of the write path nobody had used as evidence:

**`replaceOuraDailySummary` is `DELETE` every row + `INSERT` every row, in one transaction.** A
completed full-history pass therefore leaves all 59 rows sharing **one** `created_at`.

| reading, 2026-09-03 08:35Z | value |
|---|---|
| `min(created_at)` on `oura_daily_summary` | **2026-08-17 07:50:31Z** |
| distinct `created_at` stamps across 59 rows | **17** |
| `max(updated_at)` | 2026-09-03 06:59:31Z — before the 08:00 attempt began |

Seventeen stamps means the table has been assembled night by night by `upsertOuraDailySummary` ever
since. So the last full-history redecode that completed is the one Q-535 measured on **2026-08-17**.
Since then: **three attempts, three nothings** — the async jobs of 08-30 and 09-03 03:00, both reaped
at exactly the staleness window with no rows written, and the owner's **synchronous** run at ~08:00
on 09-03, which had written nothing 35 minutes later.

### What this retires

The synchronous path was the documented workaround, on the strength of Q-535's own note that it
completes behind the 502. **That note was true on 2026-08-17 and is not true now.** Both LA-56 and
`projectOverview.md`'s **Waiting on the owner** row told the owner to run it "once only"; both now say
not to run it at all until this is diagnosed. Sending someone to a workaround that silently does
nothing is worse than having no workaround, because the 502 reads the same either way.

### The lead, stated as a lead

The regression window is one day wide. Last success **2026-08-17**; the packing work landed
**2026-08-18** — `oura_raw_packed`'s first pack carries that date, and Q-541 Task 7 made
`measured_at`/`event_name` derived the same day, removing the row-walk that used to dominate. So the
re-aggregate now reads a store that did not exist when it last succeeded.

That is a correlation across a model change, which is exactly the trap `docs/data-layer-rules.md`
names. Nothing here has profiled anything. **The next step is a measurement, not a fix** — phase
timings behind the existing job row, or a run against a copy — and it is still unknown whether the
process is alive and slow or simply dead. Distinguishing those two is the heartbeat LA-56 already
owes, which this makes the more valuable half of that entry rather than the optional one.

## LB-53 — stale, not absent

The entry named one thing to measure first: during the nine-day gap with no writes, did those days
hold a **stale** score or **no row at all**? `created_at` answers it. Rows run one per day, each
created the morning after the night it describes — 08-22 created day 08-23, 08-23 created 08-24,
unbroken through 09-02 creating 09-03, with a single catch-up of 5 rows on 08-17.

**Nothing was ever missing.** A row exists from the morning after and then holds its first value until
a bulk pass rewrites it. That is the less alarming of the two failure modes: no screen was blank, but
a screen could show a days-old score — which, as the entry says, makes Q-529's client-side marking
more load-bearing rather than less.

Two corrections to the entry while there:

- **The "four stamps in the whole history" table is a stale snapshot.** Today there is a bulk pass at
  07:00:15Z rewriting ~30 days in a ~50 ms burst *and* a single-row write at 08:00:09Z for that day
  only. Both cadences exist. Re-read the stamps before building on them.
- **The deploy hypothesis is not confirmed.** The 21:55 pass landing minutes after #827 is one
  coincidence; today's 07:00:15 bulk pass lines up with no merge (#838 landed 07:49). Establish the
  trigger before designing around it.

## Not verified

Everything above is read through `claude_ro`, which is **row-scoped to the owner** — these are one
user's rows. Nothing was run on a device, and no code changed in this PR.

## Addendum, same session — the root cause was in `error_events` all along

The session-start ritual read (`error_events`, last 7 days — five groups total) turned up a live
fault **four minutes after the owner's 08:00 attempt**:

```
url:     /api/oura-ble/samples#aggregate
at:      2026-09-03 08:04:43Z
message: Failed query: select "started_at", "completed_at" from "workout_sessions" …
           caused by: Connection terminated due to connection timeout
           caused by: Connection terminated unexpectedly
stack:   at Worker.<anonymous> (/app/.next/server/chunks/1706.js)
```

`at Worker.<anonymous>` places it inside the rollup worker thread. The **only** other fault ever
recorded at that url is **2026-08-17 11:33** — same cause chain, hours after the last full-history
pass that ever completed. Two points, both bracketing the regression window this PR identified from
the other direction.

**The diagnostic exists because someone already fixed the blind spot.** `rollup-worker-entry.ts`'s
`msg()` walks the `.cause` chain precisely because on 2026-08-17 a redecode failed three times and
all that survived was the SQL text — a `DrizzleQueryError`'s message is only `Failed query: <sql>`.
Without that walk, this would still be a guess.

**Two candidate mechanisms; this does not choose between them.** Either the worker's event loop is
blocked long enough decoding ~1M samples that the pg client's socket is dropped (`Connection
terminated unexpectedly` is that shape — a statement timeout reports as *canceling statement*), or
it is pool self-contention (`connectionTimeoutMillis: 5_000` against `max: 10`, and the worker
carries its **own** Pool, since a worker thread has its own module registry).

**Ruled out: the Postgres server.** `max_connections` 500, 11 in use. Client-side, our own pool.

**What it changes about the fix.** LA-56's heartbeat would correctly report the run as dead rather
than stale, which is worth having — but it treats the symptom. The pass dies on ceilings a
whole-archive walk cannot respect. ⚠ Those ceilings are load-bearing: `CLAUDE.md`'s pool section
records that the timeouts and the error handler both took production down in session 165, so the
direction is to make the pass fit them (chunk the read, release between chunks), not to raise them
for every caller.

**Still open:** which of the two mechanisms. That wants a timed run.
