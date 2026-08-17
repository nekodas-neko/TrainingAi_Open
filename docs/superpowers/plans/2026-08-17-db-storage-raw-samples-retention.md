# Database storage — where the 464 MB actually is, and what each way of shrinking it forecloses

_Planning session, 2026-08-17. **No implementation.** This document exists to put an owner decision
on solid numbers. It deliberately does **not** pick an option: the irreversible ones are
irreversible, and a wrong call cannot be walked back._

**The question as posed:** the production database is ~473 MB, `oura_raw_samples` is most of it, and
everything the owner actually reads is a few MB. Should the database hold calculated summaries while
raw frames live on the device?

**The short answer:** the premise that raw frames are the expensive thing is **wrong by roughly an
order of magnitude**, and it matters, because the archival rule in `CLAUDE.md` protects exactly the
cheap part. The frames themselves are **26 MB**. The table they live in is **360 MB**. Moving raw to
the device is a 360 MB win of which only 26 MB is unavoidable — and it is the 26 MB that can never be
recovered. Every other option on the table gets most of the space back and gives up nothing.

---

## 1. What was measured, and how far it generalises

All figures from production on **2026-08-17** via `POST /api/admin/db-query`.

Two different scopes are mixed below and the difference matters:

- **`pg_stat_user_tables` / `pg_stat_user_indexes` / `pg_class` are NOT row-scoped.** They report
  physical sizes and row estimates for the whole database, every user included. Table sizes, index
  sizes and `idx_scan` counters in this document are therefore **system-wide and complete**.
  (`pg_stat_database.stats_reset` is `NULL`, so the scan counters are lifetime totals, not a recent
  window — a "0 scans" reading means never, not "not lately".) This is a useful discovery for future
  sessions: the 30-day / one-user ceiling on `claude_ro` does not apply to the catalog views.
- **Anything selected from a `claude_ro.*` view is the owner's rows only, and only the last 30 days
  where that table prunes.** Per-column byte totals below come from those views and are written that
  way.

For `oura_raw_samples` the distinction turns out to be immaterial: the owner holds **1,098,005** rows
against a system-wide estimate of **1,098,183** — 99.98%. For `error_events` it is very material: the
owner holds **6,222** of **13,196** rows, so owner-scoped byte totals there are roughly half the real
figure and are labelled as such.

### The database, top to bottom

| Table | Total | Heap | Indexes | TOAST | Rows (system-wide) | Share |
|---|---:|---:|---:|---:|---:|---:|
| `oura_raw_samples` | **360 MB** | 152 MB | **208 MB** | 8 kB | 1,098,183 | 77.6% |
| `error_events` | **49 MB** | 12 MB | 1.1 MB | **36 MB** | 13,196 | 10.6% |
| `oura_heartrate` | 32 MB | 6.7 MB | **25 MB** | 8 kB | 61,353 | 6.9% |
| `rr_intervals` | 11 MB | 4.5 MB | 6.6 MB | 8 kB | 53,044 | 2.4% |
| *all 79 other tables combined* | **12 MB** | — | — | — | — | 2.6% |
| **Total** | **464 MB** | | | | | |

The owner's read-path tables are as small as expected — `sleep_sessions` 296 kB, `set_logs` 408 kB,
`body_metrics` 264 kB. Four device-telemetry tables are 97.4% of the database.

---

## 2. Finding 1 — the archival payload is 7% of the table that exists to hold it

`CLAUDE.md` protects `oura_raw_samples.body_hex` absolutely: never pruned, never mutated, because the
ring's history buffer is finite and the sync cursor only moves forward, so a decoder improvement can
only back-fill by re-decoding stored hex. That rule is sound and this document does not challenge it.

What the rule costs, measured:

| Component | Owner-scoped total | Per row | Share of the 360 MB |
|---|---:|---:|---:|
| **`body_hex`** — the irreplaceable part | **26 MB** | 25.1 B | **7.3%** |
| `event_name` — text, 30 distinct values, derivable from `tag` | 20 MB | 18.8 B | 5.6% |
| `decoded` (JSONB) | **0 rows non-null** | 0 | 0% |
| Fixed columns + tuple headers + item pointers | ~106 MB | ~97 B | 29.4% |
| **Indexes** | **208 MB** | ~190 B | **57.8%** |

