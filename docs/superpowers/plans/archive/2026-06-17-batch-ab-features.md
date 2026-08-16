# Batch A+B Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship five features: calendar legend truncation fix, user feedback submission system, injury log with heatmap + workout warnings, and supplement log with daily check-ins and reminders.

**Architecture:** All features follow the project's standard stack (PostgreSQL migrations → Drizzle schema → repository interface → adapter → API routes → UI components). Feedback goes user→DB→admin console. Injuries surface in Health>Body and the workout screen. Supplements live in the Nutrition tab with Capacitor local notifications for reminders.

**Tech Stack:** Next.js 15, React 19, TypeScript, Drizzle ORM, PostgreSQL, Tailwind CSS v4, Radix UI, `@capacitor/local-notifications`, `@dnd-kit/react` (reorder), Vitest (tests)

---

## File Map

**New files:**
- `lib/data/postgres/migrations/074_feedback_submissions.sql`
- `lib/data/postgres/migrations/075_injuries.sql`
- `lib/data/postgres/migrations/076_supplements.sql`
- `lib/types/injury.ts`
- `lib/types/supplement.ts`
- `app/api/feedback/route.ts`
- `app/api/admin/feedback/route.ts`
- `app/api/admin/feedback/[id]/route.ts`
- `app/api/injuries/route.ts`
- `app/api/injuries/[id]/route.ts`
- `app/api/supplements/route.ts`
- `app/api/supplements/[id]/route.ts`
- `app/api/supplements/[id]/log/route.ts`
- `components/more/feedback-section.tsx`
- `components/more/feedback-sheet.tsx`
- `components/health/injury-card.tsx`
- `components/health/injury-sheet.tsx`
- `components/nutrition/supplements-section.tsx`
- `components/nutrition/manage-supplements-sheet.tsx`
- `lib/supplement-reminders.ts`
- `lib/__tests__/supplement-reminders.test.ts`

**Modified files:**
- `components/calendar-widget.tsx` — add `truncate max-w-[96px]` to legend session name spans
- `lib/data/postgres/schema.ts` — add feedbackSubmissions, injuries, supplements, supplementLogs tables
- `lib/data/repository.ts` — add feedback, injury, supplement methods
- `lib/data/postgres/adapter.ts` — implement all new methods
- `app/api/admin/pending-count/route.ts` — also return `feedbackCount`
- `app/admin/admin-content.tsx` — add Feedback 6th tab
- `components/more/profile-tab.tsx` — add FeedbackSection, feedback badge on admin link
- `components/muscle-heatmap.tsx` — add `'injured'` role → red `#ef4444`
- `app/health/health-content.tsx` — add InjuryCard to Body tab
- `components/workout-screen.tsx` — fetch active injuries on workout start, pass to ActiveWorkoutScreen
- `components/workout/active-workout-screen.tsx` — add `activeInjuries` prop + warning banner
- `app/nutrition/nutrition-content.tsx` — add SupplementsSection
- `components/sync-provider.tsx` — add supplement reminder reconciliation
- `lib/cache-groups.ts` — add supplement/injury cache invalidation

---

## Task 1: Feature branch + DB migrations

**Files:**
- Create: `lib/data/postgres/migrations/074_feedback_submissions.sql`
- Create: `lib/data/postgres/migrations/075_injuries.sql`
- Create: `lib/data/postgres/migrations/076_supplements.sql`

- [ ] **Step 1: Create feature branch**

```bash
git checkout -b feat/batch-ab-features
```

- [ ] **Step 2: Create migration 074**

`lib/data/postgres/migrations/074_feedback_submissions.sql`:
```sql
CREATE TABLE IF NOT EXISTS feedback_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('bug', 'feature', 'other')),
  title TEXT NOT NULL,
  description TEXT,
  screenshot_data TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 3: Create migration 075**

`lib/data/postgres/migrations/075_injuries.sql`:
```sql
CREATE TABLE IF NOT EXISTS injuries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muscle_name TEXT NOT NULL,
  notes TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('mild', 'moderate', 'severe')),
  started_date DATE NOT NULL,
  resolved_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 4: Create migration 076**

`lib/data/postgres/migrations/076_supplements.sql`:
```sql
CREATE TABLE IF NOT EXISTS supplements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  dose TEXT,
  reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  reminder_time TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplement_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplement_id UUID NOT NULL REFERENCES supplements(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (supplement_id, log_date)
);
```

- [ ] **Step 5: Apply migrations to local DB**

```bash
node scripts/local-db/migrate.js
```

Expected: no error output, migrations applied.

- [ ] **Step 6: Commit**

```bash
git add lib/data/postgres/migrations/074_feedback_submissions.sql \
        lib/data/postgres/migrations/075_injuries.sql \
        lib/data/postgres/migrations/076_supplements.sql
git commit -m "feat: DB migrations for feedback, injuries, supplements"
```

---

## Task 2: Drizzle schema + type files

**Files:**
- Modify: `lib/data/postgres/schema.ts`
- Create: `lib/types/injury.ts`
- Create: `lib/types/supplement.ts`

- [ ] **Step 1: Add Drizzle tables to schema.ts**

At the bottom of `lib/data/postgres/schema.ts`, append:

```ts
export const feedbackSubmissions = pgTable('feedback_submissions', {
  id:             uuid('id').primaryKey().defaultRandom(),
  userId:         uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type:           text('type').notNull(),
  title:          text('title').notNull(),
  description:    text('description'),
  screenshotData: text('screenshot_data'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const injuries = pgTable('injuries', {
  id:           uuid('id').primaryKey().defaultRandom(),
  userId:       uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  muscleName:   text('muscle_name').notNull(),
  notes:        text('notes'),
  severity:     text('severity').notNull(),
  startedDate:  date('started_date', { mode: 'string' }).notNull(),
  resolvedDate: date('resolved_date', { mode: 'string' }),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const supplements = pgTable('supplements', {
  id:              uuid('id').primaryKey().defaultRandom(),
  userId:          uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:            text('name').notNull(),
  dose:            text('dose'),
  reminderEnabled: boolean('reminder_enabled').notNull().default(false),
  reminderTime:    text('reminder_time'),
  sortOrder:       integer('sort_order').notNull().default(0),
  active:          boolean('active').notNull().default(true),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const supplementLogs = pgTable('supplement_logs', {
  id:           uuid('id').primaryKey().defaultRandom(),
  supplementId: uuid('supplement_id').notNull().references(() => supplements.id, { onDelete: 'cascade' }),
  userId:       uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  logDate:      date('log_date', { mode: 'string' }).notNull(),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.supplementId, t.logDate)])
```

- [ ] **Step 2: Create `lib/types/injury.ts`**

```ts
export interface Injury {
  id: string
  userId: string
  muscleName: string
  notes: string | null
  severity: 'mild' | 'moderate' | 'severe'
  startedDate: string   // "YYYY-MM-DD"
  resolvedDate: string | null
  createdAt: string
}
```

- [ ] **Step 3: Create `lib/types/supplement.ts`**

```ts
export interface Supplement {
  id: string
  userId: string
  name: string
  dose: string | null
  reminderEnabled: boolean
  reminderTime: string | null  // "HH:MM" 24h
  sortOrder: number
  active: boolean
  createdAt: string
}

export interface SupplementWithStatus extends Supplement {
  loggedToday: boolean
}
```

- [ ] **Step 4: Check TypeScript compiles**

```bash
pnpm exec tsc --noEmit 2>&1 | head -30
```

Expected: no errors on the new files.

- [ ] **Step 5: Commit**

```bash
git add lib/data/postgres/schema.ts lib/types/injury.ts lib/types/supplement.ts
git commit -m "feat: Drizzle schema and types for feedback, injuries, supplements"
```

---

## Task 3: Repository interface additions

**Files:**
- Modify: `lib/data/repository.ts`

- [ ] **Step 1: Add feedback methods to the interface**

Open `lib/data/repository.ts`. Before the closing `}` of the `WorkoutRepository` interface (after the Sync section at the end), add:

```ts
  // ── Feedback ───────────────────────────────────────────────────────────────
  createFeedback(userId: string, data: { type: string; title: string; description?: string | null; screenshotData?: string | null }): Promise<void>
  listFeedback(): Promise<{ id: string; type: string; title: string; description: string | null; screenshotData: string | null; createdAt: string; userEmail: string; userName: string | null }[]>
  deleteFeedback(id: string): Promise<void>
  countFeedback(): Promise<number>

  // ── Injuries ───────────────────────────────────────────────────────────────
  listInjuries(userId: string): Promise<import('@/lib/types/injury').Injury[]>
  createInjury(userId: string, data: Omit<import('@/lib/types/injury').Injury, 'id' | 'userId' | 'createdAt'>): Promise<import('@/lib/types/injury').Injury>
  updateInjury(id: string, userId: string, data: Partial<Omit<import('@/lib/types/injury').Injury, 'id' | 'userId' | 'createdAt'>>): Promise<import('@/lib/types/injury').Injury>
  deleteInjury(id: string, userId: string): Promise<void>

  // ── Supplements ────────────────────────────────────────────────────────────
  listSupplements(userId: string, date: string): Promise<import('@/lib/types/supplement').SupplementWithStatus[]>
  createSupplement(userId: string, data: Omit<import('@/lib/types/supplement').Supplement, 'id' | 'userId' | 'createdAt'>): Promise<import('@/lib/types/supplement').Supplement>
  updateSupplement(id: string, userId: string, data: Partial<Omit<import('@/lib/types/supplement').Supplement, 'id' | 'userId' | 'createdAt'>>): Promise<import('@/lib/types/supplement').Supplement>
  deleteSupplement(id: string, userId: string): Promise<void>
  logSupplement(supplementId: string, userId: string, date: string): Promise<void>
  unlogSupplement(supplementId: string, userId: string, date: string): Promise<void>
```

