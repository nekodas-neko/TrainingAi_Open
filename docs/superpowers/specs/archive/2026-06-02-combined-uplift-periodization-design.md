# Combined Uplift + Block Periodization — Design Spec

**Date:** 2026-06-02  
**Branch:** `claude/project-review-brainstorm-SoBBa`  
**Status:** Approved — ready for implementation planning

---

## Overview

This spec bundles the approved block periodization feature with 22 items from the Uplift Backlog (U1–U31) into a single coordinated delivery. Items are grouped into four independent phases that can each be planned and executed separately. The block periodization design is already fully specified in `docs/superpowers/specs/2026-06-01-block-periodization-design.md` — this document does not re-design it; it only describes how the uplifts integrate with it.

**Goal:** Ship block periodization alongside security fixes and functional bug fixes, with no file touched twice and no backtracking between phases.

**Governing constraint:** Security Phase 0 ships first. Block periodization does not block the security fixes, and the security fixes do not block block periodization. Phases 2 and 3 are independent cleanup sprints.

---

## Phase 0 — Security Sprint

**Goal:** Close all open security risks that are independent of block periodization. Ships immediately — no dependency on any other phase.

**Files touched:** None overlap with block periodization.

### P0-T1: Critical Auth and Cookie Fixes

**Items:** U1, U4

**`app/api/ai-chat/tts/route.ts` (U1 — CRITICAL)**

The TTS route has no authentication check. Any unauthenticated caller can hit it and burn Gemini quota. Add `auth()` at the top of the handler — if no session, return 401 before any AI call.

```typescript
const session = await auth()
if (!session?.user?.id) return new Response('Unauthorized', { status: 401 })
```

**`app/api/auth/exchange-mobile-token/route.ts` (U4 — S13)**

The session cookie is set without the `Secure` flag when detected behind Railway's reverse proxy. The detection uses `req.headers.get('x-forwarded-proto') === 'https'` but this is unreliable. Fix: always set `Secure: true` in production (`process.env.NODE_ENV === 'production'`), since Railway always serves HTTPS externally.

### P0-T2: Input Validation

**Items:** U8, U9, U22, U23

**`app/api/sync-workout/route.ts` (U8 — S10)**

No Zod schema — numeric fields can be negative, `Infinity`, or `NaN`; string fields are uncapped. Add a Zod schema for the incoming payload array before any processing:

```typescript
const SyncItemSchema = z.object({
  workoutSessionId: z.string().uuid(),
  sessionName: z.string().max(200),
  startedAt: z.string().datetime(),
  exerciseName: z.string().max(200),
  weightKg: z.number().finite().min(0).max(1000),
  reps: z.number().int().min(0).max(200),
  estimated1rm: z.number().finite().min(0).max(2000).optional(),
  setNumber: z.number().int().min(1).max(100),
  restTimeSec: z.number().int().min(0).max(3600).optional(),
  setTimeSec: z.number().int().min(0).max(3600).optional(),
})
const PayloadSchema = z.array(SyncItemSchema).max(500)
```

Return 422 with a descriptive error on validation failure. This schema is added *before* the block periodization phase-stamping logic in Phase 1 Task 12, so when Phase 1 arrives, the file already has validated inputs.

**`app/api/nutrition/scan/route.ts` (U9 — S11)**

No size limit on the incoming base64 image string. A 50MB payload is decoded into memory before any other processing. Add a byte-length check before `Buffer.from(base64, 'base64')`:

```typescript
const MAX_BASE64_BYTES = 5 * 1024 * 1024   // 5MB
if (typeof body.image === 'string' && Buffer.byteLength(body.image, 'utf8') > MAX_BASE64_BYTES) {
  return NextResponse.json({ error: 'Image too large' }, { status: 413 })
}
```

**`app/api/nutrition/barcode/route.ts` (U22 — S15)**

