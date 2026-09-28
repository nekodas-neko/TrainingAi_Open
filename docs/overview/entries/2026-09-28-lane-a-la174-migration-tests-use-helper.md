# 2026-09-28 — LA-174: migration tests run their SQL through the helper built for them

`planned-pct-bodyweight-migration.test.ts` deadlocked under the full suite and passed alone. The repo
had already solved this class: `runMigrationSql()` prefixes `LOCK TABLE users IN SHARE MODE`, so a
table-wide data migration cannot interleave with the suite's user deletes (DV-3). That test called a
bare `pool.query(migrationSql())` instead. **Eight migration test files did the same.** The advisory
lock they all take only serialises migrations against each other.

- All eight now call `runMigrationSql`. `q228`'s idempotency case reads the query result, so it takes
  the last entry of the multi-statement result.
- **No retry.** `migration-test-lock.ts` explains why (Q-171), and it was followed.
- A static test fails if any file that takes the migration lock runs migration SQL with a bare
  `pool.query`; putting one bare call back fails it.
- The 12 migration test files pass 65/65.

Out of scope: `q536-merge-redrain-clock-epochs` runs an Oura clock-epoch migration without the lock
helper. Its tables are not the shared workout tables this deadlock involved.