- [ ] **Step 2: Check TypeScript**

```bash
pnpm exec tsc --noEmit 2>&1 | head -30
```

Expected: errors only from adapter.ts (interface not yet implemented there). No errors in repository.ts itself.

- [ ] **Step 3: Commit**

```bash
git add lib/data/repository.ts
git commit -m "feat: repository interface for feedback, injuries, supplements"
```

---

## Task 4: Adapter implementations

**Files:**
- Modify: `lib/data/postgres/adapter.ts`

Add these methods at the end of the `PostgresWorkoutRepository` class (before the closing `}`). The adapter file already imports `eq`, `and`, `asc`, `desc`, `inArray`, `isNull` from `drizzle-orm` and all schema tables as `s`.

- [ ] **Step 1: Add imports needed**

At the top of `lib/data/postgres/adapter.ts`, add to the existing type imports:

```ts
import type { Injury } from '@/lib/types/injury'
import type { Supplement, SupplementWithStatus } from '@/lib/types/supplement'
```

- [ ] **Step 2: Add row mappers**

Inside the `PostgresWorkoutRepository` class, after the last `private rowTo...` method, add:

```ts
  private rowToInjury(r: typeof s.injuries.$inferSelect): Injury {
    return {
      id: r.id,
      userId: r.userId,
      muscleName: r.muscleName,
      notes: r.notes ?? null,
      severity: r.severity as Injury['severity'],
      startedDate: r.startedDate,
      resolvedDate: r.resolvedDate ?? null,
      createdAt: r.createdAt.toISOString(),
    }
  }

  private rowToSupplement(r: typeof s.supplements.$inferSelect): Supplement {
    return {
      id: r.id,
      userId: r.userId,
      name: r.name,
      dose: r.dose ?? null,
      reminderEnabled: r.reminderEnabled,
      reminderTime: r.reminderTime ?? null,
      sortOrder: r.sortOrder,
      active: r.active,
      createdAt: r.createdAt.toISOString(),
    }
  }
```

- [ ] **Step 3: Add feedback methods**

Inside the `PostgresWorkoutRepository` class, add:

```ts
  async createFeedback(userId: string, data: { type: string; title: string; description?: string | null; screenshotData?: string | null }): Promise<void> {
    await this.db.insert(s.feedbackSubmissions).values({
      userId,
      type: data.type,
      title: data.title,
      description: data.description ?? null,
      screenshotData: data.screenshotData ?? null,
    })
  }

  async listFeedback(): Promise<{ id: string; type: string; title: string; description: string | null; screenshotData: string | null; createdAt: string; userEmail: string; userName: string | null }[]> {
    const rows = await this.db
      .select({
        id: s.feedbackSubmissions.id,
        type: s.feedbackSubmissions.type,
        title: s.feedbackSubmissions.title,
        description: s.feedbackSubmissions.description,
        screenshotData: s.feedbackSubmissions.screenshotData,
        createdAt: s.feedbackSubmissions.createdAt,
        userEmail: s.users.email,
        userName: s.users.displayName,
      })
      .from(s.feedbackSubmissions)
      .innerJoin(s.users, eq(s.feedbackSubmissions.userId, s.users.id))
      .orderBy(desc(s.feedbackSubmissions.createdAt))
    return rows.map(r => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    }))
  }

  async deleteFeedback(id: string): Promise<void> {
    await this.db.delete(s.feedbackSubmissions).where(eq(s.feedbackSubmissions.id, id))
  }

  async countFeedback(): Promise<number> {
    const rows = await this.db.select({ id: s.feedbackSubmissions.id }).from(s.feedbackSubmissions)
    return rows.length
  }
```

- [ ] **Step 4: Add injury methods**

```ts
  async listInjuries(userId: string): Promise<Injury[]> {
    const rows = await this.db.select().from(s.injuries)
      .where(eq(s.injuries.userId, userId))
      .orderBy(asc(s.injuries.startedDate))
    return rows.map(r => this.rowToInjury(r))
  }

  async createInjury(userId: string, data: Omit<Injury, 'id' | 'userId' | 'createdAt'>): Promise<Injury> {
    const [r] = await this.db.insert(s.injuries).values({
      userId,
      muscleName: data.muscleName,
      notes: data.notes ?? null,
      severity: data.severity,
      startedDate: data.startedDate,
      resolvedDate: data.resolvedDate ?? null,
    }).returning()
    return this.rowToInjury(r)
  }

  async updateInjury(id: string, userId: string, data: Partial<Omit<Injury, 'id' | 'userId' | 'createdAt'>>): Promise<Injury> {
    const [r] = await this.db.update(s.injuries)
      .set({
        muscleName: data.muscleName,
        notes: data.notes ?? null,
        severity: data.severity,
        startedDate: data.startedDate,
        resolvedDate: data.resolvedDate ?? null,
      })
      .where(and(eq(s.injuries.id, id), eq(s.injuries.userId, userId)))
      .returning()
    if (!r) throw new Error('Injury not found')
    return this.rowToInjury(r)
  }

  async deleteInjury(id: string, userId: string): Promise<void> {
    await this.db.delete(s.injuries)
      .where(and(eq(s.injuries.id, id), eq(s.injuries.userId, userId)))
  }
```

- [ ] **Step 5: Add supplement methods**

```ts
  async listSupplements(userId: string, date: string): Promise<SupplementWithStatus[]> {
    const rows = await this.db.select().from(s.supplements)
      .where(eq(s.supplements.userId, userId))
      .orderBy(asc(s.supplements.sortOrder), asc(s.supplements.createdAt))
    const logs = await this.db.select({ supplementId: s.supplementLogs.supplementId })
      .from(s.supplementLogs)
      .where(and(eq(s.supplementLogs.userId, userId), eq(s.supplementLogs.logDate, date)))
    const loggedIds = new Set(logs.map(l => l.supplementId))
    return rows.map(r => ({ ...this.rowToSupplement(r), loggedToday: loggedIds.has(r.id) }))
  }

  async createSupplement(userId: string, data: Omit<Supplement, 'id' | 'userId' | 'createdAt'>): Promise<Supplement> {
    const [r] = await this.db.insert(s.supplements).values({ userId, ...data }).returning()
    return this.rowToSupplement(r)
  }

  async updateSupplement(id: string, userId: string, data: Partial<Omit<Supplement, 'id' | 'userId' | 'createdAt'>>): Promise<Supplement> {
    const [r] = await this.db.update(s.supplements)
      .set(data)
      .where(and(eq(s.supplements.id, id), eq(s.supplements.userId, userId)))
      .returning()
    if (!r) throw new Error('Supplement not found')
    return this.rowToSupplement(r)
  }

  async deleteSupplement(id: string, userId: string): Promise<void> {
    await this.db.delete(s.supplements)
      .where(and(eq(s.supplements.id, id), eq(s.supplements.userId, userId)))
  }

  async logSupplement(supplementId: string, userId: string, date: string): Promise<void> {
    await this.db.insert(s.supplementLogs)
      .values({ supplementId, userId, logDate: date })
      .onConflictDoNothing()
  }

  async unlogSupplement(supplementId: string, userId: string, date: string): Promise<void> {
    await this.db.delete(s.supplementLogs)
      .where(and(
        eq(s.supplementLogs.supplementId, supplementId),
        eq(s.supplementLogs.userId, userId),
        eq(s.supplementLogs.logDate, date),
      ))
  }
```

- [ ] **Step 6: Check TypeScript**

```bash
pnpm exec tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/data/postgres/adapter.ts lib/types/injury.ts lib/types/supplement.ts
git commit -m "feat: adapter implementations for feedback, injuries, supplements"
```

---

## Task 5: Calendar legend fix

**Files:**
- Modify: `components/calendar-widget.tsx`

The legend already calls `shortSessionName(s.name)` which truncates at 14 chars. The fix adds CSS truncation to prevent layout breaks with 4+ sessions.

- [ ] **Step 1: Add truncate class to legend text span**

In `components/calendar-widget.tsx`, find the legend section (around line 192):

```tsx
<span className="text-[10px] text-muted-foreground">{shortSessionName(s.name)}</span>
```

Change to:

```tsx
<span className="text-[10px] text-muted-foreground truncate max-w-[96px]">{shortSessionName(s.name)}</span>
```

