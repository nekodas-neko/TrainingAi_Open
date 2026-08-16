> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Goal-Specific Phase Sets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single generic Phase-Based Progression with four goal-specific phase sets so the workout's actual style matches what the AI builder previewed.

**Architecture:** A SQL migration adds 4 new progression styles and 4 new phase sets for all existing users. The adapter's `upsertUser` seeds these for new users. The generate-program API maps each goal to its phase set and updates GOAL_STYLE_RULES to reflect the accumulation-phase style (so the builder preview matches the first workout). The builder wizard gains a fourth goal option (Powerbuilding). The builder-review reverts to `phaseMode: 'automatic'` — the phase set is now correctly designed for each goal so phase cycling works as intended.

**Tech Stack:** Next.js 15, TypeScript, Drizzle ORM, PostgreSQL, Zod, Gemini via `@ai-sdk/google`

---

## Phase table (approved design)

| Goal enum | Phase set name | Acc | Int | Peak | Deload |
|---|---|---|---|---|---|
| `hypertrophy` | Hypertrophy Progression | General 4-set (4×12@60%) | Hypertrophy (4×10@65%) | Hypertrophy Plus NEW (4×8@70%) | Deload |
| `strength+hypertrophy` | S+H Progression | Hypertrophy (4×10@65%) | Hypertrophy Plus NEW (4×8@70%) | Strength 4-set (4×5@80%) | Deload |
| `powerbuilding` | Powerbuilding Progression | Powerbuilding (4×6@80%) | Heavy Strength NEW (5×5@85%) | Peak (3×3@90%) | Deload |
| `strength` | Strength Progression | Strength (5×5@80%) | Strength Plus NEW (4×3@87%) | Max Strength NEW (3×3@92%) | Deload |

All four phase sets include Testing (1 cycle) and Accessory (0 cycles, General) phases.

---

## New progression styles

| Name | Sets | Pct | Reps | Rest | useFor1rm |
|---|---|---|---|---|---|
| Hypertrophy Plus | 4 | 70% | 8 | 75s | false |
| Heavy Strength | 5 | 85% | 5 | 180s | true |
| Strength Plus | 4 | 87% | 3 | 180s | true |
| Max Strength | 3 | 92% | 3 | 240s | true |

---

## File map

| File | Change |
|---|---|
| `lib/data/postgres/migrations/042_goal_phase_sets.sql` | CREATE — 4 styles + 4 phase sets, idempotent |
| `lib/data/postgres/adapter.ts` | MODIFY — seed new styles + phase sets in `upsertUser` |
| `app/api/generate-program/route.ts` | MODIFY — new goal enum value, KNOWN_STYLES, GOAL_STYLE_RULES, goalPhaseSetMap |
| `lib/types/builder.ts` | MODIFY — add `'powerbuilding'` to `BuilderInputs.goal` union |
| `components/workout-builder/builder-wizard.tsx` | MODIFY — add Powerbuilding option to step 6 goal list |
| `components/workout-builder/builder-review.tsx` | MODIFY — revert `phaseMode` to `'automatic'`; add new styles to STYLE_DISPLAY |

---

## Task 1: Migration — new styles and phase sets

