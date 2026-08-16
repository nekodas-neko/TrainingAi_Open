> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Nav Restructure + Friend System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganise the 5-tab nav (Home/Nutrition/Workout/Health/More) and build a friend system with activity feed, leaderboard, titles, trophy case, and achievement badge redesign.

**Architecture:** Nav restructure moves content to new routes without changing logic. Friend system adds a `friendships` table, 8 new API routes, and new UI components inside a new `/more` tabbed page. Achievements gain tier borders (bronze/silver/gold) and an equippable title system computed from existing achievement data.

**Tech Stack:** Next.js 15 App Router, Drizzle ORM, PostgreSQL, Tailwind CSS v4, shadcn/ui, Lucide icons, Vitest

---

## File Map

**New files:**
- `lib/data/postgres/migrations/055_friends_and_titles.sql`
- `lib/types/friends.ts`
- `app/workout/page.tsx` — session select moved here
- `app/nutrition/page.tsx` + `app/nutrition/nutrition-content.tsx`
- `app/more/page.tsx` + `app/more/more-content.tsx`
- `app/profile/[userId]/page.tsx` — public friend profile
- `components/more/profile-tab.tsx`
- `components/more/achievements-tab.tsx`
- `components/more/config-tab.tsx`
- `components/more/friends-tab.tsx`
- `components/more/friend-feed.tsx`
- `components/more/friend-leaderboard.tsx`
- `components/more/manage-friends-sheet.tsx`
- `components/more/trophy-case.tsx`
- `components/more/title-picker-sheet.tsx`
- `components/more/share-milestone-card.tsx`
- `app/api/friends/route.ts`
- `app/api/friends/[id]/route.ts`
- `app/api/friends/feed/route.ts`
- `app/api/friends/leaderboard/route.ts`
- `app/api/profile/[userId]/route.ts`
- `app/api/seasons/route.ts`
- `app/api/user/equipped-title/route.ts`
- `app/api/user/trophy-case/route.ts`

**Modified files:**
- `lib/data/postgres/schema.ts` — add friendships, seasons, season_results tables; friend_code + equipped_title on users
- `lib/data/postgres/adapter.ts` — upsertUser generates friend_code; add friend CRUD methods
- `lib/data/repository.ts` — add friend method signatures
- `types/next-auth.d.ts` — add friend_code, equipped_title to session/JWT
- `auth.config.ts` — stamp friend_code, equipped_title into JWT
- `components/shell/bottom-nav.tsx` — new 5-tab routes
- `app/page.tsx` — simplified dashboard (no session select)
- `app/session-select/page.tsx` — redirect to /workout
- `app/health/health-content.tsx` — 3 tabs: Body / Training / Progress; remove nutrition tab
- `components/profile/achievements-grid.tsx` — tier borders, shimmer, rarity signal, trophy case support
- `app/api/weekly-digest/route.ts` — add friends context line

---

## Task 1 — DB Migration 055

**Files:**
- Create: `lib/data/postgres/migrations/055_friends_and_titles.sql`

- [ ] **Step 1: Create migration file**

```sql
-- 055_friends_and_titles.sql

-- Add columns to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS friend_code    text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS equipped_title text;

-- Generate unique friend codes for all existing users
DO $$
DECLARE
  rec    RECORD;
  code   text;
  chars  text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  attempt int;
BEGIN
  FOR rec IN SELECT id FROM users WHERE friend_code IS NULL LOOP
    attempt := 0;
    LOOP
      code := 'TRN-'
        || substr(chars, (floor(random()*36))::int + 1, 1)
        || substr(chars, (floor(random()*36))::int + 1, 1)
        || substr(chars, (floor(random()*36))::int + 1, 1)
        || substr(chars, (floor(random()*36))::int + 1, 1);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM users WHERE friend_code = code);
      attempt := attempt + 1;
      IF attempt > 100 THEN RAISE EXCEPTION 'Cannot generate unique friend code after 100 attempts'; END IF;
    END LOOP;
    UPDATE users SET friend_code = code WHERE id = rec.id;
  END LOOP;
END;
$$;

ALTER TABLE users ADD CONSTRAINT users_friend_code_unique UNIQUE (friend_code);

-- Friendships
CREATE TABLE IF NOT EXISTS friendships (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       text NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (requester_id, addressee_id)
);
CREATE INDEX IF NOT EXISTS friendships_requester_idx ON friendships(requester_id);
CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON friendships(addressee_id);

-- Seasons
CREATE TABLE IF NOT EXISTS seasons (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text NOT NULL,
  start_date date NOT NULL,
  end_date   date NOT NULL
);

CREATE TABLE IF NOT EXISTS season_results (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id    uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rank         int  NOT NULL,
  sessions     int  NOT NULL DEFAULT 0,
  volume_kg    float NOT NULL DEFAULT 0,
  badge_label  text NOT NULL CHECK (badge_label IN ('Gold', 'Silver', 'Bronze')),
  UNIQUE (season_id, user_id)
);
```

- [ ] **Step 2: Commit**
```bash
git add lib/data/postgres/migrations/055_friends_and_titles.sql
git commit -m "Add migration 055: friendships, seasons, friend_code, equipped_title"
```

---

## Task 2 — Drizzle Schema + Types

**Files:**
- Modify: `lib/data/postgres/schema.ts`
- Create: `lib/types/friends.ts`

- [ ] **Step 1: Add columns and tables to schema.ts**

After the `users` table definition (after line 32), add two columns to the users table object:
```ts
// inside the users pgTable definition, after targetBfPct:
friendCode:   text('friend_code').unique(),
equippedTitle: text('equipped_title'),
```

At the bottom of `schema.ts`, add:
```ts
export const friendships = pgTable('friendships', {
  id:          uuid('id').primaryKey().defaultRandom(),
  requesterId: uuid('requester_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  addresseeId: uuid('addressee_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status:      text('status').notNull(),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.requesterId, t.addresseeId)])

export const seasons = pgTable('seasons', {
  id:        uuid('id').primaryKey().defaultRandom(),
  label:     text('label').notNull(),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  endDate:   date('end_date', { mode: 'string' }).notNull(),
})

export const seasonResults = pgTable('season_results', {
  id:         uuid('id').primaryKey().defaultRandom(),
  seasonId:   uuid('season_id').notNull().references(() => seasons.id, { onDelete: 'cascade' }),
  userId:     uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  rank:       integer('rank').notNull(),
  sessions:   integer('sessions').notNull().default(0),
  volumeKg:   doublePrecision('volume_kg').notNull().default(0),
  badgeLabel: text('badge_label').notNull(),
}, t => [unique().on(t.seasonId, t.userId)])
```

- [ ] **Step 2: Create `lib/types/friends.ts`**

```ts
export interface Friendship {
  id: string
  requesterId: string
  addresseeId: string
  status: 'pending' | 'accepted'
  createdAt: Date
  friend: {
    id: string
    displayName: string | null
    name: string | null
    equippedTitle: string | null
    friendCode: string | null
  }
}

export interface FeedEvent {
  id: string
  type: 'pr' | 'workout'
  userId: string
  displayName: string
  equippedTitle: string | null
  occurredAt: string
  // pr event
  exerciseName?: string
  estimated1rm?: number
  // workout event
  sessionCount?: number
  volumeKg?: number
}

export interface LeaderboardEntry {
  userId: string
  displayName: string
  equippedTitle: string | null
  isYou: boolean
  weeklySessions: number
  weeklyVolumeKg: number
  currentStreak: number
}

export interface PublicProfile {
  userId: string
  displayName: string
  equippedTitle: string | null
  friendCode: string | null
  level: number
  levelLabel: string
  xp: number
  lifetimeStats: { sessions: number; totalVolumeKg: number; bestStreak: number }
  trophyCase: string[]   // 3 achievement IDs
  achievements: import('@/components/profile/achievements-grid').AchievementResult[]
  rarityMap: Record<string, number>  // achievementId -> count of friends who have it
}

export interface Season {
  id: string
  label: string
  startDate: string
  endDate: string
  result?: { rank: number; sessions: number; volumeKg: number; badgeLabel: 'Gold' | 'Silver' | 'Bronze' }
}

// Title definitions — top-tier per achievement category
export const TITLES: Record<string, { display: string; lucideIcon: string; unlockedBy: string }> = {
  iron_will:      { display: 'Iron Will',      lucideIcon: 'Swords',        unlockedBy: 'streak_60'       },
  unbroken:       { display: 'Unbroken',        lucideIcon: 'Shield',        unlockedBy: 'streak_30'       },
  powerhouse:     { display: 'Powerhouse',      lucideIcon: 'Rocket',        unlockedBy: 'volume_100k'     },
  iron_beast:     { display: 'Iron Beast',      lucideIcon: 'Dumbbell',      unlockedBy: 'volume_50k'      },
  the_veteran:    { display: 'The Veteran',     lucideIcon: 'Crown',         unlockedBy: 'sessions_250'    },
  century_club:   { display: 'Century Club',    lucideIcon: 'Trophy',        unlockedBy: 'sessions_100'    },
  set_machine:    { display: 'Set Machine',     lucideIcon: 'Zap',           unlockedBy: 'sets_5000'       },
  pr_machine:     { display: 'PR Machine',      lucideIcon: 'Diamond',       unlockedBy: 'prs_25'          },
  dawn_warrior:   { display: 'Dawn Warrior',    lucideIcon: 'Sunrise',       unlockedBy: 'early_bird_5'    },
  ghost:          { display: 'Ghost',           lucideIcon: 'Moon',          unlockedBy: 'night_owl'       },
  macro_master:   { display: 'Macro Master',    lucideIcon: 'CheckCircle2',  unlockedBy: 'calorie_goal_30' },
  well_rested:    { display: 'Well Rested',     lucideIcon: 'Bed',           unlockedBy: 'sleep_streak_30' },
  relentless:     { display: 'Relentless',      lucideIcon: 'CalendarCheck', unlockedBy: 'months_12'       },
  road_runner:    { display: 'Road Runner',     lucideIcon: 'Activity',      unlockedBy: 'steps_30k'       },
  ultramarathon:  { display: 'Ultramarathon',   lucideIcon: 'Medal',         unlockedBy: 'steps_50k'       },
  built_different: { display: 'Built Different', lucideIcon: 'Star',         unlockedBy: 'months_6'        },
}
```

- [ ] **Step 3: Commit**
```bash
git add lib/data/postgres/schema.ts lib/types/friends.ts
git commit -m "Add friendships schema, season tables, friend types"
```