No format or length check on the `barcode` query parameter before passing it to an external fetch. Add:
```typescript
const barcode = req.nextUrl.searchParams.get('barcode') ?? ''
if (!/^\d{8,14}$/.test(barcode)) {
  return NextResponse.json({ error: 'Invalid barcode' }, { status: 400 })
}
```

**`app/api/exercise-gif/route.ts` (U23 — S15)**

The `name` parameter is passed directly into a `ILIKE` query with no length cap. Add:
```typescript
const name = (req.nextUrl.searchParams.get('name') ?? '').slice(0, 100)
if (!name) return NextResponse.json({ error: 'Missing name' }, { status: 400 })
```

### P0-T3: Rate Limiting + Memory Cleanup

**Items:** U7 (partial), U20, U21

**`app/api/ai-chat/route.ts`, `app/api/nutrition/scan/route.ts`, `app/api/morning-briefing/route.ts`, `app/api/weekly-digest/route.ts` (U7 — S9)**

Each calls Gemini with no per-user rate limit. Use the existing `rateLimit()` helper (already in `lib/rate-limit.ts`) at the top of each handler:

```typescript
const limited = rateLimit(userId, '<route-key>', { limit: 15, windowMs: 60_000 })
if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
```

Suggested limits: `ai-chat` → 15/min, `nutrition/scan` → 10/min, `morning-briefing` → 5/min, `weekly-digest` → 3/min.

Note: `readiness-score` rate limiting is deferred to Phase 1 Task 13, since block periodization modifies that file and both changes belong together.

**`lib/rate-limit.ts` (U20 — S12)**

The in-memory `Map` grows unbounded on long-running server instances. When an entry's window has expired, delete it instead of leaving it in the map:

```typescript
if (now > entry.resetAt) {
  store.delete(key)           // prune instead of resetting
  // ... then fall through to create new entry
}
```

**`lib/mobile-auth-tokens.ts` (U21)**

Same unbounded map pattern as U20. Add pruning when a token's TTL has expired:
```typescript
function pruneExpired() {
  const now = Date.now()
  for (const [k, v] of tokens) {
    if (v.expiresAt < now) tokens.delete(k)
  }
}
```
Call `pruneExpired()` at the top of `createToken()` and `consumeToken()`.

### P0-T4: AI Security

**Item:** U29 (S14)

**`app/api/ai-chat/route.ts`**

User-supplied message content is currently interpolated into the system prompt, creating a prompt injection risk. Move user content to the `user` turn in the messages array and keep the system prompt static:

```typescript
// ❌ Current (vulnerable):
system: `${SYSTEM_PROMPT}\n\nUser said: ${userMessage}`

// ✅ Fixed:
system: SYSTEM_PROMPT,
messages: [{ role: 'user', content: userMessage }]
```

---

## Phase 1 — Block Periodization (with uplifts woven in)

**Goal:** Implement block periodization as designed in `docs/superpowers/specs/2026-06-01-block-periodization-design.md`. Four of the 18 tasks expand to absorb uplift items that touch the same file.

**Files modified:** See the block periodization plan for the complete file map (`docs/superpowers/plans/2026-06-01-block-periodization.md`).

### Tasks 1–11: Unchanged

DB migration, Drizzle schema, TypeScript types, repository interface, adapter implementation, phase engine (TDD), phase editor component, config screen, program-phases API, workout-data API, confirm-early-deload API — all proceed exactly as specified in the existing plan.

### Task 12: log-exercise + sync-workout + U2 + U10

When the plan reaches `log-exercise` and `sync-workout` for phase stamping, two uplifts are folded in at the same time.

**U2 — Brzycki division-by-zero (`app/api/log-exercise/route.ts`)**

The Brzycki formula produces `Infinity` when `reps === 37` because it divides by `(1.0278 - 0.0278 * 37) === 0`. Fix: guard with `reps > 36` before the formula:

