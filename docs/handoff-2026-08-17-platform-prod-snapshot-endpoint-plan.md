# Handoff — 2026-08-17 · planning the prod-snapshot endpoint (Q-530)

_Domain: `platform` · Branch: `docs/q530-secret-unblocked` · PRs: **#25 merged**, **#55 open** (docs-only)_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> [`docs/domains/platform/README.md`](domains/platform/README.md), then
> [`docs/implementation-backlog.md`](implementation-backlog.md). This file covers only what *this*
> session did. The design itself lives in
> [`plans/2026-08-17-admin-db-snapshot-endpoint.md`](superpowers/plans/2026-08-17-admin-db-snapshot-endpoint.md)
> — read that before implementing anything, not this.

## Goal

Plan the admin export endpoint behind the rescoped **Q-251**: a prod-shaped database snapshot a
sandbox session can pull, so a migration's first run against real data is not production, and so the
data-gated device-verification rows have real data to render. **Planning only — nothing was
implemented, by design.**

## Current status

- **Build/test:** `pnpm check:rules` **38 of 38 passed** and `check-backlog-pointers` clean, on both
  PRs. `pnpm dev` was **not** run and did not need to be — the diff is entirely markdown plus one
  baseline constant in `scripts/check-doc-index-size.js`.
- **Device-verified:** not applicable. No client code, no native path, no safe-area surface is
  touched by anything here.
- **Production was queried read-only** via `POST /api/admin/db-query` for every number quoted below.
  Nothing was written to production.

## What shipped

| Change | Where | PR |
|---|---|---|
| The plan | `docs/superpowers/plans/2026-08-17-admin-db-snapshot-endpoint.md` | #25 |
| Q-530 queue entry, ordered step list, Lane A routing | `docs/implementation-backlog.md` | #25 |
| Q-288 re-measured and lane-routed | `docs/implementation-backlog.md` | #25 |
| Q-251 marked as split — stays open for shape (b) only | `docs/implementation-backlog.md` | #25 |
| The optional `Lane:` field, documented | `docs/implementation-backlog.md` | #25 |
| Q-530's step-3 gate flipped from ⛔ blocked to ✅ settled | backlog + plan §3.1 | #55 |
| Journal entry | `docs/overview/entries/2026-08-17-q251-export-endpoint-plan.md` | #25 |
| Plan linked from the pillar index | `docs/domains/platform/README.md` | #25 |
| One-off Q allocation (530) recorded | `docs/agents/README.md` | #25 |

## Key decisions (with rationale)

- **The endpoint reads `claude_ro`; it does not get its own scoping map.** Q-251 asked whether the
  map in `scripts/generate-claude-ro-views.js` could be *shared*. It can do better: those 80 views
  already are one-user-scoped, default-deny, and column-withheld, served by a role with no write
  grants. The endpoint paginates over them, so the second consumer reads the generator's *output*
  rather than its source and there is nothing to keep in step. Q-287's deletion plan reached the same
  "reuse it" conclusion independently — that generator now has three dependents.
- **Scoping to one user is a consent fix and never a size fix.** The owner owns **1,098,005 of
  `oura_raw_samples`' 1,098,183 rows**, so filtering removes 0.02% of the volume. This is the single
  most load-bearing measurement in the plan and it inverts the intuition Q-251 was written on.
- **Default excludes the four bulk tables.** The shaped data rehearsal actually needs is a few MB
  (90 workout sessions, 1,019 set logs, 76 sleep sessions); the 360 MB table is one domain nobody
  rehearses against in full. `?bulk=<days>` opts a window back in.
- **A separate `ADMIN_SNAPSHOT_SECRET`, not a reuse of `ADMIN_EXPORT_SECRET`.** Day-review returns 31
  days of derived scores; this returns the database. Owner approved and set it on 2026-08-17.
- **A new route, not an extension of `/api/export`.** Opposite auth models (any user vs admin+secret)
  and opposite needs on ops tables. Merging them would mean one route with two of everything.

## Gotchas / what did NOT work

- **A duplicate backlog entry was drafted and caught before landing.** The `/api/export` finding was
  written up as a fresh Q number before grepping the queue turned up **Q-288**, filed two days
  earlier on the same file with the same fix direction. Findings were folded into Q-288 and the
  number released. The queue is large enough that "this looks unfiled" is not evidence — grep first.
- **`information_schema` filters by privilege and `pg_catalog` does not.** The drift gate needs to
  enumerate `public` tables from the read-only connection, which has no `SELECT` there.
  `information_schema.tables` would return nothing; `pg_class` / `pg_attribute` return all 83 tables
  and 944 columns. Verified against production, not assumed.
- **`push_subscriptions` cannot round-trip.** All three of its withheld columns are `NOT NULL`, so a
  view row is not insertable. The restore skips the table and declares the skip. The other six
  withheld columns are nullable, so only `users.password_hash` needs a stamped value.
- **The existing CI parity test looks like it covers the drift gate and does not.** It is a *count*
  not a set of names, it is column-blind, its migration filename pin **went stale silently between
  181 and 185** (the test file documents this itself), and it checks the *local* schema while the
  standing root cause is prod drifting from the local seed. Keep it; do not treat it as sufficient.
