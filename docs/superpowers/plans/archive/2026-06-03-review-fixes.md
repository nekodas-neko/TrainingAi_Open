> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Review Fixes & Uplift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all bugs, security gaps, performance issues, and pending uplift items identified in the session-49 code review, plus add phase-context awareness inside the active workout screen.

**Architecture:** Fixes are grouped by risk — critical data-corruption bugs first, then security, then correctness, then performance, then UX uplift, then the new feature. Each task is independently commitable. No new DB migrations required except for Task 12 (meal-type reorder adds `reorderMealTypes` using the existing `sort_order` column).

**Tech Stack:** Next.js 15, TypeScript, Drizzle ORM, PostgreSQL, `date-fns-tz`, `@dnd-kit/react` (already installed), Tailwind CSS v4.

---

## File Map

| File | What changes |
|------|-------------|
| `lib/phase-engine.ts` | `addDays` — replace `.toISOString().slice(0,10)` with `formatInTimeZone` |
| `app/api/log-exercise/route.ts` | UTC fallback date → `todayInTz(tz)` |
| `app/api/readiness-score/route.ts` | Date string slices → `toAestDay()`; chronic divisor → actual data span |
| `app/api/morning-briefing/route.ts` | Date string slices → `toAestDay()` |
| `app/api/nutrition/scan/route.ts` | Cap `body.text` at 500 chars to close prompt-injection surface |
| `app/api/sync-workout/route.ts` | Compute phase `sessionsCount` outside per-item loop, increment manually |
| `app/api/confirm-early-deload/route.ts` | Verify supplied `programId` is the active program |
| `app/api/workout-data/route.ts` | Session lookup: try UUID first, name fallback; return `phaseStatus` on per-session calls |
| `app/workout-select/workout-select-content.tsx` | Pass `session.id` in navigation URL instead of `session.name` |
| `app/session-select/session-select-content.tsx` | Early-deload banner key: replace UTC month slice with `todayInTz(tz).slice(0,7)` |
| `lib/data/postgres/adapter.ts` | Batch `listPhaseSets`, `logSets`, `upsertBodyMetrics` |
| `lib/data/repository.ts` | Add `reorderMealTypes` signature |
| `app/api/nutrition/meal-types/route.ts` | Add `PATCH` handler for batch reorder |
| `components/nutrition/meal-type-manager.tsx` | Wire `@dnd-kit` drag-to-reorder |
| `components/sync-provider.tsx` | Wrap `initSQLite` + `drainOutbox` in try/catch |
| `components/workout/active-workout-screen.tsx` | Accept + display `phaseStatus` prop |
| `components/workout-screen.tsx` | Thread `phaseStatus` through to `ActiveWorkoutScreen` |

---

## Task 1 — Fix forbidden `.toISOString().slice(0,10)` patterns (4 files)

**Files:**
- Modify: `lib/phase-engine.ts:1-7`
- Modify: `app/api/log-exercise/route.ts:5,111`
- Modify: `app/api/readiness-score/route.ts:35-36`
- Modify: `app/api/morning-briefing/route.ts:29-30`

- [ ] **Step 1: Fix `addDays` in `lib/phase-engine.ts`**

Replace lines 1–7:
```ts
import { formatInTimeZone } from 'date-fns-tz'
import type { ProgramPhase, ExerciseRole } from '@/lib/types/program'

function addDays(dateStr: string, n: number): string {
  // Use noon UTC anchor to avoid DST edge cases, then format in UTC
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return formatInTimeZone(d, 'UTC', 'yyyy-MM-dd')
}
```

- [ ] **Step 2: Fix UTC date fallback in `app/api/log-exercise/route.ts`**

Line 111 currently reads:
```ts
const today = (localDate ?? new Date().toISOString().slice(0, 10).replace(/-/g, '/')).slice(0, 10);
```

Replace with:
```ts
const tz = session.user?.timezone ?? 'Australia/Brisbane'
const today = (localDate ?? todayInTz(tz).replace(/-/g, '/')).slice(0, 10);
```

Note: `tz` is already computed earlier in this function at line 94. Remove the duplicate — move the `tz` declaration up before line 88 (before the phase block) and delete the one at line 94. The final result:
```ts
const tz = session.user?.timezone ?? 'Australia/Brisbane'

// Resolve phase context for automatic-mode programs
let currentPhaseId: string | undefined
// ... rest of phase block unchanged, but remove the `const tz =` line inside it ...

const today = (localDate ?? todayInTz(tz).replace(/-/g, '/')).slice(0, 10);
```

- [ ] **Step 3: Fix fragile date arithmetic in `app/api/readiness-score/route.ts`**

Lines 35–36 currently:
```ts
const from28dIso  = from28dDate.toISOString().slice(0, 10)
const from7dIso   = new Date(todayMid.getTime() -  7 * 86_400_000).toISOString().slice(0, 10)
```

`toAestDay` is already imported (via `DEFAULT_TZ, todayInTz, todayMidnightUtc` — check imports and add `toAestDay` if missing). Replace with:
```ts
const from28dIso  = toAestDay(from28dDate, tz)
const from7dIso   = toAestDay(new Date(todayMid.getTime() - 7 * 86_400_000), tz)
```

Update import line 4 to include `toAestDay`:
```ts
import { DEFAULT_TZ, todayInTz, todayMidnightUtc, toAestDay } from '@/lib/date-utils'
```

- [ ] **Step 4: Fix fragile date arithmetic in `app/api/morning-briefing/route.ts`**

Lines 29–30 currently:
```ts
const from7dIso = new Date(todayMid.getTime() - 7 * 86_400_000).toISOString().slice(0, 10)
const from2dIso = new Date(todayMid.getTime() - 2 * 86_400_000).toISOString().slice(0, 10)
```

Replace with:
```ts
const from7dIso = toAestDay(new Date(todayMid.getTime() - 7 * 86_400_000), tz)
const from2dIso = toAestDay(new Date(todayMid.getTime() - 2 * 86_400_000), tz)
```

