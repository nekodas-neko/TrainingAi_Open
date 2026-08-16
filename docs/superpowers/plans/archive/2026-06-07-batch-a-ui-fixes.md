> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Batch A — UI / UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 14 UI/UX issues across home screen navigation, profile cleanup, body screen data tiles, and add a sex field to the user profile for BMI/energy balance calculations.

**Architecture:** Changes are spread across 11 files. The sex field threads through DB → schema → type declarations → auth callbacks → repository → API → UI. Body screen gains five new metric tiles, all computed client-side from data already fetched (plus one new API field `calsBurnedToday`). No new DB tables — one new column.

**Tech Stack:** Next.js 15, React 19, TypeScript, Drizzle ORM, PostgreSQL, NextAuth v5 (JWT sessions), Tailwind CSS v4, lucide-react

---

## File Map

| File | What changes |
|------|-------------|
| `lib/data/postgres/migrations/050_users_sex.sql` | **CREATE** — adds `sex` column to users |
| `lib/data/postgres/schema.ts` | Add `sex` to users table definition |
| `types/next-auth.d.ts` | Add `sex`, `heightCm`, `dateOfBirth` to Session/User/JWT types |
| `auth.config.ts` | Pass `sex`, `heightCm`, `dateOfBirth` through JWT → session callbacks |
| `auth.ts` | Pass `sex`, `heightCm`, `dateOfBirth` from DB user through signIn |
| `lib/data/repository.ts` | Add `sex` to `updateUserProfile` Pick |
| `lib/data/postgres/adapter.ts` | Add `sex` to `updateUserProfile` implementation |
| `app/api/user/profile/route.ts` | Accept `sex` in PATCH body |
| `components/profile/edit-profile-sheet.tsx` | Add sex toggle (Male / Female / Other) |
| `app/api/body-metadata/route.ts` | Add `calsBurnedToday` to GET response |
| `app/session-select/session-select-content.tsx` | Tile nav + Log chip, streak nav, mood icon |
| `app/profile/profile-content.tsx` | Remove "View all", rename Goals, safe zone |
| `components/config-screen.tsx` | Advanced Settings accordion around Phase Sets + Progression Styles |
| `app/health/health-content.tsx` | Remove mood, fix biometric tiles, add 5 new metric tiles |

---

## Task 1: DB Migration — Add `sex` Column

**Files:**
- Create: `lib/data/postgres/migrations/050_users_sex.sql`
- Modify: `lib/data/postgres/schema.ts`

- [ ] **Step 1.1: Create migration file**

```sql
-- 050_users_sex.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS sex text;
```

Save to `lib/data/postgres/migrations/050_users_sex.sql`.

- [ ] **Step 1.2: Add `sex` to the Drizzle schema**

Open `lib/data/postgres/schema.ts`. Find the `users` pgTable definition. It currently ends with:
```ts
  timezone:     text('timezone').notNull().default('Australia/Brisbane'),
  foodRegion:   text('food_region').notNull().default('AU'),
})
```

Add `sex` before the closing `})`:
```ts
  timezone:     text('timezone').notNull().default('Australia/Brisbane'),
  foodRegion:   text('food_region').notNull().default('AU'),
  sex:          text('sex'),
})
```

- [ ] **Step 1.3: Add `sex` to the `User` type**

Open `lib/types/index.ts` (or wherever `User` is defined — search for `export type User` or `export interface User`). Add `sex?: string | null` to the User type. If User is inferred from the Drizzle schema via `InferSelectModel`, no separate change is needed — Drizzle will pick it up automatically.

- [ ] **Step 1.4: Commit**

```bash
git add lib/data/postgres/migrations/050_users_sex.sql lib/data/postgres/schema.ts
git commit -m "Add sex column to users table"
```

---

## Task 2: Thread `sex`, `heightCm`, `dateOfBirth` Through the Session

The health screen needs `heightCm`, `dateOfBirth`, and `sex` to compute BMI and energy balance client-side. These are added to the JWT so `useSession()` provides them without an extra API call.

**Files:**
- Modify: `types/next-auth.d.ts`
- Modify: `auth.config.ts`
- Modify: `auth.ts`

- [ ] **Step 2.1: Extend NextAuth type declarations**

Open `types/next-auth.d.ts`. Replace the entire file contents with:

```ts
import "next-auth"
import "next-auth/jwt"

declare module "next-auth" {
  interface Session {
    refreshToken?: string
    isActive?: boolean
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
      timezone?: string
      isAdmin?: boolean
      sex?: string | null
      heightCm?: number | null
      dateOfBirth?: string | null
    }
  }
  interface User {
    isActive?: boolean
    isAdmin?: boolean
    timezone?: string
    sex?: string | null
    heightCm?: number | null
    dateOfBirth?: string | null
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string
    refreshToken?: string
    isActive?: boolean
    isAdmin?: boolean
    timezone?: string
    sex?: string | null
    heightCm?: number | null
    dateOfBirth?: string | null
  }
}
```