---

## Task 3 — Repository Interface + Adapter

**Files:**
- Modify: `lib/data/repository.ts`
- Modify: `lib/data/postgres/adapter.ts`

- [ ] **Step 1: Add friend method signatures to `lib/data/repository.ts`**

After the `listInvites` section, add:
```ts
// ── Friends ────────────────────────────────────────────────────────────────
listFriendships(userId: string): Promise<import('./types/friends').Friendship[]>
sendFriendRequest(requesterId: string, emailOrCode: string): Promise<{ id: string }>
acceptFriendRequest(friendshipId: string, addresseeId: string): Promise<void>
declineFriendRequest(friendshipId: string, addresseeId: string): Promise<void>
removeFriend(friendshipId: string, userId: string): Promise<void>
getFriendIds(userId: string): Promise<string[]>
updateEquippedTitle(userId: string, titleId: string | null): Promise<void>
```

Note: also add `import type { Friendship } from './types/friends'` to the top of `repository.ts`.

- [ ] **Step 2: Update `upsertUser` in adapter.ts to generate friend_code**

After line 56 (`.returning()`), before `const returnedUser = this.rowToUser(r)`:
```ts
// Generate friend_code for new users or users missing one
if (!r.friendCode) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  let attempts = 0
  do {
    code = 'TRN-' + Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
    attempts++
  } while (
    attempts < 50 &&
    (await this.db.select({ id: s.users.id }).from(s.users).where(eq(s.users.friendCode, code))).length > 0
  )
  await this.db.update(s.users).set({ friendCode: code }).where(eq(s.users.id, r.id))
  r.friendCode = code
}
```

Also update `rowToUser` to include the new fields:
```ts
// inside rowToUser, add to the return object:
friendCode:    r.friendCode ?? undefined,
equippedTitle: r.equippedTitle ?? undefined,
```

- [ ] **Step 3: Add friend methods to adapter.ts** (at the end of the PostgresWorkoutRepository class)

```ts
// ── Friends ────────────────────────────────────────────────────────────────
async listFriendships(userId: string): Promise<Friendship[]> {
  const db = this.db
  const uid = userId as unknown as string
  const rows = await db.execute(sql`
    SELECT
      f.id, f.requester_id, f.addressee_id, f.status, f.created_at,
      u.id as friend_id,
      COALESCE(u.display_name, u.name) as friend_name,
      u.equipped_title as friend_title,
      u.friend_code as friend_code
    FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.requester_id = ${uid}::uuid THEN f.addressee_id ELSE f.requester_id END
    WHERE f.requester_id = ${uid}::uuid OR f.addressee_id = ${uid}::uuid
    ORDER BY f.created_at DESC
  `)
  return (rows.rows as any[]).map(r => ({
    id: r.id,
    requesterId: r.requester_id,
    addresseeId: r.addressee_id,
    status: r.status,
    createdAt: r.created_at,
    friend: { id: r.friend_id, displayName: r.friend_name, name: r.friend_name, equippedTitle: r.friend_title, friendCode: r.friend_code },
  }))
}

async sendFriendRequest(requesterId: string, emailOrCode: string): Promise<{ id: string }> {
  const db = this.db
  // Find target user by email or friend code
  const target = await db.execute(sql`
    SELECT id FROM users
    WHERE email = ${emailOrCode} OR friend_code = ${emailOrCode.toUpperCase()}
    LIMIT 1
  `)
  const targetId = (target.rows[0] as any)?.id
  if (!targetId) throw new Error('User not found')
  if (targetId === requesterId) throw new Error('Cannot add yourself')
  const [row] = await db.insert(s.friendships)
    .values({ requesterId: requesterId as any, addresseeId: targetId, status: 'pending' })
    .returning()
  return { id: row.id }
}

async acceptFriendRequest(friendshipId: string, addresseeId: string): Promise<void> {
  await this.db.execute(sql`
    UPDATE friendships SET status = 'accepted', updated_at = now()
    WHERE id = ${friendshipId}::uuid AND addressee_id = ${addresseeId}::uuid
  `)
}

async declineFriendRequest(friendshipId: string, addresseeId: string): Promise<void> {
  await this.db.execute(sql`
    DELETE FROM friendships
    WHERE id = ${friendshipId}::uuid AND addressee_id = ${addresseeId}::uuid
  `)
}

async removeFriend(friendshipId: string, userId: string): Promise<void> {
  await this.db.execute(sql`
    DELETE FROM friendships
    WHERE id = ${friendshipId}::uuid
      AND (requester_id = ${userId}::uuid OR addressee_id = ${userId}::uuid)
  `)
}

async getFriendIds(userId: string): Promise<string[]> {
  const rows = await this.db.execute(sql`
    SELECT CASE WHEN requester_id = ${userId}::uuid THEN addressee_id ELSE requester_id END as friend_id
    FROM friendships
    WHERE (requester_id = ${userId}::uuid OR addressee_id = ${userId}::uuid)
      AND status = 'accepted'
  `)
  return (rows.rows as any[]).map(r => r.friend_id)
}

async updateEquippedTitle(userId: string, titleId: string | null): Promise<void> {
  await this.db.execute(sql`
    UPDATE users SET equipped_title = ${titleId} WHERE id = ${userId}::uuid
  `)
}
```

Also add `import type { Friendship } from '../types/friends'` at the top of `adapter.ts`.

