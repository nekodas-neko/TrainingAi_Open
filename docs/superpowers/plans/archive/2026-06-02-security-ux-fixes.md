> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Security & UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 12 critical security and UX fixes from the Uplift Backlog (Tier 1 + Tier 2).

**Architecture:** All fixes are independent, surgical changes to existing files. Each fix addresses a specific security gap or bug. No new architectural components; all changes are point fixes to existing code paths.

**Tech Stack:** Next.js 15, TypeScript, React 19, Zustand, Zod, PostgreSQL

---

## File Mapping

| File | Purpose | Tasks |
|------|---------|-------|
| `app/api/ai-chat/tts/route.ts` | Text-to-speech API | U1 |
| `components/workout-screen.tsx` | Workout state orchestrator | U3, U11 |
| `app/api/auth/exchange-mobile-token/route.ts` | Mobile token exchange | U4 |
| `components/workout/set-card.tsx` | Set card UI | U5 |
| `app/session-select/session-select-content.tsx` | Home screen | U6 |
| `lib/rate-limit.ts` | Rate limiter utility | U7 |
| `app/api/ai-chat/route.ts` | AI chat endpoint | U7 |
| `app/api/nutrition/scan/route.ts` | Nutrition scan endpoint | U7, U9 |
| `app/api/morning-briefing/route.ts` | Morning briefing endpoint | U7 |
| `app/api/readiness-score/route.ts` | Readiness score endpoint | U7 |
| `app/api/weekly-digest/route.ts` | Weekly digest endpoint | U7 |
| `app/api/sync-workout/route.ts` | Workout sync endpoint | U8 |
| `app/api/log-exercise/route.ts` | Exercise logging endpoint | U10 |
| `components/workout/exercise-stats-sheet.tsx` | Exercise stats sheet | U11 |
| `components/nutrition/food-logger-sheet.tsx` | Food logger sheet | U12 |
| `lib/stores/workout-store.ts` | Zustand workout store | U13 |

---

## Task 1: Add auth() Guard to TTS Route (U1)

**Files:**
- Modify: `app/api/ai-chat/tts/route.ts`

- [ ] **Step 1: Read the current TTS route**

Run: `cat /home/user/TrainingAI/app/api/ai-chat/tts/route.ts`

Expected: You'll see a POST handler with no `auth()` check.

- [ ] **Step 2: Add auth() import and guard**

Replace the top of the file:

```typescript
import { auth } from "@/auth"
import { NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { text } = await req.json()
  // ... rest of handler
}
```

- [ ] **Step 3: Verify syntax**

Run: `pnpm tsc --noEmit`

Expected: Zero errors

- [ ] **Step 4: Commit**

```bash
git add app/api/ai-chat/tts/route.ts
git commit -m "security: add auth guard to TTS endpoint (U1)"
```

---

## Task 2: Fix resetSession Effect Dependencies (U3)

**Files:**
- Modify: `components/workout-screen.tsx` ~L127

- [ ] **Step 1: Find the resetSession useEffect**

Search for: `useEffect(() => { store.resetSession() }` in `workout-screen.tsx`

Expected: Effect with empty or incomplete dependency array.

- [ ] **Step 2: Identify the current deps**

The effect should look like:
```typescript
useEffect(() => {
  store.resetSession()
}, [])  // ← missing sessionType dependency
```

- [ ] **Step 3: Add sessionType to deps**

Replace with:
```typescript
useEffect(() => {
  store.resetSession()
}, [sessionType, store])
```

- [ ] **Step 4: Run TypeScript check**

Run: `pnpm tsc --noEmit`

Expected: Zero errors

- [ ] **Step 5: Commit**

```bash
git add components/workout-screen.tsx
git commit -m "fix: add sessionType to resetSession deps (U3)"
```

---

## Task 3: Fix HTTPS Cookie Detection Behind Railway Proxy (U4)

**Files:**
- Modify: `app/api/auth/exchange-mobile-token/route.ts` ~L15

- [ ] **Step 1: Read the exchange-mobile-token route**