- [ ] **Step 2.2: Pass fields through JWT → session in `auth.config.ts`**

Open `auth.config.ts`. Find the `callbacks` object. The `jwt` callback currently ends with:
```ts
if (user?.timezone) token.timezone = user.timezone
```

Add three more lines after it:
```ts
if (user?.timezone) token.timezone = user.timezone
if ('sex' in (user ?? {})) token.sex = (user as any).sex ?? null
if ('heightCm' in (user ?? {})) token.heightCm = (user as any).heightCm ?? null
if ('dateOfBirth' in (user ?? {})) token.dateOfBirth = (user as any).dateOfBirth ?? null
```

In the `session` callback, after:
```ts
if (token.timezone) session.user.timezone = token.timezone
```

Add:
```ts
if (token.timezone) session.user.timezone = token.timezone
session.user.sex = token.sex ?? null
session.user.heightCm = token.heightCm ?? null
session.user.dateOfBirth = token.dateOfBirth ?? null
```

- [ ] **Step 2.3: Pass fields from DB user through `signIn` in `auth.ts`**

Open `auth.ts`. The `signIn` callback populates user fields from the DB. Find the block that sets `user.timezone = existing.timezone` (around line 60) and add after it:
```ts
user.timezone = existing.timezone
;(user as any).sex = existing.sex ?? null
;(user as any).heightCm = existing.heightCm ?? null
;(user as any).dateOfBirth = existing.dateOfBirth ?? null
```

Find the equivalent block for `dbUser` (around line 73):
```ts
user.timezone = dbUser.timezone
;(user as any).sex = (dbUser as any).sex ?? null
;(user as any).heightCm = dbUser.heightCm ?? null
;(user as any).dateOfBirth = dbUser.dateOfBirth ?? null
```

Also find the Credentials `authorize` return object (around line 34–40) and add:
```ts
return {
  id: user.id,
  email: user.email,
  name: user.name ?? null,
  isActive: user.isActive,
  isAdmin: user.isAdmin,
  timezone: user.timezone,
  sex: (user as any).sex ?? null,
  heightCm: user.heightCm ?? null,
  dateOfBirth: user.dateOfBirth ?? null,
}
```

- [ ] **Step 2.4: Commit**

```bash
git add types/next-auth.d.ts auth.config.ts auth.ts
git commit -m "Thread sex, heightCm, dateOfBirth through JWT session"
```

---

## Task 3: Repository + API — Accept `sex` in Profile Updates

**Files:**
- Modify: `lib/data/repository.ts`
- Modify: `lib/data/postgres/adapter.ts`
- Modify: `app/api/user/profile/route.ts`

- [ ] **Step 3.1: Extend `updateUserProfile` in repository interface**

Open `lib/data/repository.ts`. Find:
```ts
updateUserProfile(userId: string, profile: Partial<Pick<User, 'displayName' | 'heightCm' | 'dateOfBirth' | 'weightGoalKg' | 'timezone'>>): Promise<User>
```

Change to:
```ts
updateUserProfile(userId: string, profile: Partial<Pick<User, 'displayName' | 'heightCm' | 'dateOfBirth' | 'weightGoalKg' | 'timezone' | 'sex'>>): Promise<User>
```

- [ ] **Step 3.2: Implement `sex` in the adapter**

Open `lib/data/postgres/adapter.ts`. Find the `updateUserProfile` implementation. It builds a `set` object and conditionally applies fields. The current body is:
```ts
const set: Record<string, unknown> = {
  displayName: profile.displayName ?? null,
  heightCm: profile.heightCm ?? null,
  dateOfBirth: profile.dateOfBirth ?? null,
  weightGoalKg: profile.weightGoalKg ?? null,
}
if (profile.timezone) set.timezone = profile.timezone
```

Change to:
```ts
const set: Record<string, unknown> = {
  displayName: profile.displayName ?? null,
  heightCm: profile.heightCm ?? null,
  dateOfBirth: profile.dateOfBirth ?? null,
  weightGoalKg: profile.weightGoalKg ?? null,
}
if (profile.timezone) set.timezone = profile.timezone
if ('sex' in profile) set.sex = profile.sex ?? null
```

- [ ] **Step 3.3: Accept `sex` in the PATCH route**

Open `app/api/user/profile/route.ts`. Find:
```ts
const { displayName, heightCm, dateOfBirth, weightGoalKg, timezone } = body
```

Change to:
```ts
const { displayName, heightCm, dateOfBirth, weightGoalKg, timezone, sex } = body
```