`body_hex` averages **24 hex characters — 12 bytes of actual ring frame.** The database spends
**~328 bytes per row** to store 12 bytes of irreplaceable data. That is a **27× overhead**, and it is
the single most important number in this document.

### Where the 208 MB of indexes goes

| Index | Size | Lifetime scans |
|---|---:|---:|
| `oura_raw_samples_user_id_ring_timestamp_ds_tag_body_hex_key` (dedup) | 78 MB | 435,531 |
| `oura_raw_samples_user_tag_ts` | 60 MB | **1,789** |
| `idx_oura_raw_samples_user_measured` | 46 MB | **3,340** |
| `oura_raw_samples_pkey` | 24 MB | 310,053 |

The dedup unique index is load-bearing — it is what makes re-sends free (ops-doc I8) — and it is
expensive precisely because it includes `body_hex`. The other two are **106 MB carrying 5,129 lifetime
scans between them**. `user_tag_ts` in particular was built for the per-tag read pattern that Q-213 /
I19 **deliberately removed** when it collapsed the rollup's ten tag reads into one partitioned-in-memory
query. That index may now be paying rent on a query shape that no longer exists.

> This is a lead, not a conclusion. Dropping an index needs a query-plan audit against the rollup,
> redecode and admin-tester read paths first. But 106 MB — 29% of the largest table in the database —
> for 5,129 lifetime scans is worth an hour of `EXPLAIN`.

### What this does to the growth forecast

Measured over the last 14 complete days: **22,910 rows/day** (range 13,044–29,265), **~560 kB/day of
`body_hex`**, **~7.5 MB/day of table**. The 41-day average is higher (26,143 rows/day) because the
Lever 2 tag whitelist (`lib/oura-ble/raw-storage.ts`) stopped persisting ten telemetry/debug tags
partway through; the 14-day figure is the forward-looking one.

| | Per day | Per year |
|---|---:|---:|
| `body_hex` — the part that cannot be regenerated | 560 kB | **205 MB** |
| The table it is stored in | 7.5 MB | **2.7 GB** |

**The irreplaceable data grows at 205 MB/year. The table grows at 2.7 GB/year.** The 2.5 GB difference
is representation, not information.

### The deadline is real even though the framing was wrong

`lib/observability/request-error.ts` records the Railway volume as **1 GB** in a code comment. At
464 MB and ~7.5–8.7 MB/day, that ceiling arrives in **roughly 60–70 days — late October 2026**. The
urgency in the owner's instinct is correct; only the target is misidentified.

> **Owner check needed:** confirm the 1 GB figure. It is a code comment, not a measurement, and every
> deadline in this document depends on it.

---

## 3. Finding 2 — the device is not an archive, and today it is not a 14-day window either

The prompt's premise was that the device store is "a deliberate 14-day rolling window, not an
archive". The 14-day window is a **documented decision that has not shipped**. What is actually on
`main`:

`OuraRawDb.kt` implements `pruneRaw(olderThanMs, reserveBytes)`, `markRolledUp`, `getUnrolledRaw` and
`rawStats`. All four are exposed as Capacitor `@PluginMethod`s and declared in the TypeScript
interface at `lib/oura-ble/plugin.ts:90-99`.

**Nothing calls any of them.** A repo-wide grep for `pruneRaw` and `markRolledUp` outside
`plugin.ts`'s own interface declaration and the Kotlin definitions returns nothing.

Two independent reasons the device store is unbounded today, and the second survives fixing the first:

1. **No caller.** `pruneRaw` is never invoked, so no pruning happens at all.
2. **Nothing to prune even if it were.** The predicate is
   `rolled_up = 1 AND synced = 1 AND measured_at IS NOT NULL AND measured_at < ?`. `rolled_up` is set
   only by `markRolledUp`, which is called only by the WebView rollup consumer — **D2 Task 5, which
   is not built**. Every row on the device therefore has `rolled_up = 0`, and the prune would delete
   zero rows if it were wired tomorrow.