Also update the `User` type in `lib/types/index.ts` (or wherever it's defined) to add:
```ts
friendCode?: string
equippedTitle?: string
```

- [ ] **Step 4: Commit**
```bash
git add lib/data/repository.ts lib/data/postgres/adapter.ts
git commit -m "Add friend CRUD methods to repository and adapter"
```

---

## Task 4 — JWT Types + Auth Config

**Files:**
- Modify: `types/next-auth.d.ts`
- Modify: `auth.config.ts`

- [ ] **Step 1: Add to `types/next-auth.d.ts`**

In the `Session.user` block, add:
```ts
friendCode?: string | null
equippedTitle?: string | null
```

In the `JWT` block, add:
```ts
friendCode?: string | null
equippedTitle?: string | null
```

- [ ] **Step 2: Stamp into JWT in `auth.config.ts`**

In the `jwt` callback, after the `dateOfBirth` line, add:
```ts
if ('friendCode' in (user ?? {})) token.friendCode = (user as any).friendCode ?? null
if ('equippedTitle' in (user ?? {})) token.equippedTitle = (user as any).equippedTitle ?? null
```

In the `session` callback, after `dateOfBirth`, add:
```ts
session.user.friendCode = token.friendCode ?? null
session.user.equippedTitle = token.equippedTitle ?? null
```

- [ ] **Step 3: Commit**
```bash
git add types/next-auth.d.ts auth.config.ts
git commit -m "Stamp friend_code and equipped_title into JWT session"
```

---

## Task 5 — API: Friends List + Send Request

**Files:**
- Create: `app/api/friends/route.ts`

- [ ] **Step 1: Create the route**

```ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const repo = await getRepository()
  const friendships = await repo.listFriendships(session.user.id)
  return NextResponse.json({ friendships })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { emailOrCode } = await req.json()
  if (!emailOrCode || typeof emailOrCode !== 'string' || emailOrCode.length > 100) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }
  const repo = await getRepository()
  try {
    const result = await repo.sendFriendRequest(session.user.id, emailOrCode.trim())
    return NextResponse.json({ id: result.id })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Failed' }, { status: 400 })
  }
}
```

- [ ] **Step 2: Commit**
```bash
git add app/api/friends/route.ts
git commit -m "Add GET/POST /api/friends routes"
```

---

## Task 6 — API: Accept / Decline / Remove

**Files:**
- Create: `app/api/friends/[id]/route.ts`

- [ ] **Step 1: Create the route**

```ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const { action } = await req.json()
  const repo = await getRepository()
  if (action === 'accept') {
    await repo.acceptFriendRequest(id, session.user.id)
    return NextResponse.json({ ok: true })
  }
  if (action === 'decline') {
    await repo.declineFriendRequest(id, session.user.id)
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const repo = await getRepository()
  await repo.removeFriend(id, session.user.id)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Commit**
```bash
git add app/api/friends/[id]/route.ts
git commit -m "Add PATCH/DELETE /api/friends/[id] routes"
```

---

## Task 7 — API: Activity Feed

**Files:**
- Create: `app/api/friends/feed/route.ts`

- [ ] **Step 1: Create the route**

```ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { getDb } from '@/lib/data/postgres/client'
import { sql } from 'drizzle-orm'
import type { FeedEvent } from '@/lib/types/friends'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepository()
  const friendIds = await repo.getFriendIds(session.user.id)

  if (friendIds.length === 0) return NextResponse.json({ events: [] })

  const db = getDb()
  const idList = friendIds.map(id => `'${id}'::uuid`).join(',')

  const [prRows, workoutRows] = await Promise.all([
    db.execute(sql`
      SELECT pr.user_id, pr.exercise_name, pr.estimated_1rm, pr.achieved_at,
             COALESCE(u.display_name, u.name) as display_name, u.equipped_title
      FROM personal_records pr
      JOIN users u ON pr.user_id = u.id
      WHERE pr.user_id IN (${sql.raw(idList)})
        AND pr.achieved_at >= now() - interval '30 days'
      ORDER BY pr.achieved_at DESC
      LIMIT 30
    `),
    db.execute(sql`
      SELECT ws.user_id, ws.started_at,
             COUNT(DISTINCT el.id)::int as exercise_count,
             COALESCE(SUM(el.volume), 0)::float as volume_kg,
             COALESCE(u.display_name, u.name) as display_name, u.equipped_title
      FROM workout_sessions ws
      JOIN users u ON ws.user_id = u.id
      LEFT JOIN exercise_logs el ON el.workout_session_id = ws.id
      WHERE ws.user_id IN (${sql.raw(idList)})
        AND ws.started_at >= now() - interval '30 days'
        AND ws.completed_at IS NOT NULL
      GROUP BY ws.id, u.id
      ORDER BY ws.started_at DESC
      LIMIT 30
    `),
  ])

  const events: FeedEvent[] = [
    ...(prRows.rows as any[]).map(r => ({
      id: `pr-${r.user_id}-${r.exercise_name}`,
      type: 'pr' as const,
      userId: r.user_id,
      displayName: r.display_name ?? 'Someone',
      equippedTitle: r.equipped_title ?? null,
      occurredAt: r.achieved_at,
      exerciseName: r.exercise_name,
      estimated1rm: Number(r.estimated_1rm),
    })),
    ...(workoutRows.rows as any[]).map(r => ({
      id: `workout-${r.user_id}-${r.started_at}`,
      type: 'workout' as const,
      userId: r.user_id,
      displayName: r.display_name ?? 'Someone',
      equippedTitle: r.equipped_title ?? null,
      occurredAt: r.started_at,
      volumeKg: Math.round(Number(r.volume_kg)),
    })),
  ].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
   .slice(0, 40)

  return NextResponse.json({ events })
}
```

- [ ] **Step 2: Commit**
```bash
git add app/api/friends/feed/route.ts
git commit -m "Add GET /api/friends/feed route"
```

---

## Task 8 — API: Leaderboard

**Files:**
- Create: `app/api/friends/leaderboard/route.ts`

- [ ] **Step 1: Create the route**

```ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { getDb } from '@/lib/data/postgres/client'
import { sql } from 'drizzle-orm'
import { formatInTimeZone } from 'date-fns-tz'
import { DEFAULT_TZ } from '@/lib/date-utils'
import type { LeaderboardEntry } from '@/lib/types/friends'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const repo = await getRepository()
  const friendIds = await repo.getFriendIds(session.user.id)
  const allIds = [session.user.id, ...friendIds]
  const idList = allIds.map(id => `'${id}'::uuid`).join(',')

  const db = getDb()
  const weekStart = (() => {
    const now = new Date()
    const d = new Date(formatInTimeZone(now, tz, "yyyy-MM-dd'T'00:00:00"))
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return d.toISOString()
  })()

  const [weeklyRows, allTimeRows, streakRows] = await Promise.all([
    db.execute(sql`
      SELECT ws.user_id,
             COUNT(DISTINCT ws.id)::int as sessions,
             COALESCE(SUM(el.volume), 0)::float as volume_kg,
             COALESCE(u.display_name, u.name) as display_name,
             u.equipped_title
      FROM workout_sessions ws
      JOIN users u ON ws.user_id = u.id
      LEFT JOIN exercise_logs el ON el.workout_session_id = ws.id
      WHERE ws.user_id IN (${sql.raw(idList)})
        AND ws.started_at >= ${weekStart}::timestamptz
        AND ws.completed_at IS NOT NULL
      GROUP BY ws.user_id, u.id
    `),
    db.execute(sql`
      SELECT ws.user_id,
             COUNT(DISTINCT ws.id)::int as sessions,
             COALESCE(SUM(el.volume), 0)::float as volume_kg,
             COALESCE(u.display_name, u.name) as display_name,
             u.equipped_title
      FROM workout_sessions ws
      JOIN users u ON ws.user_id = u.id
      LEFT JOIN exercise_logs el ON el.workout_session_id = ws.id
      WHERE ws.user_id IN (${sql.raw(idList)})
        AND ws.completed_at IS NOT NULL
      GROUP BY ws.user_id, u.id
    `),
    db.execute(sql`
      SELECT ws.user_id,
             COUNT(DISTINCT (ws.started_at AT TIME ZONE ${tz})::date)::int as training_days,
             COALESCE(u.display_name, u.name) as display_name,
             u.equipped_title
      FROM workout_sessions ws
      JOIN users u ON ws.user_id = u.id
      WHERE ws.user_id IN (${sql.raw(idList)})
        AND ws.completed_at IS NOT NULL
        AND ws.started_at >= now() - interval '90 days'
      GROUP BY ws.user_id, u.id
    `),
  ])

  const toMap = (rows: any[]) => Object.fromEntries(rows.map(r => [r.user_id, r]))
  const weekly = toMap(weeklyRows.rows as any[])
  const allTime = toMap(allTimeRows.rows as any[])
  const streaks = toMap(streakRows.rows as any[])

  const entries: LeaderboardEntry[] = allIds.map(id => ({
    userId: id,
    displayName: (weekly[id] ?? allTime[id] ?? streaks[id])?.display_name ?? 'Unknown',
    equippedTitle: (weekly[id] ?? allTime[id])?.equipped_title ?? null,
    isYou: id === session.user.id,
    weeklySessions: weekly[id]?.sessions ?? 0,
    weeklyVolumeKg: Math.round(weekly[id]?.volume_kg ?? 0),
    currentStreak: streaks[id]?.training_days ?? 0,
    allTimeSessions: allTime[id]?.sessions ?? 0,
    allTimeVolumeKg: Math.round(allTime[id]?.volume_kg ?? 0),
  }))

  return NextResponse.json({ entries, weekStart })
}
```

- [ ] **Step 2: Update `lib/types/friends.ts` LeaderboardEntry** to add allTimeSessions and allTimeVolumeKg:
```ts
// Add to LeaderboardEntry interface:
allTimeSessions: number
allTimeVolumeKg: number
```

- [ ] **Step 3: Commit**
```bash
git add app/api/friends/leaderboard/route.ts lib/types/friends.ts
git commit -m "Add GET /api/friends/leaderboard route"
```

---

## Task 9 — API: Public Profile + Seasons + Equip Title

**Files:**
- Create: `app/api/profile/[userId]/route.ts`
- Create: `app/api/seasons/route.ts`
- Create: `app/api/user/equipped-title/route.ts`

- [ ] **Step 1: Create `/api/profile/[userId]/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { getDb } from '@/lib/data/postgres/client'
import { sql } from 'drizzle-orm'

export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { userId } = await params

  const repo = await getRepository()
  // Verify friendship
  if (userId !== session.user.id) {
    const friendIds = await repo.getFriendIds(session.user.id)
    if (!friendIds.includes(userId)) {
      return NextResponse.json({ error: 'Not friends' }, { status: 403 })
    }
  }

  const db = getDb()
  // Fetch achievements data via the same queries as /api/achievements
  const achievementsRes = await fetch(
    `${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/api/achievements?userId=${userId}`,
    { headers: { 'x-internal': '1' } }
  )
  // Fallback: compute inline if internal fetch not available
  // For now return basic profile; achievements computed client-side via separate call
  const userRow = await db.execute(sql`
    SELECT id, COALESCE(display_name, name) as display_name, equipped_title, friend_code
    FROM users WHERE id = ${userId}::uuid
  `)
  const user = userRow.rows[0] as any
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [sessionsRes, volumeRes, streakRes, prCountRes] = await Promise.all([
    db.execute(sql`SELECT COUNT(DISTINCT ws.id)::int as count FROM workout_sessions ws JOIN exercise_logs el ON el.workout_session_id = ws.id WHERE ws.user_id = ${userId}::uuid`),
    db.execute(sql`SELECT COALESCE(SUM(el.volume),0)::float as total FROM exercise_logs el JOIN workout_sessions ws ON el.workout_session_id = ws.id WHERE ws.user_id = ${userId}::uuid`),
    db.execute(sql`SELECT DISTINCT (ws.started_at AT TIME ZONE 'Australia/Brisbane')::date as day FROM workout_sessions ws JOIN exercise_logs el ON el.workout_session_id = ws.id WHERE ws.user_id = ${userId}::uuid ORDER BY day DESC`),
    db.execute(sql`SELECT COUNT(*)::int as count FROM personal_records WHERE user_id = ${userId}::uuid`),
  ])

  return NextResponse.json({
    userId: user.id,
    displayName: user.display_name,
    equippedTitle: user.equipped_title,
    friendCode: user.friend_code,
    lifetimeStats: {
      sessions: (sessionsRes.rows[0] as any)?.count ?? 0,
      totalVolumeKg: Math.round((volumeRes.rows[0] as any)?.total ?? 0),
      bestStreak: (streakRes.rows as any[]).length,
    },
  })
}
```

- [ ] **Step 2: Create `/api/seasons/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getDb } from '@/lib/data/postgres/client'
import { sql } from 'drizzle-orm'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = getDb()
  const rows = await db.execute(sql`
    SELECT s.id, s.label, s.start_date, s.end_date,
           sr.rank, sr.sessions, sr.volume_kg, sr.badge_label
    FROM seasons s
    LEFT JOIN season_results sr ON sr.season_id = s.id AND sr.user_id = ${session.user.id}::uuid
    ORDER BY s.start_date DESC
  `)
  return NextResponse.json({ seasons: rows.rows })
}
```

- [ ] **Step 3: Create `/api/user/equipped-title/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { titleId } = await req.json()
  const repo = await getRepository()
  await repo.updateEquippedTitle(session.user.id, titleId ?? null)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Commit**
```bash
git add app/api/profile/[userId]/route.ts app/api/seasons/route.ts app/api/user/equipped-title/route.ts
git commit -m "Add public profile, seasons, and equipped-title API routes"
```

---

## Task 10 — Nav Restructure: /workout Route

**Files:**
- Create: `app/workout/page.tsx`
- Modify: `app/session-select/page.tsx`

- [ ] **Step 1: Create `app/workout/page.tsx`** (identical to session-select page, just different path)

```tsx
import { Suspense } from "react";
import SessionSelectContent from "@/app/session-select/session-select-content";
import { BottomNav } from "@/components/shell/bottom-nav";

export default async function WorkoutPage() {
  return (
    <>
      <Suspense fallback={null}>
        <SessionSelectContent />
      </Suspense>
      <BottomNav />
    </>
  );
}
```

- [ ] **Step 2: Make `app/session-select/page.tsx` redirect to /workout**

Replace its content with:
```tsx
import { redirect } from 'next/navigation'
export default function SessionSelectPage() {
  redirect('/workout')
}
```

- [ ] **Step 3: Commit**
```bash
git add app/workout/page.tsx app/session-select/page.tsx
git commit -m "Move session select to /workout, keep /session-select as redirect"
```

---

## Task 11 — Nav Restructure: /nutrition Route

**Files:**
- Create: `app/nutrition/page.tsx`
- Create: `app/nutrition/nutrition-content.tsx`

- [ ] **Step 1: Create `app/nutrition/nutrition-content.tsx`**

This extracts the nutrition tab content from `health-content.tsx`. Copy the following from health-content: all imports related to nutrition, all nutrition-related state, the nutrition tab JSX block (lines 914–980), and all nutrition-related sheets (FoodLoggerSheet, MealBuilderSheet, QuickEditLogSheet, NutritionTargetsForm, MealTypeManager).