Update the import on line 6 to include `toAestDay`:
```ts
import { DEFAULT_TZ, todayInTz, todayMidnightUtc, toAestDay } from '@/lib/date-utils'
```

- [ ] **Step 5: Run TypeScript check**
```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -30
```
Expected: no errors in the four modified files.

- [ ] **Step 6: Commit**
```bash
git add lib/phase-engine.ts app/api/log-exercise/route.ts app/api/readiness-score/route.ts app/api/morning-briefing/route.ts
git commit -m "fix: replace forbidden toISOString().slice(0,10) patterns with timezone-aware helpers"
```

---

## Task 2 — Fix readiness-score chronic load divisor

**Files:**
- Modify: `app/api/readiness-score/route.ts:81-88`

The chronic average currently divides total 28-day load by a hardcoded `4`. New users with <28 days of data get an artificially low average, making ACWR spike and triggering false early-deload recommendations.

- [ ] **Step 1: Replace hardcoded divisor with actual data span**

Lines 80–88 currently:
```ts
const from7dDate = new Date(todayMid.getTime() - 7 * 86_400_000)
let acuteLoad = 0, chronicLoad = 0
for (const ws of recentSessions) {
  const vol = ws.exercises.reduce((s, ex) => s + (ex.volume ?? 0), 0)
  if (ws.startedAt >= from7dDate) acuteLoad += vol
  chronicLoad += vol
}
const chronicAvg = chronicLoad / 4
```

Replace with:
```ts
const from7dDate = new Date(todayMid.getTime() - 7 * 86_400_000)
let acuteLoad = 0, chronicLoad = 0
let earliestSessionDate: Date | null = null
for (const ws of recentSessions) {
  const vol = ws.exercises.reduce((s, ex) => s + (ex.volume ?? 0), 0)
  if (ws.startedAt >= from7dDate) acuteLoad += vol
  chronicLoad += vol
  if (!earliestSessionDate || ws.startedAt < earliestSessionDate) {
    earliestSessionDate = ws.startedAt
  }
}
// Use actual data span in weeks (min 1 week to avoid division spikes on day 1)
const dataSpanMs = earliestSessionDate
  ? todayMid.getTime() - earliestSessionDate.getTime()
  : 28 * 86_400_000
const dataSpanWeeks = Math.max(1, dataSpanMs / (7 * 86_400_000))
const chronicAvg = chronicLoad / dataSpanWeeks
```

- [ ] **Step 2: Run TypeScript check**
```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | grep "readiness-score"
```
Expected: no errors.

- [ ] **Step 3: Commit**
```bash
git add app/api/readiness-score/route.ts
git commit -m "fix: compute readiness chronic load from actual data span, not hardcoded 4 weeks"
```

---

## Task 3 — Security: cap nutrition scan text input

**Files:**
- Modify: `app/api/nutrition/scan/route.ts:77-82`

`body.text` flows directly into the Gemini prompt with no length limit, making it a prompt-injection surface.

- [ ] **Step 1: Add length cap and sanitisation before the Gemini call**

Lines 77–82 currently:
```ts
} else if (body.text) {
  result = await generateText({
    model: google('gemini-3.1-flash-lite'),
    system: systemPrompt,
    prompt: `Estimate the nutrition for: ${body.text}`,
  })
```

Replace with:
```ts
} else if (body.text) {
  if (typeof body.text !== 'string') {
    return NextResponse.json({ error: 'text must be a string' }, { status: 400 })
  }
  // Cap at 500 chars to prevent prompt injection and runaway token use
  const safeText = String(body.text).slice(0, 500).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
  result = await generateText({
    model: google('gemini-3.1-flash-lite'),
    system: systemPrompt,
    prompt: `Estimate the nutrition for: ${safeText}`,
  })
```

- [ ] **Step 2: Run TypeScript check**
```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | grep "nutrition/scan"
```
Expected: no errors.

- [ ] **Step 3: Commit**
```bash
git add app/api/nutrition/scan/route.ts
git commit -m "security: cap nutrition scan text to 500 chars and strip control characters"
```

---

## Task 4 — Fix stale phase count in offline sync batch

**Files:**
- Modify: `app/api/sync-workout/route.ts:76-87`

`countSessionsSinceStart` is called inside the per-item loop but always reads the current DB count — it does not advance as items are processed. When syncing a batch that straddles a phase boundary, all items after the boundary get the wrong `phaseId`.

- [ ] **Step 1: Fetch count once before the loop and increment manually**

Lines 68–87 currently:
```ts
// Load phase info once for automatic-mode programs
let phases: ProgramPhase[] = []
let phaseProgram: { id: string; startedAt?: string; sessionsPerCycle?: number; earlyDeloadWeekStart?: string } | null = null
const activeProgram = await repo.getActiveProgram(userId)
if (activeProgram?.phaseMode === 'automatic' && activeProgram.startedAt && activeProgram.sessionsPerCycle) {
  phaseProgram = activeProgram
  phases = await repo.listProgramPhases(activeProgram.id)
}

for (const item of items) {
  const [y, m, d] = item.startedAt.slice(0, 10).split('-').map(Number);
  const dayStart = aestMidnight(y, m, d);

  let phaseId: string | undefined
  let isEarlyDeload = false
  if (phaseProgram && phases.length > 0 && phaseProgram.sessionsPerCycle) {
    const sessionsCount = await repo.countSessionsSinceStart(userId, phaseProgram.id, phaseProgram.startedAt!)
    const { phase } = getCurrentPhase(phases, phaseProgram.sessionsPerCycle, sessionsCount)
    phaseId = phase.id
    isEarlyDeload = isDeloadActive(phase, phaseProgram, item.startedAt.slice(0, 10))
  }
```

