# Phase Sets — Implementation Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make phases reusable named presets (Phase Sets) that live in Advanced Settings and are assigned to Block Periodization programs, instead of being defined per-program inline during creation.

**Architecture:** New `phase_sets` table owned by the user. `program_phases` rows move from belonging to a program to belonging to a phase set. Programs store a `phase_set_id` FK. A "Default" phase set is seeded per user. Advanced Settings becomes a collapsible section grouping Progression Styles and Phase Sets. The program editor shows a Phase Set selector instead of an inline phase editor.

**Tech Stack:** Next.js 15, TypeScript, React 19, PostgreSQL/Drizzle, Tailwind CSS v4, Radix UI sheets/selects, existing `PhaseEditor` component.

---

## Data Model

### New table: `phase_sets`

```sql
CREATE TABLE IF NOT EXISTS phase_sets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
```

### Modified table: `program_phases`

Replace `program_id` FK with `phase_set_id` FK:

```sql
ALTER TABLE program_phases
  DROP COLUMN program_id,
  ADD COLUMN phase_set_id UUID NOT NULL REFERENCES phase_sets(id) ON DELETE CASCADE;
```

### Modified table: `programs`

Add `phase_set_id` FK (nullable — only set when `phase_mode = 'automatic'`):

```sql
ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS phase_set_id UUID REFERENCES phase_sets(id) ON DELETE SET NULL;
```

### Migration strategy

Migration `021_phase_sets.sql` runs the above DDL, then migrates existing data:

1. For each user who has programs with `phase_mode = 'automatic'` and existing rows in `program_phases`, create a "Default" phase set for that user.
2. Move those `program_phases` rows to `phase_set_id` pointing at the new Default set.
3. Set `programs.phase_set_id` to the Default set for those programs.
4. Migration is fully idempotent (all steps guarded with `IF NOT EXISTS` / `ON CONFLICT DO NOTHING`).

### `phaseType` union — add `'testing'`

```ts
// lib/types/program.ts
phaseType: 'normal' | 'peak' | 'deload' | 'accessory' | 'testing'
```

A Testing phase is a 1RM testing week. Like deload, it is excluded from regular volume/intensity stats aggregates. The workout screen treats it as a maximal-effort session (no progression style override — athlete tests to failure to recalibrate 1RM baseline).

---

## Repository Interface

New methods in `lib/data/repository.ts`:

```ts
listPhaseSets(userId: string): Promise<PhaseSetWithPhases[]>
createPhaseSet(userId: string, name: string, phases: PhaseInput[]): Promise<PhaseSetWithPhases>
updatePhaseSet(phaseSetId: string, userId: string, name: string, phases: PhaseInput[]): Promise<PhaseSetWithPhases>
deletePhaseSet(phaseSetId: string, userId: string): Promise<void>  // throws if referenced by a program
assignPhaseSetToProgram(programId: string, userId: string, phaseSetId: string): Promise<void>
```

Update existing:
- `listProgramPhases(programId)` → reads via the program's `phase_set_id` JOIN
- `saveProgramPhases` → retired (replaced by `updatePhaseSet`)

Types:

```ts
interface PhaseSet {
  id: string
  name: string
  isDefault: boolean
}

interface PhaseSetWithPhases extends PhaseSet {
  phases: ProgramPhase[]
}
```

---

## API Routes

### `GET /api/phase-sets`
Returns all phase sets for the authenticated user, each with their phases array.

### `POST /api/phase-sets`
Body: `{ name: string, phases: EditablePhase[] }`
Creates a new phase set. Returns the created set with phases.

### `PUT /api/phase-sets/[id]`
Body: `{ name: string, phases: EditablePhase[] }`
Replaces all phases for the set. Name field disabled (no-op) for the Default set — name is always "Default". Returns updated set with phases.

### `DELETE /api/phase-sets/[id]`
Deletes the phase set. Returns `400` if any program references it (with a message listing program names). The Default set cannot be deleted (returns `403`).

### Retired: `/api/program-phases` PUT
Phase editing now goes through `/api/phase-sets/[id]`. The GET on `/api/program-phases` is kept (reads via phase_set_id JOIN) so existing workout-data flow is unaffected.

---

## Seeding

`upsertUser()` in `lib/data/postgres/adapter.ts` already seeds 5 default progression styles. Extend it to:

**1. Seed a "Testing" progression style** (alongside the existing 5):

| Set | % 1RM | Reps (target) | Rest  | useFor1rm |
|-----|-------|---------------|-------|-----------|
| 1   | 55%   | 5             | 90s   | false     |
| 2   | 70%   | 3             | 120s  | false     |
| 3   | 87%   | 5             | 180s  | true      |

Set 3 is the AMRAP set — the athlete does as many reps as possible at 87%. The target of 5 reps is a floor; actual reps logged feed into the Brzycki formula. `useFor1rm: true` triggers 1RM recalculation and PR detection on that set.

**2. Seed a "Default" phase set** with 6 standard phases if none exists for the user:

```
Accumulation    — 4 cycles — normal    — primary: Hypertrophy,  secondary: Hypertrophy
Intensification — 3 cycles — normal    — primary: Strength,     secondary: Strength
Peak            — 2 cycles — peak      — primary: Peak,         secondary: Peak
Testing         — 1 cycle  — testing   — primary: Testing,      secondary: Testing
Deload          — 1 cycle  — deload    — primary: Deload,       secondary: Deload
Accessory       — 0 cycles — accessory — primary: General,      secondary: (none)
```