**Files:**
- Create: `lib/data/postgres/migrations/042_goal_phase_sets.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 042_goal_phase_sets.sql
-- Adds 4 new progression styles and 4 goal-specific phase sets for all users.
-- Idempotent: all blocks guarded with IF NOT EXISTS.

DO $$
DECLARE
  uid            uuid;
  sid            uuid;
  hyp_plus_id    uuid;
  heavy_str_id   uuid;
  str_plus_id    uuid;
  max_str_id     uuid;
  testing_id     uuid;
  hypertrophy_id uuid;
  general_id     uuid;
  gen4_id        uuid;
  powerblding_id uuid;
  strength_id    uuid;
  str4_id        uuid;
  peak_id        uuid;
  deload_id      uuid;
  ps_id          uuid;
BEGIN
  FOR uid IN SELECT id FROM users LOOP

    -- ── New progression styles ───────────────────────────────────────────────

    IF NOT EXISTS (SELECT 1 FROM progression_styles WHERE user_id = uid AND name = 'Hypertrophy Plus') THEN
      sid := gen_random_uuid();
      INSERT INTO progression_styles (id, user_id, name, created_at) VALUES (sid, uid, 'Hypertrophy Plus', now());
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), sid, 1, 70, 8, 75, false),
        (gen_random_uuid(), sid, 2, 70, 8, 75, false),
        (gen_random_uuid(), sid, 3, 70, 8, 75, false),
        (gen_random_uuid(), sid, 4, 70, 8, 75, false);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM progression_styles WHERE user_id = uid AND name = 'Heavy Strength') THEN
      sid := gen_random_uuid();
      INSERT INTO progression_styles (id, user_id, name, created_at) VALUES (sid, uid, 'Heavy Strength', now());
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), sid, 1, 85, 5, 180, true),
        (gen_random_uuid(), sid, 2, 85, 5, 180, true),
        (gen_random_uuid(), sid, 3, 85, 5, 180, true),
        (gen_random_uuid(), sid, 4, 85, 5, 180, true),
        (gen_random_uuid(), sid, 5, 85, 5, 180, true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM progression_styles WHERE user_id = uid AND name = 'Strength Plus') THEN
      sid := gen_random_uuid();
      INSERT INTO progression_styles (id, user_id, name, created_at) VALUES (sid, uid, 'Strength Plus', now());
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), sid, 1, 87, 3, 180, true),
        (gen_random_uuid(), sid, 2, 87, 3, 180, true),
        (gen_random_uuid(), sid, 3, 87, 3, 180, true),
        (gen_random_uuid(), sid, 4, 87, 3, 180, true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM progression_styles WHERE user_id = uid AND name = 'Max Strength') THEN
      sid := gen_random_uuid();
      INSERT INTO progression_styles (id, user_id, name, created_at) VALUES (sid, uid, 'Max Strength', now());
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), sid, 1, 92, 3, 240, true),
        (gen_random_uuid(), sid, 2, 92, 3, 240, true),
        (gen_random_uuid(), sid, 3, 92, 3, 240, true);
    END IF;

    -- ── Resolve style IDs for this user ─────────────────────────────────────

    SELECT id INTO hyp_plus_id    FROM progression_styles WHERE user_id = uid AND name = 'Hypertrophy Plus'  LIMIT 1;
    SELECT id INTO heavy_str_id   FROM progression_styles WHERE user_id = uid AND name = 'Heavy Strength'    LIMIT 1;
    SELECT id INTO str_plus_id    FROM progression_styles WHERE user_id = uid AND name = 'Strength Plus'     LIMIT 1;
    SELECT id INTO max_str_id     FROM progression_styles WHERE user_id = uid AND name = 'Max Strength'      LIMIT 1;
    SELECT id INTO testing_id     FROM progression_styles WHERE user_id = uid AND name = 'Testing'           LIMIT 1;
    SELECT id INTO hypertrophy_id FROM progression_styles WHERE user_id = uid AND name = 'Hypertrophy'       LIMIT 1;
    SELECT id INTO general_id     FROM progression_styles WHERE user_id = uid AND name = 'General'           LIMIT 1;
    SELECT id INTO gen4_id        FROM progression_styles WHERE user_id = uid AND name = 'General 4-set'     LIMIT 1;
    SELECT id INTO powerblding_id FROM progression_styles WHERE user_id = uid AND name = 'Powerbuilding'     LIMIT 1;
    SELECT id INTO strength_id    FROM progression_styles WHERE user_id = uid AND name = 'Strength'          LIMIT 1;
    SELECT id INTO str4_id        FROM progression_styles WHERE user_id = uid AND name = 'Strength 4-set'    LIMIT 1;
    SELECT id INTO peak_id        FROM progression_styles WHERE user_id = uid AND name = 'Peak'              LIMIT 1;
    SELECT id INTO deload_id      FROM progression_styles WHERE user_id = uid AND name = 'Deload'            LIMIT 1;

    -- ── New phase sets ───────────────────────────────────────────────────────

    -- 1. Hypertrophy Progression
    IF NOT EXISTS (SELECT 1 FROM phase_sets WHERE user_id = uid AND name = 'Hypertrophy Progression') THEN
      ps_id := gen_random_uuid();
      INSERT INTO phase_sets (id, user_id, name, is_default, created_at) VALUES (ps_id, uid, 'Hypertrophy Progression', false, now());
      INSERT INTO program_phases (id, phase_set_id, position, name, duration_cycles, phase_type, primary_style_id, secondary_style_id) VALUES
        (gen_random_uuid(), ps_id, 0, 'Accumulation',    4, 'normal',    gen4_id,          gen4_id),
        (gen_random_uuid(), ps_id, 1, 'Intensification', 3, 'normal',    hypertrophy_id,   hypertrophy_id),
        (gen_random_uuid(), ps_id, 2, 'Peak',            2, 'normal',    hyp_plus_id,      hyp_plus_id),
        (gen_random_uuid(), ps_id, 3, 'Testing',         1, 'testing',   testing_id,       testing_id),
        (gen_random_uuid(), ps_id, 4, 'Deload',          1, 'deload',    deload_id,        NULL),
        (gen_random_uuid(), ps_id, 5, 'Accessory',       0, 'accessory', general_id,       NULL);
    END IF;

    -- 2. S+H Progression
    IF NOT EXISTS (SELECT 1 FROM phase_sets WHERE user_id = uid AND name = 'S+H Progression') THEN
      ps_id := gen_random_uuid();
      INSERT INTO phase_sets (id, user_id, name, is_default, created_at) VALUES (ps_id, uid, 'S+H Progression', false, now());
      INSERT INTO program_phases (id, phase_set_id, position, name, duration_cycles, phase_type, primary_style_id, secondary_style_id) VALUES
        (gen_random_uuid(), ps_id, 0, 'Accumulation',    4, 'normal',    hypertrophy_id,   hypertrophy_id),
        (gen_random_uuid(), ps_id, 1, 'Intensification', 3, 'normal',    hyp_plus_id,      hyp_plus_id),
        (gen_random_uuid(), ps_id, 2, 'Peak',            2, 'normal',    str4_id,          str4_id),
        (gen_random_uuid(), ps_id, 3, 'Testing',         1, 'testing',   testing_id,       testing_id),
        (gen_random_uuid(), ps_id, 4, 'Deload',          1, 'deload',    deload_id,        NULL),
        (gen_random_uuid(), ps_id, 5, 'Accessory',       0, 'accessory', general_id,       NULL);
    END IF;

    -- 3. Powerbuilding Progression
    IF NOT EXISTS (SELECT 1 FROM phase_sets WHERE user_id = uid AND name = 'Powerbuilding Progression') THEN
      ps_id := gen_random_uuid();
      INSERT INTO phase_sets (id, user_id, name, is_default, created_at) VALUES (ps_id, uid, 'Powerbuilding Progression', false, now());
      INSERT INTO program_phases (id, phase_set_id, position, name, duration_cycles, phase_type, primary_style_id, secondary_style_id) VALUES
        (gen_random_uuid(), ps_id, 0, 'Accumulation',    4, 'normal',    powerblding_id,   powerblding_id),
        (gen_random_uuid(), ps_id, 1, 'Intensification', 3, 'normal',    heavy_str_id,     heavy_str_id),
        (gen_random_uuid(), ps_id, 2, 'Peak',            2, 'peak',      peak_id,          NULL),
        (gen_random_uuid(), ps_id, 3, 'Testing',         1, 'testing',   testing_id,       testing_id),
        (gen_random_uuid(), ps_id, 4, 'Deload',          1, 'deload',    deload_id,        NULL),
        (gen_random_uuid(), ps_id, 5, 'Accessory',       0, 'accessory', general_id,       NULL);
    END IF;

    -- 4. Strength Progression
    IF NOT EXISTS (SELECT 1 FROM phase_sets WHERE user_id = uid AND name = 'Strength Progression') THEN
      ps_id := gen_random_uuid();
      INSERT INTO phase_sets (id, user_id, name, is_default, created_at) VALUES (ps_id, uid, 'Strength Progression', false, now());
      INSERT INTO program_phases (id, phase_set_id, position, name, duration_cycles, phase_type, primary_style_id, secondary_style_id) VALUES
        (gen_random_uuid(), ps_id, 0, 'Accumulation',    5, 'normal',    strength_id,      strength_id),
        (gen_random_uuid(), ps_id, 1, 'Intensification', 3, 'normal',    str_plus_id,      str_plus_id),
        (gen_random_uuid(), ps_id, 2, 'Peak',            2, 'peak',      max_str_id,       NULL),
        (gen_random_uuid(), ps_id, 3, 'Testing',         1, 'testing',   testing_id,       testing_id),
        (gen_random_uuid(), ps_id, 4, 'Deload',          1, 'deload',    deload_id,        NULL),
        (gen_random_uuid(), ps_id, 5, 'Accessory',       0, 'accessory', general_id,       NULL);
    END IF;

  END LOOP;
END $$;
```

