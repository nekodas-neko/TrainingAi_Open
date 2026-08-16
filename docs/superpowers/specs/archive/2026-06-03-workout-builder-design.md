# Workout Builder Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable users to generate a complete workout program by answering questions about equipment, training frequency, time budget, muscle focus, goal, and phase preference. AI generates a structured program, user reviews and refines it via chat, then saves.

**Architecture:** New builder wizard (7 steps) → Gemini-generated program → interactive review screen with exercise dropdowns + AI chat → saves as standard program. No new tables; add `equipment` column to `exercise_library` and rename phase sets globally.

**Tech Stack:** Next.js 15, TypeScript, React 19, Drizzle ORM, PostgreSQL, Gemini 3.1 Flash Lite, Tailwind v4, shadcn/ui

---

## 1. User Flow — Wizard (Steps 1–7)

### Step 1: Program Name
- **Input:** Text field
- **Validation:** Required, max 100 chars, unique per user
- **Next:** Step 2

### Step 2: Equipment (Multi-select)
- **Input:** Checkboxes (can select multiple)
  - Dumbbells
  - Barbell
  - Cables
  - Kettlebell
  - Full gym (selects all above)
- **Validation:** At least one required
- **Next:** Step 3

### Step 3: Training Frequency
- **Input:** Radio buttons (single select)
  - 1 / 2 / 3 / 4 / 5 / 6 / 7 days per week
- **Validation:** Required
- **Notes:** Frequency determines split type (full body, upper/lower, PPL, etc.)
- **Next:** Step 4

### Step 4: Time Budget Per Session
- **Input:** Radio buttons (single select)
  - 30 minutes
  - 45 minutes
  - 60 minutes
  - 90 minutes
  - **No time constraint** (generates max recommended volume)
- **Validation:** Required
- **Notes:** Drives number of exercises per session. "No time constraint" = ~20 sets/week for hypertrophy, ~15 for strength, ~25 for strength+hypertrophy split across the week
- **Next:** Step 5

### Step 5: Muscles to Focus On
- **Input:** Multi-select checkboxes from `MUSCLE_GROUPS` constant:
  - Chest, Back, Upper Back, Lats, Lower Back, Traps
  - Shoulders, Biceps, Triceps, Forearms
  - Quads, Hamstrings, Glutes, Calves, Adductors, Hip Flexors
  - Core, Abs, Full Body
- **Validation:** At least one required
- **Notes:** Informs which muscles are prioritized in the generated split
- **Next:** Step 6

### Step 6: Training Goal
- **Input:** Radio buttons (single select)
  - Hypertrophy (muscle gain, ~10–20 sets/muscle/week)
  - Strength (force gain, ~15–25 sets/muscle/week)
  - **Strength + Hypertrophy** (balanced, ~20 sets/muscle/week split between accumulation and intensification)
- **Validation:** Required
- **Next:** Step 7

### Step 7: Phase Structure
- **Display:** Three cards with description + icon
  - **Linear Progression** — "Steady 8-week build, add weight each week"
  - **Baselining** — "8 weeks to re-establish your 1RMs after time off"
  - **Phase-Based Progression** — "4 weeks accumulation → 3 weeks strength → 2 weeks peak → 1 week deload"
- **Input:** Click to select one
- **Validation:** Required
- **Notes:** Selected phase structure determines which phase set is assigned to the program at save time
- **Next:** Step 8 (call Gemini generator)

---

## 2. Gemini Generation (`/api/generate-program` POST)

### Request Body
```json
{
  "programName": "Push-Pull-Legs",
  "equipment": ["barbell", "dumbbell"],
  "sessionsPerWeek": 3,
  "timePerSessionMinutes": 60,
  "musclesToFocus": ["Chest", "Back", "Shoulders", "Quads", "Hamstrings"],
  "goal": "hypertrophy",
  "phaseStructureName": "Phase-Based Progression"
}
```

