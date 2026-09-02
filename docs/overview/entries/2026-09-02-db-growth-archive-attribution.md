# 2026-09-02 — the database's growth is partly the archive the baseline predates

**Branch:** `claude/la-db-growth-archive` · **Agent:** Implementation Lane A · Docs only.

BF-55 asks for a re-read of the total (*"it has not been read since 2026-08-30"*) and for what is
adding ~2.5 MB/day beyond expectation. Both were done from production.

**The re-read: 200 MB**, down from BF-55's 206 because migration 249 landed on 09-01 and took the
21 MB `oura_heartrate_user_updated` with it. Verified rather than assumed — `oura_heartrate` now
carries exactly two indexes, the `(user_id, timestamp)` unique key at 84,909 scans and its primary
key.

**The attribution: the archive, and it must not be treated as a defect.** `oura_raw_packed` holds
1,072 rows / 18 MB, and its **first pack is dated 2026-08-18 — the same day as the 171 MB
baseline**. It has grown 18 MB in 15 days, about 1.2 MB/day, and it is never pruned because
`body_hex` is the archival source of truth. That is ~62% of everything the database has gained since
the baseline, and it means **the ~0.4 MB/day expectation cannot have included it**: the packing work
that produced the baseline created a new permanent writer on the same day, at a rate nothing had yet
observed. Part of the "7× trend" is an expectation that was never re-baselined against the archive it
made possible.

The design is working as intended. `oura_raw_samples` is a rolling window — `ring_timestamp_ds`
spans 7.58 days across 189,406 real rows at 73 MB — and the archive takes the overflow at roughly an
eighth of the raw size. Forward, that is ~440 MB/year of permanent archive on a 5 GB volume. The
remainder, ~0.7–1.7 MB/day depending on the window, is what BF-55 still owes, and the archive should
be excluded from the next attempt rather than counted again.

**Q-283 is stale by ~14× and probably wants closing, not implementing.** Its headline is
*"~11 MB of indexes have never served a scan"*. Its one real candidate is the 5.7 MB index BF-55
already dropped. What remains: 117 zero-scan indexes at 7,528 kB, of which all but **30 indexes /
800 kB** are primary keys and unique constraints the entry itself says must never be dropped. The
largest survivor is a 128 kB `db_query_log_created_at_idx`. That is 0.4% of the database, for a
destructive migration — so the entry is gated rather than struck, because closing it is a queue
decision.

One reading cuts the other way from how it first looks: `pg_stat_database.stats_reset` is **NULL**,
so the counters cover the database's lifetime, which makes "never scanned" *stronger* than the entry
assumes — and still does not make a constraint index droppable. BF-55's counter-example holds today:
`rr_intervals_pkey` read 0 on 2026-08-30 and reads 10,930 now.

**The estimator trap recurred, exactly as CLAUDE.md describes it.**
`pg_stat_user_tables.n_live_tup` reported **76** rows for `oura_raw_packed` against **1,072** from
`count(*)`, on a table whose `last_autoanalyze` is NULL — while the size columns in the same row were
exact. That is the reading that once produced a data-loss incident which had never happened.

**Also checked and needing nothing:** production `error_events` over 7 days holds four rows. Three
are `"SpeechRecognition.then()" is not implemented on android` (2026-08-27 → 08-30), and that fault
is **closed** — `getNativeSpeech()` returns `{ plugin }` rather than the proxy, with a regression
test and `scripts/check-plugin-proxy-thenable.js` enforced in the Custom Rules job. The other two are
`POST /api/oura-ble/samples` "aborted" on 08-30, a client disconnect mid-upload, which has not
recurred.

**Not exercised:** no code changed. Every figure is a production read through `claude_ro`; note that
`pg_stat_user_tables` and `pg_stat_user_indexes` are NOT row-scoped, so unlike the rest of that
schema these numbers are database-wide rather than the owner's only.