- [ ] **Step 2: Verify the migration file exists**

```bash
ls /home/user/TrainingAI/lib/data/postgres/migrations/042_goal_phase_sets.sql
```
Expected: file listed, no error.

- [ ] **Step 3: Commit**

```bash
git add lib/data/postgres/migrations/042_goal_phase_sets.sql
git commit -m "feat: add 4 new progression styles and goal-specific phase sets (migration)"
```

---

## Task 2: Adapter — seed new styles and phase sets for new users

**Files:**
- Modify: `lib/data/postgres/adapter.ts`

The `upsertUser` method seeds styles and phase sets for accounts created after migrations have run. New styles must be added alongside the existing seeding so a fresh sign-up gets everything.

- [ ] **Step 1: Locate the style-seeding block in upsertUser**

Open `lib/data/postgres/adapter.ts` and find the block that seeds styles for new users (search for `'Hypertrophy'` or `'Strength'` inside `upsertUser`). The block creates progression styles with their style_sets rows.

- [ ] **Step 2: Add 4 new styles to the seeding block**

After the last existing style is seeded (e.g. Powerbuilding), add:

```typescript
// Hypertrophy Plus
const hypPlusExists = await this.db.select().from(s.progressionStyles)
  .where(and(eq(s.progressionStyles.userId, returnedUser.id), eq(s.progressionStyles.name, 'Hypertrophy Plus'))).limit(1)
if (hypPlusExists.length === 0) {
  const hypPlusId = randomUUID()
  await this.db.insert(s.progressionStyles).values({ id: hypPlusId, userId: returnedUser.id, name: 'Hypertrophy Plus' })
  for (const n of [1, 2, 3, 4]) {
    await this.db.insert(s.styleSets).values({ id: randomUUID(), styleId: hypPlusId, setNumber: n, pct: 70, reps: 8, restSec: 75, useFor1rm: false })
  }
}

// Heavy Strength
const heavyStrExists = await this.db.select().from(s.progressionStyles)
  .where(and(eq(s.progressionStyles.userId, returnedUser.id), eq(s.progressionStyles.name, 'Heavy Strength'))).limit(1)
if (heavyStrExists.length === 0) {
  const heavyStrId = randomUUID()
  await this.db.insert(s.progressionStyles).values({ id: heavyStrId, userId: returnedUser.id, name: 'Heavy Strength' })
  for (const n of [1, 2, 3, 4, 5]) {
    await this.db.insert(s.styleSets).values({ id: randomUUID(), styleId: heavyStrId, setNumber: n, pct: 85, reps: 5, restSec: 180, useFor1rm: true })
  }
}

// Strength Plus
const strPlusExists = await this.db.select().from(s.progressionStyles)
  .where(and(eq(s.progressionStyles.userId, returnedUser.id), eq(s.progressionStyles.name, 'Strength Plus'))).limit(1)
if (strPlusExists.length === 0) {
  const strPlusId = randomUUID()
  await this.db.insert(s.progressionStyles).values({ id: strPlusId, userId: returnedUser.id, name: 'Strength Plus' })
  for (const n of [1, 2, 3, 4]) {
    await this.db.insert(s.styleSets).values({ id: randomUUID(), styleId: strPlusId, setNumber: n, pct: 87, reps: 3, restSec: 180, useFor1rm: true })
  }
}

// Max Strength
const maxStrExists = await this.db.select().from(s.progressionStyles)
  .where(and(eq(s.progressionStyles.userId, returnedUser.id), eq(s.progressionStyles.name, 'Max Strength'))).limit(1)
if (maxStrExists.length === 0) {
  const maxStrId = randomUUID()
  await this.db.insert(s.progressionStyles).values({ id: maxStrId, userId: returnedUser.id, name: 'Max Strength' })
  for (const n of [1, 2, 3]) {
    await this.db.insert(s.styleSets).values({ id: randomUUID(), styleId: maxStrId, setNumber: n, pct: 92, reps: 3, restSec: 240, useFor1rm: true })
  }
}
```

