> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Tier 1–3 Feature Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 11 features spanning admin UX, AI safety, body analytics, training load, PR tracking, readiness scoring, sleep correlation, weekly AI digest, and hardcoded-session-name cleanup — all committed to branch `claude/charming-heisenberg-daZlE` and pushed to `main`.

**Architecture:** Each feature is a self-contained commit. DB migrations are idempotent SQL scripts. New API routes follow the existing pattern (`auth()` → `getRepository()` → return JSON). New UI is added to existing pages rather than new routes, to minimise navigation changes. No tests exist in this project — verification is manual as documented per task.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind v4, Drizzle ORM + PostgreSQL, Gemini 3.1 Flash Lite via `@ai-sdk/google`, shadcn/ui + Radix.

---

## File Map

| File | Change |
|------|--------|
| `app/api/admin/pending-count/route.ts` | **Create** — returns count of inactive users |
| `app/profile/profile-content.tsx` | Modify — badge on Admin Console button; program week display |
| `app/api/google-sheet/route.ts` | Modify — truncate history before Gemini call |
| `lib/data/postgres/adapter.ts` | Modify — add `getFirstWorkoutDateForProgram`, `getPersonalRecord`, `upsertPersonalRecord`, `getExerciseVolumeSeries`, `getSleepPerformanceData`, `countPendingUsers` |
| `lib/data/repository.ts` | Modify — add signatures for new adapter methods |
| `lib/data/postgres/migrations/017_personal_records.sql` | **Create** — new table |
| `lib/data/postgres/schema.ts` | Modify — add `personalRecords` table |
| `app/api/log-exercise/route.ts` | Modify — accept `workoutStartedAt`, detect PRs, return `isPR` |
| `app/api/day-log/route.ts` | Modify — use real `startedAt` for duration when available |
| `app/api/training-load/route.ts` | **Create** — ACWR computation |
| `app/api/readiness-score/route.ts` | **Create** — composite readiness score |
| `app/api/sleep-performance-correlation/route.ts` | **Create** — sleep bucket analysis |
| `app/api/weekly-digest/route.ts` | **Create** — Gemini-generated weekly summary |
| `app/health/health-content.tsx` | Modify — lean mass chart card |
| `app/stats/stats-content.tsx` | Modify — ACWR card, sleep correlation card, weekly digest card |
| `app/session-select/session-select-content.tsx` | Modify — readiness score card; remove FALLBACK_SESSIONS |
| `components/workout/done-screen.tsx` | Modify — PR trophy display |
| `components/workout/exercise-stats-sheet.tsx` | Modify — show all-time 1RM |
| `components/workout/utils.ts` | Modify — delete SESSION_TO_TAB |
| `components/weights-summary.tsx` | Modify — dynamic session grouping |
| `components/ai-chat-overlay.tsx` | Modify — remove FALLBACK_SESSION_NAMES |
| `components/stats/exercise-library-search.tsx` | Modify — remove hardcoded filter tabs |
| `components/config-screen.tsx` | Modify — empty default sessions |
| `components/overview-screen.tsx` | Modify — remove FALLBACK_SESSIONS |
| `components/calendar-widget.tsx` | Modify — remove FALLBACK_SESSIONS |
| `app/history/history-content.tsx` | Modify — remove FALLBACK_SESSIONS |
| `app/workout-select/workout-select-content.tsx` | Modify — remove FALLBACK_SESSIONS |

---

## Task 1: Admin Notification Badge

**Files:**
- Create: `app/api/admin/pending-count/route.ts`
- Modify: `app/profile/profile-content.tsx`

- [ ] **Step 1.1: Create `/api/admin/pending-count` route**

```ts
// app/api/admin/pending-count/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin } from '@/lib/admin'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await requireAdmin(session.user.id)
    const repo = await getRepository()
    const users = await repo.listUsers()
    const count = users.filter(u => !u.isActive).length
    return NextResponse.json({ count })
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
}
```

- [ ] **Step 1.2: Add `pendingCount` state and fetch to profile-content.tsx**

Find the existing `useState` block at the top of `ProfileContent` and add:
```ts
const [pendingCount, setPendingCount] = useState<number>(0)
```

In the `useEffect` that fetches `/api/user/profile`, after `setIsAdmin(...)`, add a conditional fetch:
```ts
if (d.user?.isAdmin) {
  fetch('/api/admin/pending-count')
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d?.count != null) setPendingCount(d.count) })
    .catch(() => {})
}
```

Note: The admin check at the time was a hardcoded email comparison (`d.user?.email === '<owner-email>'`, redacted) — keep that pattern for the conditional fetch trigger. The badge is only visible to admin anyway. That check no longer exists; admin is `users.is_admin`, bootstrapped from `ADMIN_EMAIL`.

- [ ] **Step 1.3: Add badge to the Admin Console button**

Find the Admin Console button in profile-content.tsx (search for `Shield` icon usage). Wrap the label with a relative container and add the badge:

```tsx
// Replace the existing admin console list item content with:
<div className="flex items-center gap-3 flex-1">
  <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
  <span className="text-sm">Admin Console</span>
  {pendingCount > 0 && (
    <span className="ml-auto rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1.5 py-0.5 leading-none">
      {pendingCount}
    </span>
  )}
  <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto" />
</div>
```

If the existing button already has `ChevronRight`, remove the duplicate `ml-auto` and adjust accordingly — only one `ml-auto` element should push the badge+arrow to the right.

- [ ] **Step 1.4: Commit**

```bash
git add app/api/admin/pending-count/route.ts app/profile/profile-content.tsx
git commit -m "feat: admin notification badge showing pending user count"
```

**How to verify:** Go to Profile → scroll to About/Admin section. If you are an admin and there are inactive users in the DB, a red badge appears on the Admin Console row showing the count. If no pending users exist, no badge is shown.

---

## Task 2: AI Chat Context Truncation

**Files:**
- Modify: `app/api/google-sheet/route.ts`

The current system prompt + history + training data can easily exceed Gemini's context. Truncate to the most recent 20 turns and cap the total prompt character length.

- [ ] **Step 2.1: Truncate conversation history before building context**

In `app/api/google-sheet/route.ts`, after destructuring `conversationHistory` from `parsedBody.data`, add:

```ts
// Keep only the most recent 20 turns to stay well within context limits
const recentHistory = (conversationHistory ?? []).slice(-20)
```

Then replace all uses of `conversationHistory` with `recentHistory` in the context builder:
```ts
// Change this line:
const conversationContext = conversationHistory?.length
  ? conversationHistory.map(c => `${c.role}: ${c.content}`).join("\n")
  : "";

// To:
const conversationContext = recentHistory.length
  ? recentHistory.map(c => `${c.role}: ${c.content}`).join("\n")
  : "";
```

- [ ] **Step 2.2: Cap workout history to 50 sessions**

In `buildWorkoutHistory`, add a slice before iterating so that very long history doesn't bloat the prompt:

```ts
function buildWorkoutHistory(sessions: WorkoutSession[]): string {
  if (!sessions.length) return "(no workout history)";
  // Cap at 50 most recent sessions to protect context window
  const capped = sessions.slice(-50);
  const lines: string[] = ["## Workout History (last 90 days)"];
  for (const ws of [...capped].reverse()) {
    // ... rest of function unchanged
  }
  return lines.join("\n");
}
```

- [ ] **Step 2.3: Commit**

```bash
git add app/api/google-sheet/route.ts
git commit -m "feat: truncate AI chat history and workout context to stay within Gemini token limits"
```

**How to verify:** Open the AI chat. Build a long conversation (10+ exchanges). Confirm responses are still coherent. You can also add `console.log("[chat] context chars:", fullPrompt.length)` temporarily to observe the character count stays bounded.

---

## Task 3: Program Week Tracker

**Files:**
- Modify: `lib/data/postgres/adapter.ts`
- Modify: `lib/data/repository.ts`
- Modify: `app/profile/profile-content.tsx`

- [ ] **Step 3.1: Add `getFirstWorkoutDateForProgram` to adapter**

In `lib/data/postgres/adapter.ts`, add this method inside the `PostgresWorkoutRepository` class (near the other query methods at the bottom):

```ts
async getFirstWorkoutDateForProgram(userId: string, programSessionIds: string[]): Promise<Date | null> {
  if (!programSessionIds.length) return null
  const rows = await this.db.select({ startedAt: s.workoutSessions.startedAt })
    .from(s.workoutSessions)
    .where(
      and(
        eq(s.workoutSessions.userId, userId),
        inArray(s.workoutSessions.sessionId, programSessionIds),
      )
    )
    .orderBy(asc(s.workoutSessions.startedAt))
    .limit(1)
  return rows[0]?.startedAt ?? null
}
```

- [ ] **Step 3.2: Add signature to `WorkoutRepository` interface**

In `lib/data/repository.ts`, add to the `// ── Queries` section:

```ts
getFirstWorkoutDateForProgram(userId: string, programSessionIds: string[]): Promise<Date | null>
```

- [ ] **Step 3.3: Add `/api/program-week` route**

Create `app/api/program-week/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepository()
  const program = await repo.getActiveProgram(userId)
  if (!program) return NextResponse.json({ weeksRunning: null, programName: null })

  const sessionIds = program.sessions.map(s => s.id)
  const firstDate = await (repo as import('@/lib/data/postgres/adapter').PostgresWorkoutRepository)
    .getFirstWorkoutDateForProgram(userId, sessionIds)

  if (!firstDate) return NextResponse.json({ weeksRunning: null, programName: program.name })

  const weeksRunning = Math.floor((Date.now() - firstDate.getTime()) / (7 * 24 * 60 * 60 * 1000))
  return NextResponse.json({ weeksRunning, programName: program.name, startedAt: firstDate.toISOString() })
}
```

- [ ] **Step 3.4: Display in profile-content.tsx**

Add state:
```ts
const [programWeeks, setProgramWeeks] = useState<{ weeksRunning: number | null; programName: string | null } | null>(null)
```

Add fetch in the profile `useEffect` (alongside the existing `/api/user/profile` fetch):
```ts
fetch('/api/program-week')
  .then(r => r.ok ? r.json() : null)
  .then(d => { if (d) setProgramWeeks(d) })
  .catch(() => {})
```

Find the "Stats strip" section in profile-content.tsx (the row showing Workouts / Weight Goal / Member Since) and add a new stat:
```tsx
{programWeeks?.weeksRunning != null && (
  <div className="flex flex-col items-center gap-0.5">
    <span className="text-lg font-bold" style={{ color: 'var(--color-brand)' }}>
      {programWeeks.weeksRunning}w
    </span>
    <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
      {programWeeks.weeksRunning >= 12 ? '⚠️ Review?' : 'On program'}
    </span>
  </div>
)}
```

The `⚠️ Review?` label appears at ≥12 weeks as a gentle prompt to consider cycling.

- [ ] **Step 3.5: Commit**

```bash
git add lib/data/postgres/adapter.ts lib/data/repository.ts app/api/program-week/route.ts app/profile/profile-content.tsx
git commit -m "feat: program week tracker showing how long current program has been running"
```

**How to verify:** Go to Profile. The stats strip should show e.g. "3w / On program". After 12 weeks it shows "12w / ⚠️ Review?" in the same strip.

---

## Task 4: Workout Start Time in DB

**Files:**
- Modify: `app/api/log-exercise/route.ts`
- Modify: `app/api/day-log/route.ts`

Currently `startedAt` for a `workout_session` row is forced to midnight AEST. The client already has the real workout start timestamp in Zustand (`workoutStartMs`). We wire it through.

- [ ] **Step 4.1: Accept `workoutStartedAt` in log-exercise body**

In `app/api/log-exercise/route.ts`, add `workoutStartedAt?: number` to the body type:

```ts
let body: {
  // ... all existing fields ...
  workoutStartedAt?: number;   // epoch ms of actual workout start
};
```

Destructure it:
```ts
const {
  // ... all existing destructures ...
  workoutStartedAt,
} = body;
```

- [ ] **Step 4.2: Use actual start time when creating/ensuring the session**

Replace the existing `startOfDay` logic block:

```ts
// Before:
const startOfDay = aestMidnight(y, m, d);
...
await repo.ensureWorkoutSession(userId, wsId, sessionId, sessionName, startOfDay);
// and
const ws = await repo.createWorkoutSession(userId, sessionId, sessionName, startOfDay);

// After:
const startOfDay = aestMidnight(y, m, d);
// Use real workout start if provided, otherwise fall back to day boundary
const sessionStart = workoutStartedAt ? new Date(workoutStartedAt) : startOfDay;

// ... then pass sessionStart instead of startOfDay in both calls:
await repo.ensureWorkoutSession(userId, wsId, sessionId, sessionName, sessionStart);
// ...
const ws = await repo.createWorkoutSession(userId, sessionId, sessionName, sessionStart);
```

- [ ] **Step 4.3: Update day-log to use real startedAt for duration**

In `app/api/day-log/route.ts`, the current duration calc uses first→last exercise timestamp. Replace it with session `startedAt` when it's a real timestamp (i.e. after midnight):

```ts
for (const ws of workoutSessions) {
  const timedExercises = ws.exercises
    .filter(e => e.loggedAt)
    .map(e => ({ t: e.loggedAt.getTime(), dur: (e.timeToComplete ?? 0) * 1000 }));
  if (timedExercises.length === 0) {
    workoutDurations[ws.sessionName] = null;
    continue;
  }
  // If startedAt is more than 1 minute after day-start, it's a real workout-start timestamp
  const dayStart = new Date(ws.startedAt);
  dayStart.setHours(0, 0, 0, 0);
  const isRealStart = (ws.startedAt.getTime() - dayStart.getTime()) > 60_000;

  const startMs = isRealStart
    ? ws.startedAt.getTime()
    : Math.min(...timedExercises.map(x => x.t));
  const endMs = Math.max(...timedExercises.map(x => x.t + x.dur));
  workoutDurations[ws.sessionName] = {
    start: fmtMs(startMs),
    end:   fmtMs(endMs),
    minutes: Math.round((endMs - startMs) / 60000),
  };
}
```