```typescript
// Before:
const estimated1rm = reps === 1 ? weightKg : weightKg / (1.0278 - 0.0278 * reps)

// After:
const estimated1rm = reps === 1 ? weightKg
  : reps > 36 ? weightKg          // Brzycki undefined above 36 reps — use raw weight
  : weightKg / (1.0278 - 0.0278 * reps)
```

**U10 — Atomic PR detection (`app/api/log-exercise/route.ts` ~L113–118)**

The existing PR logic reads the current record then conditionally upserts it — a classic TOCTOU race that creates false PRs under concurrent log requests. The fix requires a new adapter method (because `db` is private to the adapter — the route cannot call `repo.db.transaction` directly):

Add to `lib/data/repository.ts` interface:
```typescript
upsertPersonalRecordIfBetter(userId: string, exerciseName: string, estimated1rm: number): Promise<boolean>
// returns true if a new PR was set
```

Implement in `lib/data/postgres/adapter.ts` using a row-level lock:
```typescript
async upsertPersonalRecordIfBetter(userId: string, exerciseName: string, estimated1rm: number): Promise<boolean> {
  return this.db.transaction(async tx => {
    const [existing] = await tx
      .select({ best: s.personalRecords.estimated1rm })
      .from(s.personalRecords)
      .where(and(eq(s.personalRecords.userId, userId), eq(s.personalRecords.exerciseName, exerciseName)))
      .for('update')
    if (existing && estimated1rm <= existing.best) return false
    await tx.insert(s.personalRecords)
      .values({ userId, exerciseName, estimated1rm })
      .onConflictDoUpdate({
        target: [s.personalRecords.userId, s.personalRecords.exerciseName],
        set: { estimated1rm },
      })
    return true
  })
}
```

The route then calls:
```typescript
const isPR = !isAnyDeload && await repo.upsertPersonalRecordIfBetter(userId, exercise, estimated1rm)
```

Remove the now-redundant `getPersonalRecord` + conditional `upsertPersonalRecord` calls.

**Note on U8:** Zod validation on `sync-workout` is already applied in Phase 0 Task P0-T2. Task 12 only adds the phase-stamping logic on top of the already-validated payload.

### Task 13: readiness-score + U7 (partial rate limit)

When `readiness-score` is modified to add `earlyDeloadRecommended`, also add rate limiting:

```typescript
const limited = rateLimit(userId, 'readiness-score', { limit: 20, windowMs: 60_000 })
if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
```

### Task 14: pre-workout-screen + U5 (rep button touch targets)

When pre-workout-screen is modified for deload banners and phase indicators, also apply U5 to `set-card.tsx` in the same commit:

**`components/workout/set-card.tsx` (U5) — Rep ± button height**

Rep increment/decrement buttons are currently `h-8` (32dp). The Android minimum tap target is 48dp. Change to `h-12`:

```tsx
// ~L139–146
<button className="h-12 w-10 flex items-center justify-center ...">−</button>
<button className="h-12 w-10 flex items-center justify-center ...">+</button>
```

These are the most-used buttons in the app during an active workout — this fix reduces mis-taps.

### Task 15: session-select-content + U6 (text size)

When session-select-content is modified for block progress and early deload cards, also fix text sizes:

**`app/session-select/session-select-content.tsx` (U6)**

`text-[8px]` and `text-[9px]` classes in the week strip and streak stats are physically unreadable on the S25 Ultra in daylight. Replace with `text-xs` (12px):

```tsx
// ❌
<span className="text-[8px] text-muted-foreground">Mon</span>

// ✅
<span className="text-xs text-muted-foreground">Mon</span>
```

Apply to all occurrences of `text-[8px]` and `text-[9px]` in this file.

### Tasks 16–18: Unchanged

workout-select phase badge, stats API exclusions, weekly-stats-hub deload marker — all proceed as specified in the existing plan.

---

## Phase 2 — Independent Functional Uplifts

**Goal:** Fix 8 functional bugs that have no dependency on block periodization. Can be executed before, during, or after Phase 1.

