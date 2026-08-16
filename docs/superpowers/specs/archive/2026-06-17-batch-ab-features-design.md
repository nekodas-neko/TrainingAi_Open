# Batch A + B Features — Design Spec
Date: 2026-06-17

## Overview

Five features across two batches:

**Batch A**
1. Calendar legend truncation fix
2. Feedback submission system (user → admin)

**Batch B**
3. Injury log (heatmap + workout warning)
4. Supplement log (daily checklist + reminders)

U21 (mobile token pruning) dropped — the app uses Capacitor local notifications only; no remote push token infrastructure exists.

---

## Architecture

All features follow the standard stack pattern:
- PostgreSQL migrations in `lib/data/postgres/migrations/`
- Drizzle schema additions in `lib/data/postgres/schema.ts`
- Repository interface additions in `lib/data/repository.ts`
- Adapter implementations in `lib/data/postgres/adapter.ts`
- API routes under `app/api/`
- UI components in `components/`

---

## Feature 1: Calendar Legend Truncation Fix

**File:** `components/calendar-widget.tsx` (legend section, ~lines 188–199)

**Change:** Add `truncate max-w-[96px]` to each session name text span in the legend. This caps long session names (e.g. "Upper Body Strength") at ~12 characters with an ellipsis, preventing layout breaks on narrow screens with 4+ sessions.

---

## Feature 2: Feedback Submission System

### Data Model

**Migration:** `lib/data/postgres/migrations/074_feedback_submissions.sql`

```sql
CREATE TABLE feedback_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('bug', 'feature', 'other')),
  title TEXT NOT NULL,
  description TEXT,
  screenshot_data TEXT, -- base64 JPEG, compressed client-side to max 800px wide at 0.7 quality
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### API Routes

| Route | Auth | Description |
|-------|------|-------------|
| `POST /api/feedback` | any user | Create submission |
| `GET /api/admin/feedback` | admin only | List all submissions with user email |
| `DELETE /api/admin/feedback/[id]` | admin only | Delete submission |

`GET /api/admin/feedback` returns:
```ts
{ id, type, title, description, screenshot_data, created_at, user_email, user_name }[]
```

### User UI

**Location:** `components/more/feedback-section.tsx` (new component)

Rendered in `components/more/profile-tab.tsx` between the "About" and "Admin Console" sections.

Layout:
- Section header "Report an Issue"
- One-liner: "Found a bug or have a feature idea? Let us know."
- "Submit Feedback" button → opens `FeedbackSheet`

**`FeedbackSheet`** (`components/more/feedback-sheet.tsx`, new):
- Type chips: Bug / Feature Request / Other (single select, required)
- Title input (single line, required)
- Description textarea (4 rows, optional)
- "Attach screenshot" row: `<input type="file" accept="image/*">` hidden; visible button triggers it; on select, compress via canvas to max 800px wide at JPEG 0.7; shows thumbnail with remove × button
- Submit → POST `/api/feedback` → success toast → sheet closes
- Validation: type and title required before submit

### Admin UI

**`admin-content.tsx`** additions:
- New 6th tab: "Feedback" with a red numeric badge showing unread count (fetched from `GET /api/admin/feedback` on load; count = `submissions.length`)
- Badge also appears on the "Admin Console" link in `profile-tab.tsx`

**Feedback tab UI:**
- List of submissions sorted by `created_at DESC`
- Each row: type chip (red=Bug, blue=Feature, grey=Other), user email, title, relative timestamp
- Tap/click row to expand: full description + screenshot (if present; full-size on tap)
- Trash icon → `DELETE /api/admin/feedback/[id]` with inline confirm (button turns red "Confirm delete" on first press)

---

## Feature 3: Injury Log

### Data Model

**Migration:** `lib/data/postgres/migrations/075_injuries.sql`

```sql
CREATE TABLE injuries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muscle_name TEXT NOT NULL,  -- from standardised ~30-muscle list
  notes TEXT,                 -- free text, e.g. "left shoulder, rotator cuff"
  severity TEXT NOT NULL CHECK (severity IN ('mild', 'moderate', 'severe')),
  started_date DATE NOT NULL,
  resolved_date DATE,         -- NULL = currently active
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### API Routes

| Route | Auth | Description |
|-------|------|-------------|
| `GET /api/injuries` | user | List all user injuries (active + resolved) |
| `POST /api/injuries` | user | Create injury |
| `PATCH /api/injuries/[id]` | user | Update (severity, notes, resolved_date) |
| `DELETE /api/injuries/[id]` | user | Delete injury |

### Muscle Heatmap Extension

**`components/muscle-heatmap.tsx`:** Add `'injured'` to the `MuscleActivation` role union:
```ts
export interface MuscleActivation {
  muscle: string;
  role: 'main' | 'secondary' | 'injured';
}
```
Color for `'injured'` role: `#ef4444` (red). Injured role takes precedence over primary/secondary when the same muscle appears in multiple activation sets.

### Health > Body UI

**`components/health/injury-card.tsx`** (new):
- Header "Injuries" + "Add" button (PlusIcon)
- `MuscleHeatmap` showing active injuries as `{ muscle: name, role: 'injured' }` assignments
- List of active injuries: muscle name, severity chip (Mild=green, Moderate=amber, Severe=red), "Day N" counter, "✓ Resolved" button
- "Show resolved (N)" toggle at bottom — reveals resolved injuries greyed out with resolved date
- Tapping a row opens an edit sheet

