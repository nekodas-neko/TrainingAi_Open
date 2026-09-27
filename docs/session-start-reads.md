# The three session-start production reads — the queries, and every trap in them

Three reads run at the top of a session against `/api/admin/db-query`: **`error_events`**,
**`feedback_submissions`** (BugFix's, with the Orchestrator as backstop), and the **database size**.

`CLAUDE.md` carries the instruction to run them and the one-line consequence of each. **This file
carries the evidence** — the measurements, the corrections and the traps that have each cost a
session. Read it when a number here looks wrong, when you are about to draw a conclusion from one of
these reads, or when you are working on retention or storage. It was split out 2026-09-27 (OR-189)
because it was 11,347 characters of the ~33,000 that every session pays automatically, and most of
it is *why*, not *what*.

**The rules stay in `CLAUDE.md` and are not repeated here as rules** — this is the working behind
them.

---

- **Also at session start, read `error_events` in production** — it is the only view of faults that never reach a human. **It DOES prune at 30 days — the 2026-09-01 amendment claiming otherwise was wrong and is retracted (BF-93).** The `DELETE` is in `insertErrorEvent` (`lib/data/postgres/adapter.ts`), throttled to once a day by the shared `shouldPrune`, and it has been there since the initial public snapshot. **The evidence that convinced a session otherwise is what a working prune looks like:** a prune fired from a write path only runs when something is written, and errors are now rare, so the oldest row ages past 30 days between faults. Measured 2026-09-01 — last write **2026-08-30**, oldest row **2026-07-31**, span **exactly 30 days**, matching the cutoff computed from the last write to the day. Reading "oldest row is 32 days old" against *today* rather than against the *last write* is what produced the false finding. So: read the table early, because a fault that stops on its own goes unnoticed and then expires. The table is the second-largest object in the database at 52 MB — **and that 52 MB is BLOAT, not payload; the earlier reading of it as "30 days of retained payload rather than unbounded growth" is corrected here (RV sweep 50, 2026-09-18).** Measured that day: **12 MB heap + 39 MB TOAST + 752 kB index behind 115 live rows.** The figure was written when the table held 7,331 rows, and the prune removed the rows without reclaiming the space. So the size is real and the *conclusion* drawn from it was not: a 52 MB `error_events` is not evidence that faults are being retained, and shrinking it is a `VACUUM FULL`/rewrite question, not a retention question. The first read of that table (2026-08-04) found three faults, **two of which had already stopped before anyone looked**. One query via the admin endpoint:
  ```
  curl -sX POST https://trainingai-production.up.railway.app/api/admin/db-query \
    -H "Authorization: Bearer $CLAUDE_DB_QUERY_SECRET" -H 'Content-Type: application/json' \
    -d '{"sql":"SELECT url, source, left(message,120) AS message, count(*) AS hits, max(created_at) AS latest FROM claude_ro.error_events WHERE created_at > now() - interval '"'"'7 days'"'"' GROUP BY 1,2,3 ORDER BY hits DESC LIMIT 30"}'
  ```
  Anything new gets a Known-Issues row in [`docs/overview/known-issues.md`](overview/known-issues.md) or a backlog entry the same session — per **No orphaned findings**, a fault you saw and did not record is a dropped finding. *Something that stopped is not something that was fixed*: record it as unexplained rather than closed.
- **BugFix reads the in-app reports at session start; the Orchestrator does too, as a backstop** — *Report an Issue* on
  `/more` writes to `feedback_submissions`, and the read is one query on the same endpoint:
  ```
  curl -sX POST https://trainingai-production.up.railway.app/api/admin/db-query \
    -H "Authorization: Bearer $CLAUDE_DB_QUERY_SECRET" -H 'Content-Type: application/json' \
    -d '{"sql":"SELECT id, type, title, description, created_at, screenshot_bytes FROM claude_ro.feedback_submissions ORDER BY created_at DESC LIMIT 25"}'
  ```
  **The capability has existed since migration 142 and nobody was using it.** The loop is **read →
  review → file a backlog entry at the right priority with a lane → move the watermark** in
  `docs/agents/state/orchestrator.md`, which is what stops the same report being re-read forever
  (owner decision 2026-09-23: a watermark, deliberately no status column and nothing the reporter
  sees in the app). A report is never answered by replying to it — it becomes a queue entry, or it
  is recorded as not-a-defect with the reason, per **No orphaned findings**.
  **⚑ BUGFIX MONITORS GITHUB — issues AND inbound pull requests, one watcher, owner's instruction 2026-09-27 (OR-185).** At session start it reads `list_issues` (OPEN) and `list_pull_requests` (open), and handles everything not authored by the agent account. An **issue** it triages itself, same loop as the in-app feedback above. An **inbound PR** it hands to Review with `Lane:` for the diff read — **BugFix watches, Review reads the patch, and neither merges one**: outside code entering the app, with the auth/storage carve-outs live. A channel with two watchers is one where each assumes the other looked, which is why the watching is BugFix's alone. **REVIEW COMMENTS GO ON THE PR, AND ARE VERY CONCISE — no fluff** (owner, 2026-09-27): no preamble, no praise, no restating what the PR does; one finding per comment, naming the problem, the fix and the `file:line` or rule that makes it one; *"no issues found"* is one line. **This was a real gap, found by a collaborator rather than by us** (*"it's also not picking up the issues and PRs I raise"*): `#1620` sat two days unreferenced, `#1607`/`#1608` were caught only sideways by `TN-80`. **The CI/CD section below is written for OUR OWN PRs**, which is why an inbound one had no reader. Details: `docs/agents/README.md`.
  **Two things this read cannot tell you.** The view is **row-scoped to the owner**, so a zero means
  *none of the owner's*, never *nobody has reported anything*. And **`screenshot_bytes` is a size,
  not an image** — the view withholds `screenshot_data`, so a UI bug arrives with its most
  informative half missing (`OR-137`).
- **Also at session start, read the database size** — one query, same endpoint, beside the `error_events` read:
  ```
  curl -sX POST https://trainingai-production.up.railway.app/api/admin/db-query \
    -H "Authorization: Bearer $CLAUDE_DB_QUERY_SECRET" -H 'Content-Type: application/json' \
    -d '{"sql":"SELECT relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) total, pg_size_pretty(pg_relation_size(relid)) heap, pg_size_pretty(pg_indexes_size(relid)) idx FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10"}'
  ```
  **`pg_stat_user_tables` is NOT row-scoped** — unlike every `claude_ro` view it reports physical sizes and
  lifetime counters for the whole database, so these numbers are complete rather than "the owner's, recently".
  **But its SIZE columns and its ROW columns are not equally trustworthy, and conflating them cost a
  session (2026-08-19/20).** `pg_total_relation_size`/`pg_relation_size`/`pg_indexes_size` are read from
  the filesystem and are exact. **`n_live_tup`/`n_dead_tup` are planner ESTIMATES** maintained by
  autovacuum and `ANALYZE`, so they can be arbitrarily stale. Measured 2026-08-20: `n_live_tup` read
  **0** against `oura_raw_packed`'s **764** real rows, and **1** against an `oura_daily_summary`
  holding **45** — the latter was filed as a data-loss incident (Q-528) that had never happened.
  **⚠ The reason this line used to give — that `last_analyze`/`last_autovacuum` are "NULL on every
  table" — was true on 2026-08-20 and is FALSE now (BF-106, 2026-09-01), which makes the rule more
  dangerous rather than less.** Autovacuum and autoanalyze do run on the high-churn tables:
  `oura_raw_samples` autoanalyzed at 20:17 that day and its `n_live_tup` of **191,454** matched
  `count(*)` exactly. Coverage is **partial**, not restored — `oura_raw_packed`, which autoanalyze has
  not reached, still read **55** against **1,051** real rows in the same query. So an accurate reading
  on one table is no evidence about the next one, and nothing in the output tells you which side a
  table is on. **To ask whether a table is empty, run `count(*)`;** where the worry is that a `claude_ro` view hides other users' rows, write the
  finding as "none of the owner's" rather than reaching for a counter that cannot see them either.
  **Baseline: 171 MB total on 2026-08-18**, after the packing work took `oura_raw_samples` from 563 MB to
  50 MB. Growth was stated as ~0.4 MB/day; **measured 2026-09-18 it is 1.71 MB/day against a 224 MB total** (RV sweep 50), and re-measured **2026-09-20 at 227.4 MB — 1.71 MB/day on both the 2-day and the 33-day baseline**, so the rate is stable rather than accelerating. That ~0.4 figure is wrong and the conclusion it supports is right: the growth is bounded, attributed, and **not yet at its floor**.
  **⚠ The steady-state claim in this paragraph was wrong and is corrected here (BF-55, 2026-09-20).** It said `oura_heartrate` "spans 88 days against its ~90-day window (steady state)". **The 90-day window belongs to `rr_intervals`. `oura_heartrate` prunes at 180** (`HR_RETENTION_DAYS`, `slices/oura.ts`) — so at a measured span of **90.6 days it is half-filled and has never reclaimed a row**, and `rr_intervals` at 60 of 90 has not either. Both tables offered as evidence of steady state are still filling, which is the whole of the "7× trend" BF-55 chased for three weeks: **a window that has not reached its cap reclaims nothing and grows at the full ingest rate**, and the ~0.4 MB/day expectation implicitly assumed a steady state that had not arrived.
  Attribution, measured 2026-09-20 — `oura_heartrate` 33 MB/90.6 d = **0.36**, `rr_intervals` 23 MB/60 d = **0.38**, `oura_raw_packed` (the permanent archive, which must NOT be "fixed") 24 MB/33.4 d = **0.72**; that is **1.47 of the 1.71 MB/day**, leaving 0.24 for small tables and index growth. `oura_raw_samples` really is at steady state — 7.4 days under a 31-day cap, the packer reclaiming.
  **So the falsifiable prediction, which is what to check rather than a narrative:** total growth should STEP DOWN twice — around **late October** when `rr_intervals` hits 90 days, and around **2026-12-19** when `oura_heartrate` hits 180 (its oldest row is 2026-06-22) — settling near **~0.96 MB/day**. A step that does not arrive is the signal. Until then, **compare against ~1.7 MB/day, and treat a departure from the SHAPE — a window that stops reclaiming — as the thing to act on rather than the daily figure alone.** Anything materially above that trend gets a Known-Issues row the
  same session.
  **This check exists because nothing else will tell you.** Storage is billed on *use*, not provisioned size
  (Railway: *"only charged for the amount of storage used"*), at **$0.15/GB/month** — so even the 805 MB peak
  during the 2026-08-17 `disk_full` outage cost about **twelve cents a month**. **Cost will never warn you
  about a storage problem here.** What used to warn was the 500 MB volume hitting `disk_full`; the volume is
  now 5 GB and cannot be shrunk back (Railway does not support down-sizing), so that tripwire is gone and this
  read replaces it. Read `total` **and** `idx` — the 2026-08-17 outage was 306 MB of *index and dead-tuple
  bloat* from a non-HOT re-stamp, with the live row count going **down** and the payload unchanged, so a
  size jump is at least as likely to be bloat as data.
  **What this query can and cannot tell you (2026-08-09 — this trap was walked into):** `claude_ro.error_events` is **row-scoped to one user**, like every `claude_ro` view. A read that returned **383 rows** was against a table holding **7,331**. So every count from this endpoint is *the owner's faults only*, on top of the 30-day prune — two separate floors stacked. Write findings as "nothing else **of the owner's**", never "nothing else is failing"; the second is a claim about other people's accounts that this endpoint structurally cannot support. When a count needs to be system-wide, `pg_stat_user_tables.n_live_tup` gives the real row total without exposing anyone's rows.