And in the `updateUserProfile` call, add `sex`:
```ts
const user = await repo.updateUserProfile(session.user.id, {
  displayName: displayName ?? undefined,
  heightCm: heightCm ?? undefined,
  dateOfBirth: dateOfBirth ?? undefined,
  weightGoalKg: weightGoalKg ?? undefined,
  timezone: timezone ?? undefined,
  sex: sex !== undefined ? sex : undefined,
})
```

- [ ] **Step 3.4: Commit**

```bash
git add lib/data/repository.ts lib/data/postgres/adapter.ts app/api/user/profile/route.ts
git commit -m "Accept sex field in updateUserProfile"
```

---

## Task 4: Profile Edit Form — Add Sex Toggle

**Files:**
- Modify: `components/profile/edit-profile-sheet.tsx`

- [ ] **Step 4.1: Add `sex` state and include in save**

Open `components/profile/edit-profile-sheet.tsx`. The file has state variables at lines 30–33:
```ts
const [displayName, setDisplayName] = useState(user?.displayName ?? '')
const [heightCm, setHeightCm] = useState(user?.heightCm?.toString() ?? '')
const [dateOfBirth, setDateOfBirth] = useState(user?.dateOfBirth ?? '')
const [weightGoalKg, setWeightGoalKg] = useState(user?.weightGoalKg?.toString() ?? '')
```

Add after them:
```ts
const [sex, setSex] = useState<string>(user?.sex ?? '')
```

Find the `useEffect` that syncs state with the user prop (lines 49–52). Add:
```ts
setSex(u.sex ?? '')
```

Find the PATCH body in the save function (lines 72–75):
```ts
displayName: displayName || null,
heightCm: heightCm ? Number(heightCm) : null,
dateOfBirth: dateOfBirth || null,
weightGoalKg: weightGoalKg ? Number(weightGoalKg) : null,
```

Add:
```ts
sex: sex || null,
```

- [ ] **Step 4.2: Add the sex toggle UI**

Find the Height field in the JSX (around line 163). After the height `<input>` block and before the next field, add a 3-button sex toggle:

```tsx
{/* Sex */}
<div className="space-y-1.5">
  <Label className="text-xs text-muted-foreground">Biological Sex</Label>
  <div className="flex gap-2">
    {(['male', 'female', 'other'] as const).map(opt => (
      <button
        key={opt}
        type="button"
        onClick={() => setSex(prev => prev === opt ? '' : opt)}
        className={cn(
          'flex-1 rounded-xl border px-3 py-2 text-xs font-semibold capitalize transition',
          sex === opt
            ? 'bg-brand text-white border-brand'
            : 'bg-muted border-transparent text-muted-foreground'
        )}
      >
        {opt === 'male' ? 'Male' : opt === 'female' ? 'Female' : 'Other'}
      </button>
    ))}
  </div>
  <p className="text-[10px] text-muted-foreground">Used for BMI and energy balance estimates</p>
</div>
```

- [ ] **Step 4.3: Commit**

```bash
git add components/profile/edit-profile-sheet.tsx
git commit -m "Add sex field to profile edit form"
```

---

## Task 5: Body Metadata API — Add `calsBurnedToday`

The health screen needs today's total calories burned from cardio sessions.

**Files:**
- Modify: `app/api/body-metadata/route.ts`

- [ ] **Step 5.1: Add `calsBurnedToday` to the GET response**

Open `app/api/body-metadata/route.ts`.

Find the `BodyMetaRow` interface at line 7 and add nothing there — this is a separate field returned at the top level of the response, not per-row.

In the `GET` handler, find:
```ts
const repo = await getRepository();
const [metrics, foodLogs] = await Promise.all([
  repo.listBodyMetrics(userId, from, today),
  repo.listFoodLogs(userId, today).catch(() => []),
]);
```

Change to also fetch today's cardio sessions:
```ts
const repo = await getRepository();
const [metrics, foodLogs, cardioSessions] = await Promise.all([
  repo.listBodyMetrics(userId, from, today),
  repo.listFoodLogs(userId, today).catch(() => []),
  repo.listCardioSessions(userId, today, today).catch(() => []),
]);
```

After computing `todayRow`, compute the calories burned sum:
```ts
const calsBurnedToday = cardioSessions.length > 0
  ? cardioSessions.reduce((sum, s) => sum + (s.caloriesBurned ?? 0), 0)
  : null;
```

Update the return statement to include it:
```ts
return NextResponse.json(
  { today: todayRow, recent, calsBurnedToday },
  { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" } },
);
```

- [ ] **Step 5.2: Commit**

```bash
git add app/api/body-metadata/route.ts
git commit -m "Add calsBurnedToday to body-metadata API"
```

---

## Task 6: Home Screen — Tile Navigation, Streak, Mood Icon

**Files:**
- Modify: `app/session-select/session-select-content.tsx`

- [ ] **Step 6.1: Metric tiles — navigate to /health + Log chip**

