# Handoff — 2026-08-18 · DB storage decided and reclaimed, then the D-track made the focus

_Domain: `platform` (also touches `devices`) · Branch: `fix/raw-store-measured-and-console-gate` · PR: **#82, open, docs-only**_

> **Read first:** `projectOverview.md`, then [`docs/domains/devices/README.md`](domains/devices/README.md),
> then [`docs/implementation-backlog.md`](implementation-backlog.md). This file covers one session.
> Companion: [`handoff-2026-08-18-platform-database-reclaim.md`](handoff-2026-08-18-platform-database-reclaim.md)
> (Lane A's runbook — **now marked done**, this session executed it).

## Goal

Answer whether the database should hold only calculated summaries with raw frames on the device.
It turned into three things: a costed retention decision, a live `disk_full` recovery, and — once the
bill was examined — an owner-directed pivot to the D-track.

## Current status

- **Build/test:** docs-only, no code changed. `pnpm check:rules` **38/38** at every commit.
- **Production:** healthy. **171 MB**, data verified intact (1,121,819 frames, 764 blobs, 83 sleep
  sessions, 1,029 set logs).
- **Device-verified:** the owner read `rawStats()` on the S25 — first ever. Nothing else device-tested.

## What shipped

| | |
|---|---|
| [`plans/2026-08-17-db-storage-raw-samples-retention.md`](superpowers/plans/2026-08-17-db-storage-raw-samples-retention.md) | Five costed options, the incident diagnosis (§0) and the owner's runbook (§0a) |
| [`plans/2026-08-17-oura-raw-frame-packing.md`](superpowers/plans/2026-08-17-oura-raw-frame-packing.md) | Q-541 implementation plan — two tiers, `(user_id, epoch, tag, ds/864000)` |
| [`plans/2026-08-18-device-primary-compute.md`](superpowers/plans/2026-08-18-device-primary-compute.md) | The D-track plan: D2 Task 5/6 + D3 |
| Backlog | **Q-538…Q-551** filed; amendments folded into a concurrent session's Q-534 |
| `CLAUDE.md` | Session-start database-size read |
| **Production** | **805 MB → 171 MB**, executed with the owner |

## The findings that changed decisions

- **`body_hex` is 26 MB of a 360 MB table — 7.3%.** The archival rule protects the *cheap* part; the
  other 93% is indexes and row overhead, all reversible. That is what made "nothing irreversible" the
  right answer.
- **The `disk_full` incident was bloat, not growth.** `n_tup_ins = 0`, `n_tup_upd = 681,005`,
  **`n_tup_hot_upd = 0`** — a full `measured_at` re-stamp, non-HOT because the column was indexed. The
  table doubled while live rows went *down* and the payload did not move.
- **Storage is 0.6% of the bill.** The whole reclaim moved cost by ~$0.09/month. **Memory and CPU are
  99%** — which is what redirected the session to the D-track.
- **The device store had never been read.** 209,326 rows, **0 rolled up**, 31.2 MB. `pruneRaw` needs
  `rolled_up = 1` and `markRolledUp` has no caller, so the documented 14-day window cannot delete a row.
- **The rollup is portable.** `aggregateOuraRawSamples` is `adapter.ts:4958–6067` — **1,110 lines, 17
  DB-coupled.** The device port is an extraction behind an I/O port, not a rewrite.
- **WASM cannot instantiate in production.** `next.config.ts:10` has no `wasm-unsafe-eval` (Q-546).

## Deliberately NOT done

- **No option chosen for the owner.** Options D and E were presented as one-way doors; the owner chose
  **A+B+C** (all non-destructive) and declined both.
- **No retention change, and none needed.** `body_hex` stays archival on the server.
- **D4 not pulled forward.** Dropping server raw is out of scope and forecloses the D3 rollback.
- **`error_events` not vacuumed.** 49 MB of residue from an already-fixed fault; self-clears ~2026-09-12.
- **No code written.** This was a planning session throughout.

## Key decisions (with rationale)

- **A+B+C, no D or E** — the irreplaceable data is 7.3% of the table, so the reversible options get
  nearly all the space at zero capability cost.
- **Two tiers, not an in-place repack** (Q-541) — the ingest path and history cursor must take no new
  failure mode; a blob upsert there would put a lock and an O(blob) merge in front of every batch.
- **Bucket on `ds`, never a calendar day** — wall time is derived through anchors and that derivation
  changes; a calendar partition would need re-partitioning on every clock fix.
- **The 500 MB target is withdrawn** — Railway cannot shrink volumes and bills on *use*, so reverting
  buys nothing and would mean a dump/restore of the ring archive.
- **D-track before any Railway-vs-elsewhere decision** (Q-551) — deciding on a pre-fix, deploy-inflated
  baseline would be deciding on the wrong numbers.

## Gotchas / what did NOT work

- **Three CPU hypotheses were refuted by measurement** — no server cron (every `setInterval` is
  client-side); Q-213 already fixed the rollup window; the watermark epoch matches. **Do not re-file
  them.** The answer came from the owner's graphs: spiky, so Q-545 is the right fix.
- **A large share of the bill is deploy churn** — ~12–15 deploy markers in three hours from two lanes
  shipping. Any before/after comparison needs a quiet-window baseline.
- **`n_live_tup` is an estimate; `count(*)` is exact.** Comparing one to the other invented a phantom
  2,169-row discrepancy mid-pack.
- **Post-crash statistics read as "never".** An unclean shutdown discards the stats file and
  `stats_reset` stays `NULL`, so zeroed counters look like lifetime zeros — that produced a wrong
  "autovacuum has never run" conclusion in a concurrent session's entry, corrected on Q-534.
- **A bare `catch` made a database outage look like a permissions problem** (Q-548) — `403 Forbidden`
  while `prod_DB` was offline sent the diagnosis after env vars for several minutes.
- **The Railway agent staged four volume shrinks and reported each as done.** None applied; Railway
  refuses down-sizing, and the staged changes coincided with the database going offline.

## Files to look at

- `lib/data/postgres/adapter.ts:4958–6067` — the rollup to extract (Q-545)
- `lib/oura-ble/plugin.ts:90–99` — the bridge with no callers
- `next.config.ts:10` — the CSP blocker (Q-546)
- `app/api/admin/db-query/route.ts:51–53` — the bare catch (Q-548)
- `components/oura-ble/oura-ble-debug.tsx:391` vs `:555` — the native gate (Q-544)

## Open questions / blockers

- **Q-551 — owner decision, deliberately deferred** until Q-545 has shrunk the server.
- **Q-547 residual** — confirm the dashed markers are deploys, and take a quiet-window baseline.
- **`error_events`** — expected to self-clear by ~2026-09-12. If it hasn't, the prune conclusion was wrong.
- **PR #82 open**, CI green pending; merge it before starting Q-545.

## Pickup prompt

```
You are Implementation Lane A on the TrainingAI repo. Set this session's title to
`Implementation Agent (A) 🚧` — exactly, emoji included.

Read in this order before doing anything: docs/agents/state/implementation-lane-a.md (your baton),
docs/agents/README.md (§3 lane contract, §5 concurrency), projectOverview.md, CLAUDE.md,
docs/implementation-backlog.md, then docs/domains/devices/README.md and
docs/superpowers/plans/2026-08-18-device-primary-compute.md.

The owner has directed focus onto the D-track: moving Oura compute off the server and onto the
phone. Take Q-546 FIRST — it is a one-line change to next.config.ts adding `wasm-unsafe-eval` to the
production script-src, and until it lands no WASM session can start on the device, which blocks all
on-device neural work. Note that lib/oura-models/__tests__/wasm-parity.test.ts passes under vitest
and proves nothing about this; the gate is an on-device assertion on the S25, not a green test.

Then take Q-545, the device rollup port. Read the plan's §3 before writing anything:
aggregateOuraRawSamples is adapter.ts:4958-6067, 1,110 lines with only 17 touching the database, so
this is an extraction behind a RollupIO port with a Postgres implementation and a local-SQLite one —
NOT a second hand-written rollup. The extraction itself must ship zero behaviour change: gate it on
the server producing identical sleep_sessions/body_metrics output over historical days before and
after.

Two hard constraints. Never call markRolledUp before the derived forms are durably written locally —
marking a frame consumed while its output is unstored lets the pruner delete raw that produced
nothing. And do not modify the ingest writer or the history cursor: they are device-verified and a
botched change there loses drained spans forever (ops-doc I18/I21).

Do not pull D4 forward. The owner chose A+B+C and body_hex stays archival on the server.

Constraints that would otherwise be re-discovered: production is healthy at 171 MB after a
2026-08-17 disk_full incident; the Railway volume is 5 GB permanently (it cannot be shrunk and bills
on use, so this is free); three CPU hypotheses are already refuted and recorded on Q-547 — do not
re-file them; and a large share of current Railway cost is deploy churn from the lanes shipping, so
any before/after cost comparison needs a quiet-window baseline.
```