So `oura_raw.db` has been accumulating without limit since the native store landed (2026-07-27), at
roughly 2–3 MB/day. The plan's own warning anticipated this exactly — *"A rollup that silently falls
behind turns Tier 1 into unbounded growth"* — and the failure state it asked for ("a bound and a
visible failure state, not a best-effort sweep") is the part that is missing. The admin console has
no panel for `rawStats()`, which is a known gap, and is why this has been invisible.

### The prune predicate contains a dependency that D4 would invert

`synced = 1` is set by `markSyncedRange`, on a **server POST 2xx**. Its own code comment is explicit
about why: *"until it is set the prune has nothing it is allowed to delete… `body_hex` is the only
thing a future decoder fix can be re-run against."*

**The device is allowed to delete raw only once the server has a copy.** That is the current safety
model, and D4 deletes the server copy. After D4 the predicate is either vacuous or has to be
re-pointed at something else that does not exist yet. This is a concrete code change inside D4's
blast radius that is not named in the D4 breakdown.

### There is no working backup for the device store

`android/app/src/main/AndroidManifest.xml:14` sets `android:allowBackup="true"`, with **no
`dataExtractionRules` and no `fullBackupContent`**. Android Auto Backup's cloud quota is **25 MB per
app**; an app that exceeds it has its backup **silently dropped**, and Auto Backup has no consistent
story for a live SQLite WAL database in any case.

`oura_raw.db` passed 25 MB within the first two weeks of existing. **The device raw store has no
backup and cannot have one via this mechanism.** Under any option where the phone becomes the archive,
phone loss is total loss of raw history, with no recovery path.

### The 14-day decision was justified by the thing D4 removes

From the owner's own 2026-08-02 retention decision:

> Tier 1 is short **because it can be**: `oura_raw_samples.body_hex` is the permanent archival source
> of truth **on the server** and is never pruned… Retaining a year of them locally would cost 1.2 GB
> and buy nothing.

**The 14-day device window and the permanent server archive are load-bearing on each other.** D4 does
not just move the archive — it invalidates the premise of the retention tier, and the device tier
would have to become full-history (~1.2 GB/year on the phone, un-backed-up). Neither the master plan
nor the retention decision reconciles this. It needs to be settled before D4, not during it.

---

## 4. What the D4 cutover actually requires

D4 is already specified in
[`2026-07-21-oura-ondevice-hybrid-master-plan.md`](2026-07-21-oura-ondevice-hybrid-master-plan.md) and
is **not a config change**. It is the terminal node of a dependency chain, gated on **D1 + D2 + D3**,
where D3 is a hard precondition. Current state:

| Prerequisite | State |
|---|---|
| **D1** — six finished forms backed up + full-history restore | Server halves shipped. **The restore has never been run.** "Restore from cloud" has existed since #758 (2026-07-30) and has no device-verified proof. |
| **D2 Tasks 2–3** — native raw store + local-commit cursor | ✅ Shipped and device-verified 2026-07-30 (694-batch drain, kill-mid-drain survived). |
| **D2 Task 4** — on-device clock anchor | Built 2026-07-30 on an unmerged branch, **not device-verified, no PR open**. |
| **D2 Task 5** — WebView rollup port | **Not started.** This is the blocker for §3's prune, and for everything downstream. |
| **D2 Task 6** — neural models in WASM (SleepNet + step_counter) | Not started. Needs a `wasm-unsafe-eval` CSP change proven under the real prod CSP on the S25. |
| **D3** — read-flip to local-first + single-writer flip | Not started. Needs D1 + D2. |
| **D4 gate** — six forms in `SyncDelta`, device-verified restore-proof artifact **by commit SHA**, `oura_raw.db` own-reconcile authority, fail-closed per-day completeness audit | None of the four exist. |

D4's own PR is additionally required to **rewrite the `CLAUDE.md` archival rule** and re-scope the
ops-doc §16 invariant — the rule change is part of the work, not a consequence of it.

**Honest estimate: D4 is several implementer sessions away at minimum**, with two device-verification
gates (restore-proof, rollup parity soak) that only the owner can clear, and one CSP change that must
be proven on the S25. It is not available as an answer to a deadline 60 days out.