**Add/Edit Injury Sheet** (`components/health/injury-sheet.tsx`, new):
- Muscle picker: scrollable list of the ~30 standardised muscle names
- Severity chips: Mild / Moderate / Severe
- Start date: defaults to today, tappable date input to change
- Notes field: free text
- Save / Delete buttons

**Rendered in:** `app/health/health-content.tsx` — Body tab, after the existing body metrics cards.

### Workout Warning Banner

**Files:** `components/workout-screen.tsx` (fetch + state) and `components/workout/active-workout-screen.tsx` (banner rendering)

- `workout-screen.tsx` (orchestrator): fetch `/api/injuries` once on workout start; filter to active (no `resolved_date`); store in local state; pass as `activeInjuries` prop to `ActiveWorkoutScreen`
- Before rendering each exercise: check if `exercise.muscleGroups` overlaps with active `injury.muscle_name` values
- If overlap: render amber banner above that exercise's sets — "⚠️ [Muscle] injury active — train with caution"
- Banner is dismissible per exercise (local component state, not persisted)

---

## Feature 4: Supplement Log

### Data Model

**Migrations:** `076_supplements.sql`

```sql
CREATE TABLE supplements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  dose TEXT,              -- "5g", "1 capsule"
  reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  reminder_time TEXT,     -- "HH:MM" (24h)
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE supplement_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplement_id UUID NOT NULL REFERENCES supplements(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (supplement_id, log_date)
);
```

### API Routes

| Route | Auth | Description |
|-------|------|-------------|
| `GET /api/supplements` | user | List supplements + today's log status |
| `POST /api/supplements` | user | Create supplement |
| `PATCH /api/supplements/[id]` | user | Update (name, dose, reminder, active, sort_order) |
| `DELETE /api/supplements/[id]` | user | Delete supplement + cascade logs |
| `POST /api/supplements/[id]/log` | user | Check off today |
| `DELETE /api/supplements/[id]/log` | user | Uncheck today |

`GET /api/supplements` returns:
```ts
{ id, name, dose, reminder_enabled, reminder_time, sort_order, active, logged_today: boolean }[]
```

### Reminder System

**`lib/supplement-reminders.ts`** (new) — mirrors `lib/meal-reminders.ts` exactly:
- `computeSupplementReminderActions(supplements, loggedIds, now, notifiedToday)` — pure function returning cancel/skip/immediate/scheduled actions
- `reconcileSupplementReminders(supplements, loggedIds)` — executes actions via `@capacitor/local-notifications`
- Channel: `supplement-reminders`
- Notification IDs: base 8500, range 200 (8500–8699, avoids collision with workout=8000, meal=9200+)
- localStorage key: `ta_supplement_reminder_notified_today`
- `cancelSupplementReminder(supplementId)` — cancel single notification
- Logic differs from meal reminders (which fire at end of a window): supplement reminders fire AT `reminder_time`. If `reminder_enabled`, not logged today, and current time >= `reminder_time` → fire immediate (once, tracked in notifiedToday); else schedule at `reminder_time` that day.

**Integration in `sync-provider.tsx`:** call `reconcileSupplementReminders()` alongside `reconcileMealReminders()` on app open and on `appStateChange` (resume).
**Integration in supplement log toggle:** call `cancelSupplementReminder(id)` when checking off.

### Nutrition Tab UI

**`app/nutrition/nutrition-content.tsx`:** New "Supplements" section at the bottom.

**`components/nutrition/supplements-section.tsx`** (new):
- Section header "Supplements" + "Manage" button
- Daily checklist: each active supplement as a row — name (bold), dose (muted smaller text), checkbox on right
  - Checked: strikethrough name, green filled checkbox
  - Unchecked: normal
- Empty state: "No supplements added yet — tap Manage to add some"

**`components/nutrition/manage-supplements-sheet.tsx`** (new):
- Full-height bottom sheet
- List of all supplements (active + inactive) with drag handles for reorder (`@dnd-kit/react` — already installed)
- Each row: name, dose, reminder indicator, active/inactive toggle
- Tap row → edit sheet
- "Add Supplement" button at bottom

**Add/Edit Supplement Sheet:**
- Name input (required)
- Dose input (optional, placeholder "e.g. 5g, 1 capsule")
- Reminder toggle + time picker (shown when toggle on, "HH:MM" format)
- Active toggle
- Save / Delete buttons

---

## Implementation Order

1. DB migrations (074–076) + schema + adapter stubs
2. API routes (all features)
3. Calendar legend fix (trivial)
4. Feedback UI (FeedbackSection + FeedbackSheet + admin tab)
5. Injury UI (InjuryCard + InjurySheet + heatmap extension + workout warning)
6. Supplement UI (SupplementsSection + ManageSupplementsSheet + reminder lib)
7. Wire supplement reminders into sync-provider
8. Cache invalidation: injuries + supplements added to relevant cache-groups

---

## Out of Scope

- AI periodization planning (deferred to its own session)
- Progress photos (needs object storage)
- Left/right muscle distinction on injury heatmap (library doesn't support it)