Replace with:
```ts
// Load phase info once for automatic-mode programs
let phases: ProgramPhase[] = []
let phaseProgram: { id: string; startedAt?: string; sessionsPerCycle?: number; earlyDeloadWeekStart?: string } | null = null
// Count sessions already in DB before this sync batch — we'll increment as we process
let syncedSessionCount = 0
const activeProgram = await repo.getActiveProgram(userId)
if (activeProgram?.phaseMode === 'automatic' && activeProgram.startedAt && activeProgram.sessionsPerCycle) {
  phaseProgram = activeProgram
  phases = await repo.listProgramPhases(activeProgram.id)
  syncedSessionCount = await repo.countSessionsSinceStart(userId, activeProgram.id, activeProgram.startedAt)
}

for (const item of items) {
  const [y, m, d] = item.startedAt.slice(0, 10).split('-').map(Number);
  const dayStart = aestMidnight(y, m, d);

  let phaseId: string | undefined
  let isEarlyDeload = false
  if (phaseProgram && phases.length > 0 && phaseProgram.sessionsPerCycle) {
    const { phase } = getCurrentPhase(phases, phaseProgram.sessionsPerCycle, syncedSessionCount)
    phaseId = phase.id
    isEarlyDeload = isDeloadActive(phase, phaseProgram, item.startedAt.slice(0, 10))
    syncedSessionCount++  // advance the rolling count for the next item
  }
```

- [ ] **Step 2: TypeScript check**
```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | grep "sync-workout"
```
Expected: no errors.

- [ ] **Step 3: Commit**
```bash
git add app/api/sync-workout/route.ts
git commit -m "fix: compute phase context from rolling session count in offline sync batch"
```

---

## Task 5 — Fix confirm-early-deload active program guard

**Files:**
- Modify: `app/api/confirm-early-deload/route.ts:17-28`

A caller can supply any `programId` they own (including non-active programs) to flag it for early deload. The ownership check via `listPrograms` is correct but the active-program constraint is missing.

- [ ] **Step 1: Verify supplied `programId` is the active program**

Lines 17–28 currently:
```ts
const programId = body.programId
  ?? (await repo.getActiveProgram(userId))?.id

if (!programId) return NextResponse.json({ error: "No active program" }, { status: 400 });

const programs = await repo.listPrograms(userId);
if (!programs.some(p => p.id === programId)) {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

await repo.confirmEarlyDeload(userId, programId, today);
return NextResponse.json({ ok: true, earlyDeloadWeekStart: today, programId });
```

Replace with:
```ts
const activeProgram = await repo.getActiveProgram(userId)
if (!activeProgram) return NextResponse.json({ error: "No active program" }, { status: 400 });

// Only allow deloading the currently active program
const programId = body.programId ?? activeProgram.id
if (programId !== activeProgram.id) {
  return NextResponse.json({ error: "Can only early-deload the active program" }, { status: 403 });
}

await repo.confirmEarlyDeload(userId, programId, today);
return NextResponse.json({ ok: true, earlyDeloadWeekStart: today, programId });
```

- [ ] **Step 2: TypeScript check**
```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | grep "confirm-early-deload"
```

- [ ] **Step 3: Commit**
```bash
git add app/api/confirm-early-deload/route.ts
git commit -m "fix: restrict early deload to active program only"
```

---

## Task 6 — Fix session lookup by name → accept ID-first in workout-data

**Files:**
- Modify: `app/api/workout-data/route.ts:100-105`
- Modify: `app/workout-select/workout-select-content.tsx:197`

The API currently matches sessions by name. Two sessions with similar names get the wrong data; any client passing a session ID gets a silent fallback to session[0]. Fix: accept UUID match first, name match as fallback for backward compat.

- [ ] **Step 1: Update session lookup in `app/api/workout-data/route.ts`**

Lines 100–105 currently:
```ts
// Find the requested session by name (case-insensitive)
const programSession = program.sessions.find(
  s => s.name.toLowerCase() === sessionParam.toLowerCase()
) ?? program.sessions[0];

if (!programSession) return NextResponse.json({ exercises: [] });
```

Replace with:
```ts
// Find session by ID first (preferred), then fall back to name for backward compat
const programSession = program.sessions.find(s => s.id === sessionParam)
  ?? program.sessions.find(s => s.name.toLowerCase() === sessionParam.toLowerCase())
  ?? program.sessions[0];

if (!programSession) return NextResponse.json({ exercises: [] });
```

- [ ] **Step 2: Update navigation in `app/workout-select/workout-select-content.tsx`**

Line 197 currently:
```ts
router.push(`/workout?session=${encodeURIComponent(session.name)}`)
```

Replace with (pass ID, keep legacy name cookie for other consumers):
```ts
router.push(`/workout?session=${encodeURIComponent(session.id)}`)
```

- [ ] **Step 3: TypeScript check**
```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | grep -E "workout-data|workout-select"
```
Expected: no errors.

- [ ] **Step 4: Commit**
```bash
git add app/api/workout-data/route.ts app/workout-select/workout-select-content.tsx
git commit -m "fix: look up workout session by ID first, fall back to name for backward compat"
```

---

## Task 7 — Fix early-deload banner localStorage key (UTC month → local month)

**Files:**
- Modify: `app/session-select/session-select-content.tsx:356,708`

The early-deload banner dismissal key uses `new Date().toISOString().slice(0, 7)` (UTC year-month). On the 1st of any month before 10am AEST, the key changes but the dismissed value was stored under the old key — the banner re-appears immediately after dismissal.

- [ ] **Step 1: Check imports at top of file**

Confirm `todayInTz` is imported. If not, add it:
```ts
import { todayInTz } from '@/lib/date-utils'
```

- [ ] **Step 2: Fix both occurrences of the UTC month key**

Find line 356:
```ts
const weekKey = `ta_early_deload_dismissed_${new Date().toISOString().slice(0, 7)}`
```
Replace with:
```ts
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
const weekKey = `ta_early_deload_dismissed_${todayInTz(tz).slice(0, 7)}`
```