- [ ] **Step 4.4: Send `workoutStartedAt` from the Zustand store in workout-screen.tsx**

In `components/workout-screen.tsx`, find the `handleCompleteSet` function (or equivalent) that calls `/api/log-exercise`. Add `workoutStartedAt: store.workoutStartMs ?? undefined` to the POST body. The exact field name in the Zustand store is `workoutStartMs`.

Search for the fetch call to `/api/log-exercise` in `workout-screen.tsx` and add the field:
```ts
workoutStartedAt: useWorkoutStore.getState().workoutStartMs ?? undefined,
```

- [ ] **Step 4.5: Commit**

```bash
git add app/api/log-exercise/route.ts app/api/day-log/route.ts components/workout-screen.tsx
git commit -m "fix: use actual workout start time for session duration instead of day-boundary midnight"
```

**How to verify:** Complete a workout. Go to Stats → tap a calendar day. The duration shown should reflect the actual elapsed time from "Start Workout" press to last exercise, not just the gap between first and last exercise.

---

## Task 5: Body Composition Trend (Lean Mass)

**Files:**
- Modify: `app/health/health-content.tsx`

Lean mass = `weightKg × (1 − bodyFatPct/100)`. Show it alongside the existing weight sparkline.

- [ ] **Step 5.1: Add `LeanMassSparkline` component inside health-content.tsx**

After the existing `WeightSparkline` function, add:

```tsx
function LeanMassSparkline({ data }: { data: BodyMetaRow[] }) {
  const points = data
    .slice()
    .reverse()
    .filter(r => r.weightKg != null && r.bodyFatPct != null)
    .map(r => parseFloat(((r.weightKg!) * (1 - (r.bodyFatPct!) / 100)).toFixed(1)));

  if (points.length < 2) return null;

  const min = Math.min(...points) - 0.5;
  const max = Math.max(...points) + 0.5;
  const range = max - min || 1;
  const W = 160; const H = 48;
  const step = W / (points.length - 1);

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      <polyline
        points={points.map((v, i) => `${(i * step).toFixed(1)},${(H - ((v - min) / range) * H).toFixed(1)}`).join(" ")}
        fill="none"
        stroke="#bf5fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((v, i) => (
        <circle key={i}
          cx={(i * step).toFixed(1)}
          cy={(H - ((v - min) / range) * H).toFixed(1)}
          r="2.5" fill="#bf5fff"
        />
      ))}
    </svg>
  );
}
```

- [ ] **Step 5.2: Insert lean mass card in the Body tab**

In the JSX of `HealthContent`, find the existing weight sparkline card (it renders `<WeightSparkline data={metaRecent} />`). After that card, add:

```tsx
{metaRecent.filter(r => r.weightKg != null && r.bodyFatPct != null).length >= 2 && (
  <div className="rounded-2xl border border-border p-4" style={{ background: "rgba(191,95,255,0.08)" }}>
    <div className="flex items-center justify-between mb-2">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#bf5fff]">Lean Mass</p>
        {(() => {
          const valid = metaRecent.filter(r => r.weightKg != null && r.bodyFatPct != null);
          const latest = valid[0];
          const leanKg = latest ? (latest.weightKg! * (1 - latest.bodyFatPct! / 100)) : null;
          return leanKg != null ? (
            <p className="text-2xl font-bold text-[#bf5fff]">{leanKg.toFixed(1)} kg</p>
          ) : null;
        })()}
      </div>
    </div>
    <LeanMassSparkline data={metaRecent} />
  </div>
)}
```

- [ ] **Step 5.3: Commit**

```bash
git add app/health/health-content.tsx
git commit -m "feat: lean mass trend chart on Health body tab derived from weight + body fat %"
```

**How to verify:** Go to Health → Body tab. If you have 2+ days with both weight and body fat readings, a purple "Lean Mass" card appears with sparkline.

---

## Task 6: Acute:Chronic Workload Ratio (ACWR)

**Files:**
- Create: `app/api/training-load/route.ts`
- Modify: `app/stats/stats-content.tsx`

ACWR = 7-day rolling volume / (28-day rolling volume / 4). Green zone: 0.8–1.3. Above 1.5 = overreaching risk. Below 0.5 = detraining.

- [ ] **Step 6.1: Create `/api/training-load` route**

```ts
// app/api/training-load/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

export interface TrainingLoadResponse {
  acwr: number | null
  acuteLoad: number   // 7-day volume sum
  chronicLoad: number // 28-day volume sum / 4
  interpretation: 'optimal' | 'high' | 'very_high' | 'low' | 'insufficient_data'
}

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepository()
  const from28d = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000)
  const from7d  = new Date(Date.now() -  7 * 24 * 60 * 60 * 1000)

  const sessions = await repo.getWorkoutSessionsFrom(userId, from28d)

  let acuteLoad  = 0
  let chronicLoad = 0

  for (const ws of sessions) {
    const vol = ws.exercises.reduce((sum, ex) => sum + (ex.volume ?? 0), 0)
    if (ws.startedAt >= from7d) acuteLoad  += vol
    chronicLoad += vol
  }

  const chronicAvg = chronicLoad / 4  // normalize 28d to weekly average

  if (chronicAvg < 100) {
    // Not enough training history for meaningful ratio
    return NextResponse.json({ acwr: null, acuteLoad, chronicLoad: chronicAvg, interpretation: 'insufficient_data' } satisfies TrainingLoadResponse)
  }

  const acwr = acuteLoad / chronicAvg

  const interpretation: TrainingLoadResponse['interpretation'] =
    acwr > 1.5 ? 'very_high' :
    acwr > 1.3 ? 'high' :
    acwr < 0.5 ? 'low' :
    'optimal'

  return NextResponse.json({ acwr: parseFloat(acwr.toFixed(2)), acuteLoad, chronicLoad: chronicAvg, interpretation } satisfies TrainingLoadResponse)
}
```

- [ ] **Step 6.2: Add ACWR insight card to stats-content.tsx**

Add state and fetch:
```ts
const [trainingLoad, setTrainingLoad] = useState<import('@/app/api/training-load/route').TrainingLoadResponse | null>(null)

useEffect(() => {
  fetch('/api/training-load')
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d) setTrainingLoad(d) })
    .catch(() => {})
}, [])
```

