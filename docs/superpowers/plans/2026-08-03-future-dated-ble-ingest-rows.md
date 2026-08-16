# Investigate Future-Dated `body_metrics`/`oura_daily` Rows From BLE/Scale Ingest (Q-56)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Find and fix the root cause behind real sensor data landing on dates up to 5 days in the
future in production (`docs/reviews/2026-08-03-cross-domain-bug-review.md` §5). This is an
**investigation-first** item — the root cause was not identified in the review session, only the
symptom, evidence, and a live-in-production instance.

**Tech stack:** Oura direct-BLE pipeline (`lib/oura-ble/` or equivalent — see the `oura-native-ble`
skill and `docs/oura-ble-operations.md`), Renpho scale BLE integration, `lib/data/health-source.ts`
(the ranked per-field merge), `lib/data/postgres/adapter.ts`.

## Evidence (from the production read-only DB, `claude_ro` schema, single real account)

Five `body_metrics` rows and one `oura_daily` row, all written in the same one-second batch
(`created_at`/`synced_at` = `2026-07-30T03:44:09.953Z` / `:12.815Z`), dated 1 to 5 days **after**
that write time:

```
body_metrics: 2026-07-31 (+1d), 2026-08-01 (+2d), 2026-08-02 (+3d), 2026-08-03 (+4d), 2026-08-04 (+5d)
oura_daily:    2026-08-04 (+5d)
```

All five `body_metrics` rows carried real data — `weight_kg` 71-71.65, `body_fat_pct`, `hrv_ms`,
`resting_heart_rate`, `spo2_pct`, `steps` in a plausible 4,600-7,000/day range — stamped
`source_map` values of `oura_ble` and `scale_ble`. The four rows dated 07-31 through 08-03 have
since self-healed: as each day actually arrived, the real per-day write correctly upserted onto the
same `(user_id, date)` row via the existing unique constraint (confirmed via `updated_at` now
showing 2026-08-03, with correct data). **The 2026-08-04 row is still live in production as of this
writing** (today is 2026-08-03) — a partial placeholder (`steps: 970`,
`source_map: {"steps":"oura_ble"}`, all other fields null) sitting one calendar day in the future.

Five consecutive future dates exactly 1 day apart, each carrying plausible daily-cadence data,
matches CLAUDE.md's known Date-Arithmetic bug class (hand-added/mis-signed date offsets) more than
random corruption — read as `today + i` for `i` in `1..5` where the intent was likely `today` (a
single write) or a backfill (`today - i`).

## Tasks

- [ ] **Task 1 — find what ran at `2026-07-30T03:44:09 UTC` (≈13:44 AEST).** Check whether this
      correlates with a specific deploy, migration, or manual admin action around that time (that
      session shipped several BLE/sync fixes — Q-36 through Q-40 — check
      `docs/handoff-2026-08-02-platform-batch-queue-drain.md` and nearby PRs/commits for anything that
      writes a multi-day batch of `body_metrics`/`oura_daily` rows). Rule in or out: a backfill script,
      a redecode pass, a rollup re-run, or a live sync that mis-timestamped its output.
- [ ] **Task 2 — read the ring-clock-anchor / BLE-daily-rollup date computation.** Per CLAUDE.md's
      Oura Direct-BLE section, `ring_timestamp_ds` is a monotonic deciseconds counter since the
      ring's own epoch, not UTC — wall-clock time comes from a `(ringDs ↔ utc)` anchor. If that anchor
      was stale, wrong, or recomputed incorrectly at that moment (e.g. after a re-key or a dropped
      connection), a batch of buffered samples could map to the wrong calendar dates. Also check any
      scale-BLE backfill/catch-up write path for the same class of bug (both `oura_ble` and
      `scale_ble` sources appear in the affected rows' `source_map`, so this may be two independent
      bugs with the same symptom rather than one shared root cause — don't assume a single fix covers
      both without confirming).
- [ ] **Task 3 — check whether this has recurred since 2026-07-30.** Query prod again
      (`WHERE date > CURRENT_DATE`, or `date::date > (created_at::date + interval '1 day')::date`) —
      if the 2026-08-04 row is joined by new future-dated rows by the time this is picked up, the bug
      is still live and ongoing, not a one-off from that session.
- [ ] **Task 4 — fix the root cause** once identified, with a regression test that would have caught
      it (feed the buggy anchor/timestamp input, assert the computed date matches the real day, not a
      future one).
- [ ] **Task 5 — clean up the still-future row(s).** Once the write path no longer produces bad
      dates, decide with the owner whether the 2026-08-04 placeholder (if it hasn't already self-healed
      by the time this lands) needs a corrective one-time `UPDATE`/`DELETE` — per CLAUDE.md's Postgres
      Data Migrations rules, any corrective migration must be explicit, idempotent, and targeted (not
      a broad `DELETE WHERE date > CURRENT_DATE`, which could destroy a legitimately-scheduled future
      row if the app ever grows one — confirm none exist by design first).
- [ ] Run the full test suite + lint.
- [ ] Remove this entry from `docs/implementation-backlog.md`, add the journal entry +
      `projectOverview.md` update in the same PR. If Task 1-3 rule out a fixable root cause (e.g. it
      turns out to be a one-off manual action, not a code bug), say so explicitly and downgrade this
      to a closed investigation rather than leaving it open indefinitely.