- [ ] **Step 3: Add 4 new phase sets to builtInSets**

Locate the `builtInSets` array (around line 231 in the adapter). After the existing entries for `'Baselining'` and `'Linear Progression'`, add:

```typescript
{
  name: 'Hypertrophy Progression',
  phases: [
    { position: 0, name: 'Accumulation',    durationCycles: 4, phaseType: 'normal',    primaryStyleId: find('General 4-set'),   secondaryStyleId: find('General 4-set') },
    { position: 1, name: 'Intensification', durationCycles: 3, phaseType: 'normal',    primaryStyleId: find('Hypertrophy'),     secondaryStyleId: find('Hypertrophy') },
    { position: 2, name: 'Peak',            durationCycles: 2, phaseType: 'normal',    primaryStyleId: find('Hypertrophy Plus'),secondaryStyleId: find('Hypertrophy Plus') },
    { position: 3, name: 'Testing',         durationCycles: 1, phaseType: 'testing',   primaryStyleId: find('Testing'),         secondaryStyleId: find('Testing') },
    { position: 4, name: 'Deload',          durationCycles: 1, phaseType: 'deload',    primaryStyleId: find('Deload'),          secondaryStyleId: null },
    { position: 5, name: 'Accessory',       durationCycles: 0, phaseType: 'accessory', primaryStyleId: find('General'),         secondaryStyleId: null },
  ],
},
{
  name: 'S+H Progression',
  phases: [
    { position: 0, name: 'Accumulation',    durationCycles: 4, phaseType: 'normal',    primaryStyleId: find('Hypertrophy'),      secondaryStyleId: find('Hypertrophy') },
    { position: 1, name: 'Intensification', durationCycles: 3, phaseType: 'normal',    primaryStyleId: find('Hypertrophy Plus'), secondaryStyleId: find('Hypertrophy Plus') },
    { position: 2, name: 'Peak',            durationCycles: 2, phaseType: 'normal',    primaryStyleId: find('Strength 4-set'),   secondaryStyleId: find('Strength 4-set') },
    { position: 3, name: 'Testing',         durationCycles: 1, phaseType: 'testing',   primaryStyleId: find('Testing'),          secondaryStyleId: find('Testing') },
    { position: 4, name: 'Deload',          durationCycles: 1, phaseType: 'deload',    primaryStyleId: find('Deload'),           secondaryStyleId: null },
    { position: 5, name: 'Accessory',       durationCycles: 0, phaseType: 'accessory', primaryStyleId: find('General'),          secondaryStyleId: null },
  ],
},
{
  name: 'Powerbuilding Progression',
  phases: [
    { position: 0, name: 'Accumulation',    durationCycles: 4, phaseType: 'normal',    primaryStyleId: find('Powerbuilding'),   secondaryStyleId: find('Powerbuilding') },
    { position: 1, name: 'Intensification', durationCycles: 3, phaseType: 'normal',    primaryStyleId: find('Heavy Strength'),  secondaryStyleId: find('Heavy Strength') },
    { position: 2, name: 'Peak',            durationCycles: 2, phaseType: 'peak',      primaryStyleId: find('Peak'),            secondaryStyleId: null },
    { position: 3, name: 'Testing',         durationCycles: 1, phaseType: 'testing',   primaryStyleId: find('Testing'),         secondaryStyleId: find('Testing') },
    { position: 4, name: 'Deload',          durationCycles: 1, phaseType: 'deload',    primaryStyleId: find('Deload'),          secondaryStyleId: null },
    { position: 5, name: 'Accessory',       durationCycles: 0, phaseType: 'accessory', primaryStyleId: find('General'),         secondaryStyleId: null },
  ],
},
{
  name: 'Strength Progression',
  phases: [
    { position: 0, name: 'Accumulation',    durationCycles: 5, phaseType: 'normal',    primaryStyleId: find('Strength'),        secondaryStyleId: find('Strength') },
    { position: 1, name: 'Intensification', durationCycles: 3, phaseType: 'normal',    primaryStyleId: find('Strength Plus'),   secondaryStyleId: find('Strength Plus') },
    { position: 2, name: 'Peak',            durationCycles: 2, phaseType: 'peak',      primaryStyleId: find('Max Strength'),    secondaryStyleId: null },
    { position: 3, name: 'Testing',         durationCycles: 1, phaseType: 'testing',   primaryStyleId: find('Testing'),         secondaryStyleId: find('Testing') },
    { position: 4, name: 'Deload',          durationCycles: 1, phaseType: 'deload',    primaryStyleId: find('Deload'),          secondaryStyleId: null },
    { position: 5, name: 'Accessory',       durationCycles: 0, phaseType: 'accessory', primaryStyleId: find('General'),         secondaryStyleId: null },
  ],
},
```

