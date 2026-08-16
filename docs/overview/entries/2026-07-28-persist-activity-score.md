# Q-7 — the Activity Score was computed every call and thrown away

`/api/readiness-score` computes `activityBlend.final` on every request and never stored it, while
`/api/health/trends:99` falls back to `oura_daily.activity_score` — NULL for **every day since
2026-07-08**, because the Oura Cloud stopped scoring at the BLE re-key. Activity Score v2 shipped in
v1.207.0 with **0 of 20 days** of history behind it.

## What shipped

A third compute-and-persist block in the same route, directly modelled on the readiness and sleep
ones already there: today's date key (matching how the trends route reads it), only the `activity_*`
columns — never the shared `source`/`model_versions`, which the COALESCE upsert replaces wholesale
and would clobber `body_comp`/illness provenance on the same row — and best-effort, so a persist
failure can never fail the read.

The blend is stored alongside the score (`base`, `adjustment`, `trained`) so a stored value can be
explained after the fact rather than being an unexplainable integer.

## Why server-side, given the offline-first direction

The owner's steer is device-owned, minimal Railway. This still fits:

- The value is **already computed here** on every call. Persisting it adds no new server
  responsibility; not persisting it just discards work the server already did.
- `oura_daily_derived.activity_score` is a **COALESCE** column, so when the on-device rollup lands
  (Phase-1 Task 5 → Phase-2 Task A2) its push fills or overwrites the same field without conflict.
  Persisting now costs no future device work and forks nothing.

## The rest of Q-7 was misdiagnosed — re-filed as Q-7b

The finding attributed eight other NULL columns to a device push that "has never run". Tracing the
chain found the opposite: **there is nothing on the device that could push them.**

- **Zero** `queueMutation` call sites exist for `oura_daily_derived`/`oura_daily_summary`. The
  domains are registered (`lib/sync/mutation-schema.ts:15`) but unused —
  `lib/local-store/index.ts:80` says *"Currently inert: nothing queues these mutations until D2
  lands."*
- The local table's only live writer is `applyDelta`, which hardcodes `sync_status = 'synced'` and
  therefore can never produce an outbox row. The standalone local writer
  (`sqlite-backend.ts:604`) is called only from its own test.
- **`lib/oura-ble/rollup/` does not exist.** `lib/sqlite/migrations.ts:1030` states it plainly, as
  the justification for a destructive v18 migration: *"the rollup that writes them isn't built yet."*
- The push loop (`sync-engine.ts:671`, no domain filter) and the server branch (`adapter.ts:3754`)
  are both complete and correct. **Nothing in the sync layer needs fixing.**

`worn_hours_ble`, `active_calories_est` and `pwv` are written *only* inside the device-push branch,
so they are unreachable by construction — exactly the hazard the Phase-2 plan flagged at its line 47.

Re-filed as **Q-7b**, whose main purpose is to stop a future session treating this as a sync bug and
"fixing" a layer that already works. The real work is Phase-1 Task 5/6 then Phase-2 Task A2, both
planned and entry-gate-cleared, neither started.

## A test that passed while proving nothing

The first version of the new test allowed a null-score branch (`if (body.activityScore == null)
return`). It passed — and persisted nothing, because the seeded user had no activity signal at all.
Fixed by seeding real steps and active calories in `beforeAll` and removing the conditional entirely,
then confirmed by disabling the persist and watching the test go red.

## Also fixed here: conflict markers committed to `main`

`docs/implementation-backlog.md` on `main` carried literal `<<<<<<< HEAD` / `=======` / `>>>>>>>`
markers from PR 72def97, which duplicated the Q-2 heading (the superseded first version alongside the
current one). Docs-only, so no CI check caught it. Resolved here, keeping the current Q-2 entry and
that PR's new Q-21 flaky-test entry.

## Verification

Typecheck, lint and both custom-rule checks clean; full suite green. New DB-backed tests: the score
persists for today with its blend recorded, and the shared provenance columns survive the write.

**Not exercised — on-device.** Server-side only.