- [ ] **Step 2: Commit**

```bash
git add components/calendar-widget.tsx
git commit -m "fix: truncate calendar legend session names to prevent overflow"
```

---

## Task 6: Feedback API routes

**Files:**
- Create: `app/api/feedback/route.ts`
- Create: `app/api/admin/feedback/route.ts`
- Create: `app/api/admin/feedback/[id]/route.ts`
- Modify: `app/api/admin/pending-count/route.ts`

- [ ] **Step 1: Create `app/api/feedback/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { type, title, description, screenshotData } = body

  if (!type || !['bug', 'feature', 'other'].includes(type)) {
    return NextResponse.json({ error: 'type must be bug, feature, or other' }, { status: 400 })
  }
  if (!title?.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  const repo = await getRepository()
  await repo.createFeedback(session.user.id, {
    type,
    title: title.trim(),
    description: description?.trim() || null,
    screenshotData: screenshotData || null,
  })
  return NextResponse.json({ ok: true }, { status: 201 })
}
```

- [ ] **Step 2: Create `app/api/admin/feedback/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin } from '@/lib/admin'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
    const repo = await getRepository()
    const submissions = await repo.listFeedback()
    return NextResponse.json(submissions)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
}
```

- [ ] **Step 3: Create `app/api/admin/feedback/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin } from '@/lib/admin'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
    const { id } = await params
    const repo = await getRepository()
    await repo.deleteFeedback(id)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
}
```

- [ ] **Step 4: Update `app/api/admin/pending-count/route.ts`**

Replace the entire file:

```ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin } from '@/lib/admin'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
    const repo = await getRepository()
    const [users, feedbackCount] = await Promise.all([
      repo.listUsers(),
      repo.countFeedback(),
    ])
    const count = users.filter(u => !u.isActive).length
    return NextResponse.json({ count, feedbackCount })
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
}
```

- [ ] **Step 5: Verify TypeScript**

```bash
pnpm exec tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/feedback/route.ts \
        app/api/admin/feedback/route.ts \
        "app/api/admin/feedback/[id]/route.ts" \
        app/api/admin/pending-count/route.ts
git commit -m "feat: feedback submission API routes"
```

---

## Task 7: Injury API routes

**Files:**
- Create: `app/api/injuries/route.ts`
- Create: `app/api/injuries/[id]/route.ts`

- [ ] **Step 1: Create `app/api/injuries/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { todayInTz } from '@/lib/date-utils'
import { DEFAULT_TZ } from '@/lib/date-utils'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const repo = await getRepository()
  const injuries = await repo.listInjuries(session.user.id)
  return NextResponse.json(injuries)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { muscleName, severity, notes, startedDate } = body

  if (!muscleName?.trim()) return NextResponse.json({ error: 'muscleName required' }, { status: 400 })
  if (!['mild', 'moderate', 'severe'].includes(severity)) return NextResponse.json({ error: 'invalid severity' }, { status: 400 })

  const tz = session.user.timezone ?? DEFAULT_TZ
  const date = startedDate ?? todayInTz(tz)

  const repo = await getRepository()
  const injury = await repo.createInjury(session.user.id, {
    muscleName: muscleName.trim(),
    severity,
    notes: notes?.trim() || null,
    startedDate: date,
    resolvedDate: null,
  })
  return NextResponse.json(injury, { status: 201 })
}
```

- [ ] **Step 2: Create `app/api/injuries/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const repo = await getRepository()
  const injury = await repo.updateInjury(id, session.user.id, body)
  return NextResponse.json(injury)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const repo = await getRepository()
  await repo.deleteInjury(id, session.user.id)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
pnpm exec tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add app/api/injuries/route.ts "app/api/injuries/[id]/route.ts"
git commit -m "feat: injury log API routes"
```

---

## Task 8: Supplement API routes

**Files:**
- Create: `app/api/supplements/route.ts`
- Create: `app/api/supplements/[id]/route.ts`
- Create: `app/api/supplements/[id]/log/route.ts`

- [ ] **Step 1: Create `app/api/supplements/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { todayInTz, DEFAULT_TZ } from '@/lib/date-utils'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tz = session.user.timezone ?? DEFAULT_TZ
  const repo = await getRepository()
  const supplements = await repo.listSupplements(session.user.id, todayInTz(tz))
  return NextResponse.json(supplements)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  if (!body.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const repo = await getRepository()
  const supplement = await repo.createSupplement(session.user.id, {
    name: body.name.trim(),
    dose: body.dose?.trim() || null,
    reminderEnabled: body.reminderEnabled ?? false,
    reminderTime: body.reminderTime ?? null,
    sortOrder: body.sortOrder ?? 0,
    active: body.active ?? true,
  })
  return NextResponse.json(supplement, { status: 201 })
}
```

- [ ] **Step 2: Create `app/api/supplements/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await req.json()
  const repo = await getRepository()
  const supplement = await repo.updateSupplement(id, session.user.id, body)
  return NextResponse.json(supplement)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const repo = await getRepository()
  await repo.deleteSupplement(id, session.user.id)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Create `app/api/supplements/[id]/log/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { todayInTz, DEFAULT_TZ } from '@/lib/date-utils'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const tz = session.user.timezone ?? DEFAULT_TZ
  const repo = await getRepository()
  await repo.logSupplement(id, session.user.id, todayInTz(tz))
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const tz = session.user.timezone ?? DEFAULT_TZ
  const repo = await getRepository()
  await repo.unlogSupplement(id, session.user.id, todayInTz(tz))
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Verify TypeScript**

```bash
pnpm exec tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
git add app/api/supplements/route.ts \
        "app/api/supplements/[id]/route.ts" \
        "app/api/supplements/[id]/log/route.ts"
git commit -m "feat: supplement API routes"
```

---

## Task 9: Supplement reminder library + tests

**Files:**
- Create: `lib/supplement-reminders.ts`
- Create: `lib/__tests__/supplement-reminders.test.ts`

- [ ] **Step 1: Create `lib/supplement-reminders.ts`**

```ts
import { Capacitor } from '@capacitor/core'
import type { SupplementWithStatus } from '@/lib/types/supplement'
import { todayInTz } from './date-utils'

export const SUPPLEMENT_REMINDERS_CHANNEL = 'supplement-reminders'
export const SUPPLEMENT_REMINDER_ROUTE = '/nutrition'

const ID_BASE = 8500
const ID_RANGE = 200
const NOTIFIED_TODAY_KEY = 'ta_supplement_reminder_notified_today'

export function supplementReminderNotificationId(supplementId: string): number {
  let hash = 0
  for (let i = 0; i < supplementId.length; i++) {
    hash = (hash * 31 + supplementId.charCodeAt(i)) | 0
  }
  return ID_BASE + (Math.abs(hash) % ID_RANGE)
}

export type SupplementReminderAction =
  | { supplementId: string; type: 'cancel' }
  | { supplementId: string; type: 'skip' }
  | { supplementId: string; type: 'immediate'; name: string }
  | { supplementId: string; type: 'scheduled'; at: Date; name: string }

export function computeSupplementReminderActions(
  supplements: SupplementWithStatus[],
  now: Date = new Date(),
  notifiedToday: Set<string> = new Set(),
): SupplementReminderAction[] {
  return supplements
    .filter(s => s.active && s.reminderEnabled && s.reminderTime)
    .map((s): SupplementReminderAction => {
      const supplementId = s.id

      if (s.loggedToday) {
        return { supplementId, type: 'cancel' }
      }

      const [hours, minutes] = s.reminderTime!.split(':').map(Number)
      const reminderAt = new Date(now)
      reminderAt.setHours(hours, minutes, 0, 0)

      if (now >= reminderAt) {
        if (notifiedToday.has(supplementId)) {
          return { supplementId, type: 'skip' }
        }
        return { supplementId, type: 'immediate', name: s.name }
      }

      return { supplementId, type: 'scheduled', at: reminderAt, name: s.name }
    })
}

function readNotifiedToday(): Record<string, string> {
  try {
    const raw = localStorage.getItem(NOTIFIED_TODAY_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeNotifiedToday(map: Record<string, string>): void {
  try {
    localStorage.setItem(NOTIFIED_TODAY_KEY, JSON.stringify(map))
  } catch {}
}

export async function reconcileSupplementReminders(
  supplements: SupplementWithStatus[],
  now: Date = new Date(),
): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const today = todayInTz()
    const notifiedMap = readNotifiedToday()
    const notifiedToday = new Set(
      Object.entries(notifiedMap).filter(([, date]) => date === today).map(([id]) => id),
    )
    const actions = computeSupplementReminderActions(supplements, now, notifiedToday)

    for (const action of actions) {
      const id = supplementReminderNotificationId(action.supplementId)
      if (action.type === 'skip') continue
      if (action.type === 'cancel') {
        await LocalNotifications.cancel({ notifications: [{ id }] })
        delete notifiedMap[action.supplementId]
        continue
      }
      const at = action.type === 'immediate' ? new Date(Date.now() + 2000) : action.at
      await LocalNotifications.schedule({
        notifications: [{
          id,
          title: 'Supplement reminder',
          body: `Don't forget to log ${action.name}!`,
          schedule: { at },
          channelId: SUPPLEMENT_REMINDERS_CHANNEL,
          extra: { route: SUPPLEMENT_REMINDER_ROUTE },
        }],
      })
      if (action.type === 'immediate') {
        notifiedMap[action.supplementId] = today
      }
    }
    writeNotifiedToday(notifiedMap)
  } catch {}
}

