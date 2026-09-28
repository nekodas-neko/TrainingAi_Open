# 2026-09-28 — the admin DB snapshot was cut off at `pg_stat_statements`, and the loader committed what it got

Setting up a persistent Lane A environment (owner's goal: a local agent with a prod-shaped test
database that survives between PRs) was the first real use of `pnpm db:snapshot` on this machine,
and it found four defects.

- **Server (production):** `/api/admin/db-snapshot` streams every `claude_ro` view, and one of them,
  `pg_stat_statements`, has no public base table. `getPrimaryKeyColumns` threw on it, so every
  snapshot ended after `personal_records`, with `users`, `workout_sessions`, `set_logs` and 28 more
  missing. The stream reported it only as a trailing `{"error"}` line after a 200. Views with no
  base table are now omitted with a reason.
- **Loader:**
  - It ignored that error line and TRUNCATE-then-committed, emptying every table the stream never
    reached. It now refuses a failed stream before touching anything, and checks the per-table
    counts *before* COMMIT, rolling back on a mismatch.
  - node-postgres binds a JS array as a Postgres array literal, so a json/jsonb column holding an
    array failed with "invalid input syntax for type json". Those values are now stringified.
  - A view can carry a computed column the table lacks (`food_items.image_bytes`, four `has_*`
    flags on `oura_tokens`). Only the target's columns are loaded, and the rest are named.
  - The port guard was pinned to 5433 and it ran `setup.sh`, which assumes the cloud container's
    cluster. The port now comes from `LOCAL_DB_PORT`, and the step runs `migrate.js` against the
    target.

`docs/local-agent-environment.md` §④ records the persistent-worktree setup: one worktree per lane,
installed once (12.5 s), its own `.env.local` with no production database, and its own database
that can be rebuilt or snapshotted.

**Not verified yet:** a full successful load. It needs the server fix deployed. Checked instead:
the loader refuses the current broken stream and leaves the seed intact (1 user, 9 sessions).