And per the master plan, **D3 is the last reversible point**: *"D4 (the raw drop) forecloses this
rollback"* — once server raw is gone there is nothing to re-derive from if the device rollup is later
found wrong.

---

## 5. What a phone loss costs, per option

This is the question that separates the options, so it is stated plainly.

| Scenario | Raw frames | Derived metrics (sleep, HR, readiness, steps) |
|---|---|---|
| **Today** | Safe. Server holds all 1.1M rows. Phone loss costs nothing. | Safe on server. |
| **After row-narrowing / index work (§6 A, B)** | Safe. Unchanged. | Safe. |
| **After repacking (§6 C)** | Safe. Same frames, different physical layout. | Safe. |
| **After a bounded server window (§6 D)** | Days older than the window are **gone permanently** — not on the phone either, since the device store only goes back to 2026-07-27 and prunes. | Safe (D1 forms on server). |
| **After full D4 (§6 E)** | **Total loss of all raw history.** No Auto Backup (§3), no server copy, ring buffer long since wrapped. | Safe *if and only if* D1's restore is proven working — which it has never been. |

Under D4, phone loss permanently destroys the ability to re-decode **any** history. That is the
capability the `CLAUDE.md` rule exists to protect, and it would rest on a single un-backed-up SQLite
file on one handset.

---

## 6. The options

Presented in increasing order of what they give up. **They are not mutually exclusive** — A, B and C
compose, and any of them buys time for the D-track to be finished properly rather than under deadline
pressure.

### A — Index audit (reversible)

Audit `oura_raw_samples_user_tag_ts` (60 MB, 1,789 scans) and `idx_oura_raw_samples_user_measured`
(46 MB, 3,340 scans) against the post-Q-213 rollup, the redecode path and the admin tester. Drop or
narrow what the collapsed single-query rollup no longer needs.

- **Buys:** up to ~106 MB now, ~29% of the table; proportional reduction in future growth.
- **Costs:** a query-plan audit; a rebuild if a drop turns out wrong.
- **Irreversibly gives up:** **nothing.** An index can be recreated from the data at any time.

### B — Narrow the row (reversible)

Two independent changes: stop persisting `event_name` (20 MB; 30 distinct values, fully derivable from
`tag` — the Kotlin/TS parity test already pins that mapping), and migrate `body_hex` from `text` to
`bytea` (halves 26 MB → ~13 MB and shrinks the 78 MB dedup index proportionally).

- **Buys:** ~45–50 MB now; per-row cost from ~328 B to ~270 B.
- **Costs:** one migration each, rewriting 1.1M rows; `VACUUM FULL` to reclaim (ops-doc I17 — nulling
  a column does *not* shrink the file). Read paths that select `event_name` must derive it instead.
- **Irreversibly gives up:** **nothing.** `event_name` is a pure function of `tag`; `text` ↔ `bytea`
  is lossless.
- **Note:** master-plan decision **O1** says `bytea` and D4 are mutually exclusive — *"do not do
  both"*, with D4 preferred. If D4 is not the chosen path, that exclusion lapses and `bytea` is back
  on the table.

### C — Repack the frames (reversible; the option the current rule does not consider)

The structural finding of §2 is that the database spends 328 bytes to store 12. Store frames **packed**
instead of one-row-per-frame: one row per `(user, day, tag)` holding a `bytea` blob of concatenated
frames with delta-encoded `ring_timestamp_ds`, plus a count and a ds range. Postgres TOAST-compresses
blobs over 2 kB automatically, on top of the packing.

- **Buys:** at ~16 effective bytes/frame, **~134 MB/year instead of 2.7 GB/year — roughly 20×**. The
  existing 1.1M rows repack to well under 50 MB.
- **Costs:** the largest engineering effort of A/B/C. The dedup key must move (in-blob dedup, or a
  narrow side index); the ingest path, the rollup reader, redecode and the admin tester all change;
  one careful migration over 1.1M rows. Not small — but bounded, sandbox-testable, and it touches no
  native code.
- **Irreversibly gives up:** **nothing.** Every frame is still present, byte for byte, and unpacking
  is mechanical. Re-decode works exactly as it does today.