The component signature:
```tsx
'use client'

// Copy all nutrition-related imports from health-content.tsx:
// MacroRing, MealCard, FoodLoggerSheet, QuickEditLogSheet, NutritionTargetsForm,
// MealTypeManager, WeeklyNutritionChart, WaterLogSheet, MealBuilderSheet, SavedMealsSection
// cachedFetch, readCacheSync, invalidateCache, todayInTz, toast
// All nutrition state variables from health-content.tsx

export default function NutritionContent() {
  // Copy all nutrition-related state from health-content.tsx:
  // mealTypes, nutritionLogs, nutritionTargets, weeklyNutrition,
  // foodLoggerOpen, mealBuilderOpen, quickEditLog, nutritionSettingsOpen,
  // activeMealType, calsBurnedToday
  // Copy useEffect hooks that fetch nutrition data
  // Copy all nutrition handlers (handleDeleteLog, handleQuickEdit, etc.)

  return (
    <div className="flex flex-col bg-background min-h-screen">
      <header className="px-4 pt-safe pb-3 border-b border-border flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">Nutrition</h1>
          <p className="text-sm text-muted-foreground">Food &amp; macros</p>
        </div>
        <button onClick={() => setNutritionSettingsOpen(true)} className="p-2 text-muted-foreground hover:text-foreground mt-1">
          <Settings className="w-4 h-4" />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto pb-20 px-4 pt-4 space-y-4" style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))' }}>
        {/* Paste nutrition tab JSX from health-content.tsx lines 916–980 */}
      </div>
      {/* Paste all nutrition sheets from health-content.tsx */}
    </div>
  )
}
```

**Important:** After creating this component, remove the nutrition state, nutrition handlers, and nutrition sheets from `health-content.tsx` since they now live in `nutrition-content.tsx`. The `tab === "nutrition"` branch in health-content becomes dead code and should be removed.

- [ ] **Step 2: Create `app/nutrition/page.tsx`**

```tsx
import { Suspense } from 'react'
import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { BottomNav } from '@/components/shell/bottom-nav'
import NutritionContent from './nutrition-content'

export default async function NutritionPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')
  return (
    <>
      <Suspense fallback={null}>
        <NutritionContent />
      </Suspense>
      <BottomNav />
    </>
  )
}
```

- [ ] **Step 3: Commit**
```bash
git add app/nutrition/page.tsx app/nutrition/nutrition-content.tsx
git commit -m "Extract nutrition to standalone /nutrition page"
```

---

## Task 12 — Health 3-Tab Restructure

**Files:**
- Modify: `app/health/health-content.tsx`

- [ ] **Step 1: Update tab type and tab bar**

Change line 27:
```ts
type Tab = "body" | "training" | "progress";
```

Replace the tab bar JSX (currently renders "nutrition" | "body") with:
```tsx
<div className="flex gap-1 px-4 pt-3 pb-0">
  {(["body", "training", "progress"] as Tab[]).map(t => (
    <button
      key={t}
      onClick={() => setTab(t)}
      className={`flex-1 rounded-xl py-2 text-sm font-semibold transition-colors ${
        tab === t
          ? "bg-foreground text-background"
          : "bg-muted/50 text-muted-foreground hover:bg-muted"
      }`}
    >
      {t === "body" ? "Body" : t === "training" ? "Training" : "Progress"}
    </button>
  ))}
</div>
```

Also update the default tab state: `const [tab, setTab] = useState<Tab>("body")`

And remove the settings gear icon that was conditional on `tab === "nutrition"`.

- [ ] **Step 2: Add Training tab content**

After the `{tab === "body" && ...}` block, add:
```tsx
{tab === "training" && (
  <div className="space-y-4">
    {/* Import and render StatsContent inline, or copy relevant components */}
    {/* The simplest approach: import the stats components directly */}
    <WeeklyStatsHub stats={weeklyStats} loading={statsLoading} />
    <CalendarWidget
      sessions={calendarSessions}
      onDayPress={(date) => handleDayPress(date)}
    />
    <WeeklySummaryCard />
  </div>
)}
```

Add the necessary imports and state for weekly stats, calendar data. Copy from `stats-content.tsx` the relevant `useEffect` hooks that fetch `/api/weekly-stats` and calendar data.

- [ ] **Step 3: Add Progress tab content**

```tsx
{tab === "progress" && (
  <div className="space-y-4">
    {/* Weight chart with 7/30/90 day toggle */}
    <WeightTrendChart metrics={bodyMetrics} />
    {/* Goal progress bars */}
    <GoalProgressSection goals={userGoals} meta={meta} />
    {/* Streak history */}
    <StreakHistoryCard workoutDates={workoutDates} />
  </div>
)}
```

Move goal progress bars and trend chart content from the Body tab into Progress tab. These are currently in the body tab — extract them.

- [ ] **Step 4: Remove nutrition tab remnants**

Remove all nutrition-related state, imports, and JSX from health-content.tsx (it now lives in nutrition-content.tsx).

- [ ] **Step 5: Commit**
```bash
git add app/health/health-content.tsx
git commit -m "Restructure health page: Body / Training / Progress tabs, remove nutrition tab"
```

---

## Task 13 — Update Bottom Nav

**Files:**
- Modify: `components/shell/bottom-nav.tsx`

- [ ] **Step 1: Replace TABS and active logic**

```tsx
import {
  HomeIcon, DumbbellIcon, HeartIcon, UtensilsIcon, MoreHorizontalIcon
} from 'lucide-react'

const TABS = [
  { label: "Home",      icon: HomeIcon,           href: "/"          },
  { label: "Nutrition", icon: UtensilsIcon,        href: "/nutrition" },
  { label: "Workout",   icon: DumbbellIcon,        href: "/workout"   },
  { label: "Health",    icon: HeartIcon,           href: "/health"    },
  { label: "More",      icon: MoreHorizontalIcon,  href: "/more"      },
] as const
```

Update the `active` logic:
```tsx
const active =
  label === "Home"
    ? pathname === "/"
    : label === "Workout"
    ? pathname.startsWith("/workout")
    : label === "More"
    ? pathname.startsWith("/more") || pathname.startsWith("/profile/")
    : pathname.startsWith(href)
```

The Workout tab keeps the elevated floating button style (same code, just new href `/workout`).

- [ ] **Step 2: Commit**
```bash
git add components/shell/bottom-nav.tsx
git commit -m "Update bottom nav: Home/Nutrition/Workout/Health/More"
```

---

## Task 14 — Simplified Home Dashboard

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Replace the redirect with a real dashboard page**

The current `app/page.tsx` just redirects to `/session-select`. Replace it with a server component that renders a simplified home:

```tsx
import { Suspense } from 'react'
import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { BottomNav } from '@/components/shell/bottom-nav'
import HomeDashboard from './home-dashboard'

export default async function HomePage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')
  return (
    <>
      <Suspense fallback={null}>
        <HomeDashboard />
      </Suspense>
      <BottomNav />
    </>
  )
}
```

- [ ] **Step 2: Create `app/home-dashboard.tsx`**

This is a client component that renders the non-workout portions of `session-select-content.tsx`:
- Morning briefing card (already a standalone component — import `MorningBriefingCard` or the sheet)
- Readiness/deload card
- Streak + This Week widgets
- The metric tile row (Steps, Sleep, Mood, Water, Weight, Nutrition summary)
- AI chat entry point

```tsx
'use client'

import { useEffect, useLayoutEffect, useState } from 'react'
import { readCacheSync } from '@/lib/sqlite/cache'
import { cachedFetch } from '@/lib/sqlite/cache'
import { TTL_MEDIUM } from '@/components/sync-provider'
// Import the same widget components used in session-select-content

export default function HomeDashboard() {
  // Minimal state: body metadata, readiness, morning briefing visibility
  // Reuse the same cachedFetch('/api/body-metadata') and cachedFetch('/api/readiness-score') patterns

  return (
    <div className="flex flex-col bg-background min-h-screen">
      <header className="px-4 pt-safe pb-3 border-b border-border">
        <h1 className="text-xl font-bold">Home</h1>
      </header>
      <div className="flex-1 overflow-y-auto pb-20 px-4 pt-4 space-y-4"
        style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))' }}>
        {/* Morning briefing, readiness, streak, metric tiles, AI chat */}
        {/* Copy just these sections from session-select-content.tsx */}
        {/* Do NOT copy the program session carousel */}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**
```bash
git add app/page.tsx app/home-dashboard.tsx
git commit -m "Replace home redirect with simplified dashboard"
```

---

## Task 15 — More Page Shell + Profile Tab

**Files:**
- Create: `app/more/page.tsx`
- Create: `app/more/more-content.tsx`
- Create: `components/more/profile-tab.tsx`
- Create: `components/more/config-tab.tsx`
- Modify: `app/profile/page.tsx` — redirect to /more
- Modify: `app/config/page.tsx` — redirect to /more?tab=config

- [ ] **Step 1: Create `components/more/profile-tab.tsx`**

```tsx
'use client'

import { useSession, signOut } from 'next-auth/react'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { UserIcon } from 'lucide-react'
import { TITLES } from '@/lib/types/friends'
import type { Season } from '@/lib/types/friends'
import EditProfileSheet from '@/components/profile/edit-profile-sheet'

