# 2026-09-03 — two test files fought over a Postgres role *and* a schema (PS-23, Lane A)

**Branch:** `fix/ps23-snapshot-test-role`

## The failure

`claude-ro-readonly-role.test.ts` and `db-snapshot-integration.test.ts` each provisioned a
`claude_readonly` role in `beforeAll` and dropped it in `afterAll`. Vitest runs files in parallel, so
together they collided — **reproduced 3 of 3** before touching anything, each passing alone. Three
signatures, all observed:

1. `duplicate key value violates unique constraint "pg_authid_rolname_index"` — both created it.
2. `permission denied for schema claude_ro` — one file's teardown revoked the other's live grants.
3. **A false schema-drift error naming an innocent column.** `readTableColumns` reads
   `information_schema.columns`, which is **privilege-filtered**, so losing a grant mid-read does not
   raise — the columns simply stop being listed, and `checkDrift` blames whatever it reaches first.

The third is why this was expensive: it is indistinguishable from a genuinely missing view and points
the reader at a column with nothing wrong with it.

## PS-23's own proposed fix was necessary and not sufficient

The entry said, in bold, *"The fix is a rename, not a lock."* The rename is right and is kept —
`db-snapshot-integration.test.ts` now provisions `claude_ro_snapshot_test`, which it can do because
the view predicates key off `app.claude_ro_owner` (set **per role**, not by name) and because it
grants itself everything it needs. The role that must literally be called `claude_readonly` is the
one the migrations GRANT to by name, and the other file keeps it.

**But the rename alone still failed 3 of 5 paired runs, on `permission denied for schema claude_ro`.**
Measured, not predicted. The reason is in the other file's own comment: it applies a whole views
migration, and every one of them opens with

```sql
DROP SCHEMA IF EXISTS claude_ro CASCADE;
```

**The shared resource is the schema, not just the role**, and no rename reaches a schema that is
being dropped. The entry was written from the role collision and stopped one layer short.

## The rest of the fix, using machinery that already existed

Both files now take `migrationTestLock` (`lib/data/postgres/__tests__/migration-test-lock.ts`) — the
advisory lock built for Q-171, already used by ten migration tests, whose stated purpose is *"two
global migrations must not run against this database at once."* A views migration that drops and
rebuilds a whole schema is exactly that.

**`claude-ro-readonly-role.test.ts` should have been taking that lock regardless of PS-23.** It runs
a global schema rebuild and held no lock, so *any* concurrent test depending on `claude_ro` was
exposed — the snapshot test is simply the one that noticed. That is a wider gap than the entry
described, closed here.

## Verification

| | before | after |
|---|---|---|
| the two files, paired | **3 of 3 failed** | **5 of 5 passed**, 27/27 tests |
| full suite | — | **754 files passed, 3 skipped, 0 failed** (6,438 tests) |

The suite count moved 752 → 754 passing, because these two now run rather than erroring out.

⚠ **A false lead worth recording.** A first pass at verification failed on `column t.seq does not
exist` — nothing to do with this change. The container's local Postgres was provisioned before #844
landed migrations 263–264; `node scripts/local-db/migrate.js` with the socket URL fixed it. A stale
local schema and a real regression look identical in a test failure.

## Not verified

Test-only change; no product code, no device path, nothing user-visible. `DATABASE_URL` must be the
**TCP** form for these files to run at all — under the socket URL they skip, which is how a green
local run can prove nothing about them.
