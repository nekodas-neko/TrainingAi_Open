# 2026-08-13 — session close: outage resolved, backlog handed over

**Branch:** `docs/session-handover-backlog` · **Handoff:**
[`docs/handoff-2026-08-13-platform-production-event-loop-starvation.md`](../../handoff-2026-08-13-platform-production-event-loop-starvation.md)

Ten PRs, #1295–#1304, v1.302.2 → v1.303.3.

## What the session was, and what it became

It opened as an undiagnosed production outage and closed as ordinary queue work. The owner asked
partway through whether it had drifted into backlog territory; it had, and consolidating onto one
agent is the right call — which is what this wrap-up is for.

## The outage, in one paragraph

`aggregateOuraRawSamples` re-read and re-decoded a 35-day window of `oura_raw_samples` on every BLE
sync. The table holds 986,959 rows against ~37 days of ring history, so that window was the whole
table, rebuilt from scratch to absorb a few minutes of new data. Each run outlasted the gap between
syncs, so runs went back-to-back and held Node's single main thread for 15–30 minutes. The DB
connection errors that the previous session's hypothesis was built on were downstream: `pg`'s connect
timeout is a JS `setTimeout`, and on a blocked loop it fires late and kills healthy connections while
the database answers in milliseconds. `/api/version` — no DB, capped at 5 s — measuring **122 seconds**
is what made that unarguable.

Fixed by narrowing the read to the span a sync touched, plus a persisted watermark so a restart
resumes rather than re-deriving. **Verified on a real ring sync: 15–30 min → 2 min, CPU 1.8 → 0.815,
memory 2.19 GB → 0.553 GB.**

## The thing worth carrying forward

**Two regressions were introduced and fixed inside this session, and both were found by watching
production rather than by reading code.**

1. #1297 left a cold-start pass that re-derived everything once per process. Its own PR called that
   "one slow pass per deploy… expected, not a regression." Measured, it was **six minutes of a pegged
   main thread**, paid on all five of the day's deploys — one of them triggered by a docs-only PR.
   Fixed in #1300.
2. #1300 then took the caller's span *instead of* the watermark rather than as well as it, so a batch
   ingested before a restart could never be rolled up. Fixed in #1302.

The second was caught because a number did not add up: the seeding pass cost 2 minutes where the
equivalent pass three hours earlier cost 6, with an empty watermark table both times. Nothing in the
code review would have surfaced it.

**The lesson is not "test more".** Both changes were mutation-tested and shipped with green suites.
It is that a performance change's cost model is a claim about production, and a claim about
production can only be settled there. Both times the tell was a metric that disagreed with the
prediction, and both times the prediction was mine.

## Other work

- **Q-215** — a repeated timestamp discarded a whole 5,000-row HR batch. 2,472 occurrences; those
  samples are gone.
- **Q-219** — measured that **54% of the database was indexes**, not data, and that one never-scanned
  index was 52 MB against 6.6 MB of rows. The owner ran the REINDEX: 52 MB → 2.75 MB, database
  484 MB → 435 MB.
- **Barcode** told the owner "this product isn't in the database" during a genuine Open Food Facts
  outage — false, and the kind of false that makes you type the item in by hand.
- **Q-218** — the AI food-scan route reported failures only to stdout, which is why 30 days of
  `error_events` held nothing for it.
- **Q-187 phase 2 planned** (nutrition): keep unconfirmed prefills out of `food_logs` rather than
  filtering a column across its 24 readers, and store only "no".
- **D4 confirmed by the owner** — device-primary, because the current shape does not support many
  users. Measured: 364 MB raw against 1.6 MB derived, **231×**.

## Not verified

- **Nothing was verified on the S25.** The BLE plugin, native SQLite and the camera do not run in the
  sandbox. Every device-facing claim in this session's PRs is server-side only.
- **Local SQLite v25 has still never run on a phone.**
- The genuine barcode `notFound` path could not be walked end-to-end, because OFF was down throughout.