Find the `case "metricTiles":` section (around line 1195). The current tile render is:
```tsx
<button
  key={def.key}
  onClick={() => openLog(def)}
  aria-label={...}
  className="flex-none flex flex-col items-center gap-1 rounded-2xl px-4 py-3 min-w-[76px] transition active:scale-95"
  style={accentCardStyle(def.color)}
>
  <def.icon className="h-4 w-4" style={{ color: def.color }} />
  <span className="text-sm font-bold tabular-nums">{metaLoading ? "…" : val != null ? val : "—"}</span>
  <span className="text-[10px] text-muted-foreground">{def.unit || def.label}</span>
</button>
```

Replace with:
```tsx
<button
  key={def.key}
  onClick={() => router.push('/health')}
  aria-label={`${def.label}: ${metaLoading ? 'loading' : val != null ? val : 'no data'} ${def.unit || ''} — tap to view`}
  className="flex-none flex flex-col items-center gap-1 rounded-2xl px-4 py-3 min-w-[76px] transition active:scale-95 relative"
  style={accentCardStyle(def.color)}
>
  <button
    onClick={e => { e.stopPropagation(); openLog(def); }}
    className="absolute top-1.5 right-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-foreground/10 border border-border/50 leading-none"
    aria-label={`Log ${def.label}`}
  >
    Log
  </button>
  <def.icon className="h-4 w-4" style={{ color: def.color }} />
  <span className="text-sm font-bold tabular-nums">{metaLoading ? "…" : val != null ? val : "—"}</span>
  <span className="text-[10px] text-muted-foreground">{def.unit || def.label}</span>
</button>
```

- [ ] **Step 6.2: Streak and This Week cards — navigate to /stats**

Find `case "streak":` (around line 975). The two cards are plain `<div className="flex-1 rounded-2xl ...">` elements inside a `<div className="px-4 pb-3 pt-1 flex gap-2">` container.

Wrap each `<div className="flex-1 rounded-2xl ...">` in a `<button>`:

First card (Streak):
```tsx
<button
  onClick={() => router.push('/stats')}
  className="flex-1 rounded-2xl px-4 py-3 text-left active:scale-95 transition"
  style={accentCardStyle('#f97316')}
>
  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">Streak</p>
  {/* ... rest of streak content unchanged ... */}
</button>
```

Second card (This Week):
```tsx
<button
  onClick={() => router.push('/stats')}
  className="flex-1 rounded-2xl px-4 py-3 text-left active:scale-95 transition"
  style={accentCardStyle('#22c55e')}
>
  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">This Week</p>
  {/* ... rest of this-week content unchanged ... */}
</button>
```

Remove `className` from the outer `<div>` for the streak cards — it becomes just `<div className="px-4 pb-3 pt-1 flex gap-2">` containing the two buttons.

- [ ] **Step 6.3: Mood button empty state — use MessageCircle**

Find the mood button in `case "recommendation":` (around line 906–914):
```tsx
<button
  onClick={() => setMoodSheetOpen(true)}
  className="text-xl leading-none active:scale-90 transition-transform"
  aria-label="Log mood"
>
  {moodLog
    ? ({ drained: "😴", low: "😑", ok: "😐", good: "😊", pumped: "⚡" }[moodLog.energyLevel] ?? "😐")
    : "🫀"}
</button>
```

Replace the empty state `"🫀"` with the `MessageCircle` icon (already imported):
```tsx
<button
  onClick={() => setMoodSheetOpen(true)}
  className="text-xl leading-none active:scale-90 transition-transform"
  aria-label="Log mood"
>
  {moodLog
    ? ({ drained: "😴", low: "😑", ok: "😐", good: "😊", pumped: "⚡" }[moodLog.energyLevel] ?? "😐")
    : <MessageCircle className="h-5 w-5" style={{ color: "#fbbf24" }} />}
</button>
```

- [ ] **Step 6.4: Commit**

```bash
git add app/session-select/session-select-content.tsx
git commit -m "Home screen: tile nav, streak nav, MessageCircle mood icon"
```

---

## Task 7: Profile Page — Remove "View All", Rename Goals, Safe Zone

**Files:**
- Modify: `app/profile/profile-content.tsx`

- [ ] **Step 7.1: Remove "View all achievements" button**

Find and delete the entire button block (around lines 497–503):
```tsx
<button
  type="button"
  onClick={() => setShowAllAchievements(true)}
  className="w-full mt-2 py-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted/60 transition"
>
  View all {totalAchievements} achievements →
</button>
```

Delete only this button. The `setShowAllAchievements` state and the `ShowAllAchievements` sheet (if separate) should remain — they may be triggered by the count chip. If `setShowAllAchievements` becomes unused after this deletion, remove its declaration too.

- [ ] **Step 7.2: Rename "Daily Goals" to "Goals" and update subtitle**

