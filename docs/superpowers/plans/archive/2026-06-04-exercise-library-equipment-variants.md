> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Exercise Library Equipment Variants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace generic multi-equipment exercise names in the DB with equipment-specific variants (e.g. `Squat` → `Barbell Squat`) so GIF matching is accurate, AI-generated programs are unambiguous, and the display-name prefix hack in `workout-data/route.ts` becomes unnecessary.

**Architecture:** A single SQL migration (032) handles all renames, inserts new variants, then updates every string reference across `session_exercises`, `exercise_logs`, and `personal_records`. The GIF matcher gets new `MANUAL_OVERRIDES` and `DIRECT_URL_OVERRIDES` for renamed names. The stale `exercise_gif_cache` entries are cleared as part of the migration so they are re-fetched on next use. The `buildDisplayName` prefix logic in `workout-data/route.ts` is removed afterwards since it is no longer needed.

**Tech Stack:** PostgreSQL (Drizzle ORM), Next.js API routes, TypeScript. No new dependencies.

---

## Rename / Split Map

This is the authoritative mapping used throughout every task below. Copy it exactly — do not invent alternatives.

### Renames (old name → canonical new name, single entry)

| Old name | New name | Equipment |
|---|---|---|
| `Squat` | `Barbell Squat` | `['barbell']` |
| `Deadlift` | `Barbell Deadlift` | `['barbell']` |
| `Front Squat` | `Barbell Front Squat` | `['barbell']` |
| `Good Morning` | `Barbell Good Morning` | `['barbell']` |
| `Hip Thrust` | `Barbell Hip Thrust` | `['barbell']` |
| `Hammer Curl` | `Dumbbell Hammer Curl` | `['dumbbell', 'kettlebell']` |
| `Dumbbell Curl` | `Dumbbell Curl` | `['dumbbell', 'kettlebell']` _(no rename, already specific)_ |

### Deduplication (two library rows → one canonical name)

| Keep | Delete (update refs first) | Notes |
|---|---|---|
| `Barbell Bench Press` | `Bench Press` | 008 already added `Barbell Bench Press` |
| `Barbell Front Squat` | `Front Squat`, `Front Barbell Squat` | 008 added `Front Barbell Squat` — pick one canonical name |
| `Barbell Hip Thrust` | `Hip Thrust`, `Hip Thrusts` | 008 added `Hip Thrusts`; 030 has `Hip Thrust` |
| `Bent-Over Barbell Row` | `Barbell Row`, `Bent Over Barbell Row` | 008 added `Bent Over Barbell Row`; normalise hyphen |
| `Machine Calf Raise` | `Calf Raise`, `Calf Raises` | 008 added `Calf Raises` |

### Splits (one old entry → multiple new entries; refs default to primary variant)

| Old name | New entries | Default for existing refs |
|---|---|---|
| `Overhead Press` | `Barbell Overhead Press` `['barbell']`, `Dumbbell Overhead Press` `['dumbbell']` | `Barbell Overhead Press` |
| `Lateral Raise` | `Dumbbell Lateral Raise` `['dumbbell','kettlebell']`, `Cable Lateral Raise` `['cable']` | `Dumbbell Lateral Raise` |
| `Front Raise` | `Dumbbell Front Raise` `['dumbbell','kettlebell']`, `Cable Front Raise` `['cable']` | `Dumbbell Front Raise` |
| `Reverse Fly` | `Dumbbell Reverse Fly` `['dumbbell']`, `Cable Reverse Fly` `['cable']` | `Dumbbell Reverse Fly` |
| `Upright Row` | `Barbell Upright Row` `['barbell']`, `Cable Upright Row` `['cable']` | `Barbell Upright Row` |
| `Shrug` | `Barbell Shrug` `['barbell']`, `Dumbbell Shrug` `['dumbbell']` | `Barbell Shrug` |
| `Skull Crusher` | `Barbell Skull Crusher` `['barbell']`, `Dumbbell Skull Crusher` `['dumbbell']` | `Barbell Skull Crusher` |
| `Overhead Tricep Ext` | `Cable Overhead Tricep Extension` `['cable']`, `Dumbbell Overhead Tricep Extension` `['dumbbell']` | `Cable Overhead Tricep Extension` |
| `Romanian Deadlift` | `Barbell Romanian Deadlift` `['barbell']`, `Dumbbell Romanian Deadlift` `['dumbbell']` | `Barbell Romanian Deadlift` |
| `Bulgarian Split Squat` | `Barbell Bulgarian Split Squat` `['barbell']`, `Dumbbell Bulgarian Split Squat` `['dumbbell','kettlebell']` | `Barbell Bulgarian Split Squat` |
| `Glute Bridge` | `Barbell Glute Bridge` `['barbell']`, `Bodyweight Glute Bridge` `['bodyweight']` | `Barbell Glute Bridge` |
| `Calf Raise` / `Calf Raises` | `Machine Calf Raise` `['machine']`, `Barbell Calf Raise` `['barbell']`, `Dumbbell Calf Raise` `['dumbbell']` | `Machine Calf Raise` |
| `Wrist Curl` | `Barbell Wrist Curl` `['barbell']`, `Dumbbell Wrist Curl` `['dumbbell']` | `Dumbbell Wrist Curl` |
| `Preacher Curl` | `Barbell Preacher Curl` `['barbell']`, `Dumbbell Preacher Curl` `['dumbbell']` | `Barbell Preacher Curl` _(note: `Dumbbell Preacher Curl` already exists from 008 — skip insert, only delete old `Preacher Curl`)_ |
| `Glute Bridge` | see above | |

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `lib/data/postgres/migrations/032_exercise_equipment_variants.sql` | **Create** | All DB changes: inserts, ref updates, deletes, cache clear |
| `lib/exercise-gif-matcher.ts` | **Modify** | Add MANUAL_OVERRIDES + DIRECT_URL_OVERRIDES for new names |
| `app/api/workout-data/route.ts` | **Modify** | Remove `buildDisplayName` helper (no longer needed) |
| `lib/data/repository.ts` | **Modify** | Add `upsertExercises` + `deleteExercise` + `renameExerciseRefs` methods |
| `lib/data/postgres/adapter.ts` | **Modify** | Implement the three new repository methods |