In the JSX (after the `<WeeklyStatsHub>` component), add the ACWR card:
```tsx
{trainingLoad && trainingLoad.interpretation !== 'insufficient_data' && (
  <div className="mx-4 rounded-2xl border border-border p-4" style={{ background: 'var(--brand-card-bg)' }}>
    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Training Load (ACWR)</p>
    <div className="flex items-end gap-3">
      <p className="text-3xl font-bold tabular-nums" style={{ color: 'var(--color-brand)' }}>
        {trainingLoad.acwr?.toFixed(2) ?? '—'}
      </p>
      <p className="text-sm text-muted-foreground mb-1">
        {trainingLoad.interpretation === 'optimal'   && '✅ Optimal zone'}
        {trainingLoad.interpretation === 'high'      && '⚠️ Slightly elevated'}
        {trainingLoad.interpretation === 'very_high' && '🔴 Overreaching risk'}
        {trainingLoad.interpretation === 'low'       && '💤 Detraining risk'}
      </p>
    </div>
    <p className="text-xs text-muted-foreground mt-1">7-day avg vs 28-day baseline · green zone: 0.8–1.3</p>
  </div>
)}
```

- [ ] **Step 6.3: Commit**

```bash
git add app/api/training-load/route.ts app/stats/stats-content.tsx
git commit -m "feat: Acute:Chronic Workload Ratio insight card on stats page"
```

**How to verify:** Go to Stats. Below the weekly hub, an ACWR card appears showing your ratio (e.g. "1.02 ✅ Optimal zone"). If fewer than 28 days of data exist, the card is hidden.

---

## Task 7: Personal Record Tracker

**Files:**
- Create: `lib/data/postgres/migrations/017_personal_records.sql`
- Modify: `lib/data/postgres/schema.ts`
- Modify: `lib/data/postgres/adapter.ts`
- Modify: `lib/data/repository.ts`
- Modify: `app/api/log-exercise/route.ts`
- Modify: `components/workout/done-screen.tsx`
- Modify: `components/workout/exercise-stats-sheet.tsx`

- [ ] **Step 7.1: Create migration**

```sql
-- lib/data/postgres/migrations/017_personal_records.sql
CREATE TABLE IF NOT EXISTS personal_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_name TEXT NOT NULL,
  estimated_1rm DOUBLE PRECISION NOT NULL,
  achieved_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, exercise_name)
);
```

The `UNIQUE (user_id, exercise_name)` means one row per user per exercise — we upsert when a new all-time 1RM is set.

- [ ] **Step 7.2: Add Drizzle schema table**

In `lib/data/postgres/schema.ts`, after the `moodLogs` table:

```ts
export const personalRecords = pgTable('personal_records', {
  id:            uuid('id').primaryKey().defaultRandom(),
  userId:        uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  exerciseName:  text('exercise_name').notNull(),
  estimated1rm:  doublePrecision('estimated_1rm').notNull(),
  achievedAt:    timestamp('achieved_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.userId, t.exerciseName)])
```

- [ ] **Step 7.3: Add `getPersonalRecord` and `upsertPersonalRecord` to adapter**

In `lib/data/postgres/adapter.ts`, add inside the class:

```ts
async getPersonalRecord(userId: string, exerciseName: string): Promise<{ estimated1rm: number } | null> {
  const [r] = await this.db.select({ estimated1rm: s.personalRecords.estimated1rm })
    .from(s.personalRecords)
    .where(and(eq(s.personalRecords.userId, userId), eq(s.personalRecords.exerciseName, exerciseName)))
    .limit(1)
  return r ?? null
}

async upsertPersonalRecord(userId: string, exerciseName: string, estimated1rm: number): Promise<void> {
  await this.db.insert(s.personalRecords)
    .values({ userId, exerciseName, estimated1rm, achievedAt: new Date() })
    .onConflictDoUpdate({
      target: [s.personalRecords.userId, s.personalRecords.exerciseName],
      set: { estimated1rm, achievedAt: new Date() },
    })
}
```

- [ ] **Step 7.4: Add signatures to repository interface**

In `lib/data/repository.ts`, in the `// ── Queries` section:

```ts
getPersonalRecord(userId: string, exerciseName: string): Promise<{ estimated1rm: number } | null>
upsertPersonalRecord(userId: string, exerciseName: string, estimated1rm: number): Promise<void>
```

- [ ] **Step 7.5: Run migration + detect PRs in log-exercise route**

The migration runs automatically via `ensureSchema()` since it's added to `lib/data/postgres/migrations/`. Verify it's picked up by checking how `ensureSchema()` in `lib/data/postgres/client.ts` loads migrations (it reads all `.sql` files from the migrations directory).

In `app/api/log-exercise/route.ts`, after `const { estimated1rm, target80 } = calculate1RM(...)` add:

```ts
// Check if this is a new personal record
let isPR = false
if (estimated1rm > 0) {
  const pgRepo = repo as import('@/lib/data/postgres/adapter').PostgresWorkoutRepository
  const existing = await pgRepo.getPersonalRecord(userId, exercise)
  if (!existing || estimated1rm > existing.estimated1rm) {
    await pgRepo.upsertPersonalRecord(userId, exercise, estimated1rm)
    isPR = true
  }
}
```

Add `isPR` to the return JSON:
```ts
return NextResponse.json({
  success: true,
  workoutSessionId: wsId,
  exerciseLogId: exerciseLog.id,
  exercise,
  weights,
  sets,
  reps,
  estimated1rm,
  target80,
  isPR,
})
```

- [ ] **Step 7.6: Track PRs in workout-screen.tsx and pass to done-screen**

In `components/workout-screen.tsx`, find the Zustand store (`useWorkoutStore`) or local state handling the log-exercise API response. After the fetch call, add:

```ts
// In the handleCompleteSet (or equivalent) function, after await fetch('/api/log-exercise'):
const data = await res.json()
if (data.isPR && data.exercise) {
  // Track PRs achieved this session
  setNewPRs(prev => prev.includes(data.exercise) ? prev : [...prev, data.exercise])
}
```

Add `const [newPRs, setNewPRs] = useState<string[]>([])` near the top of workout-screen.tsx and pass `newPRs` to `<DoneScreen>`.

- [ ] **Step 7.7: Display PRs on done-screen**

In `components/workout/done-screen.tsx`, add `newPRs?: string[]` to `DoneScreenProps` and render:

```tsx
{newPRs && newPRs.length > 0 && (
  <div className="w-full max-w-xs rounded-2xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3">
    <p className="text-xs font-semibold text-yellow-400 mb-1">🏆 Personal Records</p>
    {newPRs.map(name => (
      <p key={name} className="text-sm font-medium text-yellow-300">{name}</p>
    ))}
  </div>
)}
```

Place this above the 2×2 stats grid.

- [ ] **Step 7.8: Show all-time 1RM in exercise-stats-sheet**

In `components/workout/exercise-stats-sheet.tsx`, `entries` is already fetched from `/api/exercise-history`. Derive the all-time 1RM from entries:

