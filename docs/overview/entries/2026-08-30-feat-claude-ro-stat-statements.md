# 2026-08-30 — query timings reach the audit role (BF-21), Lane A

**Branch:** `feat/claude-ro-stat-statements` · **Lane A** · migration **242** · no version bump
(nothing user-visible).

## What this is

BF-21's second half. The owner cleared the gate the same day — `shared_preload_libraries` includes
`pg_stat_statements` on the production Postgres and the extension is installed — but the read-only
role still could not see it: `claude_readonly`'s `search_path` is `claude_ro` alone and that schema
is **default-deny**, so anything without a view is unreachable. This adds the view.

## Two decisions, and both are the reason it is not a one-liner

**It goes in the GENERATOR, not in a hand-written migration.** `scripts/generate-claude-ro-views.js`
DROPs and rebuilds the whole `claude_ro` schema on every run. A view written by hand into migration
242 would survive exactly until the next table was added and regenerated — then vanish, with nothing
to say so. `_meta_withheld_columns` is the existing precedent for a non-table view living there.

**It is guarded on `to_regclass('public.pg_stat_statements')`.** The extension is production-only: it
needs a preload and a restart, so neither the local dev DB nor CI's Postgres container has it, and an
unguarded `CREATE VIEW` over a missing relation fails. This migration runs through `ensureSchema` on
cold start, so that is not a warning — it is the app down. The mutation that removes the guard fails
the whole test file rather than one case, which is the failure mode demonstrating itself.

## Not user-scoped, deliberately

Every other view in `claude_ro` is row-scoped to one user because production holds other people's
health data. This one is not, and that is correct rather than an omission: `pg_stat_statements`
stores **normalised** query text — literals are replaced with `$n` placeholders — so it carries query
shapes and timings and never a parameter value or a row.

That safety is a property of the **column list**, so the column list is tested. Five columns:
`query, calls, total_exec_time, mean_exec_time, rows`. A test refuses `queryid`, `userid`, `dbid`
and the block-I/O counters — `queryid` in particular is the one that would let a reader join back to
something.

## Verified

Both branches of the guard exercised against the local Postgres:

| | views in `claude_ro` | `claude_ro.pg_stat_statements` |
|---|---|---|
| extension absent (the local default) | 94 | absent |
| extension created | 95 | present, exactly the five columns |

`CREATE EXTENSION` succeeds without the preload and only errors when the table is *queried*, which is
what made the positive branch testable at all here. Restored afterwards with `DROP EXTENSION …
CASCADE` — noted in the migration, because the view makes `claude_ro` depend on the extension.

Mutation-proven, anchors asserted first — three mutations, all killed: guard removed (fails the file,
as the real failure would), `queryid` exposed, `SELECT *`.

`claude-ro-readonly-role.test.ts` 22/22 — **run with the TCP `DATABASE_URL`**, since it re-points the
URL at another Postgres role and skips under the session hook's socket form. Its "every base table
has a view" count now excludes `pg_stat_statements` for a second reason beyond the `_meta_` one: the
view exists only where the extension does, so counting it would make the assertion depend on which
database it ran against.

Full suite green; `pnpm check:rules` Ran 62 of 62; `tsc --noEmit` clean.

## One thing the naming forced

The migration is `242_claude_ro_views_pg_stat_statements.sql`, not `242_claude_ro_pg_stat_statements`.
The drift-gate test picks the newest file matching `^\d+_claude_ro_views.*\.sql$` and asserts it
carries no bare owner uuid — a name outside that pattern would have left the gate checking migration
**241** while 242 was the live schema. Renamed before it left the branch.

## Not exercised

- **Production.** The counters live there and start empty from the restart; nothing here can read
  them from a sandbox. The entry's own pass test — a session running
  `SELECT query, calls, mean_exec_time FROM claude_ro.pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20`
  and getting rows — is satisfiable only after this deploys and a day of normal use has accumulated.
  Check `pg_stat_statements_info.dealloc` is 0 before treating the table as complete: the default
  5,000-statement cap silently evicts the least-executed shapes.
- **No device surface**; no UI, no client code.
- **Do not close the slow-load question on a clean read here.** BF-19 already measured the database
  and it is not where the reported slowness is (`SELECT 1` in 3 ms, 99.90 % cache hit, nothing idle
  in transaction). This is a baseline that will catch a future regression.
