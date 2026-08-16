# AI-Gated Exercise Addition Design

## Goal

Allow any authenticated user to add exercises to the global library from within the app. AI generates the normalized name, instructions, muscle groups, and equipment from just a name input. A fuzzy duplicate check prevents redundant entries, with an option to rename-and-merge into an existing record.

## Entry Points

Three surfaces trigger the same shared flow:

1. **Stats exercise library search** — "no results" state shows an "Add exercise" button
2. **Workout builder swap panel** — when searching for an exercise to swap and none match, "Add exercise" appears
3. **Admin exercises panel** — "Add Exercise" button opens the sheet; the existing form also gains an inline "Generate" button that fills instructions, muscles, and equipment without opening the sheet

## User Flow

1. User types an exercise name (e.g. "DB bench press")
2. Sheet opens with name pre-filled
3. User taps "Generate" — AI call starts (Gemini Flash, ~1–2s)
4. While AI runs, client-side fuzzy search shows similar exercises from the cached library
5. AI returns: `normalizedName` (e.g. "Dumbbell Bench Press"), `instructions`, `muscles`, `equipment`
6. Review form shows AI-generated fields — all editable
7. Fuzzy matches panel sits above the form:
   - **"Use this"** — adopt the existing exercise's ID as-is, sheet closes, exercise returned to caller
   - **"Rename & use"** — adopt the existing ID, update its name to the AI-normalized version, sheet closes
8. If no match is selected, user edits the form as needed and taps "Save"
9. New exercise inserted into `exercise_library` with `created_by = user.id`
10. `'exercise-library'` cache invalidated; calling context receives `{ id, name }`

The rename-and-merge path (step 7) preserves the existing exercise's ID, so all workout history, personal records, and program references remain intact.

## AI Generation

Single `generateObject` call to Gemini Flash with a Zod schema:

```ts
z.object({
  normalizedName: z.string(),        // full name, title case, no abbreviations
  instructions:   z.string(),        // how-to paragraph, 2–4 sentences
  muscles: z.array(z.object({
    muscle: z.string(),
    role:   z.enum(['main', 'secondary']),
  })),
  equipment: z.array(z.string()),    // e.g. ["barbell", "bench"]
})
```

System prompt instructs the model to:
- Expand abbreviations (DB → Dumbbell, BB → Barbell, RDL → Romanian Deadlift)
- Use full proper names, title case
- Return standard muscle names matching the existing library values
- Return standard equipment strings matching the existing library values

## Fuzzy Matching

Client-side only — the exercise library is already in the `'exercise-library'` cache (TTL_LONG, pre-warmed by SyncProvider). No extra round-trip.

Algorithm: score each library entry against the user's typed name using word-overlap + substring match. Show up to 5 results with score above a threshold. Runs on both the original typed name and the AI-normalized name (once available).

## Architecture

### New files

| File | Purpose |
|------|---------|
| `components/exercises/add-exercise-sheet.tsx` | Shared bottom sheet — states: `"input"` → `"review"` → `"done"` |
| `app/api/exercises/generate/route.ts` | Gemini Flash call; returns normalized exercise details |
| `app/api/exercises/route.ts` | POST to create exercise; handles rename-merge via optional `mergeWithId` |

### Modified files

| File | Change |
|------|--------|
| `lib/data/postgres/schema.ts` | Add `created_by UUID REFERENCES users(id)` (nullable) to `exercise_library` |
| `lib/data/postgres/migrations/` | New migration: `ALTER TABLE exercise_library ADD COLUMN created_by UUID REFERENCES users(id)` |
| `lib/data/repository.ts` | Add `createExercise()` and `renameExercise(id, name)` to interface |
| `lib/data/postgres/adapter.ts` | Implement `createExercise()` and `renameExercise()` |
| `components/stats/exercise-library-search.tsx` | Add "Add exercise" button in no-results state |
| `components/workout-builder/builder-review.tsx` | Add "Add exercise" trigger in swap panel no-results state |
| `components/admin/exercise-manager.tsx` | Add inline "Generate" button to existing form; wire "Add Exercise" button to open sheet |

## Data Flow

```
User types name
    ↓
Client-side fuzzy match (cached library, debounced 300ms)
    ↓ (in parallel)
User taps Generate → POST /api/exercises/generate
    ↓
AI returns { normalizedName, instructions, muscles, equipment }
    ↓
Review form shown — fuzzy matches above, AI fields below (all editable)
    ↓
User either:
  A) "Use this" on a match       → sheet closes, existing exercise returned
  B) "Rename & use" on a match   → mergeWithId set, normalizedName as new name
  C) Ignores matches, edits form → new exercise path
    ↓
Save → POST /api/exercises
  • mergeWithId present → PATCH existing name, return existing { id, name }
  • no mergeWithId      → INSERT with created_by, return new { id, name }
    ↓
invalidateCache('exercise-library')
Calling context receives { id, name }
```

## Error Handling

- **AI generation fails** — inline error with "Try again"; review form opens empty for manual fill
- **Exact name match** — skip straight to fuzzy match panel ("Did you mean X?"), no need to fill form
- **Save fails** — toast, sheet stays open, user can retry
- **No fuzzy matches** — matches panel hidden; user goes straight to review form

## What Is Not in Scope

- Admin review/approval queue (AI output goes directly to global library — AI is the quality gate)
- Per-user private exercise lists
- Batch exercise import
- GIF/image upload (handled separately via admin panel after the fact)