Find (around line 587):
```tsx
<p className="text-sm font-semibold text-left">Daily Goals</p>
<p className="text-[10px] text-muted-foreground">Steps, sleep, calorie targets</p>
```

Change to:
```tsx
<p className="text-sm font-semibold text-left">Goals</p>
<p className="text-[10px] text-muted-foreground">Steps, water, calorie targets</p>
```

- [ ] **Step 7.3: Add safe zone padding to scroll container**

Find the outermost scrollable container in `profile-content.tsx`. It is likely a `<div className="... overflow-y-auto ...">` wrapping the entire profile content. Add safe area padding:

Find the element that wraps the profile scroll content and add inline style. If it already has a `style` prop, merge into it. If not, add:
```tsx
style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
```

- [ ] **Step 7.4: Commit**

```bash
git add app/profile/profile-content.tsx
git commit -m "Profile: remove duplicate achievements button, rename Goals, safe zone"
```

---

## Task 8: Config Screen — Advanced Settings Accordion

**Files:**
- Modify: `components/config-screen.tsx`

- [ ] **Step 8.1: Add `advancedOpen` state**

Open `components/config-screen.tsx`. Find the state declarations near the top (around line 96–103). Add:
```ts
const [advancedOpen, setAdvancedOpen] = useState(false)
```

- [ ] **Step 8.2: Find the Progression Styles and Phase Sets accordion blocks**

The Progression Styles accordion starts around line 748 with a header that toggles `progressionSetsOpen`. The Phase Sets accordion is around line 844 toggling `phaseSetsOpen`. They share the same JSX structure.

Identify the start of the Progression Styles section and the end of the Phase Sets section. The entire range of both sections (from the opening `<div>` of Progression Styles through the closing `</div>` of Phase Sets) gets wrapped.

- [ ] **Step 8.3: Wrap both sections in an Advanced Settings accordion**

Ensure `SlidersHorizontal` is imported from `lucide-react`. Add it to the existing import if not present:
```ts
import { ..., SlidersHorizontal } from 'lucide-react'
```

Then wrap both accordion sections:
```tsx
{/* ── Advanced Settings ── */}
<div className="rounded-2xl bg-muted/40 border border-border overflow-hidden">
  <button
    type="button"
    onClick={() => setAdvancedOpen(v => !v)}
    className="flex w-full items-center justify-between px-4 py-3.5 hover:bg-muted/60 transition"
  >
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-muted">
        <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-semibold text-left">Advanced Settings</p>
        <p className="text-[10px] text-muted-foreground">Progression styles, phase sets</p>
      </div>
    </div>
    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
  </button>
  {advancedOpen && (
    <div className="border-t border-border">
      {/* --- Progression Styles section (existing, unchanged internals) --- */}
      {/* paste the full existing Progression Styles accordion block here */}

      {/* --- Phase Sets section (existing, unchanged internals) --- */}
      {/* paste the full existing Phase Sets accordion block here */}
    </div>
  )}
</div>
```

- [ ] **Step 8.4: Commit**

```bash
git add components/config-screen.tsx
git commit -m "Config: move Phase Sets and Progression Styles into Advanced Settings"
```

---

## Task 9: Body Screen — Remove Mood, Fix Biometric Tiles, Training Load

**Files:**
- Modify: `app/health/health-content.tsx`

- [ ] **Step 9.1: Remove mood state, fetch, and UI**

Remove all of the following from `health-content.tsx`:

1. State declarations (around lines 154–155):
```ts
const [moodLog, setMoodLog] = useState<MoodLog | null | undefined>(undefined);
const [moodSheetOpen, setMoodSheetOpen] = useState(false);
```

2. The mood fetch in `useEffect` (around lines 239–242):
```ts
fetch(`/api/mood?date=${todayInTz()}`)
  .then(r => r.ok ? r.json() : null)
  .then(d => setMoodLog(d ?? null))
  .catch(() => setMoodLog(null));
```

3. The `moodLog === null` prompt block (around lines 544–560 — the "How are you feeling today?" button).

4. The `moodLog &&` logged row block (around lines 562–580 — the "Mood logged · tap to edit" button).

5. The `<MoodCheckInSheet ... />` render at the bottom (around lines 708–711).

6. The `MoodCheckInSheet` import at the top and `MoodLog` type import if they are now unused.

- [ ] **Step 9.2: Always-visible biometric tiles**

Find (around line 483–484):
```ts
const hasAny = latestHR != null || latestHrv != null || latestSpo2 != null;
if (!hasAny && !metaLoading) return null;
```

Delete the `if (!hasAny && !metaLoading) return null;` line entirely. Keep `hasAny` or remove it if now unused.

For the three tiles, each currently renders:
```tsx
<p className="text-xl font-bold tabular-nums" style={{ color: "#ef4444" }}>
  {latestHR != null ? latestHR : "—"}
</p>
```