### P2-T1: workout-screen fixes (U3, U11)

**`components/workout-screen.tsx`**

**U3 — `resetSession` missing dependency**

`resetSession` is called in a `useEffect` with `[sessionType]` as deps, but `sessionType` is not in the dependency array. This causes the old workout state to persist when switching sessions. Add `sessionType` to the effect deps array at ~L127.

**U11 — `Math.max` on empty arrays**

`Math.max(...[])` returns `-Infinity`, which propagates to the DB and display. Fix at ~L310 and also in `exercise-stats-sheet.tsx` ~L87:

```typescript
// ❌
const maxWeight = Math.max(...weights)

// ✅
const maxWeight = weights.length ? Math.max(...weights) : 0
```

### P2-T2: Food logger double-tap guard (U12)

**`components/nutrition/food-logger-sheet.tsx` (~L112)**

No `saving` state guard on the submit button — double-tapping creates duplicate log entries. Add:

```typescript
const [saving, setSaving] = useState(false)

async function handleSave() {
  if (saving) return
  setSaving(true)
  try {
    await saveLog(...)
  } finally {
    setSaving(false)
  }
}
```

Disable/visually indicate the button while `saving` is true.

### P2-T3: Workout-store date rehydration fix (U13)

**`lib/stores/workout-store.ts` (~L138)**

On rehydration, yesterday's logged exercises are shown as today's because the stored date is not checked against `todayInTz()`. Add a date check:

```typescript
// On rehydration:
import { todayInTz } from '@/lib/date-utils'

if (persistedState?.date !== todayInTz()) {
  // stale — reset to empty state
  return initialState
}
```

### P2-T4: Exercise stats sheet reliability (U18, U19)

**`components/exercise-stats-sheet.tsx` (~L56–69)**

**U18 — AbortController on exercise change**

When the user switches exercises quickly, the earlier fetch can resolve after the later one, overwriting fresh data with stale data. Add an `AbortController` per fetch:

```typescript
useEffect(() => {
  const controller = new AbortController()
  fetchStats(exerciseName, { signal: controller.signal })
    .then(setData)
    .catch(err => { if (err.name !== 'AbortError') setError(true) })
  return () => controller.abort()
}, [exerciseName])
```

**U19 — Error state for blank sparkline**

When both fetches fail, the chart renders as a blank area with no user feedback. Add an `error` state and show a message:

```typescript
if (error) return <p className="text-sm text-muted-foreground text-center py-6">Could not load history</p>
```

### P2-T5: Cache and sync reliability (U30, U31)

**`lib/sqlite/cache.ts` (~L109) (U30)**

Concurrent calls with the same key each fire their own fetch — the responses race and whichever resolves last wins, potentially overwriting a fresher result with a staler one. Add a per-key in-flight promise map:

```typescript
const inflight = new Map<string, Promise<unknown>>()

async function cachedFetch<T>(key: string, ttl: number, fetcher: () => Promise<T>): Promise<T> {
  if (inflight.has(key)) return inflight.get(key) as Promise<T>
  const promise = fetcher().finally(() => inflight.delete(key))
  inflight.set(key, promise)
  return promise
}
```

**`components/sync-provider.tsx` (U31)**

Silent failures leave the outbox undrained — the user never knows a sync failed and future syncs may silently skip retrying. Add error handling that surfaces a toast or retry indicator when `drainOutbox()` throws, and ensure failed items remain in the outbox for the next attempt.

---

## Phase 3 — UI / Accessibility

**Goal:** 9 UI polish and accessibility items. Lowest priority — these do not affect correctness or security, only usability and compliance.