export async function cancelSupplementReminder(supplementId: string): Promise<void> {
  const map = readNotifiedToday()
  if (supplementId in map) {
    delete map[supplementId]
    writeNotifiedToday(map)
  }
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.cancel({ notifications: [{ id: supplementReminderNotificationId(supplementId) }] })
  } catch {}
}
```

- [ ] **Step 2: Create `lib/__tests__/supplement-reminders.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import {
  computeSupplementReminderActions,
  supplementReminderNotificationId,
  type SupplementReminderAction,
} from '../supplement-reminders'
import type { SupplementWithStatus } from '../types/supplement'

function makeSupplement(overrides: Partial<SupplementWithStatus> = {}): SupplementWithStatus {
  return {
    id: 'sup-1',
    userId: 'user-1',
    name: 'Creatine',
    dose: '5g',
    reminderEnabled: true,
    reminderTime: '08:00',
    sortOrder: 0,
    active: true,
    createdAt: new Date().toISOString(),
    loggedToday: false,
    ...overrides,
  }
}

describe('computeSupplementReminderActions', () => {
  it('cancels when supplement is already logged today', () => {
    const sup = makeSupplement({ loggedToday: true })
    const now = new Date('2026-06-17T09:00:00')
    const actions = computeSupplementReminderActions([sup], now)
    expect(actions).toEqual<SupplementReminderAction[]>([{ supplementId: 'sup-1', type: 'cancel' }])
  })

  it('cancels when reminderEnabled is false', () => {
    const sup = makeSupplement({ reminderEnabled: false })
    const now = new Date('2026-06-17T09:00:00')
    const actions = computeSupplementReminderActions([sup], now)
    expect(actions).toHaveLength(0)
  })

  it('skips supplements with no reminderTime', () => {
    const sup = makeSupplement({ reminderTime: null })
    const actions = computeSupplementReminderActions([sup])
    expect(actions).toHaveLength(0)
  })

  it('schedules notification before reminder time', () => {
    const sup = makeSupplement({ reminderTime: '08:00' })
    const now = new Date('2026-06-17T07:00:00')
    const actions = computeSupplementReminderActions([sup], now)
    expect(actions).toEqual<SupplementReminderAction[]>([{
      supplementId: 'sup-1',
      type: 'scheduled',
      at: new Date('2026-06-17T08:00:00'),
      name: 'Creatine',
    }])
  })

  it('fires immediate when past reminder time and not notified', () => {
    const sup = makeSupplement({ reminderTime: '08:00' })
    const now = new Date('2026-06-17T09:00:00')
    const actions = computeSupplementReminderActions([sup], now)
    expect(actions).toEqual<SupplementReminderAction[]>([{
      supplementId: 'sup-1',
      type: 'immediate',
      name: 'Creatine',
    }])
  })

  it('skips when past reminder time but already notified today', () => {
    const sup = makeSupplement({ reminderTime: '08:00' })
    const now = new Date('2026-06-17T09:00:00')
    const actions = computeSupplementReminderActions([sup], now, new Set(['sup-1']))
    expect(actions).toEqual<SupplementReminderAction[]>([{ supplementId: 'sup-1', type: 'skip' }])
  })

  it('fires immediate at exactly reminder time', () => {
    const sup = makeSupplement({ reminderTime: '08:00' })
    const now = new Date('2026-06-17T08:00:00')
    const actions = computeSupplementReminderActions([sup], now)
    expect(actions[0].type).toBe('immediate')
  })

  it('handles multiple supplements independently', () => {
    const creatine = makeSupplement({ id: 'sup-1', name: 'Creatine', reminderTime: '08:00', loggedToday: true })
    const magnesium = makeSupplement({ id: 'sup-2', name: 'Magnesium', reminderTime: '21:00', loggedToday: false })
    const now = new Date('2026-06-17T09:00:00')
    const actions = computeSupplementReminderActions([creatine, magnesium], now)
    expect(actions).toEqual<SupplementReminderAction[]>([
      { supplementId: 'sup-1', type: 'cancel' },
      { supplementId: 'sup-2', type: 'scheduled', at: new Date('2026-06-17T21:00:00'), name: 'Magnesium' },
    ])
  })
})

describe('supplementReminderNotificationId', () => {
  it('returns deterministic id for same supplement id', () => {
    expect(supplementReminderNotificationId('sup-abc')).toBe(supplementReminderNotificationId('sup-abc'))
  })

  it('returns id in 8500-8699 range', () => {
    const id = supplementReminderNotificationId('some-uuid-1234')
    expect(id).toBeGreaterThanOrEqual(8500)
    expect(id).toBeLessThanOrEqual(8699)
  })

  it('returns different ids for different supplement ids', () => {
    expect(supplementReminderNotificationId('sup-aaa')).not.toBe(supplementReminderNotificationId('sup-bbb'))
  })
})
```

- [ ] **Step 3: Run tests**

```bash
pnpm test 2>&1 | tail -20
```

Expected: all supplement-reminders tests pass.

- [ ] **Step 4: Commit**

```bash
git add lib/supplement-reminders.ts lib/__tests__/supplement-reminders.test.ts
git commit -m "feat: supplement reminder library with unit tests"
```

---

## Task 10: Muscle heatmap injured role

**Files:**
- Modify: `components/muscle-heatmap.tsx`

- [ ] **Step 1: Add 'injured' to MuscleActivation and buildBodyData**

In `components/muscle-heatmap.tsx`:

1. Change the `MuscleActivation` interface:

```ts
export interface MuscleActivation {
  muscle: string;
  role: "main" | "secondary" | "injured";
}
```

2. Add `INJURED_COLOR` constant after `SECONDARY_COLOR`:

```ts
const INJURED_COLOR = "#ef4444";
```

3. Change `buildBodyData` to accept `Map<string, "main" | "secondary" | "injured">` and handle the injured role:

```ts
function buildBodyData(activations: Map<string, "main" | "secondary" | "injured">): ExtendedBodyPart[] {
  const result: ExtendedBodyPart[] = [];
  for (const [muscle, role] of activations) {
    const slug = MUSCLE_TO_SLUG[norm(muscle)];
    if (slug) {
      const color = role === "injured" ? INJURED_COLOR : role === "main" ? PRIMARY_COLOR : SECONDARY_COLOR;
      result.push({ slug, color });
    }
  }
  return result;
}
```

4. Change the `activations` Map type inside `MuscleHeatmap`:

```ts
const activations = new Map<string, "main" | "secondary" | "injured">();
```

5. When `assignments` are provided, injured role takes precedence — update the loop:

```ts
if (assignments?.length) {
  for (const a of assignments) {
    const key = norm(a.muscle);
    // injured takes precedence over main/secondary
    if (a.role === "injured" || !activations.has(key)) {
      activations.set(key, a.role);
    }
  }
}
```

6. Update the legend to show injured colour when any activated muscle is injured:

In the legend `div` (before the grid), replace it with:

```tsx
{hasActivity && !compact && (
  <div className="flex items-center gap-4 mb-2 text-xs text-muted-foreground flex-wrap">
    {[...activations.values()].includes("main") && (
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: PRIMARY_COLOR }} />
        Primary
      </span>
    )}
    {[...activations.values()].includes("secondary") && (
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: SECONDARY_COLOR }} />
        Secondary
      </span>
    )}
    {[...activations.values()].includes("injured") && (
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: INJURED_COLOR }} />
        Injured
      </span>
    )}
  </div>
)}
```

- [ ] **Step 2: Check TypeScript**

```bash
pnpm exec tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/muscle-heatmap.tsx
git commit -m "feat: muscle heatmap supports 'injured' role in red"
```

---

## Task 11: Feedback user UI

**Files:**
- Create: `components/more/feedback-section.tsx`
- Create: `components/more/feedback-sheet.tsx`
- Modify: `components/more/profile-tab.tsx`

- [ ] **Step 1: Create `components/more/feedback-sheet.tsx`**

```tsx
"use client";

import { useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ImageIcon, XIcon } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type FeedbackType = "bug" | "feature" | "other";

const TYPE_LABELS: Record<FeedbackType, string> = {
  bug: "Bug",
  feature: "Feature Request",
  other: "Other",
};