---

## Task 1 — Write the SQL migration

**Files:**
- Create: `lib/data/postgres/migrations/032_exercise_equipment_variants.sql`

- [ ] **Step 1 — Create the migration file**

```sql
-- 032_exercise_equipment_variants.sql
-- Splits generic multi-equipment exercise names into equipment-specific variants.
-- Updates all string references across session_exercises, exercise_logs,
-- personal_records. Clears exercise_gif_cache for affected names so GIFs
-- are re-fetched with the better, specific names.

-- ─── SECTION 1: Insert new variant exercises ──────────────────────────────────
-- Only insert if not already present (idempotent).

INSERT INTO exercise_library (name, muscles, equipment) VALUES
  -- Overhead Press split
  ('Barbell Overhead Press',        '[{"muscle":"Shoulders","role":"main"},{"muscle":"Triceps","role":"secondary"},{"muscle":"Traps","role":"secondary"}]', ARRAY['barbell']),
  ('Dumbbell Overhead Press',       '[{"muscle":"Shoulders","role":"main"},{"muscle":"Triceps","role":"secondary"}]',                                        ARRAY['dumbbell']),
  -- Lateral Raise split
  ('Dumbbell Lateral Raise',        '[{"muscle":"Shoulders","role":"main"}]',                                                                               ARRAY['dumbbell','kettlebell']),
  ('Cable Lateral Raise',           '[{"muscle":"Shoulders","role":"main"}]',                                                                               ARRAY['cable']),
  -- Front Raise split
  ('Dumbbell Front Raise',          '[{"muscle":"Shoulders","role":"main"}]',                                                                               ARRAY['dumbbell','kettlebell']),
  ('Cable Front Raise',             '[{"muscle":"Shoulders","role":"main"}]',                                                                               ARRAY['cable']),
  -- Reverse Fly split
  ('Dumbbell Reverse Fly',          '[{"muscle":"Shoulders","role":"main"},{"muscle":"Upper Back","role":"secondary"}]',                                    ARRAY['dumbbell']),
  ('Cable Reverse Fly',             '[{"muscle":"Shoulders","role":"main"},{"muscle":"Upper Back","role":"secondary"}]',                                    ARRAY['cable']),
  -- Upright Row split
  ('Barbell Upright Row',           '[{"muscle":"Traps","role":"main"},{"muscle":"Shoulders","role":"secondary"}]',                                         ARRAY['barbell']),
  ('Cable Upright Row',             '[{"muscle":"Traps","role":"main"},{"muscle":"Shoulders","role":"secondary"}]',                                         ARRAY['cable']),
  -- Shrug split
  ('Barbell Shrug',                 '[{"muscle":"Traps","role":"main"}]',                                                                                   ARRAY['barbell']),
  ('Dumbbell Shrug',                '[{"muscle":"Traps","role":"main"}]',                                                                                   ARRAY['dumbbell']),
  -- Skull Crusher split
  ('Barbell Skull Crusher',         '[{"muscle":"Triceps","role":"main"}]',                                                                                 ARRAY['barbell']),
  ('Dumbbell Skull Crusher',        '[{"muscle":"Triceps","role":"main"}]',                                                                                 ARRAY['dumbbell']),
  -- Overhead Tricep Extension split
  ('Cable Overhead Tricep Extension',   '[{"muscle":"Triceps","role":"main"}]',                                                                             ARRAY['cable']),
  ('Dumbbell Overhead Tricep Extension','[{"muscle":"Triceps","role":"main"}]',                                                                             ARRAY['dumbbell']),
  -- Wrist Curl split
  ('Barbell Wrist Curl',            '[{"muscle":"Forearms","role":"main"}]',                                                                                ARRAY['barbell']),
  ('Dumbbell Wrist Curl',           '[{"muscle":"Forearms","role":"main"}]',                                                                                ARRAY['dumbbell']),
  -- Romanian Deadlift split
  ('Barbell Romanian Deadlift',     '[{"muscle":"Hamstrings","role":"main"},{"muscle":"Glutes","role":"main"},{"muscle":"Lower Back","role":"secondary"}]', ARRAY['barbell']),
  ('Dumbbell Romanian Deadlift',    '[{"muscle":"Hamstrings","role":"main"},{"muscle":"Glutes","role":"main"}]',                                            ARRAY['dumbbell']),
  -- Bulgarian Split Squat split
  ('Barbell Bulgarian Split Squat', '[{"muscle":"Quads","role":"main"},{"muscle":"Glutes","role":"secondary"},{"muscle":"Hamstrings","role":"secondary"}]', ARRAY['barbell']),
  ('Dumbbell Bulgarian Split Squat','[{"muscle":"Quads","role":"main"},{"muscle":"Glutes","role":"secondary"},{"muscle":"Hamstrings","role":"secondary"}]', ARRAY['dumbbell','kettlebell']),
  -- Glute Bridge split
  ('Barbell Glute Bridge',          '[{"muscle":"Glutes","role":"main"},{"muscle":"Hamstrings","role":"secondary"}]',                                       ARRAY['barbell']),
  ('Bodyweight Glute Bridge',       '[{"muscle":"Glutes","role":"main"},{"muscle":"Hamstrings","role":"secondary"}]',                                       ARRAY['bodyweight']),
  -- Calf Raise split
  ('Machine Calf Raise',            '[{"muscle":"Calves","role":"main"}]',                                                                                  ARRAY['machine']),
  ('Barbell Calf Raise',            '[{"muscle":"Calves","role":"main"}]',                                                                                  ARRAY['barbell']),
  ('Dumbbell Calf Raise',           '[{"muscle":"Calves","role":"main"}]',                                                                                  ARRAY['dumbbell']),
  -- Simple renames (new canonical name)
  ('Barbell Squat',                 '[{"muscle":"Quads","role":"main"},{"muscle":"Glutes","role":"secondary"},{"muscle":"Hamstrings","role":"secondary"},{"muscle":"Core","role":"secondary"}]', ARRAY['barbell']),
  ('Barbell Deadlift',              '[{"muscle":"Hamstrings","role":"main"},{"muscle":"Glutes","role":"main"},{"muscle":"Lower Back","role":"main"},{"muscle":"Traps","role":"secondary"}]',      ARRAY['barbell']),
  ('Barbell Front Squat',           '[{"muscle":"Quads","role":"main"},{"muscle":"Glutes","role":"secondary"},{"muscle":"Core","role":"secondary"}]',        ARRAY['barbell']),
  ('Barbell Good Morning',          '[{"muscle":"Hamstrings","role":"main"},{"muscle":"Lower Back","role":"main"},{"muscle":"Glutes","role":"secondary"}]',  ARRAY['barbell']),
  ('Dumbbell Hammer Curl',          '[{"muscle":"Biceps","role":"main"},{"muscle":"Forearms","role":"secondary"}]',                                         ARRAY['dumbbell','kettlebell']),
  -- Barbell Preacher Curl (Dumbbell variant already in DB from 008)
  ('Barbell Preacher Curl',         '[{"muscle":"Biceps","role":"main"}]',                                                                                  ARRAY['barbell']),
  -- Bent-Over Barbell Row canonical name
  ('Bent-Over Barbell Row',         '[{"muscle":"Upper Back","role":"main"},{"muscle":"Lats","role":"main"},{"muscle":"Biceps","role":"secondary"}]',        ARRAY['barbell'])
ON CONFLICT (name) DO NOTHING;

-- ─── SECTION 2: Update session_exercises references ───────────────────────────

-- Simple renames
UPDATE session_exercises SET exercise_name = 'Barbell Squat'              WHERE exercise_name = 'Squat';
UPDATE session_exercises SET exercise_name = 'Barbell Deadlift'           WHERE exercise_name = 'Deadlift';
UPDATE session_exercises SET exercise_name = 'Barbell Front Squat'        WHERE exercise_name IN ('Front Squat', 'Front Barbell Squat');
UPDATE session_exercises SET exercise_name = 'Barbell Good Morning'       WHERE exercise_name = 'Good Morning';
UPDATE session_exercises SET exercise_name = 'Barbell Hip Thrust'         WHERE exercise_name IN ('Hip Thrust', 'Hip Thrusts');
UPDATE session_exercises SET exercise_name = 'Dumbbell Hammer Curl'       WHERE exercise_name = 'Hammer Curl';
UPDATE session_exercises SET exercise_name = 'Barbell Bench Press'        WHERE exercise_name = 'Bench Press';
UPDATE session_exercises SET exercise_name = 'Bent-Over Barbell Row'      WHERE exercise_name IN ('Barbell Row', 'Bent Over Barbell Row');
UPDATE session_exercises SET exercise_name = 'Machine Calf Raise'         WHERE exercise_name IN ('Calf Raise', 'Calf Raises');
-- Splits → default to primary variant
UPDATE session_exercises SET exercise_name = 'Barbell Overhead Press'     WHERE exercise_name = 'Overhead Press';
UPDATE session_exercises SET exercise_name = 'Dumbbell Lateral Raise'     WHERE exercise_name IN ('Lateral Raise', 'DB Lateral Raises');
UPDATE session_exercises SET exercise_name = 'Dumbbell Front Raise'       WHERE exercise_name = 'Front Raise';
UPDATE session_exercises SET exercise_name = 'Dumbbell Reverse Fly'       WHERE exercise_name = 'Reverse Fly';
UPDATE session_exercises SET exercise_name = 'Barbell Upright Row'        WHERE exercise_name = 'Upright Row';
UPDATE session_exercises SET exercise_name = 'Barbell Shrug'              WHERE exercise_name = 'Shrug';
UPDATE session_exercises SET exercise_name = 'Barbell Skull Crusher'      WHERE exercise_name = 'Skull Crusher';
UPDATE session_exercises SET exercise_name = 'Cable Overhead Tricep Extension' WHERE exercise_name = 'Overhead Tricep Ext';
UPDATE session_exercises SET exercise_name = 'Barbell Romanian Deadlift'  WHERE exercise_name = 'Romanian Deadlift';
UPDATE session_exercises SET exercise_name = 'Barbell Bulgarian Split Squat' WHERE exercise_name = 'Bulgarian Split Squat';
UPDATE session_exercises SET exercise_name = 'Barbell Glute Bridge'       WHERE exercise_name = 'Glute Bridge';
UPDATE session_exercises SET exercise_name = 'Dumbbell Wrist Curl'        WHERE exercise_name = 'Wrist Curl';
UPDATE session_exercises SET exercise_name = 'Barbell Preacher Curl'      WHERE exercise_name = 'Preacher Curl';

-- ─── SECTION 3: Update exercise_logs references (history) ────────────────────

UPDATE exercise_logs SET exercise_name = 'Barbell Squat'              WHERE exercise_name = 'Squat';
UPDATE exercise_logs SET exercise_name = 'Barbell Deadlift'           WHERE exercise_name = 'Deadlift';
UPDATE exercise_logs SET exercise_name = 'Barbell Front Squat'        WHERE exercise_name IN ('Front Squat', 'Front Barbell Squat');
UPDATE exercise_logs SET exercise_name = 'Barbell Good Morning'       WHERE exercise_name = 'Good Morning';
UPDATE exercise_logs SET exercise_name = 'Barbell Hip Thrust'         WHERE exercise_name IN ('Hip Thrust', 'Hip Thrusts');
UPDATE exercise_logs SET exercise_name = 'Dumbbell Hammer Curl'       WHERE exercise_name = 'Hammer Curl';
UPDATE exercise_logs SET exercise_name = 'Barbell Bench Press'        WHERE exercise_name = 'Bench Press';
UPDATE exercise_logs SET exercise_name = 'Bent-Over Barbell Row'      WHERE exercise_name IN ('Barbell Row', 'Bent Over Barbell Row');
UPDATE exercise_logs SET exercise_name = 'Machine Calf Raise'         WHERE exercise_name IN ('Calf Raise', 'Calf Raises');
UPDATE exercise_logs SET exercise_name = 'Barbell Overhead Press'     WHERE exercise_name = 'Overhead Press';
UPDATE exercise_logs SET exercise_name = 'Dumbbell Lateral Raise'     WHERE exercise_name IN ('Lateral Raise', 'DB Lateral Raises');
UPDATE exercise_logs SET exercise_name = 'Dumbbell Front Raise'       WHERE exercise_name = 'Front Raise';
UPDATE exercise_logs SET exercise_name = 'Dumbbell Reverse Fly'       WHERE exercise_name = 'Reverse Fly';
UPDATE exercise_logs SET exercise_name = 'Barbell Upright Row'        WHERE exercise_name = 'Upright Row';
UPDATE exercise_logs SET exercise_name = 'Barbell Shrug'              WHERE exercise_name = 'Shrug';
UPDATE exercise_logs SET exercise_name = 'Barbell Skull Crusher'      WHERE exercise_name = 'Skull Crusher';
UPDATE exercise_logs SET exercise_name = 'Cable Overhead Tricep Extension' WHERE exercise_name = 'Overhead Tricep Ext';
UPDATE exercise_logs SET exercise_name = 'Barbell Romanian Deadlift'  WHERE exercise_name = 'Romanian Deadlift';
UPDATE exercise_logs SET exercise_name = 'Barbell Bulgarian Split Squat' WHERE exercise_name = 'Bulgarian Split Squat';
UPDATE exercise_logs SET exercise_name = 'Barbell Glute Bridge'       WHERE exercise_name = 'Glute Bridge';
UPDATE exercise_logs SET exercise_name = 'Dumbbell Wrist Curl'        WHERE exercise_name = 'Wrist Curl';
UPDATE exercise_logs SET exercise_name = 'Barbell Preacher Curl'      WHERE exercise_name = 'Preacher Curl';

-- ─── SECTION 4: Update personal_records references ───────────────────────────

UPDATE personal_records SET exercise_name = 'Barbell Squat'              WHERE exercise_name = 'Squat';
UPDATE personal_records SET exercise_name = 'Barbell Deadlift'           WHERE exercise_name = 'Deadlift';
UPDATE personal_records SET exercise_name = 'Barbell Front Squat'        WHERE exercise_name IN ('Front Squat', 'Front Barbell Squat');
UPDATE personal_records SET exercise_name = 'Barbell Good Morning'       WHERE exercise_name = 'Good Morning';
UPDATE personal_records SET exercise_name = 'Barbell Hip Thrust'         WHERE exercise_name IN ('Hip Thrust', 'Hip Thrusts');
UPDATE personal_records SET exercise_name = 'Dumbbell Hammer Curl'       WHERE exercise_name = 'Hammer Curl';
UPDATE personal_records SET exercise_name = 'Barbell Bench Press'        WHERE exercise_name = 'Bench Press';
UPDATE personal_records SET exercise_name = 'Bent-Over Barbell Row'      WHERE exercise_name IN ('Barbell Row', 'Bent Over Barbell Row');
UPDATE personal_records SET exercise_name = 'Machine Calf Raise'         WHERE exercise_name IN ('Calf Raise', 'Calf Raises');
UPDATE personal_records SET exercise_name = 'Barbell Overhead Press'     WHERE exercise_name = 'Overhead Press';
UPDATE personal_records SET exercise_name = 'Dumbbell Lateral Raise'     WHERE exercise_name IN ('Lateral Raise', 'DB Lateral Raises');
UPDATE personal_records SET exercise_name = 'Dumbbell Front Raise'       WHERE exercise_name = 'Front Raise';
UPDATE personal_records SET exercise_name = 'Dumbbell Reverse Fly'       WHERE exercise_name = 'Reverse Fly';
UPDATE personal_records SET exercise_name = 'Barbell Upright Row'        WHERE exercise_name = 'Upright Row';
UPDATE personal_records SET exercise_name = 'Barbell Shrug'              WHERE exercise_name = 'Shrug';
UPDATE personal_records SET exercise_name = 'Barbell Skull Crusher'      WHERE exercise_name = 'Skull Crusher';
UPDATE personal_records SET exercise_name = 'Cable Overhead Tricep Extension' WHERE exercise_name = 'Overhead Tricep Ext';
UPDATE personal_records SET exercise_name = 'Barbell Romanian Deadlift'  WHERE exercise_name = 'Romanian Deadlift';
UPDATE personal_records SET exercise_name = 'Barbell Bulgarian Split Squat' WHERE exercise_name = 'Bulgarian Split Squat';
UPDATE personal_records SET exercise_name = 'Barbell Glute Bridge'       WHERE exercise_name = 'Glute Bridge';
UPDATE personal_records SET exercise_name = 'Dumbbell Wrist Curl'        WHERE exercise_name = 'Wrist Curl';
UPDATE personal_records SET exercise_name = 'Barbell Preacher Curl'      WHERE exercise_name = 'Preacher Curl';

-- ─── SECTION 5: Delete old generic library entries ────────────────────────────
-- Safe to delete now — all references have been updated above.

DELETE FROM exercise_library WHERE name IN (
  'Squat', 'Deadlift', 'Front Squat', 'Front Barbell Squat',
  'Good Morning', 'Hip Thrust', 'Hip Thrusts',
  'Hammer Curl', 'Bench Press',
  'Barbell Row', 'Bent Over Barbell Row',
  'Calf Raise', 'Calf Raises',
  'Overhead Press', 'Lateral Raise', 'DB Lateral Raises',
  'Front Raise', 'Reverse Fly', 'Upright Row',
  'Shrug', 'Skull Crusher', 'Overhead Tricep Ext',
  'Romanian Deadlift', 'Bulgarian Split Squat',
  'Glute Bridge', 'Wrist Curl', 'Preacher Curl'
);

-- ─── SECTION 6: Clear stale GIF cache ─────────────────────────────────────────
-- Deleted entries and renamed entries need fresh GIF lookups.

DELETE FROM exercise_gif_cache WHERE exercise_name IN (
  -- Old generic names being deleted
  'Squat', 'Deadlift', 'Front Squat', 'Front Barbell Squat',
  'Good Morning', 'Hip Thrust', 'Hip Thrusts',
  'Hammer Curl', 'Bench Press',
  'Barbell Row', 'Bent Over Barbell Row',
  'Calf Raise', 'Calf Raises',
  'Overhead Press', 'Lateral Raise', 'DB Lateral Raises',
  'Front Raise', 'Reverse Fly', 'Upright Row',
  'Shrug', 'Skull Crusher', 'Overhead Tricep Ext',
  'Romanian Deadlift', 'Bulgarian Split Squat',
  'Glute Bridge', 'Wrist Curl', 'Preacher Curl',
  -- New names that may have been cached from a displayName lookup before this migration
  'Barbell Squat', 'Barbell Deadlift', 'Barbell Front Squat', 'Barbell Good Morning',
  'Barbell Hip Thrust', 'Dumbbell Hammer Curl', 'Barbell Bench Press',
  'Bent-Over Barbell Row', 'Machine Calf Raise', 'Barbell Calf Raise', 'Dumbbell Calf Raise',
  'Barbell Overhead Press', 'Dumbbell Overhead Press',
  'Dumbbell Lateral Raise', 'Cable Lateral Raise',
  'Dumbbell Front Raise', 'Cable Front Raise',
  'Dumbbell Reverse Fly', 'Cable Reverse Fly',
  'Barbell Upright Row', 'Cable Upright Row',
  'Barbell Shrug', 'Dumbbell Shrug',
  'Barbell Skull Crusher', 'Dumbbell Skull Crusher',
  'Cable Overhead Tricep Extension', 'Dumbbell Overhead Tricep Extension',
  'Barbell Romanian Deadlift', 'Dumbbell Romanian Deadlift',
  'Barbell Bulgarian Split Squat', 'Dumbbell Bulgarian Split Squat',
  'Barbell Glute Bridge', 'Bodyweight Glute Bridge',
  'Dumbbell Wrist Curl', 'Barbell Wrist Curl',
  'Barbell Preacher Curl'
);
```