### Response
```json
{
  "program": {
    "name": "Push-Pull-Legs",
    "sessions": [
      {
        "name": "Push",
        "icon": "💪",
        "exercises": [
          {
            "name": "Bench Press",
            "exerciseRole": "primary",
            "mainMuscles": ["Chest"],
            "secondaryMuscles": ["Triceps", "Shoulders"]
          },
          {
            "name": "Incline Dumbbell Press",
            "exerciseRole": "secondary",
            "mainMuscles": ["Shoulders"],
            "secondaryMuscles": ["Chest"]
          },
          {
            "name": "Tricep Pushdown",
            "exerciseRole": "accessory",
            "mainMuscles": ["Triceps"]
          }
        ]
      }
    ],
    "phaseStructureName": "Phase-Based Progression",
    "reasoning": "3 days/week + intermediate + hypertrophy → PPL with Accumulation phase primary style"
  }
}
```

### Generation Logic

**System Prompt (Gemini):**
```
You are an expert fitness program designer. Generate a structured workout program 
based on the user's constraints. Return ONLY valid JSON, no markdown or extra text.

User constraints:
- Equipment: {equipment as comma-separated}
- Sessions per week: {sessionsPerWeek}
- Time per session: {timePerSessionMinutes} minutes (or unlimited if null)
- Muscles to focus: {musclesToFocus as comma-separated}
- Goal: {goal}
- Phase structure: {phaseStructureName}

Guidelines:
1. Determine split type (full body, upper/lower, PPL, etc.) based on frequency and muscle focus.
2. Design sessions to hit focused muscles 1–2× per week with sufficient volume.
3. Use only exercises from the provided library. Filter by user's equipment.
4. Assign each exercise a role: 'primary' (main compound) | 'secondary' (secondary compound) | 'accessory' (isolation).
5. Primary and secondary exercises should form the core; 1–2 accessory exercises per session.
6. Respect time budget: estimate 2.5 min/set for hypertrophy, 3.5 min/set for strength (work + rest + transition).
7. Ensure weekly volume targets:
   - Hypertrophy: 10–20 sets per muscle group per week
   - Strength: 15–25 sets per muscle group per week
   - Strength + Hypertrophy: 20 sets per muscle group per week, split between accumulation and intensification phases
8. If "No time constraint", generate max recommended volume (no session time cap).
9. Include a brief reasoning (1–2 sentences) explaining the split choice and exercise selection.

Available exercises (filtered by equipment and muscle relevance):
{exerciseLibraryJSON}

Return as JSON matching this schema exactly:
{
  "program": {
    "name": string,
    "sessions": [
      {
        "name": string,
        "icon": string (emoji),
        "exercises": [
          {
            "name": string (must match exercise library),
            "exerciseRole": "primary" | "secondary" | "accessory",
            "mainMuscles": string[],
            "secondaryMuscles": string[]
          }
        ]
      }
    ],
    "phaseStructureName": string,
    "reasoning": string
  }
}
```

**Implementation:**
- Fetch exercise library from DB
- Filter by user's selected equipment
- Format as JSON with each exercise's muscle data
- Call `generateObject` from `@ai-sdk/google` with structured schema above
- Validate response matches schema (exercise names exist in library)
- Return to client

---

## 3. Review & Modification Screen (Step 8)

### Layout
```
┌─ Program: "Push-Pull-Legs" ──────────────────────────────┐
│                                                           │
│ Session 1: Push                                     [Edit]│
│  ├─ Bench Press                      [Swap ▼]            │
│  │  Main: Chest | Secondary: Triceps, Shoulders         │
│  ├─ Incline Dumbbell Press           [Swap ▼]            │
│  │  Main: Shoulders | Secondary: Chest                   │
│  └─ Tricep Pushdown                  [Swap ▼]            │
│     Main: Triceps                                        │
│                                                           │
│ Session 2: Pull                                     [Edit]│
│  ├─ Pull-Up                          [Swap ▼]            │
│  │  Main: Lats | Secondary: Biceps                       │
│  ├─ Barbell Row                      [Swap ▼]            │
│  │  Main: Back | Secondary: Biceps                       │
│  └─ Face Pull                        [Swap ▼]            │
│     Main: Shoulders | Secondary: Rear Delts             │
│                                                           │
├─ Suggested Phase: Phase-Based Progression ────────────────┤
│                                                           │
│ Chat with AI:                                             │
│ ┌─────────────────────────────────────────────────────────┐
│ │ Gemini: "Your program is ready! 3 days/week with...    │
│ │ Adjust any exercises using the dropdowns, or ask me..." │
│ │                                                         │
│ │ [You]: "Can you add a landmine press to Push?"         │
│ │ [Gemini]: "Done! Replaced Incline Dumbbell with...    │
│ │                                                         │
│ │ [Message input field]          [Send] ────────────────│
│ └─────────────────────────────────────────────────────────┘
│                                                           │
│              [Back] [Regenerate] [Save Program] ──────────│
└─────────────────────────────────────────────────────────┘
```

