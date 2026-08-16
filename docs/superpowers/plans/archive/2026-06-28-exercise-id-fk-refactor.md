# Exercise ID FK Refactor — Implementation Plan

**Created:** 2026-06-28  
**Status:** Ready for execution  
**Risk:** HIGH — touches core data model; requires careful migration

## Problem

Five tables reference exercises by `exercise_name TEXT`:
- `session_exercises.exercise_name`
- `exercise_logs.exercise_name`
- `personal_records.exercise_name` (PK-like usage)
- `exercise_media.exercise_name`
- `exercise_gif_cache.exercise_name` (appears to be in `session_exercises` join)

Name-keyed lookups break silently on rename, prevent true deduplication across case/spacing variants, and block proper FK cascades.

`exercise_library` already has `id UUID PRIMARY KEY` — it's already the right canonical identifier.

## Goal

Add `exercise_id UUID FK → exercise_library.id` to the four affected tables. Keep `exercise_name` as a **denormalised display column** for now (avoids JOIN overhead on every log read). Remove name as the join key in adapter queries; replace with `exercise_id`.

## Migration Strategy (two-phase)

### Phase A — Add nullable FK + backfill (migration 099)

```sql
-- Step 1: Add nullable columns
ALTER TABLE session_exercises ADD COLUMN IF NOT EXISTS exercise_id UUID REFERENCES exercise_library(id) ON DELETE SET NULL;
ALTER TABLE exercise_logs     ADD COLUMN IF NOT EXISTS exercise_id UUID REFERENCES exercise_library(id) ON DELETE SET NULL;
ALTER TABLE personal_records  ADD COLUMN IF NOT EXISTS exercise_id UUID REFERENCES exercise_library(id) ON DELETE SET NULL;
ALTER TABLE exercise_media    ADD COLUMN IF NOT EXISTS exercise_id UUID REFERENCES exercise_library(id) ON DELETE SET NULL;

-- Step 2: Backfill from exercise_library where names match exactly
UPDATE session_exercises se
  SET exercise_id = el.id
  FROM exercise_library el
  WHERE el.name = se.exercise_name AND se.exercise_id IS NULL;

UPDATE exercise_logs exl
  SET exercise_id = el.id
  FROM exercise_library el
  WHERE el.name = exl.exercise_name AND exl.exercise_id IS NULL;

UPDATE personal_records pr
  SET exercise_id = el.id
  FROM exercise_library el
  WHERE el.name = pr.exercise_name AND pr.exercise_id IS NULL;

UPDATE exercise_media em
  SET exercise_id = el.id
  FROM exercise_library el
  WHERE el.name = em.exercise_name AND em.exercise_id IS NULL;

-- Step 3: Indexes for FK lookups
CREATE INDEX IF NOT EXISTS idx_session_exercises_exercise_id ON session_exercises(exercise_id);
CREATE INDEX IF NOT EXISTS idx_exercise_logs_exercise_id     ON exercise_logs(exercise_id);
CREATE INDEX IF NOT EXISTS idx_personal_records_exercise_id  ON personal_records(exercise_id);
```

### Phase B — Make NOT NULL + drop name-keying (migration 100)

Only run after Phase A has been on production for at least 24 hours and all new writes include `exercise_id`.

```sql
-- Require exercise_id (any remaining NULL rows = exercises not in library — warn, don't block)
-- Actually: skip NOT NULL constraint for now to handle custom exercises not in library
-- Instead, add a check index:
CREATE INDEX IF NOT EXISTS idx_exercise_logs_no_id_count ON exercise_logs(exercise_name) WHERE exercise_id IS NULL;
-- (Helps find orphans for later cleanup)
```

## Adapter Changes

After migration 099, update these methods in `adapter.ts`:

### `getLastExerciseLogsBatch(userId, exerciseLogIds)`
Currently: O(n·m) JS filtering. Already flagged for improvement in Phase 1.2d.  
After: `WHERE el.exercise_id = ANY(...)` grouped query.

### `listPersonalRecords(userId)`
Currently: returns `Map<string, number>` (exerciseName → 1RM).  
After: returns `Map<string, number>` still (name is still stored), but internally looks up by exercise_id when available.

### `logExerciseAndSets(...)` 
After: write `exercise_id` when calling; look up exercise_id from library if not provided.

### `upsertPersonalRecordIfBetter(userId, exerciseName, estimated1rm)`
After: look up `exercise_id` from library; write both name + id.

## Client-Side Changes

The client currently passes `exercise_name` strings everywhere. No client-side changes needed in Phase A — the server handles the FK lookup on write, and still returns `exercise_name` for display.

Phase B (later) could add `exercise_id` to API responses for deep-linking to exercise detail pages, but this is not required for correctness.

## Risks

1. **Custom exercises** (not in library): their `exercise_id` will stay NULL. This is acceptable — they can't be deduplicated but won't break.
2. **Case sensitivity**: if DB has "bench press" and library has "Bench Press", backfill won't match. Query: `SELECT DISTINCT exercise_name FROM exercise_logs WHERE exercise_id IS NULL LIMIT 20` will reveal these after migration.
3. **Migration timing**: backfill must complete before NOT NULL constraint is applied. On Railway with current DB size, backfill should be fast (<1s).

## Verification

```sql
-- Check backfill coverage
SELECT COUNT(*) FILTER (WHERE exercise_id IS NOT NULL) AS with_id,
       COUNT(*) FILTER (WHERE exercise_id IS NULL) AS without_id
FROM exercise_logs;

-- Find unmatched exercise names
SELECT DISTINCT exercise_name FROM exercise_logs WHERE exercise_id IS NULL LIMIT 20;
```

After Phase A: most rows should have `exercise_id`. Unmatched = custom exercises or name mismatches (fix manually or via case-insensitive backfill).

## Execution Order

1. Run migration 099 (Phase A)
2. Verify backfill coverage
3. Update adapter to write `exercise_id` on new log writes
4. Monitor production for 24h+
5. Run migration 100 (Phase B) — make NOT NULL optional, add indexes
6. In a future session: drop name-keying from adapter queries

## Files to Change

| File | Change |
|---|---|
| `lib/data/postgres/migrations/099_exercise_id_fk.sql` | Phase A migration |
| `lib/data/postgres/schema.ts` | Add `exerciseId` to 4 tables |
| `lib/data/postgres/adapter.ts` | Write `exercise_id` in log writes; update batch query |
| `lib/data/repository.ts` | No interface changes needed |