- **Why it is worth naming:** it addresses the actual cost driver — row overhead — rather than the
  data. It is the only option that makes the growth curve sustainable *without* deleting anything or
  depending on the phone.

### D — Bounded server re-decode window (irreversible, bounded)

Keep `body_hex` on the server for a fixed horizon (90 / 180 / 365 days), drop it beyond that while
retaining the decoded and rollup layers forever.

- **Buys:** caps server raw at the chosen horizon. Note that at today's rates and today's row cost, a
  **90-day window is ~676 MB — larger than the table is now**; this option only helps when combined
  with A/B/C. With C it is ~35 MB at 90 days.
- **Costs:** a prune job and a retention constant.
- **Irreversibly gives up:** **the ability to re-decode anything older than the window.** A decoder
  improvement found in month 8 can never be applied to month 1. The device does not cover the gap —
  its store starts 2026-07-27 and prunes. This is a real, permanent loss of a capability the project
  has already used: the I23 sleep-bout fix and the Q-71/I25 clock-math correction were both back-filled
  by re-decoding stored hex, and the Q-71 rewrite of stored history ran **five weeks** after the
  affected nights.

### E — Full D4 cutover (irreversible, total)

Pull all raw to the device, audit completeness per day, drop the server table.

- **Buys:** the full 360 MB, and it is the project's stated north star.
- **Costs:** D1 restore-proof + D2 Tasks 4–6 + D3 soak + the four-part D4 gate. Several sessions, two
  owner-only device gates, one CSP change. Not reachable inside the ~60-day volume deadline.
- **Irreversibly gives up:**
  1. **Server-side re-decode, permanently and for all history.**
  2. **The D3 rollback.** If the device rollup is later found wrong, there is no server raw to
     re-derive from.
  3. **Redundancy.** Raw history becomes single-copy on one un-backed-up phone (§3). Auto Backup
     cannot cover it at 25 MB.
- **Marginal gain over A+B+C:** those three leave roughly 50–80 MB of server raw at steady state
  against E's zero. **E trades all three losses above for ~50–80 MB.**

---

## 7. Finding 3 — `error_events` (49 MB): the prune works; one already-fixed bug is the volume

Separate from everything above, and carrying none of the irreversibility.

**The prune is running.** `lib/data/postgres/adapter.ts:4416` deletes rows older than 30 days,
throttled to once per 24h. The owner's oldest surviving row is **2026-07-17**, 31 days before today —
exactly what a 30-day window plus a once-daily throttle produces. Not a prune failure.

**The volume is one fault.** Of the owner's 6,222 rows, **5,771 (93%) are a single error**:
`[pg 21000] Failed query: insert into "oura_heartrate" …` — a `cardinality_violation`, i.e. a
multi-row upsert whose `VALUES` list hit the same `(user_id, timestamp)` twice. It occurred on three
days only (08-09: 2,568 · 08-12: 2,472 · 08-13: 731) and carries **15 MB of stack traces** owner-scoped.

**It is explained, not mysteriously stopped.** This is exactly the fault fixed by **Q-214 on
2026-08-13** — `upsertOuraHeartrate` (`lib/data/postgres/slices/oura.ts:258`) now collapses repeats on
the conflict target before the insert, and its comment documents this incident. Last occurrence
2026-08-13; the fix shipped the same day. Per `CLAUDE.md`'s *"something that stopped is not something
that was fixed"* rule this was checked rather than assumed — here it genuinely was fixed.

**So the 49 MB is residue and will clear itself** as those rows age out of the 30-day window, by
approximately **2026-09-12**. No action is required to recover the space.

**But two durable defects made one bug cost 49 MB, and both will do it again:**

1. **The dedupe key is defeated by parameterised SQL.** `shouldRecordRequestError` suppresses a repeat
   of the same route+message inside 60 s — which should have capped this at ~1,440 rows/day. It
   recorded ~2,600. The reason: Drizzle's failure message embeds the entire generated `VALUES` list,
   so **a different batch size produces a different message**. Measured: **5,771 rows, 18 distinct
   messages, 1 distinct 60-character prefix.** The dedupe was bypassed 18-fold by strings that carry
   no distinguishing information.