Testing phase applies its style to primary and secondary exercise roles only. Accessory exercises in a Testing phase always fall through to the Accessory style, same as in every other phase (existing `resolveStyleForExercise` behaviour).

---

## UI Changes

### Advanced Settings collapsible section (`components/config-screen.tsx`)

Replaces the existing top-level "Progression Styles" section and the conditional "Block Periodization Phases" section.

**Collapsed state:** Single row — label "Advanced Settings" + right-pointing chevron. State stored in `useState`, not persisted.

**Expanded state:** Two subsections stacked vertically:

**1. Progression Styles** — identical to current implementation, just moved inside.

**2. Phase Sets**
- Section header "Phase Sets" + "+ New" button
- List of phase set cards. Each card:
  - Name (bold) + phase count (muted, e.g. "5 phases")
  - "Default" badge (amber pill) on the default set
  - Edit button (pencil icon) → opens Phase Set editor sheet
  - Delete button (trash icon) → disabled on Default set; shows confirmation toast before deleting; shows error toast if set is in use
- If no phase sets exist yet: muted placeholder text "No phase sets. Create one to get started."

### Phase Set editor sheet

Triggered by Edit button or "+ New" button. Bottom sheet containing:

1. **Name field** — text input, disabled for the Default set
2. **PhaseEditor** — existing component, unchanged
3. **Save button** — calls `PUT /api/phase-sets/[id]` (edit) or `POST /api/phase-sets` (new). Shows loading state. Closes sheet on success. Shows error toast on failure.

### Program editor — Block Periodization mode

When `phaseMode === 'automatic'` during program creation or editing:

- **Remove:** inline `PhaseEditor` component
- **Add:** Phase Set selector row

```
Phase Set    [ Default          ▾ ]
```

Implemented as a `<select>` or Radix `<Select>` populated from the user's `phaseSets` list (fetched alongside styles on config screen mount). Defaults to the Default set on first toggle. Selection stored as `selectedPhaseSetId` in form state, saved to `programs.phase_set_id` on program save.

A "+ Manage Phase Sets" link below the selector opens Advanced Settings scrolled to the Phase Sets subsection (or user can navigate there manually).

---

## Stats / Workout Screen Impact

### Testing phase type

A Testing phase uses **rep-max to failure** — the athlete works up to a high percentage (e.g. 85–90%) and performs as many reps as possible. The existing Brzycki formula (`calc1RM` in `components/workout/utils.ts`) estimates a new 1RM from the result, exactly as it does for any set with `useFor1rm: true`. The PR detection in `log-exercise/route.ts` then records a new personal record if the estimated 1RM exceeds the previous best.

The user assigns a high-% AMRAP-style progression style to a Testing phase (e.g. a style with 87.5% / high reps / `useFor1rm: true`). No special workout screen behaviour required — Testing phases run through the same flow as any other phase.

Stats treatment:
- Excluded from volume, sets, intensity, duration aggregates in `weekly-stats` and `training-load` routes (same as deload)
- Marked with a purple "T" badge on the training load bar chart (matching deload's amber "D" badge)
- `is_early_deload` flag not applied to testing phases

### Exercise targeting in Testing phase

Testing applies only to compound movements:
- **Primary role** → Testing style (ramp + AMRAP)
- **Secondary role** → Testing style (same ramp + AMRAP — secondary compounds benefit from testing too)
- **Accessory role** → Accessory style, same as every other phase (existing `resolveStyleForExercise` behaviour — no change needed)

This is already handled by the existing `resolveStyleForExercise` logic which routes accessories to the Accessory style regardless of block. No phase-engine changes required for the targeting rule — it falls out naturally from how the function works.

---

## Files Changed

| File | Change |
|------|--------|
| `lib/data/postgres/migrations/021_phase_sets.sql` | New migration |
| `lib/data/postgres/schema.ts` | Add `phaseSets` table, update `programPhases` + `programs` |
| `lib/types/program.ts` | Add `'testing'` to `phaseType`; add `PhaseSet`, `PhaseSetWithPhases` types |
| `lib/data/repository.ts` | Add 5 new method signatures |
| `lib/data/postgres/adapter.ts` | Implement new methods; extend `upsertUser` seeding; update `listProgramPhases` JOIN |
| `app/api/phase-sets/route.ts` | New — GET + POST |
| `app/api/phase-sets/[id]/route.ts` | New — PUT + DELETE |
| `app/api/program-phases/route.ts` | GET kept, PUT retired |
| `app/api/weekly-stats/route.ts` | Exclude testing phases; add "T" badge |
| `app/api/training-load/route.ts` | Exclude testing phases from chronic window |
| `components/config-screen.tsx` | Advanced Settings collapsible; Phase Sets list; updated program editor selector |
| `lib/phase-engine.ts` | Handle `'testing'` phaseType → return null style |

No new component files required — the Phase Set editor sheet reuses the existing `PhaseEditor` component inline within `config-screen.tsx`, matching the existing pattern for the style editor sheet.