async function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const MAX_WIDTH = 800;
      const scale = Math.min(1, MAX_WIDTH / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export function FeedbackSheet({ open, onOpenChange }: Props) {
  const [type, setType] = useState<FeedbackType | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setType(null);
    setTitle("");
    setDescription("");
    setScreenshot(null);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file);
      setScreenshot(compressed);
    } catch {
      toast.error("Failed to process image");
    }
    e.target.value = "";
  }

  async function handleSubmit() {
    if (!type || !title.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, title: title.trim(), description: description.trim() || null, screenshotData: screenshot }),
      });
      if (!res.ok) throw new Error();
      toast.success("Feedback submitted — thank you!");
      reset();
      onOpenChange(false);
    } catch {
      toast.error("Failed to submit feedback");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] flex flex-col">
        <SheetHeader className="border-b border-border/30 pb-3 shrink-0">
          <SheetTitle>Submit Feedback</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Type chips */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">Type</p>
            <div className="flex gap-2">
              {(["bug", "feature", "other"] as FeedbackType[]).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={cn(
                    "flex-1 rounded-lg py-2 text-xs font-medium border transition-colors",
                    type === t
                      ? "bg-foreground text-background border-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">Title <span className="text-destructive">*</span></p>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Brief description"
              className="w-full rounded-xl bg-muted/60 border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Description */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">Details <span className="text-muted-foreground font-normal">(optional)</span></p>
            <textarea
              rows={4}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Steps to reproduce, expected vs actual behaviour, ideas…"
              className="w-full rounded-xl bg-muted/60 border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          {/* Screenshot */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">Screenshot <span className="text-muted-foreground font-normal">(optional)</span></p>
            {screenshot ? (
              <div className="relative inline-block">
                <img src={screenshot} alt="Screenshot" className="rounded-xl max-h-40 object-contain border border-border" />
                <button
                  type="button"
                  onClick={() => setScreenshot(null)}
                  className="absolute -top-2 -right-2 rounded-full bg-destructive text-destructive-foreground w-5 h-5 flex items-center justify-center"
                >
                  <XIcon className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ImageIcon className="w-4 h-4" />
                Attach screenshot
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          </div>
        </div>

        <div className="p-4 pt-0 shrink-0">
          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={!type || !title.trim() || submitting}
          >
            {submitting ? "Submitting…" : "Submit"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Create `components/more/feedback-section.tsx`**

```tsx
"use client";

import { useState } from "react";
import { MessageSquarePlusIcon } from "lucide-react";
import { FeedbackSheet } from "./feedback-sheet";

export function FeedbackSection() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div>
        <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Feedback
        </p>
        <div className="rounded-2xl bg-muted/40 border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex w-full items-center gap-3 px-4 py-3 hover:bg-muted/60 transition"
          >
            <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-muted shrink-0">
              <MessageSquarePlusIcon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold">Report an Issue</p>
              <p className="text-[10px] text-muted-foreground">Found a bug or have a feature idea? Let us know.</p>
            </div>
          </button>
        </div>
      </div>

      <FeedbackSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
```

- [ ] **Step 3: Wire into `components/more/profile-tab.tsx`**

3a. Add `feedbackCount` state. Find the line `const [pendingCount, setPendingCount] = useState(0)` and add below it:
```ts
const [feedbackCount, setFeedbackCount] = useState(0)
```

3b. Update the `useEffect` that fetches `/api/admin/pending-count` (around line 127):
```ts
useEffect(() => {
  if (!isAdmin) return
  fetch('/api/admin/pending-count')
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (d?.count != null) setPendingCount(d.count)
      if (d?.feedbackCount != null) setFeedbackCount(d.feedbackCount)
    })
    .catch(() => {})
}, [isAdmin])
```

3c. Import `FeedbackSection` at the top of profile-tab.tsx:
```ts
import { FeedbackSection } from './feedback-section'
```

3d. Render `<FeedbackSection />` between the About section and the Admin Console section. Find the `{/* ── Admin Console */}` comment and insert just before it:
```tsx
<FeedbackSection />

{/* ── Admin Console ─────────────────────────────────────────────────── */}
```

3e. Add feedback badge to the Admin Console link. Find the existing badge for `pendingCount` (around line 476):
```tsx
{pendingCount > 0 && (
  <span className="ml-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1.5 py-0.5 leading-none">
    {pendingCount}
  </span>
)}
```

Add below it:
```tsx
{feedbackCount > 0 && (
  <span className="ml-1 rounded-full bg-blue-500 text-white text-[10px] font-bold px-1.5 py-0.5 leading-none">
    {feedbackCount}
  </span>
)}
```

- [ ] **Step 4: Check TypeScript**

```bash
pnpm exec tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
git add components/more/feedback-section.tsx \
        components/more/feedback-sheet.tsx \
        components/more/profile-tab.tsx
git commit -m "feat: feedback submission UI in profile tab"
```

---

## Task 12: Feedback admin UI

**Files:**
- Modify: `app/admin/admin-content.tsx`

- [ ] **Step 1: Update Tab type**

Find the line `type Tab = ...` (near the top of admin-content.tsx) and add `'feedback'`:

```ts
type Tab = 'users' | 'invites' | 'exercises' | 'activities' | 'tools' | 'feedback'
```

- [ ] **Step 2: Add feedbackSubmissions state**

Find the state block in `AdminContent` and add:

```ts
const [feedbackSubmissions, setFeedbackSubmissions] = useState<{
  id: string; type: string; title: string; description: string | null;
  screenshotData: string | null; createdAt: string; userEmail: string; userName: string | null
}[]>([])
const [feedbackLoading, setFeedbackLoading] = useState(false)
const [expandedFeedback, setExpandedFeedback] = useState<string | null>(null)
const [confirmDeleteFeedback, setConfirmDeleteFeedback] = useState<string | null>(null)
```

- [ ] **Step 3: Add fetch for feedback**

Inside the main `useEffect` where users and invites are fetched, add:

```ts
setFeedbackLoading(true)
fetch('/api/admin/feedback')
  .then(r => r.ok ? r.json() : [])
  .then(d => { setFeedbackSubmissions(Array.isArray(d) ? d : []) })
  .catch(() => {})
  .finally(() => setFeedbackLoading(false))
```

- [ ] **Step 4: Update the tab bar**

The tab bar renders from `(['users', 'invites', 'exercises', 'activities', 'tools'] as Tab[]).map(...)`. Replace that array with:

```ts
(['users', 'invites', 'exercises', 'activities', 'tools', 'feedback'] as Tab[]).map(t => (
  <button
    key={t}
    onClick={() => setTab(t)}
    className={cn(
      'flex-1 rounded-md py-2 text-xs font-medium transition-colors capitalize relative',
      tab === t ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
    )}
  >
    {t === 'users'
      ? `Users${pending.length > 0 ? ` (${pending.length})` : ''}`
      : t === 'feedback' && feedbackSubmissions.length > 0
        ? <>Feedback <span className="ml-0.5 inline-flex items-center justify-center rounded-full bg-blue-500 text-white text-[9px] font-bold w-4 h-4">{feedbackSubmissions.length}</span></>
        : t}
  </button>
))
```

- [ ] **Step 5: Add feedback tab content**

After the `{tab === 'tools' && (...)}` block, add:

```tsx
{tab === 'feedback' && (
  <div className="space-y-3">
    {feedbackLoading && (
      <div className="space-y-2">
        {[1, 2].map(i => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
      </div>
    )}
    {!feedbackLoading && feedbackSubmissions.length === 0 && (
      <p className="text-center text-muted-foreground py-8">No feedback submissions.</p>
    )}
    {feedbackSubmissions.map(sub => {
      const typeColor = sub.type === 'bug' ? 'bg-red-500/15 text-red-400' : sub.type === 'feature' ? 'bg-blue-500/15 text-blue-400' : 'bg-muted text-muted-foreground'
      const isExpanded = expandedFeedback === sub.id
      const isConfirming = confirmDeleteFeedback === sub.id
      return (
        <div key={sub.id} className="rounded-xl border border-border bg-muted/40 overflow-hidden">
          <button
            type="button"
            className="w-full text-left px-4 py-3 flex items-start gap-3"
            onClick={() => setExpandedFeedback(isExpanded ? null : sub.id)}
          >
            <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${typeColor}`}>
              {sub.type}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{sub.title}</p>
              <p className="text-[10px] text-muted-foreground">{sub.userEmail} · {new Date(sub.createdAt).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' })}</p>
            </div>
          </button>
          {isExpanded && (
            <div className="px-4 pb-4 space-y-3 border-t border-border/50 pt-3">
              {sub.description && (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{sub.description}</p>
              )}
              {sub.screenshotData && (
                <img
                  src={sub.screenshotData}
                  alt="Screenshot"
                  className="rounded-xl max-w-full border border-border cursor-zoom-in"
                  onClick={() => window.open(sub.screenshotData!, '_blank')}
                />
              )}
              <div className="flex justify-end">
                {isConfirming ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteFeedback(null)}
                      className="text-xs text-muted-foreground px-3 py-1.5 rounded-lg border border-border"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await fetch(`/api/admin/feedback/${sub.id}`, { method: 'DELETE' })
                        setFeedbackSubmissions(prev => prev.filter(s => s.id !== sub.id))
                        setConfirmDeleteFeedback(null)
                        setExpandedFeedback(null)
                      }}
                      className="text-xs bg-destructive text-destructive-foreground px-3 py-1.5 rounded-lg"
                    >
                      Confirm delete
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteFeedback(sub.id)}
                    className="text-xs text-destructive px-3 py-1.5 rounded-lg border border-destructive/30"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )
    })}
  </div>
)}
```

- [ ] **Step 6: Check TypeScript**

```bash
pnpm exec tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 7: Commit**

