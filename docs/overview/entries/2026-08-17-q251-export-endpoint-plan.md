## 2026-08-17 — the prod-snapshot endpoint is a paginated read of a schema that already exists

**Branch:** `claude/q251-export-endpoint-plan-6e1b7j` · **Domain:** `platform` ·
Planning session, docs only. Nothing implemented.

### What was asked

Plan the admin export endpoint behind the rescoped **Q-251** — a prod-shaped database snapshot for
local migration rehearsal and data-shape realism — reusing the row-scoping map in
`scripts/generate-claude-ro-views.js` rather than duplicating it, and say plainly whether it is worth
its risk.

### The answer, and it is smaller than the entry implied

Build it, as **Q-530**, plan in
[`plans/2026-08-17-admin-db-snapshot-endpoint.md`](../../superpowers/plans/2026-08-17-admin-db-snapshot-endpoint.md).

The scoping map does not need to be shared, extracted, or imported. **`claude_ro` already *is* the
export**: 80 views, one user, default-deny, nine columns withheld, served by a role with no write
grants and its own `max: 2` pool. The endpoint paginates `SELECT *` over that schema. One map, in one
file, and the second consumer reads its output rather than its source — so there is nothing to keep
in step. ([Q-287's deletion plan](../../superpowers/plans/2026-08-16-account-deletion.md) reached the
same "reuse it, do not rebuild it" conclusion for a third consumer.)

### Three measurements against production that changed the design

- **The DB is 477 MB and `oura_raw_samples` is 360 MB of it — with 1,098,005 of its 1,098,183 rows
  belonging to the owner.** Filtering to one user removes **0.02%** of the volume. Scoping is a
  consent fix and never a size fix, and Q-251 should not be read as implying otherwise. The shaped
  data rehearsal actually needs is a few MB (90 workout sessions, 1,019 set logs, 76 sleep sessions),
  so the default export omits the four bulk tables and a `?bulk=<days>` parameter opts a window back.
- **The `claude_readonly` role can read `pg_class` / `pg_attribute` for `public`** — 83 tables, 944
  columns — despite holding no `SELECT` privilege there, because `pg_catalog` does not filter by
  privilege the way `information_schema` does. That is what makes the drift gate implementable from
  the read-only connection: **a table added without regenerating the views makes the export fail and
  names it**, rather than being silently omitted, computed from the live database at request time.
- **Every production table has a primary key**, so keyset pagination has no fallback case to design.
  `pg-cursor` is not a dependency and is not needed.

### The existing CI parity test is kept, and is not sufficient

`claude-ro-readonly-role.test.ts` asserts `views == tables - 2`. It is a **count** rather than a set
of names, it is **column-blind**, its migration filename pin **went stale silently between 181 and
185** (the file says so itself), and it checks the **local** schema — while `CLAUDE.md`'s standing
root cause is prod drifting from the fresh local seed. It also skips entirely under the Unix-socket
`DATABASE_URL` the session-start hook writes, so it does not run in a sandbox session at all; CI uses
the TCP form and does run it.

### A near-duplicate, caught before it landed

The `/api/export` coverage defect was drafted here as a fresh Q number before grepping the queue
turned up **Q-288**, filed 2026-08-15, covering the same file with the same fix direction. Folded the
new findings into Q-288 instead and released the number.

Two corrections and one new defect went into it: the count is **26 of 82 tables**, not 27 of 80 (the
old figure counted `goals`, a repository call rather than a table); ten further omissions including
the user's own `users` profile row; and — new — **the route cannot stream a large table, while its
comment claims it can.** `exportUserData` calls `pool.query` per table, buffering each result set
whole. Harmless across 26 small tables, an OOM the moment a bulk table is added to close the coverage
gap, which means **fixing coverage without fixing the buffering is strictly worse than the bug.**

### On the risk

The leak analysis is plan §6. Short version: total health-data disclosure for one person, **no**
account takeover, no write path, no other user's rows. The marginal risk over today is small, because
`CLAUDE_DB_QUERY_SECRET` already sits in every agent session's environment and already reads exactly
this data through the same views and the same role — the snapshot adds bulk egress speed and a second
key, not a new data class. A **separate** `ADMIN_SNAPSHOT_SECRET` is recommended over reusing
`ADMIN_EXPORT_SECRET`, so a leak of one is not a leak of both. Secret handling is confirm-first, so
the variable itself is flagged for the owner in the entry.

### Also this session

The `error_events` orientation read found nothing new: the largest signature is the `[pg 21000]`
cardinality fault on `/api/hr-ingest`, already recorded and fixed under **Q-214**, with its latest
hit on 2026-08-13. No new Known-Issues row was owed.

### Not exercised

Nothing was built. The production numbers, the `pg_catalog` readability, the primary-key coverage and
the withheld-column nullability were each run and are quoted from output. The endpoint, the restore
path, and the load behaviour of a bulk pull do not exist yet. No client code and no device surface is
touched by any of this.
