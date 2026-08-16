# Block Periodization UX Simplification Design

**Goal:** Drastically simplify the block periodization setup by removing redundant style pickers, introducing an Accessory phase, seeding sensible defaults, and separating Phase Setup from the program editor.

**Architecture:** The simplification is purely a UI/UX change. The underlying data model stays the same except for one new `phaseType` value (`'accessory'`). The phase engine gets a small update to route accessory exercises to the Accessory phase style instead of a per-exercise style. All other DB tables, API routes, and logic are unchanged.

**Tech Stack:** Next.js 15, TypeScript, Drizzle ORM, Tailwind v4, shadcn/ui, existing config-screen + phase-editor components

---

## 1. Terminology Changes (display only, no DB changes)

| Old label | New label |
|---|---|
| Automatic | Block Periodization |
| Manual | Manual |
| primary (exercise role) | Main Compound |
| secondary (exercise role) | Secondary Compound |
| accessory (exercise role) | Accessory |

DB values (`primary`, `secondary`, `accessory`, `normal`, `peak`, `deload`) are unchanged. Only display strings change.

---

## 2. Default Progression Styles

Seeded in `upsertUser` in `lib/data/postgres/adapter.ts` (existing hook). Skip any style whose name already exists for that user.

| Name | Sets (setNumber: pct / reps / restSec / useFor1rm) | Use |
|---|---|---|
| Hypertrophy | 4 sets: 65% / 10 reps / 60s / false | Accumulation phase main/secondary |
| Strength | 5 sets: 80% / 5 reps / 120s / false | Intensification phase main/secondary |
| Peak | 3 sets: 90% / 3 reps / 180s / true | Peak phase main only |
| Deload | 3 sets: 50% / 10 reps / 60s / false | Deload phase |
| General | 3 sets: 60% / 12 reps / 60s / false | Accessory phase |

All sets within each style use identical pct/reps/restSec (no wave-loading in defaults). `useFor1rm` is true only for Peak.

---

## 3. Default Phases

When a user first enables Block Periodization on a program (toggle switches to Block Periodization and no phases exist yet), auto-populate these phases using the default styles above:

| Name | Duration | phaseType | Primary Style | Secondary Style |
|---|---|---|---|---|
| Accumulation | 4 cycles | normal | Hypertrophy | Hypertrophy |
| Intensification | 3 cycles | normal | Strength | Strength |
| Peak | 2 cycles | peak | Peak | — (skip) |
| Deload | 1 cycle | deload | Deload | — |
| Accessory | fixed | accessory | General | — |

The Accessory phase has `durationCycles = 0` (sentinel value meaning "fixed, doesn't cycle"). It appears last in the phase list and cannot be reordered or have its type changed.

---

## 4. Accessory Phase — DB and Engine Changes

### Schema
Add `'accessory'` as a valid `phaseType` value in `program_phases`. No migration needed — it's a text column with no constraint. Just add it to the TypeScript union type in `lib/types/program.ts`.

### Phase Engine (`lib/phase-engine.ts`)
Update `resolveStyleForExercise`:
- If `exerciseRole === 'accessory'`: find the phase in the program's phase list where `phaseType === 'accessory'` and return its `primaryStyleId`. Ignore the current active phase entirely.
- If `exerciseRole === 'primary'` or `'secondary'`: existing logic unchanged.

### Phase Editor (`components/config/phase-editor.tsx`)
- Accessory phase renders differently: no duration stepper (shows "Fixed" label instead), no type buttons, just a style picker for its single style.
- Accessory phase always appears last and its drag handle is disabled.

---

## 5. Phase Setup — Separate Section in Config Screen

Phase Setup moves out of the Edit Program panel into its own top-level card in the config screen, below Progression Styles and above Programs.

### Visibility
Only shown when at least one program exists with `phaseMode === 'automatic'`.

### UI
- Section header: **"Phase Setup"**
- One card per program that has Block Periodization enabled, labelled with the program name
- Tapping the card opens a bottom sheet containing the `PhaseEditor` component (already exists)
- Bottom sheet title: "[Program Name] — Phase Setup"

### Removing Phase Editor from Edit Program Panel
The Phase Editor and avg sessions/week stepper are removed from the Edit Program panel entirely. The Edit Program panel keeps:
- Program name
- Sessions + exercises
- Schedule
- Manual / Block Periodization toggle (creation-time choice — see §6)

---

## 6. Manual vs Block Periodization — Creation-Time Choice

The toggle becomes a **radio selection shown only during program creation**, not on edit. Once saved, the mode is locked.

- New program: show toggle (Manual / Block Periodization)
- Edit existing program: show mode as a read-only label ("Manual" or "Block Periodization") with a note: "To change, create a new program"
- When Block Periodization is selected during creation: auto-populate default phases (§3) and default styles (§2) if they don't exist yet

---

## 7. Exercise UI in Block Periodization Mode

### Current (broken UX)
Every exercise shows: name + style picker + role pills

### New
**Block Periodization mode:**
- Exercise shows: name + role pills (Main Compound / Secondary Compound / Accessory)
- No style picker — style is determined entirely by role + Phase Setup
- Role defaults to Main Compound on add

**Manual mode:**
- Exercise shows: name + style picker (unchanged from current)
- No role pills

### Role pill labels
| DB value | Display label |
|---|---|
| primary | Main Compound |
| secondary | Secondary Compound |
| accessory | Accessory |

---

## 8. Avg Sessions Per Week

Moved out of Phase Setup into a small auto-calculated field. Computed from the program's schedule (count of training days per week). Shown as read-only with a manual override option if the user wants to adjust the estimated weeks display in Phase Setup.

---

## 9. What Does NOT Change

- All API routes (workout-data, program-phases, log-exercise, etc.)
- DB schema (except `phaseType` union type — text column already allows any value)
- Phase engine logic for primary/secondary exercises
- The PhaseEditor component's core structure (just modified for Accessory phase and removal from Edit Program panel)
- Muscle group assignment per exercise (stays as-is)

---

## 10. Out of Scope

- Porting a program from Manual to Block Periodization (create new program for this)
- Per-exercise style override in Block Periodization mode
- More than one Accessory phase
