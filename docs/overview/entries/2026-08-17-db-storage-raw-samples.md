# 2026-08-17 — DB storage: where the 464 MB actually is (planning session, docs-only)

One-off planning session started by the owner, not one of the five standing agents. **No code
changed.** Deliverable is a plan document, six backlog entries and one Known-Issues row.

**The question:** production is ~473 MB, `oura_raw_samples` dominates it, everything the owner reads
is a few MB. Should the database hold summaries while raw frames live on the device?

**What the measurement changed.** The premise that raw frames are the expensive thing is wrong by
roughly an order of magnitude. `body_hex` — the column `CLAUDE.md` protects absolutely, because a
decoder improvement can only back-fill by re-decoding stored hex — is **26 MB of the 360 MB table,
7.3%**. It averages 24 hex characters (12 bytes of real frame) stored at ~328 bytes/row: a **27×
overhead**. The rest is 208 MB of indexes and ~106 MB of row overhead, plus 20 MB of `event_name`
text that is a pure function of `tag`. So the archival rule protects the cheap part, and every
expensive part is reversible.

Consequently the growth split: the irreplaceable payload grows at **205 MB/year**, the table it lives
in at **2.7 GB/year**. That 2.5 GB is representation, not information — which is what makes a lossless
repack (one `bytea` blob per user/day/tag, delta-encoded timestamps) a real option at ~20× reduction,
giving up nothing. The current archival rule does not consider it.

**Two things established rather than assumed.**

The device's documented "14-day rolling window" **has not shipped.** `pruneRaw`, `markRolledUp`,
`getUnrolledRaw` and `rawStats` are all implemented in Kotlin and exposed on the plugin bridge, and
**nothing calls any of them**. Even wired, the prune needs `rolled_up = 1`, set only by the WebView
rollup consumer — D2 Task 5, not built. `oura_raw.db` has been unbounded since 2026-07-27. Nobody has
observed its size, because the admin console has no `rawStats()` panel. Separately,
`allowBackup="true"` with no extraction rules means Android Auto Backup's 25 MB quota cannot cover
that file — **the device raw store has no working backup**, which is load-bearing for D4.

Also surfaced: the 2026-08-02 retention decision justified the 14-day device tier explicitly *because*
the server keeps `body_hex` forever. D4 removes that premise, so the device tier would have to become
full-history (~1.2 GB/year, un-backed-up). No existing doc reconciles the two.

**`error_events` (49 MB) resolved cleanly and is not what it looked like.** The 30-day prune runs
correctly — the owner's oldest row is exactly 31 days old. 5,771 of the owner's 6,222 rows are a
single fault, the `oura_heartrate` `cardinality_violation` **already fixed by Q-214 on 2026-08-13**,
last seen that same day. Per the "stopped ≠ fixed" rule this was checked rather than assumed; here it
genuinely was fixed, and the space clears itself by ~2026-09-12. What survives as a finding is why one
bug cost 49 MB: the dedupe key is the raw message, Drizzle embeds the whole generated `VALUES` list in
it, so a different batch size is a different key — **5,771 rows, 18 distinct messages, 1 distinct
60-character prefix**, dedupe bypassed 18-fold.

**Method note worth keeping:** `pg_stat_user_tables` / `pg_stat_user_indexes` are reachable through
`/api/admin/db-query` and are **not** row-scoped — they give system-wide sizes and lifetime scan
counts, unlike every `claude_ro` view. `pg_stat_database.stats_reset` is `NULL`, so a "0 scans"
reading means never.

**Filed:** Q-530 (device store unbounded) · Q-532 (index audit, 106 MB / 5,129 lifetime scans) ·
Q-531 (error dedupe) · Q-533 (row narrowing) · Q-534 (frame repacking) · Q-535 (**owner decision** —
two of the five options are one-way doors). Q numbers taken as a block 530–539 from the unallocated
pointer, recorded in the band table, pointer bumped to 540; `docs/agents/README.md` now states how a
non-standing session claims a block.

**Deliberately not done:** no option was chosen. Options D and E permanently give up re-decoding, and
E additionally gives up the D3 rollback and leaves raw history single-copy on an un-backed-up phone.
That is the owner's call.

**Failure surfaces not exercised:** measurement and planning only — nothing ran on the device, and the
device findings are static analysis (grep for callers, the prune predicate, the manifest). The real
size of `oura_raw.db` on the S25 remains unobserved.