### Exercise Dropdown ("Swap")

When user clicks [Swap ▼] on an exercise:
- Show dropdown of 5–8 alternative exercises from library
- Filter by: same muscle group (main) + user's equipment
- Group by role (primary / secondary / accessory)
- Clicking an alternative updates the session immediately
- Preview updates in real-time

Example: User clicks [Swap ▼] on Bench Press (Chest primary)
```
Suggested alternatives:
─ Primary compounds:
  ✓ Bench Press (current)
  ◯ Incline Bench Press
  ◯ Decline Bench Press
─ Secondary compounds:
  ◯ Dumbbell Bench Press
  ◯ Machine Chest Press
```

### AI Chat Interface

**Display:**
- Chat history (Gemini's initial reasoning, user messages, Gemini responses)
- Each message tagged [Gemini] or [You]
- Markdown rendering (bold, lists, etc.)

**User input:**
- Text field at bottom: "Ask the AI to modify your program..."
- [Send] button
- Auto-focus on input after each response

**Supported requests (examples):**
- "Replace bench press with dumbbell bench press"
- "Add a leg press to the Push session"
- "Can I swap the cable row for a machine row?"
- "Give me more leg exercise options"
- "This is too much volume, can you reduce sets?"

**Gemini response format:**
- Acknowledge the request
- Describe the change (e.g., "Replaced incline dumbbell press with machine chest press in your Push session")
- Return the updated program JSON
- Keep tone conversational but brief

**Implementation:**
- On each user message: append to chat history
- Send full context to Gemini (initial request + all chat turns)
- Gemini receives current program state as JSON
- Gemini returns updated program + text response
- Client updates preview + chat history
- Chat history persisted in component state (lost on back/refresh — this is OK)

---

## 4. Data Model Changes

### Add Equipment Column to Exercise Library

**Migration:** `030_exercise_equipment.sql`

```sql
ALTER TABLE exercise_library 
ADD COLUMN IF NOT EXISTS equipment TEXT[] DEFAULT '{}';
```

**Values:** Array of strings from: `['barbell', 'dumbbell', 'cable', 'kettlebell', 'machine', 'bodyweight']`

**Examples:**
```
"Bench Press": ['barbell']
"Dumbbell Curl": ['dumbbell']
"Lat Pulldown": ['cable', 'machine']
"Push-Up": ['bodyweight']
"Landmine Press": ['barbell']
```

**Seeding:** Post-migration, populate all 51 existing exercises with appropriate equipment values (one-time data load).

### Rename Phase Sets Globally

Replace these names everywhere they appear:

| Old Name | New Name |
|---|---|
| `Re-baseline` | `Baselining` |
| `Default Block Periodization` | `Phase-Based Progression` |
| `Linear Progression` | `Linear Progression` (no change) |

**Files to update:**
1. `lib/data/postgres/migrations/023_backfill_standard_phases.sql` — change INSERT values
2. `lib/data/postgres/migrations/025_backfill_all_standard_phases.sql` — change INSERT values
3. `components/config-screen.tsx` — display labels in Phase Sets section
4. Builder wizard step 7 — phase structure selection card labels

---

## 5. New API Route: `/api/generate-program` (POST)

**Auth:** Required (`auth()` guard)

**Request body:**
```typescript
{
  programName: string         // required, max 100 chars
  equipment: string[]         // required, 1+ items from above list
  sessionsPerWeek: number     // required, 1–7
  timePerSessionMinutes: number | null  // required or null for "no constraint"
  musclesToFocus: string[]    // required, 1+ muscle groups
  goal: 'hypertrophy' | 'strength' | 'strength+hypertrophy'  // required
  phaseStructureName: string  // required, one of the three phase set names
}
```

**Response:** `{ program: GeneratedProgram }`

**Error handling:**
- 400: Invalid input (missing fields, invalid equipment, etc.)
- 500: Gemini generation failed — return error message to client
- Client displays: "Failed to generate program. Try again?"

---

## 6. Saving Generated Programs

**When user clicks "Save Program":**

1. Insert program record:
   ```sql
   INSERT INTO programs (user_id, name, phase_mode, phase_set_id, created_at, updated_at)
   VALUES (?, ?, 'automatic', ?, now(), now())
   ```
   - Look up phase set by name: `SELECT id FROM phase_sets WHERE user_id = ? AND name = ?`

2. For each session in the generated program:
   ```sql
   INSERT INTO program_sessions (program_id, name, position, icon)
   VALUES (?, ?, ?, ?)
   ```

3. For each exercise in each session:
   ```sql
   INSERT INTO session_exercises (session_id, exercise_name, exercise_role, muscle_groups, position)
   VALUES (?, ?, ?, ?, ?)
   ```
   - No `style_id` — phase engine resolves from `exercise_role` + current phase

4. Close wizard modal, refresh Config screen program list to show new program

---

## 7. Where It Lives in the App

**Entry point:** Config screen, "Workouts" section
- New button: **"Build Program"** (prominent, next to any existing "Add Program" button)
- Clicking opens the wizard as a full-screen modal or slide-in sheet

**After save:**
- Closes wizard
- New program appears in the Workouts list
- User can tap it to open the existing config-screen editor (reorder exercises, change roles, etc.)

**Builder is a shortcut; config screen is the full editor.**

---

## 8. Architecture Overview

| Component | Responsibility |
|---|---|
| **Wizard (Steps 1–7)** | Collect user inputs, validate, pass to API |
| **`/api/generate-program`** | Fetch exercise library, call Gemini, return structured program |
| **Review Screen (Step 8)** | Display generated program, show exercise alternatives, chat interface |
| **Exercise Dropdown** | Filter library by muscle + equipment, swap exercises in preview |
| **AI Chat** | Send user message + current program state to Gemini, update preview |
| **Save Handler** | Insert program + sessions + exercises into DB, refresh UI |

---

## 9. Error Handling & Edge Cases

| Scenario | Handling |
|---|---|
| Gemini returns invalid JSON | Show "Generation failed, try again?" with retry button |
| Exercise name from Gemini not in library | Validate against library during response; if mismatch, retry with stricter prompt |
| User swaps exercise, then asks AI to modify same session | AI sees current state in context, makes informed decision |
| User closes browser during chat | Chat history lost (acceptable — they can regenerate) |
| User goes back from review to step 7 | Wizard state preserved; can re-request generation with same inputs |
| No valid split exists (e.g., 1 day/week + 7 focused muscles) | Gemini does best effort; user can regenerate or chat to adjust |

---

## 10. Success Criteria

- ✅ User completes 7-step wizard in under 3 minutes
- ✅ Gemini generates valid program respecting all constraints (frequency, time, muscles, goal, equipment)
- ✅ Exercise alternatives dropdown shows 5+ relevant options per muscle
- ✅ User can chat with AI to refine program (swap exercises, adjust volume)
- ✅ Generated program saves and is immediately usable in Config screen
- ✅ Phase set is correctly assigned based on user's choice
- ✅ All renamed phase sets display consistently throughout app

---

## 11. Future Enhancements (out of scope)

- Share generated programs with other users
- Save generation preferences ("I like 4-day PPL with dumbbells")
- Workout progression recommendations based on phase + week
- AI suggestions during workout ("You've done 3 weeks; time to deload soon")