2. **The stored message is 2 kB of boilerplate.** Every one of the 5,771 rows is truncated to exactly
   2,000 characters (`avg = max = 2000`), and essentially all of it is `(default, $N, $N, $N, $N),`
   repeated. The caps at `request-error.ts:153` (message 2,000 / stack 8,000) are working as written —
   they are just far too generous for a message whose information content ends at character 60.

Fixing either one would have made this incident cost single-digit MB. Fixing both is cheap and is not
coupled to any decision in §6.

### Side finding — 12 MB of never-scanned indexes on `oura_heartrate`

`oura_heartrate` is 32 MB, of which **25 MB is indexes on 6.7 MB of heap**. Two have **zero lifetime
scans**: `oura_heartrate_user_updated` (7.6 MB) and `oura_heartrate_pkey` (4.3 MB). The `user_updated`
index was added by migration 130 for Track-B sync, which is not wired yet — so its zero is expected
and it should be *kept*. The unused primary key on a table with a `(user_id, timestamp)` unique
constraint is a straightforward candidate. Same reversibility as §6 A: nothing is given up.

---

## 8. What this session recommends *procedurally* (not which option to take)

1. **The owner picks from §6.** Options A, B and C give up nothing and can start immediately. D and E
   are one-way doors and this document exists so that door is opened deliberately or not at all.
2. **§7's two error-logging defects are unblocked** by that decision and should be fixed regardless.
3. **§3's device finding is urgent independent of everything else.** `oura_raw.db` is growing without
   bound on the owner's phone right now, with no visible failure state and no admin panel to see it.
   That is true whichever option is chosen, and it gets worse under E.
4. **Do not let the volume deadline force E.** E is the only option that cannot be delivered inside
   ~60 days, and it is the only one that is irreversible in every direction. A+B+C buy years, at which
   point the D-track can land on its own schedule with its gates intact.

## 9. Backlog entries filed

Q-530 – Q-535, from the unallocated pointer (this session is a one-off, not one of the five standing
agents, so it took a block rather than a lane band; the pointer is bumped to 540 and the block is
recorded in the band table).

| Q | Item | Blocked on |
|---|---|---|
| **Q-530** | `oura_raw.db` grows unbounded on-device — no `pruneRaw` caller, and `rolled_up` is never set | — (D2 Task 5 for the full fix) |
| **Q-531** | `error_events` dedupe defeated by parameterised SQL in the message; cap the message to its diagnostic prefix | — |
| **Q-532** | Index audit on `oura_raw_samples` — 106 MB for 5,129 lifetime scans (§6 A) | — |
| **Q-533** | Narrow the row: drop `event_name`, `body_hex` → `bytea` (§6 B) | Owner decision, only if E is not chosen |
| **Q-534** | Repack raw frames — ~20× reduction, lossless (§6 C) | Owner decision |
| **Q-535** | **Owner decision required:** raw-retention policy — §6 D and E are irreversible | **Owner** |

---

## Appendix — reproducing these numbers

```bash
# System-wide, NOT row-scoped — table and index sizes, lifetime scan counts.
curl -sX POST https://trainingai-production.up.railway.app/api/admin/db-query \
  -H "Authorization: Bearer $CLAUDE_DB_QUERY_SECRET" -H 'Content-Type: application/json' \
  -d '{"sql":"SELECT relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) total, pg_size_pretty(pg_relation_size(relid)) heap, pg_size_pretty(pg_indexes_size(relid)) idx FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 15"}'

# Owner-scoped (claude_ro) — per-column byte totals.
#   SELECT pg_size_pretty(sum(pg_column_size(body_hex))::bigint),
#          pg_size_pretty(sum(pg_column_size(event_name))::bigint),
#          count(*) FILTER (WHERE decoded IS NOT NULL)
#   FROM claude_ro.oura_raw_samples
```

**Failure surfaces not exercised:** this is a measurement and planning session — no code was changed
and nothing was run on the device. The device findings in §3 are **static analysis** (grep for callers,
reading the prune predicate, reading the manifest); the actual size of `oura_raw.db` on the owner's S25
was **not** observed, because the admin console has no `rawStats()` panel to display it. Confirming it
is the first step of Q-530.
