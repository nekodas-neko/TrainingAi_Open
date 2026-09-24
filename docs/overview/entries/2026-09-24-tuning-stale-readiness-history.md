# 2026-09-24 — status recheck: everything shipped, and the batched recompute has a cost I didn't price

**Branch:** `tuning/stale-readiness-history` · **Agent:** Tuning · **Docs-only.**

A recheck of where tuning stands. The good news is that the whole chain filed this week has been built.
The finding is that one of my own proposals has an interim state worse than the defect it fixes.

## Shipped since the last tuning session

| entry | state |
|---|---|
| **TN-57** — the unanswered self-report | ✅ both halves: consumers honour `*_touched`, and the write path stores `null` for an untouched scale (first seen on the 2026-09-24 morning row) |
| **TN-58** — the comparative check-in | ✅ control shipped 2026-09-22 (`components/checkin/vs-yesterday-picker.tsx`); entry stays queued for its two-week pass test |
| **LB-124** — the schema + strict body | ✅ an unknown key is now rejected rather than stripped |
| **TN-59** — prose-marker CI check | ✅ Custom Rules is now **77 of 77**, up from 75 |
| **TN-60** — the ±1.5σ rail | ✅ compressive tail, band width 20, chosen by the owner 2026-09-23 |
| **TN-61** — the queue tool's silent truncation | ✅ |

**TN-55 (the Body Battery) has NOT been built** and sits at position **9** in Lane A's READY list.

## The rail fix is live and correct

Driving the shipped `computeReadinessComposite` directly:

| z | −0.93 | −1.63 | −2.46 | −3.24 | −4.37 |
|---|---:|---:|---:|---:|---:|
| **new** | 19 | 9 | 6 | 4 | 3 |
| old | 19 | 0 | 0 | 0 | 0 |

Monotonic, and the days that used to collapse onto one value are separated.

**DV-14's deploy stall was ruled out before anything else** — production is ten hours behind `main`,
which is the explanation to reach for first, and it does not apply: the tail shipped in **1.465.13**
and production is live on **1.465.17**.

## TN-62 — the interim inverts ordering

Stored history was not re-derived, **which is what I asked for**: LA-122 item 2a batches the recompute
behind TN-6, BF-13 and LA-121. Measured over 71 stored days:

- **26 rows** hold `hrvBalance` at exactly 0 or 100; **19 rows** hold `sleepBalance` there.
- The live formula **cannot emit either** — it reaches 0 only near z = −50 and never returns 100
  (z = +20 gives 99). So all 45 are pre-fix clips.
- **2026-09-23 at z = −3.24 stores 4. 2026-09-15 at z = −1.63 stores 0.** The worse night reads better.

Pre-fix the series was at least monotonic — everything past the rail was 0 together. For any trend the
owner reads before the recompute fires, this interim is worse than the defect. I proposed the batch to
stop his history shifting four times and did not consider what the half-applied state looks like.

**`computed_at` is a trap.** 57 of the 71 rows carry a timestamp of 2026-09-23 or later, so they look
re-derived. The timestamp moved; the scores did not. TN-62 states the verification as a property of the
model — no stored value may read exactly 0 or 100 — rather than as a timestamp check.

## The battery got worse while waiting

Still `model_version` `v5`, and over the last 40 days: charge **1.6**/day, drain **56.4**, net
**−54.8**, and **25 of 40 days end at zero (63%)**. When I measured 84 days on 2026-09-21 it was
−29.8/day with 29% at zero. The defect is deteriorating, and its owner-approved fix is ninth in the
queue behind two review sweeps and a device sweep.

## Not exercised

Nothing runs; this is documentation. The measurements are read-only queries through
`/api/admin/db-query`, **row-scoped to the owner**, plus the shipped composite driven locally through
esbuild. **Not established:** why `computed_at` moved on 57 rows without the scores changing — I
measured that it did, not what did it. `pnpm check:rules` **Ran 77 of 77**, all passed.

---

## Owner decisions, 2026-09-24 — and one correction they exposed

Both as recommended: **re-derive now for the rail fix and again after the batch**, and **move TN-55 to
the top of Lane A**. TN-55 is now Lane A's READY #1.

**The correction is the more important half. TN-62 and LA-122 item 2a both named the wrong endpoint.**
They said `POST /api/admin/rederive-baselines`, which re-derives the stored **personal baselines** —
the EMA means and deviations, BF-13/TN-6's mechanism. It does not touch
`oura_daily_derived.readiness_contributors`, which is what holds the stale clipped scores. Firing it
for the rail fix would have reported success and changed none of the 45 stale values.

The endpoint that does the job is **`POST /api/admin/backfill-derived-scores`** — it recomputes each
day through `buildDayAudit`, *"the same compute functions the live route serves from, no formula
restated"*. So the re-derive is **two calls in order**, because baselines feed the z-scores the
contributors are built from: `rederive-baselines` once TN-6 and BF-13 land, **then**
`backfill-derived-scores`.

**Neither can be fired from here.** Both authenticate through `auth()` + `requireAdmin` with no
bearer-token path, so they need a logged-in admin session. `backfill-derived-scores` caps at **31 days
per request** and is dry-run unless `dryRun=false`, so the 71-day history is three pages.

I nearly fired the wrong one on the strength of my own entry. The reason I didn't is that the route's
name says *baselines* and the thing needing rewriting is *scores* — worth stating because the entry
read as authoritative and was wrong.

## Also re-measured today

TN-55's own headline is now understated: the battery's last 40 days run charge **1.6**/day against
drain **56.4** — net **−54.8**, **63% of days ending at zero**, mean end **12.1**. The entry's −30/day
came from 84 days. That measurement is recorded on the entry with an instruction not to quote the
plan's before-figures without re-running the harness.