- [ ] **Step 2 — Verify file was created**

```bash
ls lib/data/postgres/migrations/032_exercise_equipment_variants.sql
wc -l lib/data/postgres/migrations/032_exercise_equipment_variants.sql
# Expected: file exists, ~130 lines
```

- [ ] **Step 3 — Commit**

```bash
git add lib/data/postgres/migrations/032_exercise_equipment_variants.sql
git commit -m "Add migration to split generic exercises into equipment-specific variants"
```

---

## Task 2 — Update the GIF matcher

The GIF matcher uses normalised names. New specific names like `Barbell Squat` will normalise to `barbell squat` and the Jaccard scorer will find a good match automatically for most. The cases below need explicit help.

**Files:**
- Modify: `lib/exercise-gif-matcher.ts`

- [ ] **Step 1 — Add overrides for renamed and split exercises**

Open `lib/exercise-gif-matcher.ts`. In `DIRECT_URL_OVERRIDES`, the existing `"barbell hip thrust"` entry already covers `Barbell Hip Thrust`. No change needed there.

In `MANUAL_OVERRIDES`, add the following entries (insert after the existing `"dumbbell preacher curl"` line):

```typescript
export const MANUAL_OVERRIDES: Record<string, string> = {
  // ... existing entries unchanged ...
  "dumbbell preacher curl":  "preacher curl",

  // Equipment-specific variants added in migration 032
  "barbell squat":                      "barbell squat",          // dataset has this exact name
  "barbell deadlift":                   "deadlift",
  "barbell front squat":                "front squat",
  "barbell good morning":               "good morning",
  "dumbbell hammer curl":               "hammer curl",
  "barbell overhead press":             "overhead press",
  "dumbbell overhead press":            "dumbbell shoulder press",
  "dumbbell lateral raise":             "lateral raise",
  "cable lateral raise":                "cable lateral raise",
  "dumbbell front raise":               "front raise",
  "cable front raise":                  "cable front raise",
  "dumbbell reverse fly":               "reverse fly",
  "cable reverse fly":                  "cable reverse fly",
  "barbell upright row":                "upright row",
  "cable upright row":                  "cable upright row",
  "barbell shrug":                      "barbell shrug",
  "dumbbell shrug":                     "dumbbell shrug",
  "barbell skull crusher":              "skull crusher",
  "dumbbell skull crusher":             "dumbbell skull crusher",
  "cable overhead tricep extension":    "cable tricep overhead extension",
  "dumbbell overhead tricep extension": "dumbbell tricep overhead extension",
  "barbell romanian deadlift":          "romanian deadlift",
  "dumbbell romanian deadlift":         "dumbbell romanian deadlift",
  "barbell bulgarian split squat":      "bulgarian split squat",
  "dumbbell bulgarian split squat":     "dumbbell split squat",
  "barbell glute bridge":               "barbell glute bridge",
  "bodyweight glute bridge":            "glute bridge",
  "machine calf raise":                 "calf raise",
  "barbell calf raise":                 "standing calf raise",
  "dumbbell calf raise":                "dumbbell calf raise",
  "barbell wrist curl":                 "wrist curl",
  "dumbbell wrist curl":                "dumbbell wrist curl",
  "barbell preacher curl":              "preacher curl",
  "bent-over barbell row":              "barbell bent over row",
  "barbell bench press":                "barbell bench press",
};
```