Change each `"—"` fallback to show "No data" text instead:
```tsx
{latestHR != null ? (
  <p className="text-xl font-bold tabular-nums" style={{ color: "#ef4444" }}>{latestHR}</p>
) : (
  <p className="text-xs text-muted-foreground">No data</p>
)}
```

Apply the same pattern for `latestHrv` (orange `#f97316`) and `latestSpo2` (cyan `#06b6d4`).

- [ ] **Step 9.3: Training load — always visible with "not enough data" state**

Find (around line 582):
```tsx
{trainingLoad && (
  <div className="rounded-2xl p-4" style={accentCardStyle('#f59e0b')}>
    ...
  </div>
)}
```

Replace with an always-visible card:
```tsx
<div className="rounded-2xl p-4" style={accentCardStyle('#f59e0b')}>
  <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Training Load (ACWR)</h3>
  {(!trainingLoad || trainingLoad.acwr === 0) ? (
    <div>
      <p className="text-base font-semibold text-foreground">Not enough data yet</p>
      <p className="text-xs text-muted-foreground mt-0.5">Track a few sessions to see your ACWR</p>
    </div>
  ) : (
    <div className="flex items-end gap-3">
      <p className="text-3xl font-bold tabular-nums" style={{ color: '#f59e0b' }}>
        {trainingLoad.acwr.toFixed(2)}
      </p>
      <p className="text-sm text-muted-foreground mb-1">
        {trainingLoad.interpretation === 'optimal'   && '✅ Optimal zone'}
        {trainingLoad.interpretation === 'high'      && '⚠️ Slightly elevated'}
        {trainingLoad.interpretation === 'very_high' && '🔴 Overreaching risk'}
        {trainingLoad.interpretation === 'low'       && '💤 Detraining risk'}
      </p>
    </div>
  )}
  <p className="text-xs text-muted-foreground mt-1">7-day avg vs 28-day baseline · green zone: 0.8–1.3</p>
  <div className="mt-3 flex gap-2 rounded-xl bg-muted/50 p-3">
    <InfoIcon className="h-3.5 w-3.5 text-muted-foreground flex-none mt-0.5" />
    <p className="text-[11px] text-muted-foreground leading-relaxed">
      ACWR compares your last 7 days of training volume (acute load) against your 28-day rolling average (chronic load). Below 0.8 means detraining risk; 0.8–1.3 is the sweet spot; above 1.5 raises injury risk.
    </p>
  </div>
</div>
```

- [ ] **Step 9.4: Commit**

```bash
git add app/health/health-content.tsx
git commit -m "Body screen: remove mood, fix biometric tiles, training load placeholder"
```

---

## Task 10: Body Screen — New Metric Tiles

Add Distance, Calories Burned, BMI, Weight Trend, and Energy Balance tiles to the body screen.

**Files:**
- Modify: `app/health/health-content.tsx`

All tiles share a common pattern. First, add a helper function near the top of the component (after state declarations):

- [ ] **Step 10.1: Add helper utilities**

At the top of the component function body in `health-content.tsx`, add these helper calculations after state declarations:

```ts
// ── Derived metric helpers ──────────────────────────────────────

const latestWeightKg = metaToday?.weightKg ?? metaRecent.find(r => r.weightKg != null)?.weightKg ?? null;
const latestDistanceKm = metaToday?.distanceKm ?? null; // distance resets daily, no fallback

// BMI
const heightCm = session?.user?.heightCm ?? null;
const bmi = latestWeightKg != null && heightCm != null
  ? latestWeightKg / Math.pow(heightCm / 100, 2)
  : null;
const bmiLabel = bmi == null ? null
  : bmi < 18.5 ? 'Underweight'
  : bmi < 25   ? 'Normal'
  : bmi < 30   ? 'Overweight'
  : 'Obese';

// Weight trend (linear regression slope over last 28 days, kg/week)
const weightPoints = [...metaRecent].reverse().filter(r => r.weightKg != null) as { date: string; weightKg: number }[];
let weightTrendKgPerWeek: number | null = null;
if (weightPoints.length >= 3) {
  const n = weightPoints.length;
  const xs = weightPoints.map((_, i) => i);
  const ys = weightPoints.map(r => r.weightKg!);
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  const slope = xs.reduce((sum, x, i) => sum + (x - xMean) * (ys[i] - yMean), 0)
              / xs.reduce((sum, x) => sum + Math.pow(x - xMean, 2), 0);
  // slope is kg per reading interval; readings ~daily so multiply by 7 for kg/week
  weightTrendKgPerWeek = Math.round(slope * 7 * 10) / 10;
}

// Energy balance: calories in - burned - TDEE
const sex = session?.user?.sex ?? null;
const dateOfBirth = session?.user?.dateOfBirth ?? null;
const ageYears = dateOfBirth
  ? Math.floor((Date.now() - new Date(dateOfBirth).getTime()) / (365.25 * 24 * 3600 * 1000))
  : null;
const calsBurnedToday = (bodyMeta as any)?.calsBurnedToday as number | null ?? null;
const caloriesToday = metaToday?.calories ?? null;
let energyBalanceKcal: number | null = null;
if (latestWeightKg != null && heightCm != null && ageYears != null && sex != null && caloriesToday != null) {
  const sexOffset = sex === 'male' ? 5 : sex === 'female' ? -161 : -78;
  const bmr = 10 * latestWeightKg + 6.25 * heightCm - 5 * ageYears + sexOffset;
  const tdee = Math.round(bmr * 1.4);
  energyBalanceKcal = caloriesToday - (calsBurnedToday ?? 0) - tdee;
}
```