**Important**: The `find()` helper reads `userStyles` which is populated before this block runs. The 4 new styles seeded in Step 2 are inserted *before* `userStyles` is read (they're at the top of `upsertUser`). Verify that `userStyles` is re-read (or fetched) AFTER the new style inserts, otherwise `find('Hypertrophy Plus')` etc. will return `null`. If `userStyles` is read only once before all seeding, re-fetch it after the new style inserts:

```typescript
// Re-read after new style inserts so find() can resolve new names
const userStyles = await this.db.select().from(s.progressionStyles).where(eq(s.progressionStyles.userId, returnedUser.id))
const find = (name: string) => userStyles.find(st => st.name === name)?.id ?? null
```

- [ ] **Step 4: Commit**

```bash
git add lib/data/postgres/adapter.ts
git commit -m "feat: seed new progression styles and goal-specific phase sets for new users"
```

---

## Task 3: Generate-program route — goal enum, styles, phase set auto-selection

**Files:**
- Modify: `app/api/generate-program/route.ts`

Four changes in one file: (1) expand goal enum, (2) add new styles to KNOWN_STYLES, (3) update GOAL_STYLE_RULES, (4) add goalPhaseSetMap.

- [ ] **Step 1: Update RequestSchema goal enum**

Find (line 16):
```typescript
goal: z.enum(['hypertrophy', 'strength', 'strength+hypertrophy']),
```
Replace with:
```typescript
goal: z.enum(['hypertrophy', 'strength', 'strength+hypertrophy', 'powerbuilding']),
```

- [ ] **Step 2: Add 4 new styles to KNOWN_STYLES**

After the `Powerbuilding` entry (around line 93–98), add:

```typescript
  {
    name: 'Hypertrophy Plus',
    sets: Array(4).fill({ reps: 8, restSec: 75 }),
    description: '4 × 8 @ 70% · 75s rest — moderate intensity, high volume bridge',
  },
  {
    name: 'Heavy Strength',
    sets: Array(5).fill({ reps: 5, restSec: 180 }),
    description: '5 × 5 @ 85% · 180s rest — high-intensity strength block',
  },
  {
    name: 'Strength Plus',
    sets: Array(4).fill({ reps: 3, restSec: 180 }),
    description: '4 × 3 @ 87% · 180s rest — strength intensification',
  },
  {
    name: 'Max Strength',
    sets: Array(3).fill({ reps: 3, restSec: 240 }),
    description: '3 × 3 @ 92% · 240s rest — near-maximal peak strength',
  },
```

- [ ] **Step 3: Update GOAL_STYLE_RULES**

Replace the existing GOAL_STYLE_RULES constant (lines 102–106) with:

```typescript
const GOAL_STYLE_RULES: Record<string, { primary: string; secondary: string; accessory: string }> = {
  hypertrophy:            { primary: 'General 4-set',  secondary: 'Hypertrophy 3-set', accessory: 'General' },
  'strength+hypertrophy': { primary: 'Hypertrophy',    secondary: 'Hypertrophy 3-set', accessory: 'Hypertrophy 3-set' },
  powerbuilding:          { primary: 'Powerbuilding',  secondary: 'Hypertrophy 3-set', accessory: 'Hypertrophy 3-set' },
  strength:               { primary: 'Strength',       secondary: 'Strength 4-set',    accessory: 'Strength 3-set' },
}
```

The primary rule for each goal now matches the accumulation phase's primaryStyleId so the builder preview reflects what the first workout will actually show.

- [ ] **Step 4: Add goalPhaseSetMap and update phase set lookup**

Add this constant after GOAL_STYLE_RULES:

```typescript
const GOAL_PHASE_SET_MAP: Record<string, string> = {
  hypertrophy:            'Hypertrophy Progression',
  'strength+hypertrophy': 'S+H Progression',
  powerbuilding:          'Powerbuilding Progression',
  strength:               'Strength Progression',
}
```

Then find the phase set lookup block (currently around line 306–314):
```typescript
const phaseSet =
  phaseSets.find(ps => ps.name === inputs.phaseStructureName) ??
  phaseSets.find(ps => ps.name.toLowerCase().includes(inputs.phaseStructureName.split(' ')[0].toLowerCase())) ??
  phaseSets.find(ps => ps.isDefault) ??
  phaseSets[0]
```

Replace with:
```typescript
const goalPhaseSetName = GOAL_PHASE_SET_MAP[inputs.goal]
const phaseSet =
  (goalPhaseSetName ? phaseSets.find(ps => ps.name === goalPhaseSetName) : null) ??
  phaseSets.find(ps => ps.name === inputs.phaseStructureName) ??
  phaseSets.find(ps => ps.name.toLowerCase().includes(inputs.phaseStructureName.split(' ')[0].toLowerCase())) ??
  phaseSets.find(ps => ps.isDefault) ??
  phaseSets[0]
```

- [ ] **Step 5: Update phaseStructureName in the response to reflect actual phase set used**

Find where `programJson` is built (around line 322). The `phaseStructureName` field is set from `inputs.phaseStructureName`. Update it to use the actual phase set name:

```typescript
phaseStructureName: goalPhaseSetName ?? inputs.phaseStructureName,
```

- [ ] **Step 6: Commit**

```bash
git add app/api/generate-program/route.ts
git commit -m "feat: auto-select goal-specific phase set and update style rules for 4-goal builder"
```

---

## Task 4: Types + builder wizard — add Powerbuilding goal

**Files:**
- Modify: `lib/types/builder.ts`
- Modify: `components/workout-builder/builder-wizard.tsx`

- [ ] **Step 1: Update BuilderInputs goal union in types**

In `lib/types/builder.ts`, line 30, replace:
```typescript
  goal: 'hypertrophy' | 'strength' | 'strength+hypertrophy'
```
With:
```typescript
  goal: 'hypertrophy' | 'strength' | 'strength+hypertrophy' | 'powerbuilding'
```

- [ ] **Step 2: Add Powerbuilding option to step 6 in wizard**

In `components/workout-builder/builder-wizard.tsx`, find the goal options array (lines 333–336):
```typescript
{ value: 'hypertrophy',          label: 'Hypertrophy',            description: 'Build muscle size — moderate weight, higher reps' },
{ value: 'strength',             label: 'Strength',               description: 'Build max strength — heavy weight, lower reps' },
{ value: 'strength+hypertrophy', label: 'Strength + Hypertrophy', description: 'Balanced approach — alternates size and strength phases' },
```

Replace with:
```typescript
{ value: 'hypertrophy',          label: 'Hypertrophy',            description: 'Build muscle size — high volume, 60–70% intensity, phases up gradually' },
{ value: 'strength+hypertrophy', label: 'Strength + Hypertrophy', description: 'Balanced — builds muscle first, then shifts toward strength over the block' },
{ value: 'powerbuilding',        label: 'Powerbuilding',          description: 'Strength-focused with size — heavy from day one, peaks at 90%' },
{ value: 'strength',             label: 'Strength',               description: 'Maximise 1RM — heavy compounds, peaks at 92%, lower volume' },
```

- [ ] **Step 3: Commit**

```bash
git add lib/types/builder.ts components/workout-builder/builder-wizard.tsx
git commit -m "feat: add Powerbuilding as fourth builder goal option"
```

---

## Task 5: Builder review — revert phaseMode + update STYLE_DISPLAY

**Files:**
- Modify: `components/workout-builder/builder-review.tsx`

- [ ] **Step 1: Revert phaseMode to 'automatic'**

Find in `handleSave` (around line 178):
```typescript
            phaseMode: 'manual',
```
Replace with:
```typescript
            phaseMode: 'automatic',
```

The phase sets are now correctly designed for each goal, so automatic mode will use the right styles.

- [ ] **Step 2: Add new styles to STYLE_DISPLAY**

Find the STYLE_DISPLAY constant (around line 24). After the `'Powerbuilding'` entry, add:

```typescript
  'Hypertrophy Plus': '4 × 8 @ 70% · 75s rest',
  'Heavy Strength':   '5 × 5 @ 85% · 180s rest',
  'Strength Plus':    '4 × 3 @ 87% · 180s rest',
  'Max Strength':     '3 × 3 @ 92% · 240s rest',
```

- [ ] **Step 3: Commit**

```bash
git add components/workout-builder/builder-review.tsx
git commit -m "feat: re-enable automatic phase mode and add new style display strings"
```

---

## Task 6: Push and verify

- [ ] **Step 1: Push all commits to the feature branch**

```bash
git push -u origin fix/ai-style-assignment
```

Wait — check the current branch first. All work in this session has been on `main` (no feature branch was created). Push to main:

```bash
git push origin main
```

- [ ] **Step 2: Wait for Railway deploy and test**

After deploy, test in order:
1. **Builder**: Select each of the 4 goals → verify correct phase set name appears in review header
2. **Powerbuilding goal**: builder review should show "4 × 6 @ 80% · 120s rest" for primary compounds (Accumulation phase style)
3. **Save a Powerbuilding program** → open workout → should show 4×6@80% for first exercise (Powerbuilding, accumulation phase)
4. **S+H goal**: builder review should show "4 × 10 @ 65% · 60s rest" for primary compounds (Hypertrophy, accumulation phase)
5. **Hypertrophy goal**: builder review should show "4 × 12 @ 60% · 60s rest" for primary (General 4-set, accumulation phase)
6. **Strength goal**: builder review should show "5 × 5 @ 80% · 120s rest" for primary (Strength, accumulation phase)

---

## Self-Review Checklist

- [x] Migration has IF NOT EXISTS guards on all inserts — idempotent ✓
- [x] Adapter seeds new styles before re-reading userStyles so find() resolves correctly ✓
- [x] GOAL_STYLE_RULES primary style for each goal matches the accumulation phase's primaryStyleId — builder preview = first workout ✓
- [x] goalPhaseSetMap falls back to phaseStructureName-based lookup if new phase sets aren't found ✓
- [x] `sessionsPerCycle` fix from previous commit preserved (builder-review.tsx already has it) ✓
- [x] Existing phase sets (Phase-Based Progression, Baselining, Linear Progression) untouched ✓
- [x] phaseType='peak' used only for Powerbuilding Progression and Strength Progression peaks (Hypertrophy/S+H peaks use 'normal' — they don't do true 1RM peaking) ✓