```bash
git add app/admin/admin-content.tsx
git commit -m "feat: feedback admin UI with badge and delete"
```

---

## Task 13: Injury health card UI

**Files:**
- Create: `components/health/injury-sheet.tsx`
- Create: `components/health/injury-card.tsx`
- Modify: `app/health/health-content.tsx`

The standardised muscle list (matching keys in `MUSCLE_TO_SLUG` in `muscle-heatmap.tsx`) to use in the picker:

```ts
const MUSCLE_OPTIONS = [
  'chest', 'shoulders', 'biceps', 'triceps', 'forearms',
  'abs', 'obliques', 'hip flexors',
  'quads', 'hamstrings', 'glutes', 'calves', 'adductors',
  'traps', 'upper back', 'lats', 'lower back',
]
```

- [ ] **Step 1: Create `components/health/injury-sheet.tsx`**

```tsx
"use client";

import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { todayInTz } from "@/lib/date-utils";
import type { Injury } from "@/lib/types/injury";

const MUSCLE_OPTIONS = [
  'chest', 'shoulders', 'biceps', 'triceps', 'forearms',
  'abs', 'obliques', 'hip flexors',
  'quads', 'hamstrings', 'glutes', 'calves', 'adductors',
  'traps', 'upper back', 'lats', 'lower back',
]

type Severity = 'mild' | 'moderate' | 'severe'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  injury?: Injury | null
  onSaved: (injury: Injury) => void
  onDeleted?: (id: string) => void
}

export function InjurySheet({ open, onOpenChange, injury, onSaved, onDeleted }: Props) {
  const [muscle, setMuscle] = useState('')
  const [severity, setSeverity] = useState<Severity>('mild')
  const [startedDate, setStartedDate] = useState(todayInTz())
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (injury) {
      setMuscle(injury.muscleName)
      setSeverity(injury.severity)
      setStartedDate(injury.startedDate)
      setNotes(injury.notes ?? '')
    } else {
      setMuscle('')
      setSeverity('mild')
      setStartedDate(todayInTz())
      setNotes('')
    }
  }, [injury, open])

  async function handleSave() {
    if (!muscle) return
    setSaving(true)
    try {
      const url = injury ? `/api/injuries/${injury.id}` : '/api/injuries'
      const method = injury ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ muscleName: muscle, severity, startedDate, notes: notes.trim() || null }),
      })
      if (!res.ok) throw new Error()
      const saved: Injury = await res.json()
      onSaved(saved)
      onOpenChange(false)
      toast.success(injury ? 'Injury updated' : 'Injury logged')
    } catch {
      toast.error('Failed to save injury')
    } finally {
      setSaving(false)
    }
  }

  async function handleResolve() {
    if (!injury) return
    setSaving(true)
    try {
      const res = await fetch(`/api/injuries/${injury.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolvedDate: todayInTz() }),
      })
      if (!res.ok) throw new Error()
      const saved: Injury = await res.json()
      onSaved(saved)
      onOpenChange(false)
      toast.success('Injury marked as resolved')
    } catch {
      toast.error('Failed to update injury')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!injury) return
    setSaving(true)
    try {
      const res = await fetch(`/api/injuries/${injury.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      onDeleted?.(injury.id)
      onOpenChange(false)
      toast.success('Injury deleted')
    } catch {
      toast.error('Failed to delete injury')
    } finally {
      setSaving(false)
    }
  }

  const severityColors: Record<Severity, string> = {
    mild: 'bg-green-500/15 text-green-500 border-green-500/30',
    moderate: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
    severe: 'bg-red-500/15 text-red-500 border-red-500/30',
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] flex flex-col">
        <SheetHeader className="border-b border-border/30 pb-3 shrink-0">
          <SheetTitle>{injury ? 'Edit Injury' : 'Log Injury'}</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Muscle picker */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">Muscle</p>
            <div className="flex flex-wrap gap-2">
              {MUSCLE_OPTIONS.map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMuscle(m)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors capitalize",
                    muscle === m
                      ? "bg-foreground text-background border-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Severity */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">Severity</p>
            <div className="flex gap-2">
              {(['mild', 'moderate', 'severe'] as Severity[]).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSeverity(s)}
                  className={cn(
                    "flex-1 rounded-lg py-2 text-xs font-semibold border capitalize transition-colors",
                    severity === s ? severityColors[s] : "border-border text-muted-foreground"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Start date */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">Started</p>
            <input
              type="date"
              value={startedDate}
              onChange={e => setStartedDate(e.target.value)}
              className="w-full rounded-xl bg-muted/60 border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Notes */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">Notes <span className="font-normal">(optional)</span></p>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. left shoulder, rotator cuff"
              className="w-full rounded-xl bg-muted/60 border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {injury && !injury.resolvedDate && (
            <Button variant="outline" className="w-full" onClick={handleResolve} disabled={saving}>
              ✓ Mark as Resolved
            </Button>
          )}
          {injury && (
            <Button variant="destructive" className="w-full" onClick={handleDelete} disabled={saving}>
              Delete
            </Button>
          )}
        </div>
        <div className="p-4 pt-0 shrink-0">
          <Button className="w-full" onClick={handleSave} disabled={!muscle || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Create `components/health/injury-card.tsx`**

```tsx
"use client";

import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { MuscleHeatmap, type MuscleActivation } from "@/components/muscle-heatmap";
import { InjurySheet } from "./injury-sheet";
import { cn } from "@/lib/utils";
import { differenceInDays } from "date-fns";
import { todayInTz } from "@/lib/date-utils";
import type { Injury } from "@/lib/types/injury";

interface Props {
  injuries: Injury[]
  loading: boolean
  onInjuriesChange: (injuries: Injury[]) => void
}

const SEVERITY_CHIP: Record<string, string> = {
  mild: "bg-green-500/15 text-green-500",
  moderate: "bg-amber-500/15 text-amber-500",
  severe: "bg-red-500/15 text-red-500",
}

export function InjuryCard({ injuries, loading, onInjuriesChange }: Props) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<Injury | null>(null)
  const [showResolved, setShowResolved] = useState(false)

  const active = injuries.filter(i => !i.resolvedDate)
  const resolved = injuries.filter(i => i.resolvedDate)

  const heatmapAssignments: MuscleActivation[] = active.map(i => ({
    muscle: i.muscleName,
    role: "injured",
  }))

  function handleSaved(saved: Injury) {
    setEditing(null)
    const exists = injuries.find(i => i.id === saved.id)
    if (exists) {
      onInjuriesChange(injuries.map(i => i.id === saved.id ? saved : i))
    } else {
      onInjuriesChange([...injuries, saved])
    }
  }

  function handleDeleted(id: string) {
    onInjuriesChange(injuries.filter(i => i.id !== id))
  }

  if (loading) {
    return (
      <div className="rounded-2xl bg-muted/60 border border-border p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Injuries</p>
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
      </div>
    )
  }

  return (
    <>
      <div className="rounded-2xl bg-muted/60 border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Injuries</p>
          <button
            type="button"
            onClick={() => { setEditing(null); setSheetOpen(true) }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <PlusIcon className="h-3.5 w-3.5" /> Add
          </button>
        </div>

        {active.length > 0 ? (
          <>
            <MuscleHeatmap assignments={heatmapAssignments} compact={false} className="mb-3" />
            <div className="space-y-2">
              {active.map(i => {
                const days = differenceInDays(new Date(todayInTz()), new Date(i.startedDate))
                return (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => { setEditing(i); setSheetOpen(true) }}
                    className="w-full flex items-center gap-3 rounded-xl bg-muted/60 px-3 py-2.5 text-left hover:bg-muted/80 transition-colors"
                  >
                    <span className="flex-1 min-w-0">
                      <span className="text-sm font-medium capitalize">{i.muscleName}</span>
                      {i.notes && <span className="text-xs text-muted-foreground ml-1.5">— {i.notes}</span>}
                    </span>
                    <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-semibold capitalize shrink-0", SEVERITY_CHIP[i.severity])}>
                      {i.severity}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">Day {days + 1}</span>
                  </button>
                )
              })}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">No active injuries</p>
        )}

        {resolved.length > 0 && (
          <button
            type="button"
            onClick={() => setShowResolved(v => !v)}
            className="mt-3 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {showResolved ? 'Hide' : `Show`} resolved ({resolved.length})
          </button>
        )}
        {showResolved && resolved.map(i => (
          <div key={i.id} className="mt-1 flex items-center gap-3 rounded-xl px-3 py-2 opacity-50">
            <span className="flex-1 text-sm line-through capitalize">{i.muscleName}</span>
            <span className="text-[10px] text-muted-foreground">Resolved {i.resolvedDate}</span>
          </div>
        ))}
      </div>

      <InjurySheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        injury={editing}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
      />
    </>
  )
}
```

- [ ] **Step 3: Add InjuryCard to `app/health/health-content.tsx`**

3a. Add import near the top with other health imports:
```ts
import { InjuryCard } from "@/components/health/injury-card";
import type { Injury } from "@/lib/types/injury";
```

3b. Add state in `HealthContent`:
```ts
const [injuries, setInjuries] = useState<Injury[] | null>(null)
```

3c. Add fetch in the main `useEffect` (alongside existing cachedFetch calls):
```ts
fetch('/api/injuries')
  .then(r => r.ok ? r.json() : [])
  .then((d: Injury[]) => setInjuries(Array.isArray(d) ? d : []))
  .catch(() => setInjuries([]))
```

3d. In the Body tab JSX, add `<InjuryCard>` after the existing body metric cards (before the sleep section or at the end of the body content). Find the Body tab section and add:
```tsx
<InjuryCard
  injuries={injuries ?? []}
  loading={injuries === null}
  onInjuriesChange={setInjuries}
/>
```

- [ ] **Step 4: Check TypeScript**

```bash
pnpm exec tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
git add components/health/injury-sheet.tsx \
        components/health/injury-card.tsx \
        app/health/health-content.tsx
git commit -m "feat: injury card in Health > Body with heatmap visualisation"
```

---

## Task 14: Injury workout warning banner

**Files:**
- Modify: `components/workout-screen.tsx`
- Modify: `components/workout/active-workout-screen.tsx`

- [ ] **Step 1: Fetch active injuries in `components/workout-screen.tsx`**

1a. Add import at top:
```ts
import type { Injury } from "@/lib/types/injury";
```

1b. Add state near other state declarations:
```ts
const [activeInjuries, setActiveInjuries] = useState<Injury[]>([])
```

1c. In the `useEffect` that fetches workout data (find where `cachedFetch` is called for `workout-data`), add alongside it:
```ts
fetch('/api/injuries')
  .then(r => r.ok ? r.json() : [])
  .then((d: Injury[]) => setActiveInjuries(d.filter((i: Injury) => !i.resolvedDate)))
  .catch(() => {})
```

1d. Pass `activeInjuries` to `<ActiveWorkoutScreen>`. Find the render of `<ActiveWorkoutScreen` and add the prop:
```tsx
activeInjuries={activeInjuries}
```

- [ ] **Step 2: Add warning banner to `components/workout/active-workout-screen.tsx`**

2a. Add to `ActiveWorkoutScreenProps` interface:
```ts
activeInjuries?: import('@/lib/types/injury').Injury[]
```

2b. Add `activeInjuries = []` to the destructured props in `ActiveWorkoutScreen`.

2c. Compute injured muscles for the current exercise. Add before the return statement:
```ts
const injuredMuscles = (exercise?.muscleGroups ?? []).filter(mg =>
  (activeInjuries ?? []).some(i => i.muscleName.toLowerCase() === mg.toLowerCase())
)
```

2d. Render the warning banner in the exercise area. Find where the exercise name/header is rendered (before the set cards) and add:
```tsx
{injuredMuscles.length > 0 && (
  <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2.5 flex items-start gap-2">
    <span className="text-amber-500 mt-0.5 shrink-0">⚠️</span>
    <p className="text-xs text-amber-400">
      <span className="font-semibold">Injury active: </span>
      {injuredMuscles.map(m => m.charAt(0).toUpperCase() + m.slice(1)).join(', ')} — train with caution
    </p>
  </div>
)}
```

- [ ] **Step 3: Check TypeScript**

```bash
pnpm exec tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add components/workout-screen.tsx components/workout/active-workout-screen.tsx
git commit -m "feat: injury warning banner in active workout"
```

---

## Task 15: Supplement nutrition UI

**Files:**
- Create: `components/nutrition/manage-supplements-sheet.tsx`
- Create: `components/nutrition/supplements-section.tsx`
- Modify: `app/nutrition/nutrition-content.tsx`

- [ ] **Step 1: Create `components/nutrition/manage-supplements-sheet.tsx`**

```tsx
"use client";

import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { PlusIcon, GripVerticalIcon, TrashIcon } from "lucide-react";
import type { Supplement, SupplementWithStatus } from "@/lib/types/supplement";

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  supplements: SupplementWithStatus[]
  onChanged: (supplements: SupplementWithStatus[]) => void
}