- [ ] **Step 2 — Commit**

```bash
git add lib/exercise-gif-matcher.ts
git commit -m "Add GIF matcher overrides for equipment-specific exercise names"
```

---

## Task 3 — Remove the display-name prefix hack

The `buildDisplayName` helper in `app/api/workout-data/route.ts` was introduced as a stopgap to prefix generic names with equipment at render time. With the library now containing specific names, this is dead code.

**Files:**
- Modify: `app/api/workout-data/route.ts`

- [ ] **Step 1 — Delete `buildDisplayName` and its call sites**

In `app/api/workout-data/route.ts`:

1. Delete the `EQUIPMENT_PRIORITY` constant (lines beginning `const EQUIPMENT_PRIORITY`).
2. Delete the `EQUIPMENT_PREFIX` constant.
3. Delete the `buildDisplayName` function.
4. In the `exercises` map (around line 186), remove the `displayName` field:

```typescript
// Remove this line:
displayName: libEntry ? buildDisplayName(ex.exerciseName, libEntry.equipment, ex.exerciseRole ?? 'primary') : undefined,
```

5. Delete `displayName?: string` from the `WorkoutExercise` interface.

- [ ] **Step 2 — Update display components to fall back cleanly**

The components currently use `ex.displayName ?? ex.name`. Since `displayName` is now always `undefined`, this evaluates to `ex.name` — which is already the specific name. The `?? ex.name` fallback keeps them working with zero change, but remove the now-dead field reference from the interface to keep TypeScript honest.