| Item | File | Change |
|------|------|--------|
| U14 | `set-card.tsx`, back buttons, week-day tiles, metric tiles | Add `aria-label` to all icon-only buttons (WCAG 2.1 SC 1.1.1) |
| U15 | `food-logger-sheet.tsx` | Fix back-navigation with a `prevStep` stack instead of `libraryItemId` heuristic |
| U16 | `assign-step.tsx` | Meal-type chips + quantity buttons: min `h-[44px]` (currently 32–36dp) |
| U17 | `capture-step.tsx` | Recent-items row height: `py-2.5` → `min-h-[48px]` |
| U24 | `components/workout/timer-ring.tsx` | SVG size: 160px → `min(60vw, 220px)` |
| U25 | `components/ui/weight-dial.tsx` | Height: fixed 240px → `35vh` capped at 320px |
| U26 | All screen headers/footers | Standardise safe-area padding to `pt-safe`/`pb-safe` throughout |
| U27 | `stats-content.tsx` + other content screens | Replace `<div>` section headers with `<h2>`/`<h3>` for screen reader semantics |
| U28 | `nutrition/meal-type-manager.tsx` | Wire `@dnd-kit` drag-to-reorder for meal types (grip handles exist but are inert — KI #14) |

---

## Execution Order

```
Phase 0 (Security) → can ship immediately
Phase 1 (Block Periodization + woven uplifts) → main feature
Phase 2 (Independent Uplifts) → any time, no deps
Phase 3 (UI/Accessibility) → lowest priority, own sprint
```

Phases 0, 2, and 3 are independent of each other and of Phase 1. Only Phase 1 has an internal dependency chain (Tasks 1–5 must complete before Tasks 6+).

---

## Items Explicitly Deferred

The following uplift items are noted in the backlog but are **not included** in this spec — they require their own design pass before implementation:

- **Cache invalidation after config save** (KI #1 / "workout:* cache key") — needs a decision on invalidation strategy (tag-based, key-prefix flush, or webhooks)
- **Workout state lost on page refresh** (KI #2) — requires a design for resilient state persistence beyond the current store

---

## Uplift Backlog Coverage

| Item | Phase | Status |
|------|-------|--------|
| U1 | Phase 0, T1 | Auth guard on TTS |
| U2 | Phase 1, Task 12 | Brzycki division-by-zero |
| U3 | Phase 2, T1 | resetSession deps |
| U4 | Phase 0, T1 | HTTPS cookie fix |
| U5 | Phase 1, Task 14 | Rep button touch targets |
| U6 | Phase 1, Task 15 | text-[8px] → text-xs |
| U7 | Phase 0, T3 + Phase 1, Task 13 | Rate limit AI routes (split) |
| U8 | Phase 0, T2 | Zod schema on sync-workout |
| U9 | Phase 0, T2 | Nutrition scan size check |
| U10 | Phase 1, Task 12 | Atomic PR detection |
| U11 | Phase 2, T1 | Math.max empty array |
| U12 | Phase 2, T2 | Food logger saving guard |
| U13 | Phase 2, T3 | Workout-store date rehydration |
| U14 | Phase 3 | aria-labels |
| U15 | Phase 3 | Food logger back-navigation |
| U16 | Phase 3 | Meal-type chips touch targets |
| U17 | Phase 3 | Recent-items row height |
| U18 | Phase 2, T4 | AbortController in stats sheet |
| U19 | Phase 2, T4 | Error state in stats sheet |
| U20 | Phase 0, T3 | Rate-limit map pruning |
| U21 | Phase 0, T3 | Mobile auth token pruning |
| U22 | Phase 0, T2 | Barcode format validation |
| U23 | Phase 0, T2 | exercise-gif name cap |
| U24 | Phase 3 | Timer ring size |
| U25 | Phase 3 | Weight dial height |
| U26 | Phase 3 | Safe-area padding |
| U27 | Phase 3 | Semantic headings |
| U28 | Phase 3 | Drag-to-reorder meal types |
| U29 | Phase 0, T4 | AI prompt injection |
| U30 | Phase 2, T5 | cachedFetch in-flight lock |
| U31 | Phase 2, T5 | SyncProvider error handling |