Run: `cat /home/user/TrainingAI/app/api/auth/exchange-mobile-token/route.ts`

Expected: You'll see a check like `req.url.startsWith("https://")` which always fails behind a proxy.

- [ ] **Step 2: Find the Secure flag line**

Look for where `sameSite` and `secure` are set on the cookie. Should be around line 30–40.

- [ ] **Step 3: Replace HTTPS detection**

Change this:
```typescript
const isHttps = req.url.startsWith("https://")
```

To this:
```typescript
const isHttps = req.headers.get("x-forwarded-proto") === "https"
```

- [ ] **Step 4: Run TypeScript check**

Run: `pnpm tsc --noEmit`

Expected: Zero errors

- [ ] **Step 5: Commit**

```bash
git add app/api/auth/exchange-mobile-token/route.ts
git commit -m "fix: detect HTTPS via x-forwarded-proto header for Railway proxy (U4)"
```

---

## Task 4: Enlarge Rep +/− Buttons to 48dp (U5)

**Files:**
- Modify: `components/workout/set-card.tsx` ~L139–146

- [ ] **Step 1: Find the rep button code**

Search for the rep +/− buttons in set-card.tsx. Should look like:
```typescript
<button className="h-8 w-8 rounded ...">−</button>
```

- [ ] **Step 2: Change h-8 to h-12**

Replace:
```typescript
className="h-8 w-8 rounded border ...flex items-center justify-center..."
```

With:
```typescript
className="h-12 w-12 rounded border ...flex items-center justify-center..."
```

Do this for both the minus and plus buttons.

- [ ] **Step 3: Verify layout doesn't break**

Run: `pnpm tsc --noEmit`

Expected: Zero errors

- [ ] **Step 4: Commit**

```bash
git add components/workout/set-card.tsx
git commit -m "fix: enlarge rep +/− buttons to 48dp Android minimum (U5)"
```

---

## Task 5: Replace 8–9px Text with text-xs (U6)

**Files:**
- Modify: `app/session-select/session-select-content.tsx` (week strip + streak stats)

- [ ] **Step 1: Search for text-[8px] and text-[9px]**

Run: `grep -n "text-\[8px\]\|text-\[9px\]" /home/user/TrainingAI/app/session-select/session-select-content.tsx`

Expected: 2–3 matches in the week strip or streak stats area.

- [ ] **Step 2: Replace each occurrence**

For each match, change:
- `text-[8px]` → `text-xs`
- `text-[9px]` → `text-xs`

The Tailwind `text-xs` is 12px, much more readable on S25 Ultra.

- [ ] **Step 3: Run TypeScript check**

Run: `pnpm tsc --noEmit`

Expected: Zero errors

- [ ] **Step 4: Commit**

```bash
git add app/session-select/session-select-content.tsx
git commit -m "fix: replace unreadable 8–9px text with text-xs (U6)"
```

---

## Task 6: Rate-Limit All AI Routes (U7)

**Files:**
- Modify: `lib/rate-limit.ts`
- Modify: `app/api/ai-chat/route.ts`
- Modify: `app/api/nutrition/scan/route.ts`
- Modify: `app/api/morning-briefing/route.ts`
- Modify: `app/api/readiness-score/route.ts`
- Modify: `app/api/weekly-digest/route.ts`

- [ ] **Step 1: Examine rate-limit.ts**

Run: `cat /home/user/TrainingAI/lib/rate-limit.ts`

Expected: You'll see `rateLimit(key, limit, windowMs)` helper that tracks in-memory Map with `lastAttempts`.

- [ ] **Step 2: Add rate-limit import to ai-chat route**

At the top of `app/api/ai-chat/route.ts`:
```typescript
import { rateLimit } from "@/lib/rate-limit"
```

- [ ] **Step 3: Add rate-limit check before Gemini call**

In the POST handler, right before calling `generateText`:

```typescript
const userId = session.user.id
const limited = await rateLimit(`ai-chat:${userId}`, 10, 60000) // 10 req/min per user
if (limited) {
  return NextResponse.json(
    { error: "Rate limit exceeded. Max 10 requests per minute." },
    { status: 429 }
  )
}
```

- [ ] **Step 4: Repeat for nutrition/scan**

In `app/api/nutrition/scan/route.ts`, add the same check before `generateObject`:

```typescript
const userId = session.user.id
const limited = await rateLimit(`nutrition-scan:${userId}`, 20, 60000) // 20 req/min per user
if (limited) {
  return NextResponse.json(
    { error: "Rate limit exceeded. Max 20 requests per minute." },
    { status: 429 }
  )
}
```

- [ ] **Step 5: Repeat for morning-briefing**

In `app/api/morning-briefing/route.ts`:

```typescript
const userId = session.user.id
const limited = await rateLimit(`morning-briefing:${userId}`, 5, 3600000) // 5 req/hour per user
if (limited) {
  return NextResponse.json(
    { error: "Rate limit exceeded. Max 5 requests per hour." },
    { status: 429 }
  )
}
```

- [ ] **Step 6: Repeat for readiness-score**

In `app/api/readiness-score/route.ts`:

```typescript
const userId = session.user.id
const limited = await rateLimit(`readiness-score:${userId}`, 20, 60000) // 20 req/min per user
if (limited) {
  return NextResponse.json(
    { error: "Rate limit exceeded. Max 20 requests per minute." },
    { status: 429 }
  )
}
```

- [ ] **Step 7: Repeat for weekly-digest**

In `app/api/weekly-digest/route.ts`:

```typescript
const userId = session.user.id
const limited = await rateLimit(`weekly-digest:${userId}`, 5, 3600000) // 5 req/hour per user
if (limited) {
  return NextResponse.json(
    { error: "Rate limit exceeded. Max 5 requests per hour." },
    { status: 429 }
  )
}
```

- [ ] **Step 8: Run TypeScript check**

Run: `pnpm tsc --noEmit`

Expected: Zero errors

- [ ] **Step 9: Commit**

```bash
git add app/api/ai-chat/route.ts app/api/nutrition/scan/route.ts app/api/morning-briefing/route.ts app/api/readiness-score/route.ts app/api/weekly-digest/route.ts
git commit -m "security: add rate-limiting to all AI routes (U7)"
```

---

## Task 7: Add Zod Schema to sync-workout (U8)

**Files:**
- Modify: `app/api/sync-workout/route.ts`

- [ ] **Step 1: Read the current sync-workout route**

Run: `cat /home/user/TrainingAI/app/api/sync-workout/route.ts`

Expected: You'll see `const body = await req.json()` with no validation.

- [ ] **Step 2: Add Zod import**

At the top of `app/api/sync-workout/route.ts`:
```typescript
import { z } from "zod"
```

- [ ] **Step 3: Define the sync schema**

Add this before the POST handler:

```typescript
const SyncItemSchema = z.object({
  workoutSessionId: z.string().uuid(),
  exerciseName: z.string().min(1).max(200),
  styleId: z.string().uuid().nullable(),
  styleName: z.string().max(100).nullable(),
  reps: z.number().int().min(1).max(50),
  weightKg: z.number().min(0).max(500),
  estimated1rm: z.number().min(0).max(500),
  volumeKg: z.number().min(0).max(50000),
  intensityPct: z.number().min(0).max(200),
  useFor1rm: z.boolean(),
  setStartMs: z.number().int().nonnegative().nullable(),
  setEndMs: z.number().int().nonnegative().nullable(),
  interExerciseRestSec: z.number().int().nonnegative().nullable(),
})

const SyncPayloadSchema = z.object({
  items: z.array(SyncItemSchema),
})
```

- [ ] **Step 4: Add validation before processing**

In the POST handler, replace the body parsing:

```typescript
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const parsed = SyncPayloadSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const items = parsed.data.items
  // ... rest of handler using items
}
```

- [ ] **Step 5: Run TypeScript check**

Run: `pnpm tsc --noEmit`