Search for all `displayName` references and confirm they are all of the form `ex.displayName ?? ex.name` or `exercise.displayName ?? exercise.name` — the `?? ex.name` fallback means no component changes are required.

```bash
grep -rn "displayName" components/workout/ app/workout-select/
# Every result should be of the form `?.displayName ?? ?.name`
# If any result reads displayName directly (no fallback), update it to just .name
```

- [ ] **Step 3 — Commit**

```bash
git add app/api/workout-data/route.ts
git commit -m "Remove displayName prefix hack — exercise library now has specific names"
```

---

## Task 4 — Repository CRUD for exercise library

The library currently exposes only `listExerciseLibrary`. Adding write methods enables future admin tooling and makes the migration logic reversible from code.

**Files:**
- Modify: `lib/data/repository.ts`
- Modify: `lib/data/postgres/adapter.ts`

- [ ] **Step 1 — Add method signatures to repository interface**

In `lib/data/repository.ts`, after the `listExerciseLibrary(): Promise<ExerciseLibraryEntry[]>` line, add:

```typescript
upsertExercise(entry: Omit<ExerciseLibraryEntry, 'id'> & { id?: string }): Promise<ExerciseLibraryEntry>
deleteExercise(name: string): Promise<void>
renameExerciseRefs(oldName: string, newName: string): Promise<void>
```