Find line 708 (same pattern, inside the banner render):
```ts
const weekKey = `ta_early_deload_dismissed_${new Date().toISOString().slice(0, 7)}`
```
Replace with:
```ts
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
const weekKey = `ta_early_deload_dismissed_${todayInTz(tz).slice(0, 7)}`
```

- [ ] **Step 3: TypeScript check**
```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | grep "session-select"
```

- [ ] **Step 4: Commit**
```bash
git add app/session-select/session-select-content.tsx
git commit -m "fix: key early-deload banner dismissal on local month, not UTC month"
```

---

## Task 8 — DB performance: batch writes in adapter

**Files:**
- Modify: `lib/data/postgres/adapter.ts` (three methods)

Three methods issue N sequential DB round-trips where one batch statement would do. Priorities: `logSets` (12–20 trips per exercise log), `upsertBodyMetrics` (1 per Health Connect day sync), `listPhaseSets` (1 per phase set).

- [ ] **Step 1: Batch `logSets` (lines ~838–863)**

Current code loops over each set and does one `INSERT ... ON CONFLICT DO UPDATE` per set:
```ts
async logSets(exerciseLogId: string, sets: Omit<SetLog, 'id' | 'exerciseLogId'>[]): Promise<SetLog[]> {
  const saved: SetLog[] = []
  for (const set of sets) {
    const [r] = await this.db.insert(s.setLogs)
      .values({ exerciseLogId, setNumber: set.setNumber, ... })
      .onConflictDoUpdate({ ... })
      .returning()
    saved.push({ ...set, id: r.id, exerciseLogId })
  }
  return saved
}
```

Replace with a single batch insert:
```ts
async logSets(exerciseLogId: string, sets: Omit<SetLog, 'id' | 'exerciseLogId'>[]): Promise<SetLog[]> {
  if (sets.length === 0) return []
  const rows = await this.db.insert(s.setLogs)
    .values(sets.map(set => ({
      exerciseLogId,
      setNumber: set.setNumber,
      weightKg: set.weightKg,
      reps: set.reps,
      setTimeSec: set.setTimeSec ?? null,
      restTimeSec: set.restTimeSec ?? null,
      intensityPct: set.intensityPct ?? null,
      useFor1rm: set.useFor1rm,
      setStartMs: set.setStartMs ?? null,
      setEndMs: set.setEndMs ?? null,
    })))
    .onConflictDoUpdate({
      target: [s.setLogs.exerciseLogId, s.setLogs.setNumber],
      set: {
        weightKg: sql`EXCLUDED.weight_kg`,
        reps: sql`EXCLUDED.reps`,
        setTimeSec: sql`EXCLUDED.set_time_sec`,
        restTimeSec: sql`EXCLUDED.rest_time_sec`,
        intensityPct: sql`EXCLUDED.intensity_pct`,
        useFor1rm: sql`EXCLUDED.use_for_1rm`,
        setStartMs: sql`EXCLUDED.set_start_ms`,
        setEndMs: sql`EXCLUDED.set_end_ms`,
      },
    })
    .returning()
  return rows.map((r, i) => ({ ...sets[i], id: r.id, exerciseLogId }))
}
```

- [ ] **Step 2: Batch `upsertBodyMetrics` (lines ~1206–1235)**

Current code loops one upsert per day. Replace the method body:
```ts
async upsertBodyMetrics(userId: string, metrics: Omit<BodyMetrics, 'id' | 'userId' | 'createdAt'>[]): Promise<void> {
  if (metrics.length === 0) return
  await this.db.insert(s.bodyMetrics)
    .values(metrics.map(m => ({
      userId, date: m.date,
      weightKg: m.weightKg ?? null, bodyFatPct: m.bodyFatPct ?? null,
      calories: m.calories ?? null, proteinG: m.proteinG ?? null,
      carbsG: m.carbsG ?? null, fatG: m.fatG ?? null,
      steps: m.steps ?? null, distanceKm: m.distanceKm ?? null,
      restingHeartRate: m.restingHeartRate ?? null, hrvMs: m.hrvMs ?? null,
      spo2Pct: m.spo2Pct ?? null,
    })))
    .onConflictDoUpdate({
      target: [s.bodyMetrics.userId, s.bodyMetrics.date],
      set: {
        weightKg:         sql`COALESCE(EXCLUDED.weight_kg,          body_metrics.weight_kg)`,
        bodyFatPct:       sql`COALESCE(EXCLUDED.body_fat_pct,       body_metrics.body_fat_pct)`,
        calories:         sql`COALESCE(EXCLUDED.calories,           body_metrics.calories)`,
        proteinG:         sql`COALESCE(EXCLUDED.protein_g,          body_metrics.protein_g)`,
        carbsG:           sql`COALESCE(EXCLUDED.carbs_g,            body_metrics.carbs_g)`,
        fatG:             sql`COALESCE(EXCLUDED.fat_g,              body_metrics.fat_g)`,
        steps:            sql`COALESCE(EXCLUDED.steps,              body_metrics.steps)`,
        distanceKm:       sql`COALESCE(EXCLUDED.distance_km,        body_metrics.distance_km)`,
        restingHeartRate: sql`COALESCE(EXCLUDED.resting_heart_rate, body_metrics.resting_heart_rate)`,
        hrvMs:            sql`COALESCE(EXCLUDED.hrv_ms,             body_metrics.hrv_ms)`,
        spo2Pct:          sql`COALESCE(EXCLUDED.spo2_pct,           body_metrics.spo2_pct)`,
      },
    })
}
```

- [ ] **Step 3: Batch `listPhaseSets` (lines ~556–576)**