Expected: Zero errors

- [ ] **Step 6: Commit**

```bash
git add app/api/sync-workout/route.ts
git commit -m "security: add Zod validation to sync-workout payload (U8)"
```

---

## Task 8: Gate Nutrition Scan Image Size (U9)

**Files:**
- Modify: `app/api/nutrition/scan/route.ts` (before base64 decode)

- [ ] **Step 1: Find the image parsing code**

Search for `Buffer.from(body.image, 'base64')` in `nutrition/scan/route.ts`.

Expected: You'll see the decode happening without a size check.

- [ ] **Step 2: Add size guard before decode**

Right before the `Buffer.from` line, add:

```typescript
const MAX_IMAGE_SIZE_MB = 5
const MAX_IMAGE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024

// Check base64 string length (encoded size ≈ 4/3 of decoded size)
const estimatedDecodedBytes = (body.image.length * 3) / 4
if (estimatedDecodedBytes > MAX_IMAGE_BYTES) {
  return NextResponse.json(
    { error: `Image too large. Maximum ${MAX_IMAGE_SIZE_MB}MB allowed.` },
    { status: 413 }
  )
}

const imageBuffer = Buffer.from(body.image, 'base64')
```

- [ ] **Step 3: Run TypeScript check**

Run: `pnpm tsc --noEmit`

Expected: Zero errors

- [ ] **Step 4: Commit**

```bash
git add app/api/nutrition/scan/route.ts
git commit -m "security: gate nutrition scan image size to 5MB (U9)"
```

---

## Task 9: Make PR Detection Atomic (U10)

**Files:**
- Modify: `app/api/log-exercise/route.ts` ~L113–118

- [ ] **Step 1: Find the current PR detection code**

Search for the `personalRecords` table query in `log-exercise/route.ts`.

Expected: You'll see a read-then-write check that's vulnerable to race conditions.

- [ ] **Step 2: Replace with atomic INSERT ON CONFLICT**

Find this pattern:
```typescript
const existingPR = await db.select().from(personalRecords).where(...)
let isPR = false
if (!existingPR || loggedExercise.estimated1rm > existingPR.estimated_1rm) {
  await db.insert(personalRecords).values({...})
  isPR = true
}
```

Replace with:
```typescript
const prResult = await db.insert(personalRecords).values({
  userId,
  exerciseName: loggedExercise.exerciseName,
  estimated1rm: loggedExercise.estimated1rm,
  achievedAt: new Date(),
}).onConflictDoUpdate({
  target: [personalRecords.userId, personalRecords.exerciseName],
  set: {
    estimated1rm: sql`GREATEST(${personalRecords.estimated1rm}, EXCLUDED.estimated_1rm)`,
    achievedAt: sql`CASE WHEN EXCLUDED.estimated_1rm > ${personalRecords.estimated1rm} THEN EXCLUDED.achieved_at ELSE ${personalRecords.achievedAt} END`,
  },
}).returning()

const isPR = prResult.length > 0 && prResult[0].estimated1rm === loggedExercise.estimated1rm
```

- [ ] **Step 3: Run TypeScript check**

Run: `pnpm tsc --noEmit`

Expected: Zero errors

- [ ] **Step 4: Commit**

```bash
git add app/api/log-exercise/route.ts
git commit -m "fix: make PR detection atomic to prevent race conditions (U10)"
```

---

## Task 10: Guard Math.max on Empty Arrays (U11)

**Files:**
- Modify: `components/workout-screen.tsx` ~L310
- Modify: `components/workout/exercise-stats-sheet.tsx` ~L87

- [ ] **Step 1: Find the first Math.max call in workout-screen.tsx**

Search for `Math.max(...` around line 310.

Expected: You'll see `Math.max(...array)` without a length check.

- [ ] **Step 2: Add guard for first location**

Replace:
```typescript
const value = Math.max(...array)
```

With:
```typescript
const value = array.length > 0 ? Math.max(...array) : 0
```

- [ ] **Step 3: Find the second Math.max call in exercise-stats-sheet.tsx**

