# Railway console + production DB readings, 2026-08-25

_Orchestrator · owner supplied the Railway charts; the DB figures are live reads through
`POST /api/admin/db-query`. Filed because three queue entries (**Q-549**, **Q-547**, **Q-551**) were
parked on `Gate: owner` waiting for exactly these numbers._

**Headline: Q-549's premise is falsified.** `prod_DB` does not hold 0.79 GB. It holds **423 MB, flat**.

---

## 1. What was read

**Railway charts, 3-hour window, tooltips at 2026-08-25 13:03 GMT+10:**

| service | CPU | memory | notes |
|---|---|---|---|
| `prod_DB` | **0.0 vCPU** (limit 8.0) | **423 MB** (limit 8.00 GB), flat ~400-423 across the window | public network traffic ~0; one small step to ~450 MB near 12:45 |
| `TrainingAI` | near 0.0 between events, spiking to **2.5 vCPU** | ~400 MB baseline, spiking to **~1.2 GB** | **649 requests** in 3 h, one bucket at 276; ~10-12 dashed markers |

Also visible: `TrainingAi_DataBucket` **118.9 MB**, `postgres-volume` attached to `prod_DB`, both
services Online.

**Live DB reads, same day:**

```
shared_buffers        16384 x 8kB   = 128 MB   (Postgres default, unchanged)
work_mem               4096 kB      = 4 MB
maintenance_work_mem  65536 kB      = 64 MB
effective_cache_size 524288 x 8kB   = 4 GB     (planner hint — allocates nothing)
max_connections         500                     (unchanged)
live backends             3
pg_database_size                      197 MB
sum(pg_total_relation_size) / 87 user tables
                                      182 MB
sum(pg_indexes_size)                   68 MB   (37% of user-table bytes)
```

Largest tables: `oura_raw_samples` **58 MB** (29 heap / 30 idx) · `error_events` **49 MB**
(12 heap / 1.1 idx — so **~36 MB TOAST**) · `oura_heartrate` **33 MB** (8 heap / 25 idx) ·
`oura_raw_packed` 15 MB · `rr_intervals` 13 MB.

---

## 2. Q-549 — the 0.79 GB premise does not survive

The entry predicted, from a 2026-08-18 reading of *"~200 MB and climbing"*, that
**"0.79 GB is the warmed steady state and will return."** That was a testable prediction and it
failed: seven days later, on a container warm for a week, memory is **flat across three hours** with
no upward trend.

**Flat is the finding.** The 2026-08-18 reading was taken minutes after the volume incident
restarted the container, which is why it was climbing — the entry says so itself. Nothing about this
reading is climbing.

**Where 0.79 GB most likely came from.** It was an average over *"~19.6 days to 2026-08-18"*, and
that window contains the **2026-08-17 `disk_full` outage**, where the volume peaked at 805 MB on
306 MB of index and dead-tuple bloat. An average taken across an incident is not a steady state.

**What is actually there.** 423 MB serving a 197 MB database: 128 MB of it is `shared_buffers` at a
**99.87% hit ratio** (measured 2026-08-19, unchanged), and most of the remainder is OS page cache —
reclaimable, not waste. This entry's own second warning said it might be exactly this, and it is.
Roughly **$4/month rather than $7.87**, of which only a fraction is reducible at all.

**What is left of the entry.** `max_connections = 500` against a ceiling of ~12, a Railway console
setting worth tens of MB of boot-time preallocation. **Recommendation: close Q-549.**

**Limitation, stated rather than glossed:** three hours, not the full day the gate asked for. It
cannot exclude a daily spike (a backup, an autovacuum pass). It does exclude the claim the entry
rests on.

---

## 3. Q-547 — the deploy-marker half, corroborated by coincidence

The `TrainingAI` chart carries the ~10-12 dashed markers Q-547 describes, and the window is
**independently known to be a heavy merge window**: PRs **#405, #406, #407, #410, #408** all landed
on `main` inside it, with the largest CPU spikes (to 2.5 vCPU) at 12:30-13:00, when #408 and #410
merged. The markers line up with known deploys.

**It is not the baseline, and must not be used as one.** Five deploys in three hours is about double
the ~5/hour Q-547 already flagged as atypical, so 2.5 vCPU is the churn signature, not a
steady-state regression. **The quiet-window read is still owed** — ideally three hours with zero
merges.

---

## 4. Q-551 — one input moved, and it is not enough to re-cost on

The ~$8/month "stay" floor was built partly on Q-549's 0.79 GB. That slice was **never real spend**
rather than spend awaiting a fix, so the DB line is already near its own floor untuned. But the app
half — the larger half — is still unmeasured at rest, because every reading so far has landed on a
shipping day. **Re-cost when both halves have been read quiet, after Q-545.**

---

## 5. Database growth — measured, filed, not an alarm

`CLAUDE.md` states a **171 MB** baseline at 2026-08-18 and ~0.4 MB/day expected. Like-for-like
(`sum(pg_total_relation_size)`, which is what the baseline measured — **not** `pg_database_size`,
which is 197 MB because it includes catalogs), today reads **182 MB**: **11 MB in 7 days ≈ 1.6
MB/day, about 4x** the stated trend.

**Almost all of it is `oura_raw_samples`**, 50 → 58 MB since the packing work — **≈1.1 MB/day of the
1.6** — which is the BLE ingest accumulating normally.

**Two readings are not a trend, and the baseline is the weak one:** 171 MB was taken immediately
after both the repack and the `disk_full` incident, so a compacted heap regrowing slack inflates any
rate computed off it. **The action is a third reading next session.** If ~1.6 MB/day holds, the
number to correct is `CLAUDE.md`'s 0.4, not the database.

**Not urgent:** at this rate the 5 GB volume holds ~8 years, and 182 MB bills at about **3
cents/month**.

---

## 6. `error_events` — nothing new, and one trap avoided

Seven fault groups in 7 days (owner-scoped, as every `claude_ro` view is): the
`/api/body-battery` **daytime-stress: constants not set** group at **31 hits, latest 2026-08-23
20:59:17Z**, five one-hit `SpeechRecognition.then() is not implemented on android`, and one one-hit
chunk-load failure.

**The daytime-stress group must not be read as fixed, and this read nearly was.** PR **#329** merged
at **21:17:23Z** — **18 minutes after** the last occurrence — so the fault stopped *before the fix
existed*. Worse, **TN-4's guard (#415, deployed ~13:00 UTC 2026-08-24) catches this failure and only
`console.error`s it**, so a recurrence now writes nothing to `error_events` at all: silence is
evidence of nothing either way. A Tuning session recorded both points on 2026-08-24 and the
`projectOverview.md` row says outright **"Do not strike this row on a zero count."** It becomes
checkable again when **TN-7** lands. Two `body_battery_daily` rows written since the fix (latest
dated 2026-08-25) confirm the route is being exercised — which is necessary for that check and not
sufficient for it.

`error_events` itself remains **49 MB, 27% of the database**, ~36 MB of it TOAST. Unchanged since
**Q-315** measured it; Q-315 owns it and is parked on `Gate: owner`.