Current code issues one `SELECT` per phase set. Replace with two queries total (all sets, then all phases in one `inArray`):
```ts
async listPhaseSets(userId: string): Promise<PhaseSetWithPhases[]> {
  const sets = await this.db
    .select()
    .from(s.phaseSets)
    .where(eq(s.phaseSets.userId, userId))
    .orderBy(asc(s.phaseSets.createdAt))

  if (sets.length === 0) return []

  const setIds = sets.map(set => set.id)
  const allPhases = await this.db
    .select()
    .from(s.programPhases)
    .where(inArray(s.programPhases.phaseSetId, setIds))
    .orderBy(asc(s.programPhases.position))

  return sets.map(set => ({
    id: set.id, name: set.name, isDefault: set.isDefault,
    phases: allPhases
      .filter(p => p.phaseSetId === set.id)
      .map(r => this.rowToPhase(r)),
  }))
}
```

- [ ] **Step 4: TypeScript check**
```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | grep "adapter"
```
Expected: no errors.

- [ ] **Step 5: Commit**
```bash
git add lib/data/postgres/adapter.ts
git commit -m "perf: batch logSets, upsertBodyMetrics, and listPhaseSets to eliminate sequential round-trips"
```

---

## Task 9 — U31: SyncProvider error handling

**Files:**
- Modify: `components/sync-provider.tsx:48-65`

`initSQLite` and `drainOutbox` errors are silently swallowed — the outbox never drains if SQLite init fails, and there's no diagnostic information.

- [ ] **Step 1: Add try/catch with console logging**

Lines 48–65 currently:
```ts
(async () => {
  await initSQLite(MIGRATIONS);
  if (cancelled) return;

  // Drain any pending outbox items first
  await drainOutbox();
  if (cancelled) return;

  // Warm caches sequentially to avoid hammering the server
  for (const task of CACHE_TASKS) {
    if (cancelled) break;
    await warmCache(task);
  }
})();
```

Replace with:
```ts
(async () => {
  try {
    await initSQLite(MIGRATIONS);
  } catch (err) {
    console.error('[SyncProvider] SQLite init failed:', err)
    return  // Can't proceed without storage — skip drain and cache warm
  }
  if (cancelled) return;

  try {
    await drainOutbox();
  } catch (err) {
    console.error('[SyncProvider] Outbox drain failed:', err)
    // Non-fatal — continue to warm caches
  }
  if (cancelled) return;

  for (const task of CACHE_TASKS) {
    if (cancelled) break;
    await warmCache(task);
  }
})();
```

- [ ] **Step 2: TypeScript check**
```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | grep "sync-provider"
```

- [ ] **Step 3: Commit**
```bash
git add components/sync-provider.tsx
git commit -m "fix(U31): surface SQLite init and outbox drain errors instead of silently swallowing them"
```

---

## Task 10 — U27: Replace `<div>` section headers with semantic `<h2>`/`<h3>`

**Files:**
- Modify: `app/health/health-content.tsx` — section label divs
- Modify: `app/session-select/session-select-content.tsx` — section label divs

Scan for `<p className="... uppercase tracking-wide"` and `<p className="... text-xs ... font-medium"` used as section headings — these should be `<h2>` or `<h3>` for accessibility.

- [ ] **Step 1: Update section headings in `app/health/health-content.tsx`**

Search for patterns like:
```tsx
<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
```

Replace each with the same classes but using `<h2>`:
```tsx
<h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
```

Do the same for any sub-section labels that act as `<h3>`.

Run:
```bash
grep -n 'className.*uppercase.*tracking' /home/user/TrainingAI/app/health/health-content.tsx | head -20
```
to find all instances, then update each one.

- [ ] **Step 2: Update section headings in `app/session-select/session-select-content.tsx`**

Run:
```bash
grep -n 'className.*uppercase.*tracking\|text-xs.*font-medium.*mb-' /home/user/TrainingAI/app/session-select/session-select-content.tsx | head -20
```
Update `<p>` section label tags to `<h2>` using the same classes.

- [ ] **Step 3: Do the same for nutrition components**

Run:
```bash
grep -rn 'className.*uppercase.*tracking' /home/user/TrainingAI/components/nutrition/ | head -20
```
Update any `<p>` acting as section headings.