- [ ] **Step 2 — Implement in adapter**

In `lib/data/postgres/adapter.ts`, after the `listExerciseLibrary` implementation, add:

```typescript
async upsertExercise(entry: Omit<ExerciseLibraryEntry, 'id'> & { id?: string }): Promise<ExerciseLibraryEntry> {
  const [row] = await this.db.insert(s.exerciseLibrary)
    .values({
      ...(entry.id ? { id: entry.id } : {}),
      name: entry.name,
      muscles: entry.muscles,
      equipment: entry.equipment,
    })
    .onConflictDoUpdate({
      target: s.exerciseLibrary.name,
      set: {
        muscles: sql`EXCLUDED.muscles`,
        equipment: sql`EXCLUDED.equipment`,
      },
    })
    .returning()
  return { id: row.id, name: row.name, muscles: row.muscles as MuscleAssignment[], equipment: row.equipment ?? [] }
}

async deleteExercise(name: string): Promise<void> {
  await this.db.delete(s.exerciseLibrary).where(eq(s.exerciseLibrary.name, name))
}

async renameExerciseRefs(oldName: string, newName: string): Promise<void> {
  await this.db.transaction(async tx => {
    await tx.update(s.sessionExercises)
      .set({ exerciseName: newName })
      .where(eq(s.sessionExercises.exerciseName, oldName))
    await tx.update(s.exerciseLogs)
      .set({ exerciseName: newName })
      .where(eq(s.exerciseLogs.exerciseName, oldName))
    await tx.update(s.personalRecords)
      .set({ exerciseName: newName })
      .where(eq(s.personalRecords.exerciseName, oldName))
  })
}
```

