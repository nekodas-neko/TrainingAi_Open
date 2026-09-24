# Review sweep 56 — the reads nobody ran

**2026-09-24 · Review · docs only. Every production figure is a SELECT through `claude_ro` and covers
the owner's rows only.**

## The angle

Sweep 55 found Q-270 waiting 20 days on *"one query, a few days from now"*. Run today, that query
answered the entry. So this sweep asked the question across the whole queue: **which entries are
waiting on a read that anyone could run now?** A pattern match found 105 entries mentioning an owed
query, re-measure or dated check. Four read-only agents triaged them and ran the reads. This session
re-ran the most consequential one itself.

| verdict | entries |
|---|---:|
| not actually waiting on a read (build, owner, device, hardware) | ~60 |
| **read run today** | **~33** |
| — of which the answer **changes the entry** | **23** |
| too early, with the date it becomes answerable | 7 |

## What changed, most important first

1. **Nights are missing from `sleep_sessions` on 12 of 27 recent dates (PS-17, Q-274).** Re-checked
   here. On 08-29, 08-30, 09-03, 09-07, 09-08, 09-09, 09-14, 09-15, 09-16, 09-18, 09-20 and 09-22,
   the only row is a 0.0–4.1 h daytime fragment. The ring's overnight HR is complete on those
   nights, and the summary holds 7–9 h. Q-274 says the problem "does not currently reproduce", which
   is false. It was 5 of 13 on 09-17, so it is getting worse. **RV-161 asks for PS-17 to move up.**
2. **106 of 129 derived-score rows were rewritten at 02:37 UTC today, unattributed (RV-159).** Body
   composition changed (Q-527's corrupt row went from 3.0% to 6.2%, which now passes the 4% screen).
   The stuck rails did not change.
3. **`rederive-baselines` has never run**, and five pass tests wait on it: BF-13, TN-6, Q-506, TN-8
   and TN-42. The stored temperature SD is ~10–14× the true one. RV-161 item 1 asks the owner to
   add it to the device agent's authorised backfill, and to run it first.
4. **The strap status log goes silent overnight without a final row (TN-54).** Nothing was recorded
   from 20:48 to 06:55, the strap was never `ready` for ~25 h, and 09-23 has no RR data. `worn` is
   true on every row.
5. **LA-110 has a cause.** The five affected days are exactly the first run of each session of the
   new program, its baseline block. The entry's "REFUTED" paragraph had read current-state rows only.
   The evidence expires around 10-06.
6. **Barcode foods almost never store their image, and never their barcode (BF-35).** 1 of 41
   barcode rows has an image, the same product stored one and then didn't, and `barcode` is NULL
   on all 340 rows.
7. **Resilience now pins at the bottom clamp (Q-508).** It is not dormant, as the title says. It has
   walked from 5 down to 1.01 since 09-07.
8. **Q-72 can't be unblocked by waiting.** There have been no sleep ratings since 08-17.
9. **Q-30's size condition is exceeded.** The raw archive is 25 MB, growing ~0.7 MB/day.
10. **Smaller re-measures:**
    - TN-36: the deload arm now fires 27–30%, down from 73%.
    - Q-507: the wrong sign survives BF-81's fix (+0.405, n=24).
    - PS-4: the batons grew, and the ratchet was raised with them.
    - TN-3a: 32 days of buckets now exist.
    - TN-4: its evidence has pruned.
    - BF-110: the first `resized` recheck arrived, from a different start height.
    - Q-501: the uncheckable population is 41, not ~100.
    - Q-540: the indexes grew 30 → 45 MB.
    - Q-4: its written query names the wrong column.
    - Q-116: the ring drains ~21 points a night.
    - DV-14: production caught up.
    - TN-55: a zero-drain day with 203 HR samples.

**Answered and ready to close (RV-160):** Q-292, Q-295, Q-296, Q-513, LA-27 and Q-219. Also three
stale Known-Issues rows the owner asked about: Q-351 (#48), Q-353 (#79) and Q-144 (already
archived), plus Q-453–455 (#335).

**Too early, with dates:** TN-58 (09-29 and 10-06), TN-55 (10-04), Q-507 (10-16), TN-50 (10-17),
TN-25 (10-18) and Q-52 (no fixed date). RV-162 proposes making these dates a field, so they fire.

## Standing reads

- `error_events`, 7 days: every group is the known `bf110 resume` telemetry. Nothing new.
- **Database: 235 MB as a sum of tables, up 3 MB since sweep 54's 232 MB**, which is on the
  ~1.7 MB/day trend.
- ⚠ **Do not compare `pg_database_size` (250 MB) to that figure.** It adds the system catalogs.
  This sweep briefly read the 18 MB difference as a one-day jump, which it was not.
- `oura_raw_samples` holds 197,253 rows over 7.8 days, so the hot window is pruning.

## Method notes for the next sweep

- The `/api/admin/db-query` endpoint sometimes answered `{"error":"Unauthorized"}` on a query that
  succeeded on retry. It is flaky, and the secret is fine. Retry once before believing it.
- `body_battery_daily.hr_sample_count` and `anchor_source` were refused twice. Those columns may not
  be in the view.
- A reading noted on an entry is dated and attributed (*"📊 Read 2026-09-24 (Review sweep 56 …)"*), so
  the next reader can tell a measurement from a claim.