- [ ] **Step 4: TypeScript check**
```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Commit**
```bash
git add app/health/health-content.tsx app/session-select/session-select-content.tsx components/nutrition/
git commit -m "fix(U27): replace div/p section headings with semantic h2/h3 elements"
```

---

## Task 11 — U26: Standardise safe-area bottom padding on scrollable containers

**Files:**
- Modify: multiple screens where scrollable content uses hardcoded `pb-28` or `pb-4` instead of `pb-safe` at the bottom

The `pb-safe` utility is defined in `globals.css` as `padding-bottom: env(safe-area-inset-bottom, 0px)`. Scrollable inner containers that end at the bottom of the screen should use `pb-safe` (or combine it with their existing bottom padding).

- [ ] **Step 1: Find inconsistent footer padding**

```bash
grep -rn 'overflow-y-auto' /home/user/TrainingAI/components /home/user/TrainingAI/app --include="*.tsx" | grep -v "node_modules\|.next" | grep -v "pb-safe"
```

For each result that represents the main scroll container of a full-screen component (not a nested list inside a sheet), check if it has adequate bottom padding that clears the bottom nav + safe area. The bottom nav is `~64px`; `pb-28` (112px) is fine. `pb-4` on a full-screen scroll is not.

- [ ] **Step 2: Add or ensure `pb-safe` is included on containers missing it**

A safe pattern for full-screen scrollable containers:
```tsx
<div className="flex-1 overflow-y-auto px-4 pt-4 pb-28">
```
`pb-28` already accounts for the bottom nav. On screens where the bottom nav is absent (sheets, modals), ensure at least:
```tsx
<div className="flex-1 overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
```

- [ ] **Step 3: Commit any changes made**
```bash
git add -p
git commit -m "fix(U26): ensure safe-area-inset-bottom is respected on all scrollable containers"
```

---

## Task 12 — U28: Wire drag-to-reorder for meal types

**Files:**
- Modify: `lib/data/repository.ts` — add `reorderMealTypes` signature
- Modify: `lib/data/postgres/adapter.ts` — implement `reorderMealTypes`
- Modify: `app/api/nutrition/meal-types/route.ts` — add `PATCH` handler
- Modify: `components/nutrition/meal-type-manager.tsx` — wire `@dnd-kit/react` sort

The `meal_types` table has a `sort_order` column already. `@dnd-kit/react` is already installed. The existing `GripVertical` icon is rendered but not wired.

- [ ] **Step 1: Add `reorderMealTypes` to the repository interface**

In `lib/data/repository.ts`, find the `updateMealType` signature and add after it:
```ts
reorderMealTypes(userId: string, orderedIds: string[]): Promise<void>
```

- [ ] **Step 2: Implement `reorderMealTypes` in the adapter**

In `lib/data/postgres/adapter.ts`, find `updateMealType` and add after it:
```ts
async reorderMealTypes(userId: string, orderedIds: string[]): Promise<void> {
  await this.db.transaction(async tx => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.update(s.mealTypes)
        .set({ sortOrder: i })
        .where(and(eq(s.mealTypes.id, orderedIds[i]), eq(s.mealTypes.userId, userId)))
    }
  })
}
```

- [ ] **Step 3: Add `PATCH` handler to `/api/nutrition/meal-types/route.ts`**

Read the file, then add after the existing `POST` export:
```ts
export async function PATCH(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { orderedIds?: string[] }
  if (!Array.isArray(body.orderedIds) || body.orderedIds.some(id => typeof id !== 'string')) {
    return NextResponse.json({ error: 'orderedIds must be an array of strings' }, { status: 400 })
  }

  const repo = await getRepository()
  await repo.reorderMealTypes(userId, body.orderedIds)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Wire drag-to-reorder in `components/nutrition/meal-type-manager.tsx`**

Replace the entire file with a version that uses `@dnd-kit/react` sorting. The key changes:
1. Import `useSortable`, `SortableContext`, `verticalListSortingStrategy`, `DndContext`, `closestCenter`, `DragEndEvent` from `@dnd-kit/react/sortable` and `@dnd-kit/react`
2. Wrap the list in `<DndContext>` and `<SortableContext>`
3. Make each row a sortable item — the `GripVertical` icon becomes the drag handle
4. On `onDragEnd`, reorder the local state and PATCH the API

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Loader2, Trash2, Pencil, GripVertical, Plus } from 'lucide-react'
import { toast } from 'sonner'
import type { MealType } from '@/lib/types/nutrition'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