- [ ] **Step 3 — Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | grep -E "adapter|repository" | grep -v "Cannot find module"
# Expected: no errors from these files
```

- [ ] **Step 4 — Commit**

```bash
git add lib/data/repository.ts lib/data/postgres/adapter.ts
git commit -m "Add upsertExercise, deleteExercise, renameExerciseRefs to repository"
```

---

## Task 5 — Deploy and verify

The migration runs automatically on cold start via `ensureSchema`. After deploying, trigger a re-seeding of the GIF cache via the existing admin endpoint.

- [ ] **Step 1 — Push to main and wait for Railway deploy**

```bash
git push -u origin main
# Wait for Railway build to succeed (check deploy logs)
```

- [ ] **Step 2 — Verify migration ran**

Open the app and navigate to **Config → Workouts**. Any program that had "Romanian Deadlift" should now show "Barbell Romanian Deadlift". Any program with "Squat" should show "Barbell Squat". If names are unchanged, the migration did not run — check Railway logs for `ensureSchema` errors.

- [ ] **Step 3 — Trigger GIF cache re-seed**

Call the admin seed endpoint (requires an admin session cookie):

```bash
curl -X POST https://<your-railway-domain>/api/admin/seed-exercise-gifs \
  -H "Cookie: next-auth.session-token=<your-session-cookie>"