Note: `bodyMeta` is whatever variable holds the raw response from `/api/body-metadata`. Find the variable name used in the component for the raw API response (search for `calsBurnedToday` or the fetch call result) and use that. If the raw response isn't stored, update the fetch to store it.

Update the body-metadata fetch to store the full response. Find the `cachedFetch` call for `'body-metadata'`. The callback currently does:
```ts
(data) => { setMetaToday(data.today ?? null); setMetaRecent(data.recent ?? []); setMetaLoading(false); }
```

Change to also capture calsBurnedToday:
```ts
(data) => {
  setMetaToday(data.today ?? null);
  setMetaRecent(data.recent ?? []);
  setCalsBurnedToday((data as any).calsBurnedToday ?? null);
  setMetaLoading(false);
}
```

Add state: `const [calsBurnedToday, setCalsBurnedToday] = useState<number | null>(null);`

Then replace `(bodyMeta as any)?.calsBurnedToday` in the helper with just `calsBurnedToday`.

Also add `useSession` at the top of the component if not already imported:
```ts
import { useSession } from 'next-auth/react'
// in component:
const { data: session } = useSession()
```

- [ ] **Step 10.2: Add Distance tile to the Steps/Sleep row**

Find the Steps/Sleep grid (around line 431):
```tsx
<div className="grid grid-cols-2 gap-3">
  {/* Steps button */}
  {/* Sleep button */}
</div>
```

Change to `grid-cols-3` and add the Distance button after Sleep:

```tsx
<div className="grid grid-cols-3 gap-3">
  {/* Steps — unchanged */}
  {/* Sleep — unchanged */}

  {/* Distance */}
  <button
    onClick={() => setMetricSheet("steps")}
    className="rounded-2xl p-4 relative overflow-hidden text-left transition active:scale-95"
    style={accentCardStyle('#2dd4bf')}
  >
    <div className="absolute -top-3 -right-3 w-14 h-14 rounded-full pointer-events-none" style={{ background: "#2dd4bf", filter: "blur(20px)", opacity: 0.2 }} />
    <div className="flex items-start justify-between mb-2">
      <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#2dd4bf" }}>Distance</p>
      <span className="text-[9px] text-muted-foreground opacity-60">↗</span>
    </div>
    {metaLoading ? (
      <div className="h-7 w-16 animate-pulse rounded-lg bg-muted" />
    ) : latestDistanceKm != null ? (
      <p className="text-2xl font-bold tabular-nums">{latestDistanceKm.toFixed(1)}<span className="text-sm font-normal ml-1">km</span></p>
    ) : (
      <p className="text-xs text-muted-foreground mt-1">No data</p>
    )}
    <p className="text-xs text-muted-foreground mt-1">Today</p>
  </button>
</div>
```

- [ ] **Step 10.3: Add Calories Burned tile**

After the Steps/Sleep/Distance grid, add a new 2-column row for Calories Burned and BMI:

```tsx
<div className="grid grid-cols-2 gap-3">
  {/* Calories Burned */}
  <div className="rounded-2xl p-4 relative overflow-hidden" style={accentCardStyle('#f97316')}>
    <div className="absolute -top-3 -right-3 w-14 h-14 rounded-full pointer-events-none" style={{ background: "#f97316", filter: "blur(20px)", opacity: 0.2 }} />
    <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#f97316" }}>Burned</p>
    {metaLoading ? (
      <div className="h-7 w-16 animate-pulse rounded-lg bg-muted" />
    ) : calsBurnedToday != null ? (
      <p className="text-2xl font-bold tabular-nums">{Math.round(calsBurnedToday)}<span className="text-sm font-normal ml-1">kcal</span></p>
    ) : (
      <p className="text-xs text-muted-foreground">No data</p>
    )}
    <p className="text-xs text-muted-foreground mt-1">From cardio today</p>
  </div>

  {/* BMI */}
  <div className="rounded-2xl p-4 relative overflow-hidden" style={accentCardStyle('#a78bfa')}>
    <div className="absolute -top-3 -right-3 w-14 h-14 rounded-full pointer-events-none" style={{ background: "#a78bfa", filter: "blur(20px)", opacity: 0.2 }} />
    <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#a78bfa" }}>BMI</p>
    {metaLoading ? (
      <div className="h-7 w-16 animate-pulse rounded-lg bg-muted" />
    ) : bmi != null ? (
      <>
        <p className="text-2xl font-bold tabular-nums" style={{ color: "#a78bfa" }}>{bmi.toFixed(1)}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{bmiLabel}</p>
      </>
    ) : (
      <p className="text-xs text-muted-foreground">No data</p>
    )}
  </div>
</div>
```

