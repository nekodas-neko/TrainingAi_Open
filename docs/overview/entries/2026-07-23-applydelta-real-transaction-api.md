## 2026-07-23 — Fix: applyDelta transaction uses the plugin's real begin/commit API (v1.208.4)

**Branch:** `claude/oura-ondevice-hybrid-phase-2-f4ahnd`. Third fix in the same on-device "Sync failed"
investigation (#761 surfaced the error, #769 unmasked it, #779 fixed the missing-column cause) — after
#779 deployed, the missing-column error was gone but a **new** error surfaced at the same failure site:

> `SQL failed [COMMIT]: Run: Cannot perform this operation because there is no current transaction.`

### Root cause
`applyDelta` (and `logWorkoutLocally`) managed their transaction by sending literal `'BEGIN'`, `'COMMIT'`,
`'ROLLBACK'` **SQL text** through the shared `runSQL()` helper, which calls `_db.run(sql, values)` —
`@capacitor-community/sqlite`'s `SQLiteDBConnection.run(statement, values, transaction = true, ...)`
**defaults its own `transaction` param to `true`** (confirmed from the plugin's `definitions.js`), meaning
**every individual `.run()` call auto-wraps itself in its own begin+commit** unless told otherwise. So the
sequence `runSQL('BEGIN')` → `runSQL(insert1)` → `runSQL(insert2)` → … → `runSQL('COMMIT')` never actually
ran as one atomic transaction: the *first* insert's own auto-commit closed out whatever the literal `BEGIN`
opened, every following write then auto-committed itself in isolation (so data still landed correctly, just
non-atomically), and by the time the code reached the final literal `COMMIT`, the plugin's own bookkeeping
already believed no transaction was open — hence the exact error observed.

### The fix
Use the plugin's **real** transaction API (`SQLiteDBConnection.beginTransaction()` /
`.commitTransaction()` / `.rollbackTransaction()` — first-class methods, not raw SQL text) instead of
literal `BEGIN`/`COMMIT`/`ROLLBACK` strings:
- `lib/sqlite/sqlite-service.ts`: new exported `beginTransaction()`/`commitTransaction()`/
  `rollbackTransaction()` wrapping the plugin's real methods, tracked via a module-level `_inTransaction`
  flag. `runSQL()` now passes `transaction: !_inTransaction` to `_db.run()` — unchanged (`true`) for the
  overwhelming majority of call sites outside any manual transaction (zero behaviour change there), but
  `false` for every write made while a manual transaction is open, so those writes correctly participate in
  the outer transaction instead of each auto-committing itself.
- `lib/local-store/sqlite-backend.ts`: both transaction blocks (`logWorkoutLocally`, `applyDelta`) now call
  `beginTransaction()`/`commitTransaction()`/`rollbackTransaction()` instead of `runSQL('BEGIN'|'COMMIT'|'ROLLBACK', [])`.
  No changes needed to any of the dozens of individual write call sites inside either transaction body — the
  fix lives entirely at the two start/end points plus the single `runSQL` choke point.

### Verification (sandbox)
- Rewrote the two `applyDelta batching` tests that asserted the (broken) literal-SQL pattern — they now
  assert `beginTransaction`/`commitTransaction`/`rollbackTransaction` are called (in the right order
  relative to the writes) and that no literal `BEGIN`/`COMMIT`/`ROLLBACK` string is ever sent through
  `runSQL`. `lib/local-store` full suite green (52 tests).
- Did **not** add a real-SQLite (`node:sqlite`) repro this time — that plugin-specific auto-transaction-wrap
  behaviour doesn't exist in plain SQLite, so a real-execution test couldn't have caught this bug or
  verified this fix; the mock-based call-sequencing tests are the correct verification tool here. (Also
  avoids repeating the Node-22-only `node:sqlite` CI mistake from the #761 iteration.)
- `tsc`: only the 2 pre-existing `onnxruntime-web` errors. Changed-file eslint clean. `check-reconcile` +
  `check-push-mutations` green.
- **Cannot be verified end-to-end in the sandbox** — this is a real native-plugin transaction-semantics bug;
  the owner's next Sync/Restore retry is the actual proof.

### User-visible → bumped
`package.json` 1.208.3 → **1.208.4** (patch, bug fix) + `lib/changelog.ts` entry.
