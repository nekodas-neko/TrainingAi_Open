# 2026-08-30 — the console counts rows instead of guessing them (BF-54), Lane A

**Branch:** `fix/db-footprint-real-counts` · **Lane A** · no migration · admin-console only, so no
version bump.

## What this is

BF-54, from the owner's D2/D5 device screenshots and then measured against production. Two sites in
`lib/data/postgres/slices/oura.ts` read `n_live_tup` — a planner **estimate** maintained by
autovacuum, which CLAUDE.md already documents as untrustworthy here because `last_analyze` is NULL
on every table in this database.

The gap is not marginal:

| Table | `n_live_tup` | real `count(*)` | under-read |
|---|---|---|---|
| `oura_raw_samples` | 552 | 180,415 | 327× |
| `rr_intervals` | 0 | 87,015 | ∞ |
| `error_events` | 1 | 6,102 | 6,102× |

## The display was the smaller half

`getOuraStorageStats` printed the estimate under a column headed **rows** — the owner's screen showed
297 directly below a line reading "0 / 180,160", three orders of magnitude apart on one screen.

`vacuumTableFull` used the same counter to **justify a VACUUM FULL**, and its own comment states the
reasoning: *"A huge `before` against a handful of live rows is the signature of pure bloat."* Against
`oura_raw_samples` that read 67 MB against 552 rows and said *pure bloat*, on a table holding 180,415
real rows. Acting on it takes an **ACCESS EXCLUSIVE lock** with the timeouts deliberately lifted, and
reclaims nothing.

## The fix

`count(*)` at both sites. The footprint gets one `UNION ALL` of counts across the 14-table allowlist,
joined to the size query by name; the reclaim counts the one table it is about to rewrite.

**Cost was checked rather than assumed.** Counting 14 tables is a seq scan of tens of MB on a screen
pressed occasionally — and the same function already does a *far* more expensive full scan with
`pg_column_size` over the largest table in the set. The count before a VACUUM FULL is trivial beside
the rewrite it justifies.

**The sizes are untouched, and that distinction is the point.** `pg_total_relation_size` is read from
the filesystem and is exact; only the ROW columns of `pg_stat_user_tables` are estimates. Conflating
the two cost a session before (Q-528, a data-loss incident filed against a table that had never lost
anything), so a test pins the sizes still matching too.

## Verified

Six tests in `lib/data/postgres/__tests__/storage-footprint-real-counts.test.ts`. The one that
matters **reproduces the estimate being wrong** rather than assuming it: ANALYZE, insert 9 rows,
never ANALYZE again — the state this database is permanently in — then assert `estimate < real` and
that the reported figure is `real`. If autovacuum ever runs mid-test that assertion fails rather than
silently proving nothing, which is deliberate.

The VACUUM path is asserted at **source**, not run: it takes an ACCESS EXCLUSIVE lock with
`statement_timeout = 0` against a database every other test file in this directory shares — the wedge
CLAUDE.md warns about — for a change that is one expression. The prohibition strips comments first,
because this file now *explains* `n_live_tup` at length and a check that could not tell an
explanation from a use would force the next reader to delete the explanation to keep it green.

Mutation-proven, anchors asserted first — four mutations, all killed: the estimate restored in the
size query, counts dropped on the way out, the reclaim reverted to the estimate, sizes zeroed. **One
survived and is left surviving:** the identifier guard in front of the `sql.raw` interpolation. Its
input is a module constant of valid identifiers, so no fixture can reach it — it is there because it
guards a raw interpolation and because `vacuumTableFull` twenty lines below applies exactly the same
belt-and-braces for the same reason.

**Sibling sweep complete:** `grep -rn n_live_tup` over the tree found two call sites and both were in
this file. A test freezes that at zero outside comments.

`pnpm dev` against the local Postgres: `GET /api/oura-ble/db-stats` as an admin returns
`oura_raw_samples: rows 4226`, matching `count(*)` exactly.

Full suite green; `pnpm check:rules` Ran 62 of 62; `tsc --noEmit` clean.

## Not exercised

- **Production**, which is where the divergence actually is. On the local dev DB autovacuum keeps up
  on tables this small, so the dev-server check confirms the route works and *not* that it changed
  the answer — the unit test is what forces the divergence, deterministically.
- **The VACUUM FULL itself** was not run, for the reason above.
- **No device surface**; this is an admin console reached in a browser.
- BF-55 — the 84 MB-index / ~7×-trend growth finding measured beside this one — is **not** addressed
  here. It stays in the queue, and its first move is measurement, not a VACUUM.
