# 2026-09-28 — RV-190: an admin query can no longer leave session state on a pooled connection

**Lane A · auth/security · held for the owner's merge-time yes (RV-221).**

- **The hole:** `claude_readonly` only sets session defaults: the owner scope, read-only mode and
  the statement timeout. Any query could change them with `set_config(..., false)`, and on the
  2-connection pool the change outlived the request. A later honest query could then read another
  user's rows, write, or run unbounded.
- **Fix:** `withReadonlyClient` (`lib/data/postgres/readonly-client.ts`) replaces every
  `pool.query` in `db-query` and `db-snapshot`.
  - It runs `BEGIN TRANSACTION READ ONLY` → `SET LOCAL statement_timeout` → work → `ROLLBACK` →
    `DISCARD ALL`.
  - If cleanup fails, the client is destroyed rather than returned to the pool.
  - `db-query` also sends its statement in **extended protocol**, so Postgres refuses a second
    statement, behind the existing `;` check.
  - The snapshot now runs as one transaction, which also makes it a single consistent read. Each
    row count gets a savepoint, so one failed count no longer aborts the export.
- **Verified:**
  - The real-Postgres cases in `claude-ro-readonly-role.test.ts`: a control proving a raw
    override persists; the scope, timeout and read-only mode revert across reuse of the same
    backend pid; no widened scope in a later request; read-only per transaction; extended mode
    refuses two statements. With `db-snapshot-integration`, 32 of 32 ran and passed.
  - `pnpm dev` against a locally provisioned role, using throwaway local secrets: an override
    request, then three requests on the same pid, each seeing the defaults; the schema GET; and a
    snapshot export.
- **Two existing tests changed:**
  - The snapshot's failed-count case now fails only the count.
  - The bulk pass-through case now reads its stream; it had only passed because `start()` reached
    `bulkWindowFor` within a few microtasks.
- **Not exercised:** production. Nothing was probed there. `OR-138` (#1499) should now build its
  owner widening with `SET LOCAL` inside this wrapper.