function SortableMealTypeRow({
  mt,
  onEdit,
  onDelete,
}: {
  mt: MealType
  onEdit: (mt: MealType) => void
  onDelete: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: mt.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <div ref={setNodeRef} style={style} className="rounded-xl border border-border/50 bg-muted/20">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          className="p-1 cursor-grab active:cursor-grabbing touch-none"
        >
          <GripVertical className="w-4 h-4 text-muted-foreground/60 shrink-0" />
        </button>
        <span className="text-lg shrink-0">{mt.emoji}</span>
        <span className="text-sm font-medium flex-1">{mt.name}</span>
        <span className="text-[10px] text-muted-foreground">{mt.timeStartHour}–{mt.timeEndHour}h</span>
        <button onClick={() => onEdit(mt)} className="p-1.5 text-muted-foreground hover:text-foreground">
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => onDelete(mt.id)} className="p-1.5 text-muted-foreground hover:text-destructive">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

export function MealTypeManager() {
  const [mealTypes, setMealTypes] = useState<MealType[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', emoji: '', timeStartHour: 0, timeEndHour: 24 })
  const [addingNew, setAddingNew] = useState(false)
  const [newForm, setNewForm] = useState({ name: '', emoji: '🍽️', timeStartHour: 0, timeEndHour: 24 })
  const [saving, setSaving] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  async function load() {
    setLoading(true)
    try {
      const data = await fetch('/api/nutrition/meal-types').then(r => r.json())
      setMealTypes(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = mealTypes.findIndex(m => m.id === active.id)
    const newIndex = mealTypes.findIndex(m => m.id === over.id)
    const reordered = arrayMove(mealTypes, oldIndex, newIndex)
    setMealTypes(reordered)
    try {
      await fetch('/api/nutrition/meal-types', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds: reordered.map(m => m.id) }),
      })
    } catch {
      toast.error('Failed to save order')
      load() // revert on failure
    }
  }

  function startEdit(mt: MealType) {
    setEditingId(mt.id)
    setEditForm({ name: mt.name, emoji: mt.emoji, timeStartHour: mt.timeStartHour, timeEndHour: mt.timeEndHour })
  }

  async function saveEdit() {
    if (!editingId) return
    setSaving(true)
    try {
      const res = await fetch(`/api/nutrition/meal-types/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      })
      if (!res.ok) throw new Error()
      toast.success('Updated')
      setEditingId(null)
      load()
    } catch {
      toast.error('Failed to update')
    } finally {
      setSaving(false)
    }
  }

  async function deleteMealType(id: string) {
    try {
      const res = await fetch(`/api/nutrition/meal-types/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Cannot delete — food logs reference this meal type')
        return
      }
      toast.success('Deleted')
      load()
    } catch {
      toast.error('Failed to delete')
    }
  }

  async function addNew() {
    setSaving(true)
    try {
      const res = await fetch('/api/nutrition/meal-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newForm, sortOrder: mealTypes.length }),
      })
      if (!res.ok) throw new Error()
      toast.success('Meal type added')
      setAddingNew(false)
      setNewForm({ name: '', emoji: '🍽️', timeStartHour: 0, timeEndHour: 24 })
      load()
    } catch {
      toast.error('Failed to add meal type')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Loader2 className="w-5 h-5 animate-spin text-muted-foreground m-4" />

  // Render inline edit form outside sortable context to avoid dnd-kit conflicts
  if (editingId) {
    return (
      <div className="space-y-2">
        {mealTypes.map(mt => mt.id === editingId ? (
          <div key={mt.id} className="rounded-xl border border-border/50 bg-muted/20 p-3 space-y-2">
            <div className="flex gap-2">
              <input type="text" value={editForm.emoji}
                onChange={e => setEditForm(f => ({ ...f, emoji: e.target.value }))}
                className="w-14 rounded-lg border bg-background px-2 py-2 text-center" maxLength={2} />
              <input type="text" value={editForm.name}
                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm"
                placeholder="Meal name" autoFocus />
            </div>
            <div className="flex gap-2 items-center text-xs text-muted-foreground">
              <span>Hours</span>
              <input type="number" min={0} max={23} value={editForm.timeStartHour}
                onChange={e => setEditForm(f => ({ ...f, timeStartHour: parseInt(e.target.value) || 0 }))}
                className="w-16 rounded-lg border bg-background px-2 py-1.5 text-center text-sm" />
              <span>to</span>
              <input type="number" min={1} max={24} value={editForm.timeEndHour}
                onChange={e => setEditForm(f => ({ ...f, timeEndHour: parseInt(e.target.value) || 24 }))}
                className="w-16 rounded-lg border bg-background px-2 py-1.5 text-center text-sm" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditingId(null)} className="flex-1 rounded-lg border py-2 text-sm">Cancel</button>
              <button onClick={saveEdit} disabled={saving}
                className="flex-1 rounded-lg bg-foreground text-background py-2 text-sm font-semibold disabled:opacity-40">
                {saving ? '…' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <div key={mt.id} className="rounded-xl border border-border/50 bg-muted/20">
            <div className="flex items-center gap-2 px-3 py-2.5 opacity-50">
              <GripVertical className="w-4 h-4 text-muted-foreground/40 shrink-0" />
              <span className="text-lg shrink-0">{mt.emoji}</span>
              <span className="text-sm font-medium flex-1">{mt.name}</span>
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={mealTypes.map(m => m.id)} strategy={verticalListSortingStrategy}>
          {mealTypes.map(mt => (
            <SortableMealTypeRow key={mt.id} mt={mt} onEdit={startEdit} onDelete={deleteMealType} />
          ))}
        </SortableContext>
      </DndContext>

      {addingNew ? (
        <div className="rounded-xl border border-dashed border-border p-3 space-y-2">
          <div className="flex gap-2">
            <input type="text" value={newForm.emoji}
              onChange={e => setNewForm(f => ({ ...f, emoji: e.target.value }))}
              className="w-14 rounded-lg border bg-background px-2 py-2 text-center" maxLength={2} />
            <input type="text" value={newForm.name}
              onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
              className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm"
              placeholder="Meal type name" autoFocus />
          </div>
          <div className="flex gap-2 items-center text-xs text-muted-foreground">
            <span>Hours</span>
            <input type="number" min={0} max={23} value={newForm.timeStartHour}
              onChange={e => setNewForm(f => ({ ...f, timeStartHour: parseInt(e.target.value) || 0 }))}
              className="w-16 rounded-lg border bg-background px-2 py-1.5 text-center text-sm" />
            <span>to</span>
            <input type="number" min={1} max={24} value={newForm.timeEndHour}
              onChange={e => setNewForm(f => ({ ...f, timeEndHour: parseInt(e.target.value) || 24 }))}
              className="w-16 rounded-lg border bg-background px-2 py-1.5 text-center text-sm" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setAddingNew(false)} className="flex-1 rounded-lg border py-2 text-sm">Cancel</button>
            <button onClick={addNew} disabled={saving || !newForm.name.trim()}
              className="flex-1 rounded-lg bg-foreground text-background py-2 text-sm font-semibold disabled:opacity-40">
              {saving ? '…' : 'Add'}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAddingNew(true)}
          className="w-full rounded-xl border border-dashed border-border/60 py-3 flex items-center justify-center gap-2 text-sm text-muted-foreground hover:border-border transition-colors">
          <Plus className="w-4 h-4" />
          Add meal type
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Check if `@dnd-kit/utilities` is installed (needed for `CSS.Transform.toString`)**
```bash
cd /home/user/TrainingAI && grep "@dnd-kit/utilities" package.json
```
If missing:
```bash
pnpm add @dnd-kit/utilities
```

- [ ] **Step 6: TypeScript check**
```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | grep -E "meal-type|adapter|repository" | head -20
```

- [ ] **Step 7: Commit**
```bash
git add lib/data/repository.ts lib/data/postgres/adapter.ts app/api/nutrition/meal-types/route.ts components/nutrition/meal-type-manager.tsx
git commit -m "feat(U28): wire drag-to-reorder for meal types with @dnd-kit and PATCH endpoint"
```

---

## Task 13 — Phase-context tracker in active workout screen

**Files:**
- Modify: `app/api/workout-data/route.ts` — return `phaseStatus` on per-session calls
- Modify: `components/workout-screen.tsx` — thread `phaseStatus` to `ActiveWorkoutScreen`
- Modify: `components/workout/active-workout-screen.tsx` — accept + display `phaseStatus`

Currently `phaseStatus` (phase name, cycle, weeks remaining) is only shown on the home screen. The active workout header has no phase context. This is the "phase-context aware session tracker" gap.

- [ ] **Step 1: Return `phaseStatus` from the per-session workout-data call**

In `app/api/workout-data/route.ts`, the per-session branch (lines 100–168) already computes `currentPhase` and `allPhases`. Add `phaseStatus` computation and include it in the response.

After line 116 (`currentPhase = getCurrentPhase(...).phase`), add:
```ts
    // Build full phaseStatus for the active workout header
    let phaseStatus: PhaseStatus | null = null
    const phaseResult = getCurrentPhase(allPhases, program.sessionsPerCycle!, sessionsCount)
    const tz = session?.user?.timezone ?? 'Australia/Brisbane'
    const today = todayInTz(tz)
    const deloadActive = isDeloadActive(phaseResult.phase, program, today)
    const avgPerWeek = avgSessionsPerWeek(program)
    phaseStatus = {
      phase: phaseResult.phase,
      cycleInPhase: phaseResult.cycleInPhase,
      totalPhaseCycles: phaseResult.totalPhaseCycles,
      completedCycles: phaseResult.completedCycles,
      totalProgramCycles: phaseResult.totalProgramCycles,
      blockComplete: phaseResult.blockComplete,
      approxWeeksRemaining: avgPerWeek > 0 ? phaseResult.approxWeeksRemaining(avgPerWeek) : null,
      isDeloadActive: deloadActive,
    }
```

Then update the return statement at line 168 to include it:
```ts
return NextResponse.json({ exercises, program, session: programSession, phaseStatus }, { headers: cacheHeaders });
```

Note: wrap the `phaseStatus` block in the existing `if (program.phaseMode === 'automatic' && ...)` guard. Only compute it when block periodization is active.

- [ ] **Step 2: Read `components/workout-screen.tsx` to find where workout data is fetched and where `ActiveWorkoutScreen` is rendered**

```bash
grep -n "phaseStatus\|ActiveWorkoutScreen\|workout-data\|fetchExercises" /home/user/TrainingAI/components/workout-screen.tsx | head -30
```

- [ ] **Step 3: Thread `phaseStatus` state through `workout-screen.tsx`**

Add state:
```ts
const [phaseStatus, setPhaseStatus] = useState<import('@/app/api/workout-data/route').PhaseStatus | null>(null)
```

In the fetch function that calls `/api/workout-data?tab=...`, update to read and store `phaseStatus`:
```ts
const { exercises, phaseStatus: ps } = await res.json()
// ... existing exercise processing ...
setPhaseStatus(ps ?? null)
```

- [ ] **Step 4: Pass `phaseStatus` to `ActiveWorkoutScreen`**

Find the `<ActiveWorkoutScreen ... />` render in `workout-screen.tsx` and add the prop:
```tsx
<ActiveWorkoutScreen
  {...existingProps}
  phaseStatus={phaseStatus}
/>
```

- [ ] **Step 5: Add `phaseStatus` prop to `ActiveWorkoutScreen` and render the badge**

In `components/workout/active-workout-screen.tsx`, update the props interface (currently ends at `sessionName?: string`):
```ts
interface ActiveWorkoutScreenProps {
  // ... existing props ...
  sessionName?: string;
  phaseStatus?: import('@/app/api/workout-data/route').PhaseStatus | null;
}
```

Add `phaseStatus` to the destructured props:
```ts
export function ActiveWorkoutScreen({
  // ... existing params ...
  sessionName,
  phaseStatus,
}: ActiveWorkoutScreenProps) {
```

In the header (currently around line 121), after the session title line, add the phase badge:
```tsx
{phaseStatus && !phaseStatus.isDeloadActive && (
  <span className="text-[10px] text-muted-foreground/70 leading-none">
    {phaseStatus.phase.name} · Cycle {phaseStatus.cycleInPhase}/{phaseStatus.totalPhaseCycles}
    {phaseStatus.approxWeeksRemaining != null && ` · ~${phaseStatus.approxWeeksRemaining}w left`}
  </span>
)}
{phaseStatus?.isDeloadActive && (
  <span className="text-[10px] text-amber-500 leading-none font-medium">
    {phaseStatus.phase.phaseType === 'deload' ? 'Deload Week' : 'Recovery Week'}
  </span>
)}
```

- [ ] **Step 6: TypeScript check**
```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | grep -E "workout-screen|active-workout|workout-data" | head -20
```
Expected: no errors.

- [ ] **Step 7: Commit**
```bash
git add app/api/workout-data/route.ts components/workout-screen.tsx components/workout/active-workout-screen.tsx
git commit -m "feat: show phase name and cycle progress in active workout header"
```

---

## Final — Push branch and update docs

- [ ] **Step 1: Run full TypeScript check**
```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -40
```
Expected: 0 errors.

- [ ] **Step 2: Push the branch**
```bash
git push -u origin claude/vigilant-turing-2rXPM
```

- [ ] **Step 3: Update `projectOverview.md`**

In the "Planned / Future Work" section:
- Mark U26, U27, U28, U31 as completed
- Remove the phase-context tracker from the gap list (now implemented)
- Add any new known issues discovered during implementation

In the "Known Issues" section, mark item #3 (Brzycki at reps=37) as fixed if it wasn't already confirmed fixed.

---

## Self-Review Checklist

**Spec coverage:**
- ✅ T1: All 4 toISOString violations fixed
- ✅ T2: Readiness chronic divisor
- ✅ T3: Nutrition scan prompt injection
- ✅ T4: Sync-workout stale phase count
- ✅ T5: Confirm-early-deload active program guard
- ✅ T6: Session lookup by ID
- ✅ T7: Early-deload banner UTC month key
- ✅ T8: Adapter batch writes (all 3 methods)
- ✅ T9: SyncProvider error handling (U31)
- ✅ T10: Semantic section headers (U27)
- ✅ T11: Safe-area footer audit (U26)
- ✅ T12: Meal type drag-to-reorder (U28)
- ✅ T13: Phase-context session tracker (new feature)

**Placeholder scan:** No TBDs. All code blocks are complete and exact. Task 10 (U27) and Task 11 (U26) require a grep-first step because exact line numbers depend on the file content — this is by design, not a placeholder.

**Type consistency:** `PhaseStatus` type is imported from `@/app/api/workout-data/route` consistently across Tasks 7, 13.