- **`/api/export` claims to stream and does not.** `exportUserData` calls `pool.query` per table,
  buffering each result set whole. This makes fixing Q-288's coverage *without* fixing the buffering
  strictly worse than the bug — an OOM the moment a bulk table joins the list.
- **A running container cannot see a newly-set environment variable.** Confirmed here:
  `ADMIN_SNAPSHOT_SECRET` reads length 0 in this session because the container predates the owner
  setting it. That is staleness, not a missing secret.

## Deliberately NOT done

- **No implementation.** Backlog protocol splits plan and build across sessions; this was the plan.
- **No second Railway service.** Q-251 shape (b), still deferred — it buys real HTTPS and a non-prod
  origin for the APK, which nothing concretely needs yet.
- **No scrubbing/anonymisation design.** Filtering to one consenting user replaced it, which is the
  better answer: scoping is a property you get right once, scrubbing is one you must keep getting
  right.
- **No `CLAUDE.md` env-var row for `ADMIN_SNAPSHOT_SECRET`.** That is step 5's job — documenting an
  env var for a route that does not exist would be a false claim.
- **The ~10 data-gated device-verification rows were not struck.** They should close once a snapshot
  can be restored locally, but `CLAUDE.md` strikes a row when it is *observed* working, not when a
  capability that should cover it lands. Re-check per row; do not bulk-strike.

## Files to look at

- `docs/superpowers/plans/2026-08-17-admin-db-snapshot-endpoint.md` — §1 measurements, §4 the drift
  gate, §6 the leak analysis. Those three are where the design would be wrong if they are wrong.
- `scripts/generate-claude-ro-views.js` — the authority on row scoping. Step 1 adds two meta-views to
  it; the `DENY` / `VIA` / `GLOBAL` / `DENIED` classification is otherwise untouched.
- `app/api/admin/day-review/route.ts` — the `authorize()` function step 3 copies verbatim.
- `lib/data/postgres/readonly-client.ts` — the `max: 2` pool and its 10 s `statement_timeout`, which
  the chunk size is sized to fit rather than relax.
- `lib/export/full-export.ts` — Q-288's subject, and the buffering trap.

## Open questions / blockers

- **None blocking.** The one owner decision (the secret) was made and set during this session.
- **Unverifiable until step 3 ships:** neither copy of `ADMIN_SNAPSHOT_SECRET` has been exercised,
  because no code reads it. A `401` on the first real call means the two copies disagree — a
  truncated paste or trailing newline — not that the route is wrong. This is recorded in Q-530 so it
  is not misdiagnosed.
- **Q-530 and Q-288 share `lib/export/`**, which is unlisted in the lane contract. Both are Lane A;
  they must not run concurrently in different sessions, and the lane needs to claim the path in its
  baton before starting either.

## Pickup prompt

```
You are Implementation Agent (A) on the TrainingAI repo (nekodas-neko/TrainingAi_Open).
Check out main, freshly fetched.

Read in this order:
  1. projectOverview.md — status and Known Issues
  2. docs/agents/README.md — the lane contract; you are Lane A
  3. docs/agents/state/implementation-lane-a.md — your baton
  4. docs/domains/platform/README.md — the pillar index
  5. docs/superpowers/plans/2026-08-17-admin-db-snapshot-endpoint.md — the plan you are building
  6. docs/handoff-2026-08-17-platform-prod-snapshot-endpoint-plan.md — the planning session's record

Your item is Q-530 in docs/implementation-backlog.md — the admin DB snapshot endpoint. Work the
plan's §8 step order. Re-verify the entry's premise against current main first, per the backlog
protocol; the plan was written 2026-08-17 and the schema may have moved.

First concrete action: claim `scripts/` and `lib/export/` in your baton
(docs/agents/state/implementation-lane-a.md). Neither path is listed in §3 of docs/agents/README.md,
and `lib/export/` is shared with Q-288 — do not start if another session holds it.

Then step 1: add `_meta_excluded_tables` and `_meta_withheld_columns` to
scripts/generate-claude-ro-views.js, regenerate into the next free Postgres migration number (claim
it against both the migrations directory AND open PRs), and re-point the migration filename pin in
lib/data/postgres/__tests__/claude-ro-readonly-role.test.ts in the SAME commit — that pin has gone
stale silently before.

Constraints you would otherwise re-discover:
- ADMIN_SNAPSHOT_SECRET is already set by the owner in both Railway and the Claude Code environment.
  Step 3 is NOT blocked. If `echo ${#ADMIN_SNAPSHOT_SECRET}` prints 0, your container is stale.
- Nothing has verified either copy of that secret, because no code reads it yet. A 401 on your first
  end-to-end call means the two copies disagree, not that your route is wrong.
- The claude_readonly role can read pg_class/pg_attribute for public but NOT information_schema.tables
  — the drift gate must use pg_catalog.
- push_subscriptions cannot round-trip (three NOT NULL withheld columns). Skip it, declare the skip.
- The readonly pool is max:2 with a 10s statement_timeout. Size chunks to fit it; do not relax it.
- Never regenerate over an applied migration filename — ensureSchema tracks by filename and would
  skip it forever.

This is server-side only: no APK is needed, and merging is the delivery.
```