type EditTarget = Supplement | null  // null = new supplement

export function ManageSupplementsSheet({ open, onOpenChange, supplements, onChanged }: Props) {
  const [editTarget, setEditTarget] = useState<EditTarget | 'new' | null>(null)
  const [name, setName] = useState('')
  const [dose, setDose] = useState('')
  const [reminderEnabled, setReminderEnabled] = useState(false)
  const [reminderTime, setReminderTime] = useState('08:00')
  const [saving, setSaving] = useState(false)

  function openNew() {
    setName(''); setDose(''); setReminderEnabled(false); setReminderTime('08:00')
    setEditTarget('new')
  }

  function openEdit(s: Supplement) {
    setName(s.name); setDose(s.dose ?? ''); setReminderEnabled(s.reminderEnabled)
    setReminderTime(s.reminderTime ?? '08:00')
    setEditTarget(s)
  }

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    try {
      const isNew = editTarget === 'new'
      const url = isNew ? '/api/supplements' : `/api/supplements/${(editTarget as Supplement).id}`
      const method = isNew ? 'POST' : 'PATCH'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          dose: dose.trim() || null,
          reminderEnabled,
          reminderTime: reminderEnabled ? reminderTime : null,
          sortOrder: isNew ? supplements.length : undefined,
        }),
      })
      if (!res.ok) throw new Error()
      const saved: Supplement = await res.json()
      if (isNew) {
        onChanged([...supplements, { ...saved, loggedToday: false }])
      } else {
        onChanged(supplements.map(s => s.id === saved.id ? { ...saved, loggedToday: (supplements.find(x => x.id === saved.id)?.loggedToday ?? false) } : s))
      }
      setEditTarget(null)
      toast.success(isNew ? 'Supplement added' : 'Supplement updated')
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      await fetch(`/api/supplements/${id}`, { method: 'DELETE' })
      onChanged(supplements.filter(s => s.id !== id))
      setEditTarget(null)
      toast.success('Supplement deleted')
    } catch {
      toast.error('Failed to delete')
    }
  }

  async function toggleActive(s: SupplementWithStatus) {
    try {
      const res = await fetch(`/api/supplements/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !s.active }),
      })
      if (!res.ok) throw new Error()
      const saved: Supplement = await res.json()
      onChanged(supplements.map(x => x.id === saved.id ? { ...saved, loggedToday: x.loggedToday } : x))
    } catch {
      toast.error('Failed to update')
    }
  }

  if (editTarget !== null) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] flex flex-col">
          <SheetHeader className="border-b border-border/30 pb-3 shrink-0">
            <SheetTitle>{editTarget === 'new' ? 'Add Supplement' : 'Edit Supplement'}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">Name</p>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Creatine"
                className="w-full rounded-xl bg-muted/60 border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">Dose <span className="font-normal">(optional)</span></p>
              <input
                type="text"
                value={dose}
                onChange={e => setDose(e.target.value)}
                placeholder="e.g. 5g, 1 capsule"
                className="w-full rounded-xl bg-muted/60 border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="rounded-xl bg-muted/60 border border-border px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Daily reminder</p>
                <p className="text-xs text-muted-foreground mt-0.5">Notify me if not logged by this time</p>
              </div>
              <Switch checked={reminderEnabled} onCheckedChange={setReminderEnabled} />
            </div>
            {reminderEnabled && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">Reminder time</p>
                <input
                  type="time"
                  value={reminderTime}
                  onChange={e => setReminderTime(e.target.value)}
                  className="w-full rounded-xl bg-muted/60 border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}
            {editTarget !== 'new' && (
              <Button variant="destructive" className="w-full" onClick={() => handleDelete((editTarget as Supplement).id)}>
                Delete
              </Button>
            )}
          </div>
          <div className="p-4 pt-0 shrink-0 flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setEditTarget(null)}>Back</Button>
            <Button className="flex-1" onClick={handleSave} disabled={!name.trim() || saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] flex flex-col">
        <SheetHeader className="border-b border-border/30 pb-3 shrink-0">
          <SheetTitle>Manage Supplements</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {supplements.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">No supplements yet. Add one below.</p>
          )}
          {supplements.map(s => (
            <div key={s.id} className="flex items-center gap-3 rounded-xl bg-muted/60 border border-border px-3 py-3">
              <GripVerticalIcon className="h-4 w-4 text-muted-foreground shrink-0" />
              <button type="button" onClick={() => openEdit(s)} className="flex-1 text-left min-w-0">
                <p className={`text-sm font-medium ${!s.active ? 'line-through text-muted-foreground' : ''}`}>{s.name}</p>
                {s.dose && <p className="text-xs text-muted-foreground">{s.dose}</p>}
                {s.reminderEnabled && s.reminderTime && (
                  <p className="text-[10px] text-muted-foreground">⏰ {s.reminderTime}</p>
                )}
              </button>
              <Switch checked={s.active} onCheckedChange={() => toggleActive(s)} />
            </div>
          ))}
        </div>
        <div className="p-4 pt-0 shrink-0">
          <Button className="w-full" onClick={openNew}>
            <PlusIcon className="h-4 w-4 mr-2" /> Add Supplement
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Create `components/nutrition/supplements-section.tsx`**

```tsx
"use client";

import { useState } from "react";
import { CheckIcon, SettingsIcon } from "lucide-react";
import { ManageSupplementsSheet } from "./manage-supplements-sheet";
import { cancelSupplementReminder } from "@/lib/supplement-reminders";
import type { SupplementWithStatus } from "@/lib/types/supplement";
import { cn } from "@/lib/utils";

interface Props {
  supplements: SupplementWithStatus[]
  loading: boolean
  onChanged: (supplements: SupplementWithStatus[]) => void
}

export function SupplementsSection({ supplements, loading, onChanged }: Props) {
  const [manageOpen, setManageOpen] = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)

  const active = supplements.filter(s => s.active)

  async function toggleLog(s: SupplementWithStatus) {
    if (toggling) return
    setToggling(s.id)
    try {
      const method = s.loggedToday ? 'DELETE' : 'POST'
      const res = await fetch(`/api/supplements/${s.id}/log`, { method })
      if (!res.ok) throw new Error()
      if (!s.loggedToday) {
        await cancelSupplementReminder(s.id)
      }
      onChanged(supplements.map(x => x.id === s.id ? { ...x, loggedToday: !x.loggedToday } : x))
    } catch {
      // silent — checkbox snaps back
    } finally {
      setToggling(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="h-4 w-32 rounded bg-muted animate-pulse" />
        <div className="h-12 rounded-xl bg-muted animate-pulse" />
        <div className="h-12 rounded-xl bg-muted animate-pulse" />
      </div>
    )
  }

  return (
    <>
      <div>
        <div className="flex items-center justify-between px-1 pb-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Supplements</p>
          <button type="button" onClick={() => setManageOpen(true)} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
            <SettingsIcon className="h-3 w-3" /> Manage
          </button>
        </div>
        {active.length === 0 ? (
          <div className="rounded-2xl bg-muted/40 border border-border px-4 py-4 text-center">
            <p className="text-sm text-muted-foreground">No supplements added yet.</p>
            <button type="button" onClick={() => setManageOpen(true)} className="text-xs text-foreground underline mt-1">
              Add some
            </button>
          </div>
        ) : (
          <div className="rounded-2xl bg-muted/40 border border-border overflow-hidden divide-y divide-border">
            {active.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleLog(s)}
                disabled={toggling === s.id}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/60 transition-colors"
              >
                <div className={cn(
                  "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
                  s.loggedToday
                    ? "bg-green-500 border-green-500"
                    : "border-muted-foreground/40"
                )}>
                  {s.loggedToday && <CheckIcon className="w-3 h-3 text-white" />}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className={cn("text-sm font-medium", s.loggedToday && "line-through text-muted-foreground")}>
                    {s.name}
                  </p>
                  {s.dose && <p className="text-xs text-muted-foreground">{s.dose}</p>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <ManageSupplementsSheet
        open={manageOpen}
        onOpenChange={setManageOpen}
        supplements={supplements}
        onChanged={onChanged}
      />
    </>
  )
}
```

- [ ] **Step 3: Add to `app/nutrition/nutrition-content.tsx`**

3a. Add import:
```ts
import { SupplementsSection } from "@/components/nutrition/supplements-section";
import type { SupplementWithStatus } from "@/lib/types/supplement";
```

3b. Add state:
```ts
const [supplements, setSupplements] = useState<SupplementWithStatus[]>([])
const [supplementsLoading, setSupplementsLoading] = useState(true)
```

3c. Add fetch in the main `useEffect`:
```ts
fetch('/api/supplements')
  .then(r => r.ok ? r.json() : [])
  .then((d: SupplementWithStatus[]) => setSupplements(Array.isArray(d) ? d : []))
  .catch(() => {})
  .finally(() => setSupplementsLoading(false))
```

3d. Render `<SupplementsSection>` at the bottom of the main nutrition content div (before the closing tag of the main container, after all the meal cards and charts):
```tsx
<SupplementsSection
  supplements={supplements}
  loading={supplementsLoading}
  onChanged={setSupplements}
/>
```

- [ ] **Step 4: Check TypeScript**

```bash
pnpm exec tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
git add components/nutrition/manage-supplements-sheet.tsx \
        components/nutrition/supplements-section.tsx \
        app/nutrition/nutrition-content.tsx
git commit -m "feat: supplement daily checklist in Nutrition tab"
```

---

## Task 16: Wire supplement reminders + cache groups

**Files:**
- Modify: `components/sync-provider.tsx`
- Modify: `lib/cache-groups.ts`

- [ ] **Step 1: Add supplement reminder reconciliation to `components/sync-provider.tsx`**

1a. Add import at the top:
```ts
import { reconcileSupplementReminders } from '@/lib/supplement-reminders';
```

1b. After the existing workout reminder `useEffect` block (around line 180), add a new `useEffect`:

```ts
// Reconcile supplement reminder notifications on app open and on resume
useEffect(() => {
  let handle: { remove: () => void } | undefined;

  async function reconcile() {
    try {
      const supplements = await fetch('/api/supplements').then(r => r.json());
      await reconcileSupplementReminders(Array.isArray(supplements) ? supplements : []);
    } catch {
      // Network unavailable — skip
    }
  }

  (async () => {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;
    reconcile();
    const { App } = await import('@capacitor/app');
    handle = await App.addListener('resume', reconcile);
  })();

  return () => { handle?.remove(); };
}, []);
```

- [ ] **Step 2: Add cache invalidation to `lib/cache-groups.ts`**

The supplements and injuries don't have derived caches that need invalidating (they're fetched directly). However, add a helper for supplement log writes so callers can invalidate if needed in future:

In `lib/cache-groups.ts`, no changes needed for now — `invalidateReadinessInputs` already covers body data. Injuries and supplements use direct `fetch()` in components without caching (they're lightweight lists). Skip this step — no cache groups change required.

- [ ] **Step 3: Check TypeScript**

```bash
pnpm exec tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Run all tests**

```bash
pnpm test 2>&1 | tail -20
```

Expected: all tests pass, including the new supplement-reminders tests.

- [ ] **Step 5: Commit**

```bash
git add components/sync-provider.tsx
git commit -m "feat: supplement reminder reconciliation in sync provider"
```

---

## Task 17: Smoke test + push

- [ ] **Step 1: Start dev server**

```bash
pnpm dev 2>&1 &
sleep 5
```

- [ ] **Step 2: Verify the server starts clean**

```bash
curl -s http://localhost:3000/api/health 2>/dev/null || curl -s http://localhost:3000 -o /dev/null -w "%{http_code}"
```

Expected: 200 response.

- [ ] **Step 3: Smoke-test API routes with local DB**

```bash
# Check injuries endpoint (will get 401 without auth, which is correct)
curl -s http://localhost:3000/api/injuries -w "\nHTTP %{http_code}\n"
# Check supplements endpoint
curl -s http://localhost:3000/api/supplements -w "\nHTTP %{http_code}\n"
# Check feedback endpoint
curl -s -X POST http://localhost:3000/api/feedback -w "\nHTTP %{http_code}\n"
```

Expected: all return `401` (Unauthorized) — correct, auth is required.

- [ ] **Step 4: Kill dev server**

```bash
pkill -f "next dev" 2>/dev/null; true
```

- [ ] **Step 5: Push feature branch**

```bash
git push -u origin feat/batch-ab-features
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Calendar legend truncation | Task 5 |
| feedback_submissions migration | Task 1 |
| Feedback schema + types | Task 2 |
| Feedback repo/adapter | Tasks 3, 4 |
| POST /api/feedback | Task 6 |
| GET/DELETE /api/admin/feedback | Task 6 |
| pending-count includes feedbackCount | Task 6 |
| FeedbackSection + FeedbackSheet in profile-tab | Task 11 |
| Admin Feedback tab with badge | Task 12 |
| injuries migration | Task 1 |
| Injury schema + types | Task 2 |
| Injury repo/adapter | Tasks 3, 4 |
| GET/POST /api/injuries | Task 7 |
| PATCH/DELETE /api/injuries/[id] | Task 7 |
| MuscleHeatmap 'injured' role → red | Task 10 |
| InjuryCard + InjurySheet in Health > Body | Task 13 |
| Workout warning banner | Task 14 |
| supplements + supplement_logs migrations | Task 1 |
| Supplement schema + types | Task 2 |
| Supplement repo/adapter | Tasks 3, 4 |
| All supplement API routes | Task 8 |
| supplement-reminders.ts library | Task 9 |
| Supplement reminder unit tests | Task 9 |
| SupplementsSection + ManageSupplementsSheet in Nutrition | Task 15 |
| Supplement reminders in sync-provider | Task 16 |

All spec requirements covered. ✅