- [ ] **Step 10.4: Add Weight Trend and Energy Balance tiles**

After the Burned/BMI row, add another 2-column row:

```tsx
<div className="grid grid-cols-2 gap-3">
  {/* Weight Trend */}
  <div className="rounded-2xl p-4 relative overflow-hidden" style={accentCardStyle('#22c55e')}>
    <div className="absolute -top-3 -right-3 w-14 h-14 rounded-full pointer-events-none" style={{ background: "#22c55e", filter: "blur(20px)", opacity: 0.2 }} />
    <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#22c55e" }}>Trend</p>
    {metaLoading ? (
      <div className="h-7 w-16 animate-pulse rounded-lg bg-muted" />
    ) : weightTrendKgPerWeek != null ? (
      <>
        <p className="text-2xl font-bold tabular-nums" style={{ color: "#22c55e" }}>
          {weightTrendKgPerWeek >= 0 ? '+' : ''}{weightTrendKgPerWeek}
          <span className="text-sm font-normal ml-1">kg/wk</span>
        </p>
      </>
    ) : (
      <p className="text-xs text-muted-foreground">Need more data</p>
    )}
  </div>

  {/* Energy Balance */}
  <div className="rounded-2xl p-4 relative overflow-hidden" style={accentCardStyle('#00d4ff')}>
    <div className="absolute -top-3 -right-3 w-14 h-14 rounded-full pointer-events-none" style={{ background: "#00d4ff", filter: "blur(20px)", opacity: 0.2 }} />
    <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#00d4ff" }}>Balance</p>
    {metaLoading ? (
      <div className="h-7 w-16 animate-pulse rounded-lg bg-muted" />
    ) : energyBalanceKcal != null ? (
      <>
        <p className="text-2xl font-bold tabular-nums" style={{ color: "#00d4ff" }}>
          {energyBalanceKcal >= 0 ? '+' : ''}{Math.round(energyBalanceKcal)}
          <span className="text-sm font-normal ml-1">kcal</span>
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5">vs TDEE est.</p>
      </>
    ) : (
      <p className="text-xs text-muted-foreground">No data</p>
    )}
  </div>
</div>
```

- [ ] **Step 10.5: Commit**

```bash
git add app/health/health-content.tsx
git commit -m "Body screen: add Distance, Burned, BMI, Weight Trend, Energy Balance tiles"
```

---

## Task 11: Push and Verify

- [ ] **Step 11.1: Push branch**

```bash
git push -u origin claude/training-goals-home-bugs-MfOPS
```

- [ ] **Step 11.2: Check TypeScript compiles**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors. If type errors appear, fix them before proceeding.

- [ ] **Step 11.3: Manual test checklist**

Pull the branch and test each item:

**Home screen:**
- Tap any metric tile body → navigates to `/health`
- Tap the small "Log" chip on a metric tile → opens the log sheet (does NOT navigate)
- Tap the Streak card → navigates to `/stats`
- Tap the This Week card → navigates to `/stats`
- Recommended Today mood button with no mood logged → shows amber `MessageCircle` icon
- Recommended Today mood button after logging mood → shows correct energy emoji

**Profile:**
- Achievement section: no "View all N achievements →" button visible
- Goals section: label reads "Goals" (not "Daily Goals"), subtitle mentions "water"
- Scroll to bottom of profile → content is not clipped by home indicator
- Tap "Program & Exercises" → config screen. Progression Styles and Phase Sets are inside "Advanced Settings" accordion, collapsed by default

**Profile edit sheet:**
- Open edit profile → sex toggle (Male / Female / Other) appears below Height
- Select a sex → saves correctly → re-open edit sheet → sex is pre-selected

**Body screen:**
- HRV, SpO₂, Resting HR tiles are always visible (even with no Health Connect data) — show "No data" when null
- Training Load card is always visible — shows "Not enough data yet" when no sessions
- Distance tile appears in the Steps/Sleep row
- Calories Burned tile appears
- BMI tile appears (shows value if weight + height in profile; "No data" otherwise)
- Weight Trend tile appears ("Need more data" until 3+ weight readings)
- Energy Balance tile appears ("No data" until weight, height, DOB, and sex are all set)
- Mood prompt and "Mood logged" row are gone from body screen
