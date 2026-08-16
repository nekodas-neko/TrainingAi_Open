---
name: db-migrations-repository
description: Use this skill when adding or changing database schema, writing a new SQL migration, adding/changing a repository method, or wiring a new field end-to-end from DB to UI. Also trigger when the user asks to "add a column", "add a table", "store X", "persist Y", or when reviewing/writing any API route that accepts an id from the client and writes to the database (ownership/IDOR check).
---

# Database Migrations & Repository Pattern

## Migration files

- Location: `lib/data/postgres/migrations/NNN_description.sql`, zero-padded 3-digit sequential number (next after `063_meal_type_reminders_enabled.sql` is `064_...`)
- Applied automatically by `ensureSchema()` (`lib/data/postgres/client.ts`) on cold start — reads every `.sql` file in the directory, sorted, and runs it against the pool
- **Migrations MUST be idempotent** — `ensureSchema` swallows errors as "probably already ran" (`console.warn`, no throw). Always use:
  - `CREATE TABLE IF NOT EXISTS ...`
  - `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`
  - `CREATE INDEX IF NOT EXISTS ...`
- Test against the local dev Postgres (`pnpm db:local` — see CLAUDE.md's Local Development Database section) before considering a migration done. Re-running `ensureSchema` must be a clean no-op the second time.

## Wiring a new field end-to-end

1. **Migration** — add the column/table (idempotent, as above)
2. **Schema** — add/update the Drizzle table definition in `lib/data/postgres/schema.ts`
3. **Type** — add the field to the relevant type in `lib/types/*.ts`
4. **Repository interface** — `lib/data/repository.ts` declares the method signature (organized by domain section comments — Users, Programs, Progression Styles, Nutrition, etc.)
5. **Adapter** — implement in `lib/data/postgres/adapter.ts`, including any `rowToX` mapper that converts a DB row (snake_case) to the app type (camelCase)
6. **API route** — call the repository method, never `getDb()`/Drizzle directly from `app/api/**`
7. **Cache** — if this data is read via `cachedFetch`, add/extend an `invalidateCache` call on the write path (see `caching-conventions` skill)

## Never bypass the repository

All DB access goes through `WorkoutRepository` (`lib/data/repository.ts`) implemented by `lib/data/postgres/adapter.ts`. This keeps the data layer swappable and testable, and is where ownership checks live.

## Ownership checks (IDOR prevention)

Any write endpoint that accepts ids referencing rows owned by a user (session ids, exercise log ids, etc.) must verify the authenticated user owns those ids **before** writing — never trust a client-supplied id's implicit ownership. Pattern (from S18, `sync-workout`):

```ts
const owners = await repo.getWorkoutSessionOwners(sessionIds) // Map<id, userId>
const validIds = sessionIds.filter(id => owners.get(id) === currentUserId)
// skip/report mismatched ids rather than writing to them
```

Batch the ownership lookup (one query for all ids), not one query per id. Return `{ synced, skipped }` style responses so the client can surface partial failures rather than a hard error.