```ts
const allTime1rm = entries.length > 0
  ? Math.max(...entries.map(e => e.estimated1rm).filter(v => v > 0))
  : null
```

Add it to the stats display section of the sheet (next to the current 1RM display):
```tsx
{allTime1rm != null && (
  <div className="flex items-center gap-1.5 text-xs text-yellow-400">
    <span>🏆</span>
    <span>All-time 1RM: <strong>{allTime1rm.toFixed(1)} kg</strong></span>
  </div>
)}
```

- [ ] **Step 7.9: Commit**

```bash
git add lib/data/postgres/migrations/017_personal_records.sql lib/data/postgres/schema.ts \
  lib/data/postgres/adapter.ts lib/data/repository.ts app/api/log-exercise/route.ts \
  components/workout/done-screen.tsx components/workout/exercise-stats-sheet.tsx \
  components/workout-screen.tsx
git commit -m "feat: personal record tracker — detect new 1RM PRs, show on done screen and exercise stats"
```

**How to verify:** Log a heavy set that beats your previous 1RM. On the Done screen, a gold "🏆 Personal Records" card appears with the exercise name. In the exercise stats sheet, "🏆 All-time 1RM: Xkg" is shown.

**Important:** Railway DB migration — run `017_personal_records.sql` against Railway Postgres after deploying, or confirm that `ensureSchema()` picks it up automatically (check `lib/data/postgres/client.ts`).

---

## Task 8: Readiness / Energy Score

**Files:**
- Create: `app/api/readiness-score/route.ts`
- Modify: `app/session-select/session-select-content.tsx`

Composite score (0–100) from sleep, HRV trend, resting HR trend, and training load. Only shown when all three biometric types have data.

- [ ] **Step 8.1: Create `/api/readiness-score` route**

```ts
// app/api/readiness-score/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

export interface ReadinessScoreResponse {
  score: number         // 0–100
  label: string         // "High" | "Moderate" | "Low"
  components: {
    sleep: number       // 0–40
    hrv: number         // 0–30
    rhr: number         // 0–20
    load: number        // 0–10
  }
  hasSufficientData: boolean
}

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepository()

  const todayIso = new Date().toISOString().slice(0, 10)
  const from28d  = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const from7d   = new Date(Date.now() -  7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const [bodyMetrics, sleepSessions, recentSessions] = await Promise.all([
    repo.listBodyMetrics(userId, from28d, todayIso),
    repo.listSleepSessions(userId, from28d, todayIso),
    repo.getWorkoutSessionsFrom(userId, new Date(Date.now() - 28 * 24 * 60 * 60 * 1000)),
  ])

  // ── Sleep score (0–40) ──────────────────────────────────────────────────────
  const lastSleep = sleepSessions.sort((a, b) => b.sleepEnd.getTime() - a.sleepEnd.getTime())[0]
  const sleepHours = lastSleep?.durationHours ?? null
  const sleepScore = sleepHours != null ? Math.min(40, Math.round((sleepHours / 8) * 40)) : 0

  // ── HRV score (0–30) ────────────────────────────────────────────────────────
  const hrvRows = bodyMetrics.filter(m => m.hrvMs != null)
  const recent2dHrv = bodyMetrics.filter(m => m.date >= from7d && m.hrvMs != null)
  const baseline28Hrv = hrvRows.map(m => m.hrvMs!).filter(v => v > 0)
  const baselineHrv = baseline28Hrv.length >= 5
    ? baseline28Hrv.reduce((a, b) => a + b, 0) / baseline28Hrv.length
    : null
  const recentHrv = recent2dHrv.length
    ? recent2dHrv.map(m => m.hrvMs!).reduce((a, b) => a + b, 0) / recent2dHrv.length
    : null
  const hrvScore = (baselineHrv && recentHrv)
    ? Math.max(0, Math.min(30, Math.round(30 * (recentHrv / baselineHrv))))
    : 0

  // ── RHR score (0–20) ────────────────────────────────────────────────────────
  const rhrRows = bodyMetrics.filter(m => m.restingHeartRate != null)
  const recent2dRhr = bodyMetrics.filter(m => m.date >= from7d && m.restingHeartRate != null)
  const baseline28Rhr = rhrRows.map(m => m.restingHeartRate!)
  const baselineRhr = baseline28Rhr.length >= 5
    ? baseline28Rhr.reduce((a, b) => a + b, 0) / baseline28Rhr.length
    : null
  const recentRhr = recent2dRhr.length
    ? recent2dRhr.map(m => m.restingHeartRate!).reduce((a, b) => a + b, 0) / recent2dRhr.length
    : null
  // Lower RHR vs baseline = better recovery; higher = worse
  const rhrScore = (baselineRhr && recentRhr)
    ? Math.max(0, Math.min(20, Math.round(20 * (baselineRhr / recentRhr))))
    : 0

  // ── Training load score (0–10) ───────────────────────────────────────────────
  const from7dDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  let acuteLoad = 0, chronicLoad = 0
  for (const ws of recentSessions) {
    const vol = ws.exercises.reduce((sum, ex) => sum + (ex.volume ?? 0), 0)
    if (ws.startedAt >= from7dDate) acuteLoad += vol
    chronicLoad += vol
  }
  const chronicAvg = chronicLoad / 4
  const acwr = chronicAvg > 100 ? acuteLoad / chronicAvg : null
  const loadScore = acwr != null
    ? acwr >= 0.8 && acwr <= 1.3 ? 10
      : acwr > 1.3 ? Math.max(0, Math.round(10 * (1.5 - acwr)))
      : Math.round(10 * acwr / 0.8)
    : 5 // neutral when no training load data

  const hasSufficientData = sleepHours != null && (baselineHrv != null || baselineRhr != null)
  const score = sleepScore + hrvScore + rhrScore + loadScore

  const label = score >= 70 ? 'High' : score >= 45 ? 'Moderate' : 'Low'

  return NextResponse.json({
    score, label,
    components: { sleep: sleepScore, hrv: hrvScore, rhr: rhrScore, load: loadScore },
    hasSufficientData,
  } satisfies ReadinessScoreResponse)
}
```

- [ ] **Step 8.2: Add readiness score card to home screen**

In `app/session-select/session-select-content.tsx`, add state and fetch:

```ts
const [readiness, setReadiness] = useState<import('@/app/api/readiness-score/route').ReadinessScoreResponse | null>(null)

useEffect(() => {
  fetch('/api/readiness-score')
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d?.hasSufficientData) setReadiness(d) })
    .catch(() => {})
}, [])
```

In the JSX, render a readiness card above the recommendation card (or as a section within the `HomeSortableSection` list). Add a new `HomeSortableSection` entry or insert inline before the recommendation:

```tsx
{readiness && (
  <div className="mx-4 rounded-2xl border border-border p-4" style={{ background: 'var(--brand-card-bg)' }}>
    <div className="flex items-center justify-between">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Today's Readiness</p>
        <p className="text-3xl font-bold tabular-nums mt-0.5" style={{ color: 'var(--color-brand)' }}>
          {readiness.score}<span className="text-base font-normal text-muted-foreground">/100</span>
        </p>
        <p className="text-sm text-muted-foreground">{readiness.label}</p>
      </div>
      <div className="text-right text-xs text-muted-foreground space-y-0.5">
        <p>😴 Sleep: {readiness.components.sleep}/40</p>
        <p>❤️ HRV: {readiness.components.hrv}/30</p>
        <p>💓 RHR: {readiness.components.rhr}/20</p>
        <p>⚡ Load: {readiness.components.load}/10</p>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 8.3: Commit**

```bash
git add app/api/readiness-score/route.ts app/session-select/session-select-content.tsx
git commit -m "feat: readiness/energy score card on home screen from HRV, RHR, sleep, and training load"
```

**How to verify:** Open the home screen. If HRV + RHR data exists (requires several days of Health Connect sync) the readiness card appears. Score will be low if data is sparse — this is expected; it improves as baseline data accumulates.

---

## Task 9: Sleep ↔ Performance Correlation

**Files:**
- Create: `app/api/sleep-performance-correlation/route.ts`
- Modify: `app/stats/stats-content.tsx`

- [ ] **Step 9.1: Create `/api/sleep-performance-correlation` route**

```ts
// app/api/sleep-performance-correlation/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

export interface SleepCorrelationResponse {
  insight: string
  buckets: { label: string; avgOneRm: number; count: number }[]
  hasSufficientData: boolean
}

const BUCKETS = [
  { label: '<6h',  min: 0,   max: 6   },
  { label: '6–7h', min: 6,   max: 7   },
  { label: '7–8h', min: 7,   max: 8   },
  { label: '8h+',  min: 8,   max: 99  },
]

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepository()
  const from90d = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  const from90dIso = from90d.toISOString().slice(0, 10)
  const todayIso = new Date().toISOString().slice(0, 10)

  const [workoutSessions, sleepSessions] = await Promise.all([
    repo.getWorkoutSessionsFrom(userId, from90d),
    repo.listSleepSessions(userId, from90dIso, todayIso),
  ])

  // Build map: date string → sleep duration that night (sleep ending on that date)
  const sleepByDate = new Map<string, number>()
  for (const s of sleepSessions) {
    if (s.durationHours != null) {
      sleepByDate.set(s.date, s.durationHours)
    }
  }

  // For each workout, find previous night's sleep
  const bucketData: Record<string, number[]> = { '<6h': [], '6–7h': [], '7–8h': [], '8h+': [] }

  for (const ws of workoutSessions) {
    const workoutDate = ws.startedAt.toISOString().slice(0, 10)
    // Previous calendar date
    const prevDate = new Date(ws.startedAt.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const sleepHours = sleepByDate.get(workoutDate) ?? sleepByDate.get(prevDate)
    if (sleepHours == null) continue

    const bucket = BUCKETS.find(b => sleepHours >= b.min && sleepHours < b.max)
    if (!bucket) continue

    for (const ex of ws.exercises) {
      if (ex.estimated1rm != null && ex.estimated1rm > 0) {
        bucketData[bucket.label].push(ex.estimated1rm)
      }
    }
  }

  const buckets = BUCKETS.map(b => {
    const vals = bucketData[b.label]
    return {
      label: b.label,
      avgOneRm: vals.length ? parseFloat((vals.reduce((a, v) => a + v, 0) / vals.length).toFixed(1)) : 0,
      count: vals.length,
    }
  }).filter(b => b.count > 0)

  const hasSufficientData = buckets.filter(b => b.count >= 3).length >= 2

  // Find best and worst buckets
  let insight = 'Not enough paired sleep + workout data yet.'
  if (hasSufficientData) {
    const sorted = [...buckets].filter(b => b.count >= 3).sort((a, b) => b.avgOneRm - a.avgOneRm)
    const best  = sorted[0]
    const worst = sorted[sorted.length - 1]
    const diff  = parseFloat(((best.avgOneRm - worst.avgOneRm) / worst.avgOneRm * 100).toFixed(1))
    if (diff > 2) {
      insight = `After ${best.label} sleep, average 1RM is ${diff}% higher than after ${worst.label} sleep.`
    } else {
      insight = 'Sleep duration shows minimal effect on 1RM in your data so far.'
    }
  }

  return NextResponse.json({ insight, buckets, hasSufficientData } satisfies SleepCorrelationResponse)
}
```

- [ ] **Step 9.2: Add insight card to stats-content.tsx**

Add state and fetch:
```ts
const [sleepCorr, setSleepCorr] = useState<import('@/app/api/sleep-performance-correlation/route').SleepCorrelationResponse | null>(null)