# Expected response: { message: "...", total: N, seeded: N, matched: N, unmatched: [] }
```

If `unmatched` is non-empty, those exercise names need additional `MANUAL_OVERRIDES` entries in Task 2.

- [ ] **Step 4 — Smoke test in the workout screen**

1. Open any session with "Barbell Romanian Deadlift" in it.
2. Tap the exercise name to open the stats sheet.
3. Confirm a GIF loads (not a blank/placeholder).
4. Repeat for "Barbell Squat", "Dumbbell Lateral Raise", "Cable Overhead Tricep Extension".

- [ ] **Step 5 — Verify history continuity**

1. Open Stats → tap a day you previously logged "Romanian Deadlift".
2. The session drawer should show "Barbell Romanian Deadlift" — same sets/reps as before.
3. Open the workout screen for that session — the "Last session" data should still appear under the exercise heading.

---

## Self-Review

**Spec coverage:**
- ✅ Split multi-equipment exercises into named variants
- ✅ Update `session_exercises` references
- ✅ Update `exercise_logs` references (history continuity)
- ✅ Update `personal_records` references
- ✅ Clear stale GIF cache entries
- ✅ GIF matcher updated for new names
- ✅ Display-name prefix hack removed (now redundant)
- ✅ Repository CRUD added for future admin use

**Placeholder scan:** No TBDs, no "implement later", no vague steps. All SQL is complete and specific.

**Type consistency:** `ExerciseLibraryEntry` type is used consistently in Task 4. `renameExerciseRefs` accesses `s.sessionExercises`, `s.exerciseLogs`, `s.personalRecords` — all exist in the schema. `MuscleAssignment` cast in `upsertExercise` matches `listExerciseLibrary`.

**Risk note:** The migration updates history rows to a single "default" variant (e.g. all "Romanian Deadlift" logs → "Barbell Romanian Deadlift"). If a user was actually doing dumbbell RDLs, their history will be mislabelled. This is acceptable given there is currently no way to distinguish variants in the existing data. Users can correct individual exercises via the stats edit flow.
