# 2026-08-23 — Q-534's three open findings, measured rather than built (closed)

**Branch:** `chore/close-q534-park-blocked` · **Lane A** · docs only

Q-534 was the non-destructive half of the `disk_full` incident: four findings, of which finding 4
(the `measured_at` index that made every re-stamp non-HOT) shipped on 2026-08-18. The other three
sat open. All three are measured here against production, and **none of them is actionable any
more** — so the entry is closed rather than implemented.

## The database the entry was written about no longer exists

| | at the incident (2026-08-17) | now (2026-08-23) |
|---|---|---|
| database total | 819 MB | **210 MB** |
| `oura_raw_samples` | 1.1M rows / 666 MB | 315k rows / 87 MB |
| its indexes | 443 MB | 46 MB |
| dead tuples | ~306 MB of bloat | **0** |
| `n_tup_upd` / `n_tup_hot_upd` | 681,005 / 0 | 0 / 0 |

The 500 MB question the entry closes on — *is it reachable without touching retention?* — is not
just answered, it is 290 MB behind us. `n_tup_upd = 0` is the direct evidence that finding 4's fix
removed the mechanism: nothing re-stamps the table at all now.

## Finding 1 — "the dedup index stores the payload twice" — is wrong

The reasoning was sound and the premise was not. Measured:

```
rows 314,995 · body_hex avg 24 chars · min 4 · max 28 · 7.3 MB across every row
dedup index (user_id, ring_timestamp_ds, tag, body_hex): 22 MB, 135,560 scans
```

**`body_hex` averages 24 characters.** A SHA-256 digest is 32 bytes — *larger than the value it
would replace*. MD5 is 16 and would save roughly 8 bytes a row, about **11% of a 22 MB index**, in
exchange for a collision hazard on the one guarantee that stops a distinct ring event being silently
dropped. The entry itself named that risk and said the column must stay in the equality check; with
the payload this small there is nothing left to gain by paying it.

The 22 MB is per-tuple overhead across 315k rows, not payload. Arithmetic: uuid 16 + bigint 8 + tag
+ a 24-char varlena ≈ 56 bytes of key, plus item pointer and tuple header ≈ 68, plus fill ≈ 73.
315k × 73 ≈ 23 MB, which is what is there.

What *would* shrink it losslessly is `text` → `bytea` (24 hex chars → 12 raw bytes), with exact
equality preserved and no collision risk at all — strictly better than hashing on every axis. That
is Q-540's half, and Q-541 supersedes it because a packed blob is already `bytea`. Q-540 now carries
the measured sizes, so the next reader costs it against 22 MB rather than the 78 MB it was written
against.

## Finding 2 — autovacuum — was already marked a measurement artifact

Re-confirmed: `last_autovacuum = 2026-08-22T19:08Z`, `n_dead_tup = 0`. (`last_analyze` is still
NULL, which `CLAUDE.md` already warns about — it is why `n_live_tup` is not to be trusted for "is
this table empty".)

## Finding 3 — `work_mem` and the 6.5 s `DISTINCT ON` — is no longer live

The query that triggered the incident, run against production:

```
SELECT DISTINCT ON (tag) tag, ring_timestamp_ds FROM oura_raw_samples ORDER BY tag, ring_timestamp_ds DESC
→ 20 rows, 246 ms
```

**246 ms, against the 6.5 s the entry recorded.** `oura_raw_samples_user_tag_ts` serves it, and the
sort that needed temp disk was a function of 1.1M rows. At 315k it does not spill. Raising `work_mem`
for a path that no longer strains it would be a change with nothing to verify against.

## What is left, and where it went

- The `VACUUM FULL` press the entry sequences is **Q-315**, which is now parked `Gate: owner` — the
  route shipped, and pressing it needs an admin session cookie a session cannot obtain (`db-query`
  runs as `claude_readonly`, which cannot `VACUUM` by design).
- The volume revert is withdrawn and settled, as the entry already says.
- **Q-418** is parked `Gate: device` in the same pass. Its remaining half is a native plugin patch
  needing an APK, and the entry's own instruction is to verify background tracking with the screen
  off *before* building on it — a 20-minute pocketed walk, which is not reachable from here.

## Not verified

Everything above is production measurement through `/api/admin/db-query`, which is **row-scoped to
one user**. For `oura_raw_samples` that is not a limitation — 314,995 counted against a 302,240
whole-table estimate says the owner's rows are essentially the table — but the sizes come from
`pg_stat_user_tables`, which is whole-database and exact, while the counts come from the scoped
view. Both are quoted as what they are.