Search around line 87 in that file.

- [ ] **Step 4: Add guard for second location**

Apply the same guard pattern as step 2.

- [ ] **Step 5: Run TypeScript check**

Run: `pnpm tsc --noEmit`

Expected: Zero errors

- [ ] **Step 6: Commit**

```bash
git add components/workout-screen.tsx components/workout/exercise-stats-sheet.tsx
git commit -m "fix: guard Math.max calls on empty arrays (U11)"
```

---

## Task 11: Add Saving State to Food Logger (U12)

**Files:**
- Modify: `components/nutrition/food-logger-sheet.tsx` ~L112

- [ ] **Step 1: Find the food logger state**

Search for the `const [` declarations in `food-logger-sheet.tsx`.

Expected: You'll see state for step, calories, macros, but no `saving` state.

- [ ] **Step 2: Add saving state**

Add this line with the other useState declarations:
```typescript
const [saving, setSaving] = useState(false)
```

- [ ] **Step 3: Find the Confirm button click handler**

Search for the `onClick` on the Confirm button (around line 112).

Expected: It calls an API and updates state directly without guarding.

- [ ] **Step 4: Wrap API call with saving guard**

Replace:
```typescript
const handleConfirm = async () => {
  const result = await fetch("/api/nutrition/food-logs", { method: "POST", body: JSON.stringify(...) })
  // update state
}
```

With:
```typescript
const handleConfirm = async () => {
  if (saving) return // Prevent double-submit
  setSaving(true)
  try {
    const result = await fetch("/api/nutrition/food-logs", { method: "POST", body: JSON.stringify(...) })
    if (result.ok) {
      // update state, close sheet, etc
    }
  } finally {
    setSaving(false)
  }
}
```

- [ ] **Step 5: Disable Confirm button while saving**

On the Confirm button element, add:
```typescript
disabled={saving}
```

- [ ] **Step 6: Run TypeScript check**

Run: `pnpm tsc --noEmit`

Expected: Zero errors

- [ ] **Step 7: Commit**

```bash
git add components/nutrition/food-logger-sheet.tsx
git commit -m "fix: add saving state to food logger to prevent double-submit (U12)"
```

---

## Task 12: Fix Workout-Store Date Check on Rehydration (U13)

**Files:**
- Modify: `lib/stores/workout-store.ts` ~L138

- [ ] **Step 1: Read the workout store**

Run: `cat /home/user/TrainingAI/lib/stores/workout-store.ts | grep -A 20 "HYDRATE"`

Expected: You'll see rehydration logic that doesn't check if the date has changed.

- [ ] **Step 2: Find the rehydrate function**

Search for the hydrate/rehydrate callback in the store persistence config.

- [ ] **Step 3: Add date check**

In the rehydrate function, after the state is loaded, add:

```typescript
// If the stored date doesn't match today, reset logged exercises from yesterday
import { todayInTz } from "@/lib/date-utils"

const storedDate = state.storedDate
const today = todayInTz()
if (storedDate !== today) {
  return {
    ...state,
    storedDate: today,
    todayLogged: {}, // Clear yesterday's logged exercises
  }
}
```

Add `storedDate: string` to the store state type definition if not already present.

- [ ] **Step 4: Initialize storedDate on store creation**

In the default state, add:
```typescript
storedDate: todayInTz(),
```

- [ ] **Step 5: Run TypeScript check**

Run: `pnpm tsc --noEmit`

Expected: Zero errors

- [ ] **Step 6: Commit**

```bash
git add lib/stores/workout-store.ts
git commit -m "fix: check date on store rehydration to reset yesterday's logged exercises (U13)"
```

---

## Verification Checklist

After all 12 tasks are complete, verify:

- [ ] `pnpm tsc --noEmit` passes (zero errors)
- [ ] `pnpm run build` succeeds
- [ ] All 12 commits are present: `git log --oneline | head -12`
- [ ] Branch is clean: `git status` shows no uncommitted changes
- [ ] Ready to push and merge to main

---