export function ProfileTab() {
  const { data: session } = useSession()
  const [seasons, setSeasons] = useState<Season[]>([])
  const [editOpen, setEditOpen] = useState(false)

  useEffect(() => {
    fetch('/api/seasons').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.seasons) setSeasons(d.seasons)
    })
  }, [])

  const titleInfo = session?.user?.equippedTitle
    ? TITLES[session.user.equippedTitle]
    : null

  return (
    <div className="space-y-4 pb-8">
      {/* Identity card */}
      <div className="rounded-2xl border border-border p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
            <UserIcon className="w-7 h-7 text-muted-foreground" />
          </div>
          <div>
            <p className="font-bold text-base">{session?.user?.name ?? 'You'}</p>
            {titleInfo && (
              <p className="text-xs text-brand font-semibold">{titleInfo.display}</p>
            )}
            {session?.user?.friendCode && (
              <p className="text-xs text-muted-foreground font-mono">{session.user.friendCode}</p>
            )}
          </div>
        </div>
        <Button variant="outline" className="w-full" onClick={() => setEditOpen(true)}>
          Edit Profile
        </Button>
      </div>

      {/* Season badges */}
      {seasons.filter(s => s.result).length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Season Badges</p>
          <div className="flex gap-2 flex-wrap">
            {seasons.filter(s => s.result).map(s => (
              <div key={s.id} className="rounded-xl border px-3 py-2 text-center"
                style={{
                  borderColor: s.result!.badgeLabel === 'Gold' ? '#f59e0b' : s.result!.badgeLabel === 'Silver' ? '#94a3b8' : '#b45309',
                  background: s.result!.badgeLabel === 'Gold' ? 'rgba(245,158,11,0.1)' : s.result!.badgeLabel === 'Silver' ? 'rgba(148,163,184,0.1)' : 'rgba(180,83,9,0.1)',
                }}>
                <p className="text-[10px] font-bold" style={{ color: s.result!.badgeLabel === 'Gold' ? '#f59e0b' : s.result!.badgeLabel === 'Silver' ? '#94a3b8' : '#b45309' }}>
                  {s.result!.badgeLabel}
                </p>
                <p className="text-[10px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <Button variant="outline" className="w-full text-destructive border-destructive/30"
        onClick={() => signOut({ callbackUrl: '/sign-in' })}>
        Sign Out
      </Button>

      <EditProfileSheet open={editOpen} onOpenChange={setEditOpen} />
    </div>
  )
}
```

- [ ] **Step 2: Create `components/more/config-tab.tsx`**

```tsx
'use client'
import dynamic from 'next/dynamic'

const ConfigScreen = dynamic(() => import('@/components/config-screen'), { ssr: false })

export function ConfigTab() {
  return <ConfigScreen />
}
```

- [ ] **Step 3: Create `app/more/more-content.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ProfileTab } from '@/components/more/profile-tab'
import { ConfigTab } from '@/components/more/config-tab'

type Tab = 'profile' | 'achievements' | 'friends' | 'config'

export default function MoreContent() {
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<Tab>(
    (searchParams.get('tab') as Tab | null) ?? 'profile'
  )

  const tabs: { id: Tab; label: string }[] = [
    { id: 'profile',      label: 'Profile'      },
    { id: 'achievements', label: 'Achievements' },
    { id: 'friends',      label: 'Friends'      },
    { id: 'config',       label: 'Config'       },
  ]

  return (
    <div className="flex flex-col bg-background min-h-screen">
      <header className="px-4 pt-safe pb-3 border-b border-border">
        <h1 className="text-xl font-bold">More</h1>
      </header>

      {/* Tab bar */}
      <div className="flex gap-1 px-4 pt-3 pb-0 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-none rounded-xl px-3 py-2 text-sm font-semibold transition-colors whitespace-nowrap ${
              tab === t.id
                ? 'bg-foreground text-background'
                : 'bg-muted/50 text-muted-foreground hover:bg-muted'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto pb-20 px-4 pt-4"
        style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))' }}>
        {tab === 'profile'      && <ProfileTab />}
        {tab === 'achievements' && <div className="text-muted-foreground text-sm">Achievements coming in Task 16</div>}
        {tab === 'friends'      && <div className="text-muted-foreground text-sm">Friends coming in Task 20</div>}
        {tab === 'config'       && <ConfigTab />}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create `app/more/page.tsx`**

```tsx
import { Suspense } from 'react'
import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { BottomNav } from '@/components/shell/bottom-nav'
import MoreContent from './more-content'

export default async function MorePage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')
  return (
    <>
      <Suspense fallback={null}>
        <MoreContent />
      </Suspense>
      <BottomNav />
    </>
  )
}
```

- [ ] **Step 5: Redirect old routes**

`app/profile/page.tsx`:
```tsx
import { redirect } from 'next/navigation'
export default function ProfilePage() { redirect('/more') }
```

`app/config/page.tsx`:
```tsx
import { redirect } from 'next/navigation'
export default function ConfigPage() { redirect('/more?tab=config') }
```

- [ ] **Step 6: Commit**
```bash
git add app/more/ components/more/profile-tab.tsx components/more/config-tab.tsx app/profile/page.tsx app/config/page.tsx
git commit -m "Add /more page with Profile and Config tabs"
```

---

## Task 16 — Achievement Badge Redesign + Rarity Signal

**Files:**
- Modify: `components/profile/achievements-grid.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Add tier helpers to achievements-grid.tsx**

At the top of the file, add:
```ts
function getBadgeTier(xpReward: number): 'bronze' | 'silver' | 'gold' {
  if (xpReward >= 200) return 'gold'
  if (xpReward >= 50)  return 'silver'
  return 'bronze'
}

const TIER_STYLES = {
  bronze: { border: '#b45309', glow: 'rgba(180,83,9,0.3)',  bg: 'rgba(180,83,9,0.08)'  },
  silver: { border: '#94a3b8', glow: 'rgba(148,163,184,0.3)', bg: 'rgba(148,163,184,0.08)' },
  gold:   { border: '#f59e0b', glow: 'rgba(245,158,11,0.4)', bg: 'rgba(245,158,11,0.1)'  },
}
```

- [ ] **Step 2: Update `BadgeCard` to use tiers and show rarity**

Update the `BadgeCard` signature to accept optional props:
```tsx
function BadgeCard({
  achievement,
  isNew = false,
  rarityCount,
  totalFriends,
  size = 'normal',
}: {
  achievement: AchievementResult
  isNew?: boolean
  rarityCount?: number
  totalFriends?: number
  size?: 'normal' | 'large'
}) {
```

In the `unlocked` button style, replace the existing style with:
```tsx
const tier = getBadgeTier(xpReward)
const tierStyle = TIER_STYLES[tier]

// unlocked style:
{
  background: `color-mix(in oklch, ${color} 12%, var(--color-background))`,
  borderColor: tierStyle.border,
  boxShadow: `0 0 12px ${tierStyle.glow}`,
}
```

After the icon, add the rarity label when `totalFriends` is provided:
```tsx
{unlocked && totalFriends != null && (
  <p className="text-[8px] text-muted-foreground mt-0.5">
    {rarityCount ?? 0}/{totalFriends} friends
  </p>
)}
```

Add shimmer class when `isNew`:
```tsx
className={`... ${isNew ? 'shimmer-once' : ''}`}
```

- [ ] **Step 3: Add shimmer keyframe to `app/globals.css`**

```css
@keyframes shimmer-sweep {
  0%   { background-position: -200% center; }
  100% { background-position:  200% center; }
}

.shimmer-once {
  background-image: linear-gradient(
    105deg,
    transparent 40%,
    rgba(255,255,255,0.45) 50%,
    transparent 60%
  );
  background-size: 200% 100%;
  animation: shimmer-sweep 0.8s ease-out forwards;
}
```

- [ ] **Step 4: Update `AchievementsGrid` to compute new achievements via localStorage**

```tsx
export function AchievementsGrid({ achievements, onlyUnlocked = false, rarityMap = {}, totalFriends = 0 }: AchievementsGridProps) {
  const [newIds, setNewIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const seen: string[] = JSON.parse(localStorage.getItem('ta_seen_achievements') ?? '[]')
    const seenSet = new Set(seen)
    const justUnlocked = achievements.filter(a => a.unlocked && !seenSet.has(a.id)).map(a => a.id)
    if (justUnlocked.length > 0) {
      setNewIds(new Set(justUnlocked))
      localStorage.setItem('ta_seen_achievements', JSON.stringify([...seen, ...justUnlocked]))
    }
  }, [achievements])
  // ...
```

Pass `isNew={newIds.has(a.id)}`, `rarityCount={rarityMap[a.id]}`, `totalFriends={totalFriends}` to each `BadgeCard`.

Add `rarityMap` and `totalFriends` to the `AchievementsGridProps` interface.

- [ ] **Step 5: Commit**
```bash
git add components/profile/achievements-grid.tsx app/globals.css
git commit -m "Achievement badge tiers (bronze/silver/gold), shimmer on new unlock, rarity signal"
```

---

## Task 17 — Trophy Case + Title Picker

**Files:**
- Create: `components/more/trophy-case.tsx`
- Create: `components/more/title-picker-sheet.tsx`

- [ ] **Step 1: Create `components/more/trophy-case.tsx`**

```tsx
'use client'

import { useState, useEffect } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { AchievementResult } from '@/components/profile/achievements-grid'
import { ACHIEVEMENT_ICONS, CATEGORY_COLORS } from '@/components/profile/achievements-grid'
import { Dumbbell, PlusCircle } from 'lucide-react'

const TROPHY_KEY = 'ta_trophy_case'

interface TrophyCaseProps {
  achievements: AchievementResult[]
  editable?: boolean
}

export function TrophyCase({ achievements, editable = true }: TrophyCaseProps) {
  const [slots, setSlots] = useState<(string | null)[]>([null, null, null])
  const [picking, setPicking] = useState<number | null>(null)

  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem(TROPHY_KEY) ?? '[null,null,null]')
    setSlots(saved)
  }, [])

  const pin = (slotIdx: number, achievementId: string) => {
    const next = [...slots]
    next[slotIdx] = achievementId
    setSlots(next)
    localStorage.setItem(TROPHY_KEY, JSON.stringify(next))
    setPicking(null)
  }

  const unpin = (slotIdx: number) => {
    const next = [...slots]
    next[slotIdx] = null
    setSlots(next)
    localStorage.setItem(TROPHY_KEY, JSON.stringify(next))
  }

  const unlocked = achievements.filter(a => a.unlocked)

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Trophy Case</p>
      <div className="flex gap-3">
        {slots.map((id, i) => {
          const ach = id ? achievements.find(a => a.id === id) : null
          const Icon = ach ? (ACHIEVEMENT_ICONS[ach.id] ?? Dumbbell) : PlusCircle
          const color = ach ? (CATEGORY_COLORS[ach.category] ?? 'var(--color-brand)') : 'rgba(255,255,255,0.2)'
          return (
            <button
              key={i}
              onClick={() => editable && (ach ? unpin(i) : setPicking(i))}
              className="relative flex-1 aspect-square rounded-2xl border flex flex-col items-center justify-center"
              style={ach ? {
                background: `color-mix(in oklch, ${color} 15%, var(--color-background))`,
                borderColor: color,
                boxShadow: `0 0 16px color-mix(in oklch, ${color} 30%, transparent)`,
              } : { background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.1)' }}
            >
              <Icon className="h-10 w-10" style={{ color, filter: ach ? `drop-shadow(0 0 6px ${color})` : 'none' }} />
              {ach && <p className="text-[9px] font-semibold mt-1 text-center px-1 line-clamp-2" style={{ color }}>{ach.name}</p>}
              {!ach && editable && <p className="text-[9px] text-muted-foreground mt-1">Tap to pin</p>}
            </button>
          )
        })}
      </div>

      {/* Achievement picker popover */}
      {picking !== null && (
        <div className="mt-3 rounded-2xl border border-border bg-background/95 p-3 space-y-1 max-h-48 overflow-y-auto">
          <p className="text-xs text-muted-foreground mb-2">Choose an achievement to showcase:</p>
          {unlocked.map(a => (
            <button key={a.id} onClick={() => pin(picking, a.id)}
              className="w-full text-left flex items-center gap-2 rounded-xl p-2 hover:bg-muted/50 transition-colors">
              {(() => { const I = ACHIEVEMENT_ICONS[a.id] ?? Dumbbell; return <I className="h-4 w-4 flex-none" style={{ color: CATEGORY_COLORS[a.category] }} /> })()}
              <span className="text-sm">{a.name}</span>
              <span className="text-xs text-muted-foreground ml-auto">+{a.xpReward} XP</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create `components/more/title-picker-sheet.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { TITLES } from '@/lib/types/friends'
import {
  Swords, Shield, Rocket, Dumbbell, Crown, Trophy, Zap, Diamond,
  Sunrise, Moon, CheckCircle2, Bed, CalendarCheck, Activity, Star,
} from 'lucide-react'
import type { AchievementResult } from '@/components/profile/achievements-grid'

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  Swords, Shield, Rocket, Dumbbell, Crown, Trophy, Zap, Diamond,
  Sunrise, Moon, CheckCircle2, Bed, CalendarCheck, Activity, Star,
}

interface TitlePickerSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  achievements: AchievementResult[]
  equippedTitle: string | null
  onEquip: (titleId: string | null) => void
}

export function TitlePickerSheet({ open, onOpenChange, achievements, equippedTitle, onEquip }: TitlePickerSheetProps) {
  const [saving, setSaving] = useState(false)

  const unlockedAchIds = new Set(achievements.filter(a => a.unlocked).map(a => a.id))
  const availableTitles = Object.entries(TITLES).filter(([, t]) => unlockedAchIds.has(t.unlockedBy))

  const equip = async (titleId: string | null) => {
    setSaving(true)
    await fetch('/api/user/equipped-title', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titleId }),
    })
    onEquip(titleId)
    setSaving(false)
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[70vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Choose Your Title</SheetTitle>
        </SheetHeader>
        <div className="space-y-2 mt-4">
          <button
            onClick={() => equip(null)}
            className={`w-full flex items-center gap-3 rounded-xl p-3 border transition-colors ${
              equippedTitle === null ? 'border-brand bg-brand/10' : 'border-border hover:bg-muted/50'
            }`}
          >
            <span className="text-sm text-muted-foreground">No title</span>
          </button>
          {availableTitles.map(([id, title]) => {
            const Icon = ICON_MAP[title.lucideIcon] ?? Dumbbell
            const equipped = equippedTitle === id
            return (
              <button
                key={id}
                onClick={() => equip(id)}
                disabled={saving}
                className={`w-full flex items-center gap-3 rounded-xl p-3 border transition-colors ${
                  equipped ? 'border-brand bg-brand/10' : 'border-border hover:bg-muted/50'
                }`}
              >
                <Icon className="h-5 w-5 flex-none text-brand" />
                <span className="font-semibold text-sm">{title.display}</span>
                {equipped && <span className="ml-auto text-xs text-brand">Equipped</span>}
              </button>
            )
          })}
          {availableTitles.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              Unlock more achievements to earn titles.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 3: Commit**
```bash
git add components/more/trophy-case.tsx components/more/title-picker-sheet.tsx
git commit -m "Add TrophyCase and TitlePickerSheet components"
```

---

## Task 18 — Achievements Tab in More

**Files:**
- Create: `components/more/achievements-tab.tsx`
- Modify: `app/more/more-content.tsx`

- [ ] **Step 1: Create `components/more/achievements-tab.tsx`**

```tsx
'use client'

import { useState, useEffect } from 'react'
import { AchievementsGrid } from '@/components/profile/achievements-grid'
import { TrophyCase } from './trophy-case'
import { TitlePickerSheet } from './title-picker-sheet'
import { Button } from '@/components/ui/button'
import { LEVEL_THRESHOLDS } from '@/app/api/achievements/route'
import type { AchievementResult } from '@/components/profile/achievements-grid'

// Re-export or inline these from achievements route:
const LEVEL_THRESHOLDS_CLIENT = [0, 100, 250, 500, 900, 1400, 2100, 3000, 4200, 5800, 8000]

function getLevelLabel(level: number) {
  if (level <= 2) return 'Novice'
  if (level <= 4) return 'Beginner'
  if (level <= 6) return 'Intermediate'
  if (level <= 8) return 'Advanced'
  if (level <= 10) return 'Elite'
  return 'Legend'
}

interface AchievementsResponse {
  level: number; levelLabel: string; xp: number; currentLevelXp: number; nextLevelXp: number
  lifetimeStats: { sessions: number; totalVolumeKg: number; bestStreak: number }
  achievements: AchievementResult[]
}

export function AchievementsTab() {
  const [data, setData] = useState<AchievementsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [titlePickerOpen, setTitlePickerOpen] = useState(false)
  const [equippedTitle, setEquippedTitle] = useState<string | null>(null)
  const [rarityMap, setRarityMap] = useState<Record<string, number>>({})
  const [totalFriends, setTotalFriends] = useState(0)

  useEffect(() => {
    fetch('/api/achievements').then(r => r.ok ? r.json() : null).then(d => {
      if (d) setData(d)
      setLoading(false)
    })
    // Fetch friend count for rarity signal
    fetch('/api/friends').then(r => r.ok ? r.json() : null).then(d => {
      const accepted = (d?.friendships ?? []).filter((f: any) => f.status === 'accepted')
      setTotalFriends(accepted.length)
      // For a proper rarity map, we'd need a dedicated endpoint.
      // For now, leave empty — can enhance later with /api/friends/rarity
    })
  }, [])

  useEffect(() => {
    // Read equipped title from session (via a simple fetch or session hook)
    fetch('/api/auth/session').then(r => r.ok ? r.json() : null).then(d => {
      setEquippedTitle(d?.user?.equippedTitle ?? null)
    })
  }, [])

  if (loading) return <div className="animate-pulse h-40 rounded-2xl bg-muted" />

  const xp = data?.xp ?? 0
  const level = data?.level ?? 1
  const levelLabel = data?.levelLabel ?? 'Novice'
  const nextLevelXp = data?.nextLevelXp ?? 100
  const currentLevelXp = data?.currentLevelXp ?? 0
  const xpProgress = nextLevelXp > currentLevelXp
    ? (xp - currentLevelXp) / (nextLevelXp - currentLevelXp)
    : 1

  return (
    <div className="space-y-5 pb-8">
      {/* Level + XP */}
      <div className="rounded-2xl border border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-2xl font-bold">Level {level}</p>
            <p className="text-sm text-muted-foreground">{levelLabel}</p>
          </div>
          <p className="text-sm font-mono text-muted-foreground">{xp} XP</p>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.round(xpProgress * 100)}%` }} />
        </div>
        <p className="text-xs text-muted-foreground mt-1">{xp - currentLevelXp} / {nextLevelXp - currentLevelXp} XP to next level</p>
      </div>

      {/* Lifetime stats */}
      {data?.lifetimeStats && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Sessions', value: data.lifetimeStats.sessions },
            { label: 'Volume', value: `${Math.round(data.lifetimeStats.totalVolumeKg / 1000)}k kg` },
            { label: 'Best Streak', value: `${data.lifetimeStats.bestStreak}d` },
          ].map(s => (
            <div key={s.label} className="rounded-2xl border border-border p-3 text-center">
              <p className="text-xl font-bold">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Trophy case */}
      {data?.achievements && <TrophyCase achievements={data.achievements} />}

      {/* Title picker button */}
      <Button variant="outline" className="w-full" onClick={() => setTitlePickerOpen(true)}>
        {equippedTitle ? `Title: ${equippedTitle.replace(/_/g, ' ')}` : 'Choose a Title'}
      </Button>

      {/* Achievement grid */}
      {data?.achievements && (
        <AchievementsGrid
          achievements={data.achievements}
          rarityMap={rarityMap}
          totalFriends={totalFriends}
        />
      )}

      {data?.achievements && (
        <TitlePickerSheet
          open={titlePickerOpen}
          onOpenChange={setTitlePickerOpen}
          achievements={data.achievements}
          equippedTitle={equippedTitle}
          onEquip={setEquippedTitle}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire into `more-content.tsx`**

Replace the placeholder for `achievements` tab:
```tsx
import { AchievementsTab } from '@/components/more/achievements-tab'
// ...
{tab === 'achievements' && <AchievementsTab />}
```

- [ ] **Step 3: Commit**
```bash
git add components/more/achievements-tab.tsx app/more/more-content.tsx
git commit -m "Add Achievements tab to More page with trophy case and title picker"
```

---

## Task 19 — Friends Tab UI

**Files:**
- Create: `components/more/friend-feed.tsx`
- Create: `components/more/friend-leaderboard.tsx`
- Create: `components/more/manage-friends-sheet.tsx`
- Create: `components/more/friends-tab.tsx`
- Modify: `app/more/more-content.tsx`

- [ ] **Step 1: Create `components/more/friend-feed.tsx`**

```tsx
'use client'

import { Dumbbell, Trophy } from 'lucide-react'
import type { FeedEvent } from '@/lib/types/friends'
import { TITLES } from '@/lib/types/friends'

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function FriendFeed({ events }: { events: FeedEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">No activity yet. Add friends to see their progress here.</p>
  }
  return (
    <div className="space-y-3">
      {events.map(ev => {
        const title = ev.equippedTitle ? TITLES[ev.equippedTitle]?.display : null
        return (
          <div key={ev.id} className="rounded-2xl border border-border p-3 flex gap-3 items-start">
            <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center flex-none">
              {ev.type === 'pr' ? <Trophy className="h-4 w-4 text-amber-400" /> : <Dumbbell className="h-4 w-4 text-brand" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">
                {ev.displayName}
                {title && <span className="ml-1 text-xs text-brand font-normal">· {title}</span>}
              </p>
              <p className="text-sm text-muted-foreground">
                {ev.type === 'pr'
                  ? `New PR: ${ev.exerciseName} @ ${ev.estimated1rm?.toFixed(1)} kg`
                  : `Completed a workout · ${ev.volumeKg} kg volume`}
              </p>
            </div>
            <span className="text-xs text-muted-foreground flex-none">{timeAgo(ev.occurredAt)}</span>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Create `components/more/friend-leaderboard.tsx`**

```tsx
'use client'

import { useState } from 'react'
import type { LeaderboardEntry } from '@/lib/types/friends'
import { TITLES } from '@/lib/types/friends'

type Metric = 'sessions' | 'volume' | 'streak'

export function FriendLeaderboard({ entries }: { entries: LeaderboardEntry[] }) {
  const [period, setPeriod] = useState<'weekly' | 'alltime'>('weekly')
  const [metric, setMetric] = useState<Metric>('sessions')

  const getValue = (e: LeaderboardEntry) => {
    if (period === 'weekly') {
      return metric === 'sessions' ? e.weeklySessions : metric === 'volume' ? e.weeklyVolumeKg : e.currentStreak
    }
    return metric === 'sessions' ? e.allTimeSessions : metric === 'volume' ? e.allTimeVolumeKg : e.currentStreak
  }

  const sorted = [...entries].sort((a, b) => getValue(b) - getValue(a))
  const maxVal = Math.max(...sorted.map(getValue), 1)

  return (
    <div className="space-y-4">
      {/* Period toggle */}
      <div className="flex gap-1">
        {(['weekly', 'alltime'] as const).map(p => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`flex-1 rounded-xl py-1.5 text-sm font-semibold transition-colors ${period === p ? 'bg-foreground text-background' : 'bg-muted/50 text-muted-foreground'}`}>
            {p === 'weekly' ? 'This Week' : 'All Time'}
          </button>
        ))}
      </div>

      {/* Metric toggle */}
      <div className="flex gap-1">
        {([['sessions', 'Sessions'], ['volume', 'Volume'], ['streak', 'Streak']] as [Metric, string][]).map(([m, label]) => (
          <button key={m} onClick={() => setMetric(m)}
            className={`flex-1 rounded-xl py-1.5 text-xs font-semibold transition-colors ${metric === m ? 'bg-brand text-white' : 'bg-muted/50 text-muted-foreground'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Entries */}
      {sorted.map((entry, i) => {
        const val = getValue(entry)
        const title = entry.equippedTitle ? TITLES[entry.equippedTitle]?.display : null
        const chasing = !entry.isYou && (() => {
          const me = entries.find(e => e.isYou)
          if (!me) return false
          const myVal = getValue(me)
          return val > myVal && (val - myVal) / myVal <= 0.1
        })()

        return (
          <div key={entry.userId}
            className={`flex items-center gap-3 rounded-2xl border p-3 ${entry.isYou ? 'border-brand bg-brand/5' : 'border-border'}`}>
            <span className="text-sm font-bold w-5 text-center text-muted-foreground">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">
                {entry.displayName}
                {entry.isYou && <span className="ml-1 text-xs text-brand">(you)</span>}
                {chasing && <span className="ml-1">👀</span>}
              </p>
              {title && <p className="text-xs text-brand">{title}</p>}
              <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-brand transition-all"
                  style={{ width: `${(val / maxVal) * 100}%` }} />
              </div>
            </div>
            <span className="font-bold text-sm tabular-nums">
              {metric === 'volume' ? `${val.toLocaleString()} kg` : metric === 'streak' ? `${val}d` : val}
            </span>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Create `components/more/manage-friends-sheet.tsx`**

```tsx
'use client'

import { useState, useEffect } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import type { Friendship } from '@/lib/types/friends'

interface ManageFriendsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate: () => void
}

export function ManageFriendsSheet({ open, onOpenChange, onUpdate }: ManageFriendsSheetProps) {
  const [friendships, setFriendships] = useState<Friendship[]>([])
  const [addInput, setAddInput] = useState('')
  const [adding, setSaving] = useState(false)

  useEffect(() => {
    if (open) fetch('/api/friends').then(r => r.ok ? r.json() : null).then(d => {
      setFriendships(d?.friendships ?? [])
    })
  }, [open])

  const pending = friendships.filter(f => f.status === 'pending' && f.addresseeId !== undefined)
  const accepted = friendships.filter(f => f.status === 'accepted')

  const sendRequest = async () => {
    if (!addInput.trim()) return
    setSaving(true)
    const res = await fetch('/api/friends', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailOrCode: addInput.trim() }),
    })
    const data = await res.json()
    if (res.ok) {
      toast.success('Friend request sent')
      setAddInput('')
      onUpdate()
    } else {
      toast.error(data.error ?? 'Failed to send request')
    }
    setSaving(false)
  }

  const accept = async (id: string) => {
    await fetch(`/api/friends/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'accept' }),
    })
    toast.success('Friend added!')
    setFriendships(prev => prev.map(f => f.id === id ? { ...f, status: 'accepted' } : f))
    onUpdate()
  }

  const decline = async (id: string) => {
    await fetch(`/api/friends/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'decline' }),
    })
    setFriendships(prev => prev.filter(f => f.id !== id))
  }

  const remove = async (id: string) => {
    await fetch(`/api/friends/${id}`, { method: 'DELETE' })
    setFriendships(prev => prev.filter(f => f.id !== id))
    onUpdate()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
        <SheetHeader><SheetTitle>Friends</SheetTitle></SheetHeader>

        <div className="mt-4 space-y-4">
          {/* Add friend */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">Add by email or friend code (e.g. TRN-4X9K)</p>
            <div className="flex gap-2">
              <Input value={addInput} onChange={e => setAddInput(e.target.value)}
                placeholder="email or TRN-XXXX" onKeyDown={e => e.key === 'Enter' && sendRequest()} />
              <Button onClick={sendRequest} disabled={adding || !addInput.trim()}>Add</Button>
            </div>
          </div>

          {/* Pending requests */}
          {pending.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Pending</p>
              {pending.map(f => (
                <div key={f.id} className="flex items-center justify-between rounded-xl border border-border p-3 mb-2">
                  <p className="text-sm">{f.friend.displayName ?? f.friend.name ?? 'Someone'}</p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => accept(f.id)}>Accept</Button>
                    <Button size="sm" variant="outline" onClick={() => decline(f.id)}>Decline</Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Friends list */}
          {accepted.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Friends ({accepted.length})</p>
              {accepted.map(f => (
                <div key={f.id} className="flex items-center justify-between rounded-xl border border-border p-3 mb-2">
                  <div>
                    <p className="text-sm font-semibold">{f.friend.displayName ?? f.friend.name ?? 'Friend'}</p>
                    {f.friend.friendCode && <p className="text-xs text-muted-foreground font-mono">{f.friend.friendCode}</p>}
                  </div>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(f.id)}>Remove</Button>
                </div>
              ))}
            </div>
          )}

          {accepted.length === 0 && pending.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No friends yet. Add someone above!</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 4: Create `components/more/friends-tab.tsx`**

```tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { FriendFeed } from './friend-feed'
import { FriendLeaderboard } from './friend-leaderboard'
import { ManageFriendsSheet } from './manage-friends-sheet'
import { Button } from '@/components/ui/button'
import { Users } from 'lucide-react'
import type { FeedEvent, LeaderboardEntry } from '@/lib/types/friends'

export function FriendsTab() {
  const [view, setView] = useState<'feed' | 'leaderboard'>('feed')
  const [manageOpen, setManageOpen] = useState(false)
  const [feedEvents, setFeedEvents] = useState<FeedEvent[]>([])
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/friends/feed').then(r => r.ok ? r.json() : { events: [] }),
      fetch('/api/friends/leaderboard').then(r => r.ok ? r.json() : { entries: [] }),
    ]).then(([feedData, boardData]) => {
      setFeedEvents(feedData.events ?? [])
      setLeaderboard(boardData.entries ?? [])
      setLoading(false)
    })
  }, [])

  useEffect(() => { loadData() }, [loadData])

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {(['feed', 'leaderboard'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors ${view === v ? 'bg-foreground text-background' : 'bg-muted/50 text-muted-foreground'}`}>
              {v === 'feed' ? 'Feed' : 'Leaderboard'}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => setManageOpen(true)}>
          <Users className="h-4 w-4 mr-1" />
          Manage
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-16 rounded-2xl bg-muted animate-pulse" />)}
        </div>
      ) : view === 'feed' ? (
        <FriendFeed events={feedEvents} />
      ) : (
        <FriendLeaderboard entries={leaderboard} />
      )}

      <ManageFriendsSheet open={manageOpen} onOpenChange={setManageOpen} onUpdate={loadData} />
    </div>
  )
}
```

- [ ] **Step 5: Wire Friends tab into more-content.tsx**

```tsx
import { FriendsTab } from '@/components/more/friends-tab'
// ...
{tab === 'friends' && <FriendsTab />}
```

- [ ] **Step 6: Commit**
```bash
git add components/more/friend-feed.tsx components/more/friend-leaderboard.tsx components/more/manage-friends-sheet.tsx components/more/friends-tab.tsx app/more/more-content.tsx
git commit -m "Add Friends tab with feed, leaderboard, and manage sheet"
```

---

## Task 20 — Public Profile Page

**Files:**
- Create: `app/profile/[userId]/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { BottomNav } from '@/components/shell/bottom-nav'
import PublicProfileContent from './profile-content'

export default async function PublicProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')
  const { userId } = await params
  return (
    <>
      <PublicProfileContent userId={userId} />
      <BottomNav />
    </>
  )
}
```

- [ ] **Step 2: Create `app/profile/[userId]/profile-content.tsx`**

```tsx
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Trophy } from 'lucide-react'
import { AchievementBadges } from '@/components/profile/achievements-grid'
import { TrophyCase } from '@/components/more/trophy-case'
import { TITLES } from '@/lib/types/friends'
import type { AchievementResult } from '@/components/profile/achievements-grid'

interface ProfileData {
  displayName: string
  equippedTitle: string | null
  friendCode: string | null
  lifetimeStats: { sessions: number; totalVolumeKg: number; bestStreak: number }
}

export default function PublicProfileContent({ userId }: { userId: string }) {
  const router = useRouter()
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [achievements, setAchievements] = useState<AchievementResult[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch(`/api/profile/${userId}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/achievements?userId=${userId}`).then(r => r.ok ? r.json() : null),
    ]).then(([p, a]) => {
      if (p) setProfile(p)
      if (a?.achievements) setAchievements(a.achievements.filter((x: AchievementResult) => x.unlocked))
      setLoading(false)
    })
  }, [userId])

  if (loading) return <div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-brand" /></div>
  if (!profile) return <div className="flex items-center justify-center h-screen"><p className="text-muted-foreground">Profile not found.</p></div>

  const titleInfo = profile.equippedTitle ? TITLES[profile.equippedTitle] : null

  return (
    <div className="flex flex-col bg-background min-h-screen">
      <header className="px-4 pt-safe pb-3 border-b border-border flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">{profile.displayName ?? 'Friend'}</h1>
          {titleInfo && <p className="text-sm text-brand font-semibold">{titleInfo.display}</p>}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pb-20 px-4 pt-4 space-y-5"
        style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))' }}>
        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Sessions', value: profile.lifetimeStats.sessions },
            { label: 'Volume', value: `${Math.round(profile.lifetimeStats.totalVolumeKg / 1000)}k kg` },
            { label: 'Best Streak', value: `${profile.lifetimeStats.bestStreak}d` },
          ].map(s => (
            <div key={s.label} className="rounded-2xl border border-border p-3 text-center">
              <p className="text-xl font-bold">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Trophy case — read-only */}
        {achievements.length > 0 && <TrophyCase achievements={achievements} editable={false} />}

        {/* All unlocked achievements */}
        {achievements.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              Achievements ({achievements.length})
            </p>
            <AchievementBadges achievements={achievements} />
          </div>
        )}
      </div>
    </div>
  )
}
```

Note: the `/api/achievements` route currently only supports the logged-in user. For viewing a friend's achievements, the route needs a `?userId=` query param with a friendship check. Add this to the achievements route:

In `app/api/achievements/route.ts`, update the GET handler:
```ts
export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const targetId = url.searchParams.get('userId')

  let userId = session.user.id
  if (targetId && targetId !== session.user.id) {
    // Verify friendship
    const repo = await getRepository()
    const friendIds = await repo.getFriendIds(session.user.id)
    if (!friendIds.includes(targetId)) {
      return NextResponse.json({ error: 'Not friends' }, { status: 403 })
    }
    userId = targetId
  }
  // rest of the route uses `userId` variable instead of `session.user.id`
```

- [ ] **Step 3: Commit**
```bash
git add app/profile/[userId]/ app/api/achievements/route.ts
git commit -m "Add public friend profile page; achievements route supports userId param"
```

---

## Task 21 — Share Milestone Card

**Files:**
- Create: `components/more/share-milestone-card.tsx`
- Modify: `components/profile/achievements-grid.tsx`

- [ ] **Step 1: Create `components/more/share-milestone-card.tsx`**

```tsx
'use client'

import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Share2 } from 'lucide-react'
import type { AchievementResult } from '@/components/profile/achievements-grid'
import { ACHIEVEMENT_ICONS, CATEGORY_COLORS } from '@/components/profile/achievements-grid'
import { Dumbbell } from 'lucide-react'

interface ShareMilestoneCardProps {
  achievement: AchievementResult
  displayName: string
}

export function ShareMilestoneCard({ achievement, displayName }: ShareMilestoneCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const Icon = ACHIEVEMENT_ICONS[achievement.id] ?? Dumbbell
  const color = CATEGORY_COLORS[achievement.category] ?? 'var(--color-brand)'

  const share = async () => {
    const text = `🏆 ${displayName} just unlocked "${achievement.name}" on TrainingAI! ${achievement.description}`
    if (navigator.share) {
      await navigator.share({ title: 'Achievement Unlocked!', text })
    } else {
      await navigator.clipboard.writeText(text)
      // toast('Copied to clipboard!')
    }
  }

  return (
    <div className="space-y-3">
      {/* Visual card for screenshot */}
      <div ref={cardRef}
        className="rounded-3xl p-6 flex flex-col items-center gap-3 border"
        style={{
          background: `linear-gradient(135deg, color-mix(in oklch, ${color} 20%, #000), color-mix(in oklch, ${color} 8%, #000))`,
          borderColor: color,
          boxShadow: `0 0 40px color-mix(in oklch, ${color} 30%, transparent)`,
        }}>
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color }}>Achievement Unlocked</p>
        <Icon className="h-16 w-16" style={{ color, filter: `drop-shadow(0 0 12px ${color})` }} />
        <p className="text-2xl font-bold text-white text-center">{achievement.name}</p>
        <p className="text-sm text-white/70 text-center">{achievement.description}</p>
        <p className="text-sm font-bold" style={{ color }}>+{achievement.xpReward} XP · TrainingAI</p>
      </div>
      <Button className="w-full" onClick={share}>
        <Share2 className="h-4 w-4 mr-2" />
        Share
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Add Share button to BadgeCard in achievements-grid.tsx**

In the `PopoverContent` of `BadgeCard`, add a Share button when `xpReward >= 100` and `unlocked`:
```tsx
{unlocked && xpReward >= 100 && (
  <div className="mt-3">
    <ShareMilestoneCard achievement={achievement} displayName="" />
  </div>
)}
```

Import `ShareMilestoneCard` at the top of `achievements-grid.tsx`. The `displayName` will come from session — pass it as a prop to `AchievementsGrid` and down to `BadgeCard`:

Add `displayName?: string` prop to `AchievementsGridProps` and pass through.

- [ ] **Step 3: Commit**
```bash
git add components/more/share-milestone-card.tsx components/profile/achievements-grid.tsx
git commit -m "Add ShareMilestoneCard component for big achievement unlocks"
```

---

## Task 22 — Weekly Digest Friend Context

**Files:**
- Modify: `app/api/weekly-digest/route.ts`

- [ ] **Step 1: Add friend context to digest prompt**

After computing `context` (around line 64), add:
```ts
// Friends context
let friendContext = ''
try {
  const repo = await getRepository()
  const friendIds = await repo.getFriendIds(userId)
  if (friendIds.length > 0) {
    const idList = friendIds.map(id => `'${id}'::uuid`).join(',')
    const db = (await import('@/lib/data/postgres/client')).getDb()
    const { sql } = await import('drizzle-orm')
    const friendVolRow = await db.execute(sql`
      SELECT COALESCE(u.display_name, u.name) as name, COALESCE(SUM(el.volume), 0)::float as vol
      FROM workout_sessions ws
      JOIN users u ON ws.user_id = u.id
      LEFT JOIN exercise_logs el ON el.workout_session_id = ws.id
      WHERE ws.user_id IN (${sql.raw(idList)})
        AND ws.started_at >= ${thisWeekStart.toISOString()}::timestamptz
        AND ws.completed_at IS NOT NULL
      GROUP BY u.id ORDER BY vol DESC LIMIT 1
    `)
    const topFriend = friendVolRow.rows[0] as any
    if (topFriend?.name) {
      friendContext = `\nFriend leaderboard: ${topFriend.name} leads with ${Math.round(topFriend.vol)} kg volume this week.`
    }
  }
} catch { /* non-critical */ }
```

Then append to the prompt:
```ts
prompt: `...${context}${friendContext}`,
```

- [ ] **Step 2: Commit**
```bash
git add app/api/weekly-digest/route.ts
git commit -m "Add friend context line to weekly digest prompt"
```

---

## Task 23 — Deferred: Activity Logging Placeholder

**Files:**
- Modify: `app/session-select/session-select-content.tsx` (or `app/workout/page.tsx` area)

- [ ] **Step 1: Add "Log Activity" placeholder button**

In `session-select-content.tsx`, find the area below the session cards (search for the section dividers after the program session carousel). Add before the first widget section:

```tsx
import { PlusCircle } from 'lucide-react'
import { toast } from 'sonner'

// After the session carousel JSX:
<button
  onClick={() => toast.info('Activity logging coming soon!')}
  className="w-full flex items-center gap-3 rounded-2xl border border-dashed border-border/60 p-4 text-muted-foreground hover:border-brand/40 hover:text-foreground transition-colors"
>
  <PlusCircle className="h-5 w-5 flex-none" />
  <span className="text-sm font-medium">Log Activity (Run, Stretch, Cycle...)</span>
</button>
```

- [ ] **Step 2: Commit**
```bash
git add app/session-select/session-select-content.tsx
git commit -m "Add Log Activity placeholder button on workout page (coming soon)"
```

---

## Task 24 — Push to Branch

- [ ] **Step 1: Final lint check**
```bash
cd /home/user/TrainingAI && pnpm lint 2>&1 | tail -20
```

- [ ] **Step 2: Run tests**
```bash
cd /home/user/TrainingAI && pnpm test 2>&1 | tail -20
```

- [ ] **Step 3: Push**
```bash
git push -u origin claude/implementation-plan-status-8iJ9G
```

---

## Spec Coverage Check

| Spec section | Task(s) |
|---|---|
| Nav 5-tab restructure | 10, 11, 13, 14 |
| /nutrition route | 11 |
| /workout route (session select moved) | 10 |
| /health 3 tabs (Body/Training/Progress) | 12 |
| /more 4 tabs (Profile/Achievements/Friends/Config) | 15, 18, 19 |
| DB migration (friendships, seasons, user cols) | 1, 2 |
| Friend code generation | 3 |
| Add friend by email or code | 5, 19 |
| Accept/decline/remove | 6, 19 |
| Activity feed | 7, 19 |
| Leaderboard (weekly + all-time) | 8, 19 |
| Chasing indicator 👀 | 19 (FriendLeaderboard) |
| Public profile page | 20 |
| Rarity signal | 16 |
| Achievement progress visible to friends | 20 |
| Season system + badges | 9, 15 |
| Shareable milestone cards | 21 |
| Weekly digest friend context | 22 |
| Title system (16 titles, equippable) | 2 (types), 3 (DB), 9 (API), 17 (UI), 18 |
| Trophy case (3 pinned slots) | 17, 18 |
| Achievement tier borders + shimmer | 16 |
| Push notifications | ⚠️ Deferred — infrastructure (service worker push subscription) does not exist |
| Activity logging placeholder | 23 |

**Push notifications are deferred.** The app has a service worker but no push subscription infrastructure. Implementing it requires: registering a push subscription in the SW, a `/api/push/subscribe` endpoint, storing subscriptions in DB, and a trigger in the `/api/friends/feed` write path. Note for next session.
