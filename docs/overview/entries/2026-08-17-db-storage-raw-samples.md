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

## Mid-session: it became an incident, and the diagnosis changed

Production hit `[pg 53100] disk_full` at ~07:42 UTC while this was being written. **The volume was
500 MB, not the 1 GB the code comment claimed** — the check I had flagged as needed was the right
instinct, and the figure was wrong by 2× in the dangerous direction. At the 464 MB measured hours
earlier the database was already at 93% of capacity; the runway was hours, not 60 days.

**The cause was not growth.** Re-measured 22 minutes after recovery, `oura_raw_samples` had gone
360 MB → 666 MB while live rows went **down** by 557 and `body_hex`/`event_name` did not move at all.
`n_tup_ins = 0`, `n_tup_upd = 681,005`, `n_tup_hot_upd = 0` — a full-table `measured_at` re-stamp,
non-HOT by construction because `measured_at` is indexed, so each update rewrote a heap tuple plus an
entry in all four indexes. All four roughly doubled in step.

**It is not the Q-46 bug**, and saying so mattered: that `IS DISTINCT FROM` guard is present and
working. It can only skip a re-stamp writing back the same value, and the Q-71/I25 clock correction
changed every row's derived value, so nothing could be skipped. The operation was legitimate — which
is the actual finding: **this table cannot be re-stamped without roughly doubling, and the operations
manual prescribes exactly that as the remedy for five separate failure modes.**

Two things only visible after the incident. Dropping `idx_oura_raw_samples_user_measured` is not just
a space win — `measured_at` is the only *indexed* column a re-stamp changes, so removing that index
makes a full re-stamp **HOT-eligible**. And repacking removes the operation entirely, because a packed
table stops storing `measured_at` per frame at all.

**The answer to "does the non-destructive half alone reach 500 MB" is yes, and nothing irreversible is
needed.** `VACUUM FULL` reclaims ~306 MB to ~465 MB; the index audit and row narrowing reach ~260 MB.
The distinction worth keeping: *reaching* 500 MB and *holding* it are different. `VACUUM FULL` alone
re-crosses it in ~5 days, A+B in ~7 weeks, repacking in ~3 years. So repacking is load-bearing under
the owner's 500 MB target, not optional polish — and it is non-destructive, so it costs no capability.

**Owner decisions recorded:** A+B+C (no D, no E); D4 stays the destination with no deadline, which
lapses O1 and unblocks the `bytea` work; stock 500 MB is the target, not the temporary 5 GB;
visibility-first on the device store. Q-536 filed at the top of the queue for the incident; the queue
re-ranked around it.

## The repack got its own implementation plan

`docs/superpowers/plans/2026-08-17-oura-raw-frame-packing.md`. The retention doc costed the option;
this one answers the three questions an implementer would hit on day one.

**The design decision that matters: two tiers, not an in-place repack.** `oura_raw_samples` and the
whole ingest path are left exactly as they are for a 7-day hot window, and a new `oura_raw_packed`
holds everything older as sealed blobs. The cursor path is the one thing here that must never break —
a botched change loses drained spans forever — so it takes no new failure mode at all, the dedup key
never moves, and cold blobs are append-only and therefore cannot bloat, which is precisely what the
current table lacks.

**The bucket key is `(user_id, epoch, tag, ring_timestamp_ds/864000)` — ds, never a calendar day.**
Wall time is derived through anchors and that derivation changes; a calendar-day partition would need
re-partitioning on every clock correction, reintroducing the failure this removes. `epoch` is
load-bearing and the data proves it: the four epochs' ds ranges overlap heavily. Establishing that also
surfaced a latent issue — the existing unique constraint omits `epoch` — filed as Task 0 to rule out
rather than asserted as a live bug.

**Measured: 968 blobs replace 1,098,956 rows, 1,135×.** 22.5 blobs/day, 13 MB of payload for all
history, projected steady state ~70 MB. Better than the ~50 MB table estimate in the retention doc's
§6 C, which was arithmetic rather than measurement.

The reads turned out to be the easy part: nearly every one is already
`user_id + tag IN (…) + ds BETWEEN … ORDER BY ds`, so the two-tier reader is one shared helper.

**Failure surfaces not exercised:** measurement and planning only — no code changed, nothing ran on
the device, and the device findings are static analysis (grep for callers, the prune predicate, the
manifest). The real size of `oura_raw.db` on the S25 remains unobserved. **The `VACUUM FULL` has not
been run and the re-stamp was still in progress at last measurement** — every post-vacuum figure here
is projected from the pre-incident measurement at the same row count, not observed.