useEffect(() => {
  fetch('/api/sleep-performance-correlation')
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d) setSleepCorr(d) })
    .catch(() => {})
}, [])
```

In the JSX, after the ACWR card, add:
```tsx
{sleepCorr && (
  <div className="mx-4 rounded-2xl border border-border p-4">
    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Sleep vs Performance</p>
    <p className="text-sm font-medium mb-3">{sleepCorr.insight}</p>
    {sleepCorr.hasSufficientData && (
      <div className="flex gap-2">
        {sleepCorr.buckets.map(b => (
          <div key={b.label} className="flex-1 rounded-xl bg-muted/60 p-2 text-center">
            <p className="text-[10px] text-muted-foreground">{b.label}</p>
            <p className="text-sm font-bold" style={{ color: 'var(--color-brand)' }}>{b.avgOneRm > 0 ? `${b.avgOneRm}kg` : '—'}</p>
            <p className="text-[9px] text-muted-foreground">{b.count} sessions</p>
          </div>
        ))}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 9.3: Commit**

```bash
git add app/api/sleep-performance-correlation/route.ts app/stats/stats-content.tsx
git commit -m "feat: sleep vs performance correlation insight on stats page"
```

**How to verify:** Go to Stats. If 90+ days of workout data exists with sleep sessions, a "Sleep vs Performance" card appears with avg 1RM by sleep duration bucket. The insight text shows the highest-performance sleep range.

---

## Task 10: Weekly AI Digest

**Files:**
- Create: `app/api/weekly-digest/route.ts`
- Modify: `app/stats/stats-content.tsx`

On-demand Gemini summary of the past week. Cached in localStorage with a weekly key so it's only regenerated once per week unless the user taps "Regenerate".

- [ ] **Step 10.1: Create `/api/weekly-digest` route**

```ts
// app/api/weekly-digest/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { google } from '@ai-sdk/google'
import { generateText } from 'ai'

export async function POST() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepository()
  const from14d = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
  const todayIso = new Date().toISOString().slice(0, 10)
  const from14dIso = from14d.toISOString().slice(0, 10)

  const [sessions, bodyMetrics, sleepSessions] = await Promise.all([
    repo.getWorkoutSessionsFrom(userId, from14d),
    repo.listBodyMetrics(userId, from14dIso, todayIso),
    repo.listSleepSessions(userId, from14dIso, todayIso),
  ])

  const thisWeekSessions = sessions.filter(ws => ws.startedAt >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
  const lastWeekSessions = sessions.filter(ws => ws.startedAt < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))

  const thisWeekVol  = thisWeekSessions.reduce((s, ws) => s + ws.exercises.reduce((e, ex) => e + (ex.volume ?? 0), 0), 0)
  const lastWeekVol  = lastWeekSessions.reduce((s, ws) => s + ws.exercises.reduce((e, ex) => e + (ex.volume ?? 0), 0), 0)

  const recentWeight = bodyMetrics.filter(m => m.weightKg != null).sort((a, b) => b.date.localeCompare(a.date))
  const weightChange = recentWeight.length >= 2
    ? parseFloat((recentWeight[0].weightKg! - recentWeight[recentWeight.length - 1].weightKg!).toFixed(1))
    : null

  const avgSleep = sleepSessions.length
    ? (sleepSessions.reduce((s, r) => s + (r.durationHours ?? 0), 0) / sleepSessions.length).toFixed(1)
    : null

  const context = `
This week: ${thisWeekSessions.length} sessions, ${Math.round(thisWeekVol)}kg total volume.
Last week: ${lastWeekSessions.length} sessions, ${Math.round(lastWeekVol)}kg total volume.
${weightChange != null ? `Body weight change (2 weeks): ${weightChange > 0 ? '+' : ''}${weightChange}kg` : ''}
${avgSleep ? `Average sleep this week: ${avgSleep}h` : ''}
`.trim()

  const { text } = await generateText({
    model: google('gemini-3.1-flash-lite'),
    prompt: `You are a personal training coach. Write a concise weekly digest (3–5 bullet points, max 150 words) based on this data. Be specific and encouraging. Focus on what went well and one actionable tip for next week.\n\n${context}`,
  })

  return NextResponse.json({ digest: text, generatedAt: new Date().toISOString() })
}
```

- [ ] **Step 10.2: Add weekly digest card to stats-content.tsx**

Add state and a week-keyed localStorage cache:

```ts
const DIGEST_KEY = `ta_weekly_digest_${new Date().toISOString().slice(0, 7)}` // e.g. ta_weekly_digest_2026-05
const [digest, setDigest] = useState<string | null>(null)
const [digestLoading, setDigestLoading] = useState(false)

useEffect(() => {
  try {
    const cached = localStorage.getItem(DIGEST_KEY)
    if (cached) setDigest(cached)
  } catch { /* ignore */ }
}, [])

async function generateDigest() {
  setDigestLoading(true)
  try {
    const res = await fetch('/api/weekly-digest', { method: 'POST' })
    const d = await res.json()
    if (d.digest) {
      setDigest(d.digest)
      localStorage.setItem(DIGEST_KEY, d.digest)
    }
  } catch { /* ignore */ }
  finally { setDigestLoading(false) }
}
```

In the JSX, before the calendar widget, add:
```tsx
<div className="mx-4 rounded-2xl border border-border p-4">
  <div className="flex items-center justify-between mb-2">
    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Weekly Digest</p>
    <button
      onClick={generateDigest}
      disabled={digestLoading}
      className="text-[10px] text-brand underline disabled:opacity-50"
    >
      {digestLoading ? 'Generating…' : digest ? 'Regenerate' : 'Generate'}
    </button>
  </div>
  {digest ? (
    <p className="text-sm leading-relaxed whitespace-pre-line">{digest}</p>
  ) : (
    <p className="text-xs text-muted-foreground">Tap Generate for an AI summary of your week.</p>
  )}
</div>
```

- [ ] **Step 10.3: Commit**

```bash
git add app/api/weekly-digest/route.ts app/stats/stats-content.tsx
git commit -m "feat: weekly AI digest card on stats page using Gemini"
```

**How to verify:** Go to Stats. A "Weekly Digest" card appears with a "Generate" button. Tapping it calls Gemini and renders a 3–5 bullet summary. Refreshing the page shows the cached digest (stored by month key in localStorage).

---

## Task 11: Hardcoded Session Name Cleanup

**Files:**
- Modify: `components/workout/utils.ts`
- Modify: `components/weights-summary.tsx`
- Modify: `components/ai-chat-overlay.tsx`
- Modify: `components/stats/exercise-library-search.tsx`
- Modify: `components/config-screen.tsx`
- Modify: `components/overview-screen.tsx`
- Modify: `components/calendar-widget.tsx`
- Modify: `app/history/history-content.tsx`
- Modify: `app/stats/stats-content.tsx`
- Modify: `app/session-select/session-select-content.tsx`
- Modify: `app/workout-select/workout-select-content.tsx`

- [ ] **Step 11.1: Remove SESSION_TO_TAB from utils.ts**

In `components/workout/utils.ts`, delete the entire `SESSION_TO_TAB` block:
```ts
// DELETE these 5 lines:
export const SESSION_TO_TAB: Record<string, string> = {
  Push: "push",
  Pull: "pull",
  Legs: "legs",
};
```

Verify nothing imports it: `grep -r "SESSION_TO_TAB" src/ components/ app/` — if any import exists, remove it there too. Based on current grep results, nothing else imports it.

- [ ] **Step 11.2: Fix weights-summary.tsx dynamic grouping**

Replace the hardcoded `TAB_ORDER` with dynamic session names derived from exercises:

```tsx
// Delete:
const TAB_ORDER = ["Push", "Pull", "Legs"];

// Replace the component body's `grouped` derivation with:
const sessionNames = [...new Set(exercises.map(e => e.sessionName))].sort()
const grouped = sessionNames.reduce<Record<string, ExerciseSummary[]>>((acc, tab) => {
  acc[tab] = exercises.filter(e => e.sessionName === tab)
  return acc
}, {})

// In JSX, replace TAB_ORDER.map(...) with sessionNames.map(...)
```

- [ ] **Step 11.3: Remove FALLBACK_SESSION_NAMES from ai-chat-overlay.tsx**

Delete:
```ts
const FALLBACK_SESSION_NAMES = ["Push", "Pull", "Legs"];
```

Change the `suggestions` useMemo to use an empty fallback:
```ts
const suggestions = useMemo(() => {
  const sessionSuggestions = (sessionNames ?? []).map(n => `Show my ${n} progression over time`)
  return [
    "Show my body weight progression over time",
    ...sessionSuggestions,
    "Show me this week's overview",
  ]
}, [sessionNames])
```

- [ ] **Step 11.4: Fix exercise-library-search.tsx filter tabs**

The `FILTERS` constant maps muscle groups to Push/Pull/Legs/Core labels — this is actually a useful *muscle-movement* categorisation, not a session-name assumption. Keep the muscle→category mapping but rename the UI labels to be movement-pattern names rather than session names.

Replace:
```ts
const FILTERS = ["All", "Push", "Pull", "Legs", "Core"] as const;
```

With:
```ts
const FILTERS = ["All", "Push", "Pull", "Legs", "Core"] as const;
// Note: these are movement pattern labels (Push = pressing, Pull = rowing/pulling, Legs = lower body)
// NOT session names — keep as-is but document the distinction
```

Actually the mapping (`Chest: "Push"`, `Back: "Pull"` etc.) is muscle→movement-pattern, which is stable regardless of session names. Leave the filter labels unchanged — they describe movement patterns, not sessions. This is acceptable as-is. Skip this sub-step.

- [ ] **Step 11.5: Fix DEFAULT_SESSIONS in config-screen.tsx**

```ts
// Delete:
const DEFAULT_SESSIONS: EditableSession[] = [
  { name: "Push", exercises: [] },
  { name: "Pull", exercises: [] },
  { name: "Legs", exercises: [] },
];

// Replace with:
const DEFAULT_SESSIONS: EditableSession[] = [];
```

Find the two uses of `DEFAULT_SESSIONS` in config-screen.tsx:
1. `const [programSessions, setProgramSessions] = useState<EditableSession[]>(DEFAULT_SESSIONS)` — now initialises to `[]`
2. `setProgramSessions(DEFAULT_SESSIONS.map(...))` on new program creation — change to `setProgramSessions([])`

- [ ] **Step 11.6: Replace all FALLBACK_SESSIONS arrays with []**

In each of these files, find the `FALLBACK_SESSIONS` constant and change the initial state to `[]`:

**`app/session-select/session-select-content.tsx`:**
```ts
// Delete the FALLBACK_SESSIONS const block (lines 26-30)
// Change initial state:
const [activeSessions, setActiveSessions] = useState<ProgramSession[]>([])
// In the cachedFetch callback, remove the FALLBACK_SESSIONS fallback:
return d?.program?.sessions?.length ? d.program.sessions : []
// and in the catch:
} catch { return [] }
```

**`app/stats/stats-content.tsx`:**
```ts
// Delete the FALLBACK_SESSIONS const block (lines 21-25)
const [activeSessions, setActiveSessions] = useState<ProgramSession[]>([])
```

**`app/workout-select/workout-select-content.tsx`:**
```ts
// Delete the FALLBACK_SESSIONS const block
const [sessions, setSessions] = useState<ProgramSession[]>([])
// In the cachedFetch callback:
(meta) => { setSessions(meta?.program?.sessions ?? []) }
// Remove remaining FALLBACK_SESSIONS references
```

**`components/overview-screen.tsx`:**
```ts
// Delete the FALLBACK_SESSIONS const block
const [activeSessions, setActiveSessions] = useState<ProgramSession[]>([])
```

**`components/calendar-widget.tsx`:**
```ts
// Delete the FALLBACK_SESSIONS const block
const [programSessions, setProgramSessions] = useState<ProgramSession[]>([])
```

**`app/history/history-content.tsx`:**
```ts
// Delete the FALLBACK_SESSIONS const block
const [activeSessions, setActiveSessions] = useState<ProgramSession[]>([])
```

- [ ] **Step 11.7: Verify the app still loads**

After these changes, screens that previously showed "Push / Pull / Legs" tabs during initial load will briefly show an empty state before the API responds. This is correct behaviour — the content loads as soon as the real program data arrives.

Check that calendar-widget.tsx still functions: the `FALLBACK_SESSIONS` there provided legend entries during load. Without it, the legend will be empty until the program loads. That's acceptable.

- [ ] **Step 11.8: Commit**

```bash
git add components/workout/utils.ts components/weights-summary.tsx components/ai-chat-overlay.tsx \
  components/config-screen.tsx components/overview-screen.tsx components/calendar-widget.tsx \
  app/history/history-content.tsx app/stats/stats-content.tsx \
  app/session-select/session-select-content.tsx app/workout-select/workout-select-content.tsx
git commit -m "fix: remove all hardcoded Push/Pull/Legs session name assumptions"
```

**How to verify:**
- Open the app fresh. Screens should load cleanly with no "Push/Pull/Legs" placeholders.
- The calendar legend is empty for a moment, then shows your real session names once `/api/workout-data` responds.
- Creating a new program in Config starts with zero sessions, not three pre-named ones.
- The AI chat suggestions show your real session names.
- Exercise library search still works (Push/Pull/Legs/Core filter tabs are movement patterns, not sessions — they remain).

---

## Final Steps: Push to main

- [ ] **Push feature branch to origin**

```bash
git push -u origin claude/charming-heisenberg-daZlE
```

- [ ] **Merge to main** (user has approved)

```bash
git checkout main
git merge --no-ff claude/charming-heisenberg-daZlE -m "feat: Tier 1–3 feature batch (admin badge, chat truncation, program weeks, workout start time, lean mass, ACWR, PRs, readiness score, sleep correlation, weekly digest, hardcoded-session cleanup)"
git push origin main
```

- [ ] **Update projectOverview.md** with session summary, bump version in package.json, add changelog entry

---

## DB Migrations Needed on Railway

After deploying, run this against the Railway Postgres database:

```sql
-- 017_personal_records.sql
CREATE TABLE IF NOT EXISTS personal_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_name TEXT NOT NULL,
  estimated_1rm DOUBLE PRECISION NOT NULL,
  achieved_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, exercise_name)
);
```

All other changes are code-only (no schema changes).

---

## Testing Checklist (Pull Command + What to Check)

```bash
git pull origin main
```

| Feature | Where | What to look for |
|---|---|---|
| Admin badge | Profile → Admin Console row | Red badge showing pending user count (or hidden if none) |
| AI truncation | AI Chat → long conversation | Responses still coherent after 20+ exchanges |
| Program weeks | Profile → stats strip | "Xw / On program" (or "⚠️ Review?" at 12+w) |
| Workout start time | Stats → calendar day overlay | Duration reflects actual elapsed time, not just inter-exercise gap |
| Lean mass | Health → Body tab | Purple "Lean Mass" card with sparkline (requires weight + BF data) |
| ACWR | Stats page | Training load card with ratio and colour-coded status |
| PR tracker | Complete a heavy set → Done screen | Gold "🏆 Personal Records" card; also check exercise stats sheet for all-time 1RM |
| Readiness score | Home screen | Score card (hidden until HRV/RHR baseline accumulates — 5+ days) |
| Sleep correlation | Stats page | "Sleep vs Performance" card with bucket bars |
| Weekly digest | Stats page | "Weekly Digest" card with Generate button |
| Hardcoded cleanup | Config → New Program | Starts with 0 sessions not 3; Calendar legend is blank then fills dynamically |
