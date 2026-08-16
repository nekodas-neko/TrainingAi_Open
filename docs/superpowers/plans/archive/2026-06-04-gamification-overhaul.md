> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Gamification Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gamify the active workout screen, profile page, and achievements system with Aurora-inspired UI; fix the rest-day bug and workout data load performance; add more theme colors.

**Architecture:** Changes are spread across three areas — (1) workout flow (set-card layout + timer ring), (2) profile/achievements (icons, cards, level sheet, settings reorg), (3) data layer (caching, rest-day fix). Each task is independent enough to ship separately. All visual changes use existing CSS custom properties (`var(--color-brand)`) so they automatically respect the active theme.

**Tech Stack:** Next.js 15 · React 19 · TypeScript · Tailwind CSS v4 · Lucide React · Drizzle ORM · SQLite client cache (`lib/sqlite/cache.ts`) · shadcn/ui Sheet/Popover

---

## File Map

| File | Change |
|------|--------|
| `lib/data/postgres/adapter.ts:1102-1207` | Fix rest-day logic for users with no recent workouts |
| `components/workout-screen.tsx:88-117` | Replace sessionStorage cache with SQLite cachedFetch |
| `components/workout/set-card.tsx` | Full layout overhaul — D_Arc style pill |
| `components/workout/active-workout-screen.tsx` | Session timer arc ring in header |
| `components/profile/achievements-grid.tsx` | Lucide icons, large square cards, colored category borders, popover on tap |
| `components/profile/level-sheet.tsx` *(new)* | Interactive level/XP detail sheet |
| `components/profile/edit-profile-sheet.tsx` | Add Units + Food Region fields |
| `app/profile/profile-content.tsx` | Settings reorg, wire LevelSheet, remove moved fields |
| `lib/brand-themes.ts` | Add Red + Gold themes |
| `app/globals.css` | No change needed |

---

## Task 1 — Fix rest-day false positive

**Problem:** `getNextSession` in `lib/data/postgres/adapter.ts` (line 1155) returns `isRestDay: true` when the user has a `weekly` schedule and today's day-of-week is absent from `schedule.days` — even if the user hasn't trained at all this week. This is technically correct schedule behaviour, but the UI is surfacing "Rest Day" in a confusing way when no workouts have been logged.

**Files:**
- Modify: `lib/data/postgres/adapter.ts:1152-1163`

- [ ] **Step 1: Read the current logic**

Open `lib/data/postgres/adapter.ts` lines 1102–1207 and understand the weekly-schedule branch at line 1152:

```ts
if (schedule?.type === 'weekly' && schedule.days?.length) {
  const dow = todayDayOfWeek(timezone)
  const todayEntry = schedule.days.find(d => d.dayOfWeek === dow)
  if (!todayEntry) return { isRestDay: true, reason: 'Rest day — not a scheduled training day' }
  // ...
}
```

The bug: if a user's weekly schedule says Mon/Wed/Fri are training days and today is Sunday, this immediately returns `isRestDay: true` regardless of whether the user chose to train on Sunday or has missed every day this week.

- [ ] **Step 2: Add a "has trained this week" override**

Replace the early-return at line 1155 with logic that only marks as rest day when the user has trained at least once in the past 7 days (showing the schedule is active):

```ts
if (schedule?.type === 'weekly' && schedule.days?.length) {
  const dow = todayDayOfWeek(timezone)
  const todayEntry = schedule.days.find(d => d.dayOfWeek === dow)
  if (!todayEntry) {
    // Only call it a rest day if the user has actually been training this cycle.
    // If they haven't trained at all recently, show the next session instead.
    const hasTrainedRecently = recentWsWithName.some(ws => {
      const age = Date.now() - ws.startedAt.getTime()
      return age < 7 * 86_400_000
    })
    if (hasTrainedRecently) {
      return { isRestDay: true, reason: 'Rest day — not a scheduled training day' }
    }
    // Fall through to the rotation logic below (shows next session)
  } else {
    if (todayEntry.sessionId) {
      const pinned = sessions.find(sess => sess.id === todayEntry.sessionId)
      return pinned
        ? { isRestDay: false, session: pinned, reason: `Scheduled: ${pinned.name}` }
        : { isRestDay: false, session: nextSession, reason: `Scheduled day — rotate: ${nextSession.name}` }
    }
    return { isRestDay: false, session: nextSession, reason: `Scheduled day — rotate: ${nextSession.name}` }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/data/postgres/adapter.ts
git commit -m "Fix rest-day false positive when user has no recent workouts"
```

---

## Task 2 — Cache workout exercise data with SQLite (fix slow pre-workout load)

**Problem:** `workout-screen.tsx` uses `sessionStorage` which is cleared on page reload and has no TTL. The home screen pre-fetches but only writes to sessionStorage, so after a reload the workout screen always makes a live API call. Replace with the app's SQLite cache (`cachedFetch` from `lib/sqlite/cache.ts`) which persists across reloads and has a TTL.

**Files:**
- Modify: `components/workout-screen.tsx:88-117`

- [ ] **Step 1: Update fetchExercises to use cachedFetch**

Replace the entire `fetchExercises` callback (lines 88–117) in `components/workout-screen.tsx`:

```ts
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'

// Inside WorkoutScreen component, replace fetchExercises:
const fetchExercises = useCallback(async () => {
  const tab = sessionType.toLowerCase()
  const cacheKey = `workout-data:${tab}`
  const TTL = 5 * 60  // 5 minutes — matches TTL_SHORT

  // Synchronous read for immediate paint
  const cached = readCacheSync<{ exercises: WorkoutExercise[]; session?: { name: string }; phaseStatus?: PhaseStatus }>(cacheKey)
  if (cached) {
    setExercises(cached.exercises ?? [])
    if (cached.phaseStatus) setPhaseStatus(cached.phaseStatus)
    if (cached.session?.name) setSessionDisplayName(cached.session.name)
    setLoading(false)
  } else {
    setLoading(true)
  }

  try {
    await cachedFetch(
      cacheKey,
      `/api/workout-data?tab=${encodeURIComponent(tab)}`,
      TTL,
      (data) => {
        setExercises(data.exercises ?? [])
        if (data.phaseStatus) setPhaseStatus(data.phaseStatus)
        if (data.session?.name) setSessionDisplayName(data.session.name)
        setLoading(false)
      },
    )
  } catch {
    if (!cached) toast.error('Could not load workout data')
    setLoading(false)
  }
}, [sessionType])
```

- [ ] **Step 2: Update refreshExercises to bust the SQLite cache**

```ts
const refreshExercises = useCallback(() => {
  // bust the SQLite cache for this session
  const { invalidate } = require('@/lib/sqlite/cache')
  invalidate(`workout-data:${sessionType.toLowerCase()}`)
  store.clearTodayLogged()
  fetchExercises()
}, [sessionType, fetchExercises])
```

Check `lib/sqlite/cache.ts` for the exact invalidation API — if the export is named differently (e.g. `deleteCache`, `bustCache`), use the correct name.

- [ ] **Step 3: Remove sessionStorage usage in session-select**

In `app/session-select/session-select-content.tsx` lines 403–408, the home screen pre-fetches `ta_wc_*` into sessionStorage. This is now redundant since workout-screen uses SQLite cache. Remove those fetch calls to reduce network chatter on the home screen:

```ts
// DELETE these lines (403–408):
// ...sessions.map(sess =>
//   fetch(`/api/workout-data?tab=...`)
//     .then(...)
//     .then((data) => { if (data) sessionStorage.setItem(`ta_wc_...`) })
// ),
```

- [ ] **Step 4: Commit**

```bash
git add components/workout-screen.tsx app/session-select/session-select-content.tsx
git commit -m "Cache workout exercise data with SQLite for instant pre-workout loads"
```

---

## Task 3 — Active set card redesign (D_Arc style pill)

**Goal:** The active set card is too spacious. Redesign to a tight 3-zone horizontal pill:
- Zone A (left ~55%): large weight value + dial, minimal vertical footprint
- Centre: × separator  
- Zone B (right ~45%): rep count large + stacked +/- buttons, fills the space
- Set number badge: small circle overlay at top-left of the card

**Files:**
- Modify: `components/workout/set-card.tsx`

- [ ] **Step 1: Rewrite the `isActive` branch of SetCard**

Replace the entire `isActive` return block (starting at `if (isActive) {`) in `components/workout/set-card.tsx` with:

```tsx
if (isActive) {
  return (
    <div className="relative">
      {/* SVG animated border — set phase only. Must be outside the card div (no overflow-hidden on wrapper) */}
      {workoutPhase === "set" && (
        <svg className="absolute pointer-events-none z-10"
          style={{ inset: "-2px", width: "calc(100% + 4px)", height: "calc(100% + 4px)", overflow: "visible" }}>
          <rect x="1" y="1" width="calc(100% - 2px)" height="calc(100% - 2px)"
            rx="18" ry="18" fill="none" stroke="var(--color-brand)"
            strokeWidth="2" pathLength="1000" strokeDasharray="970 30"
            style={{ animation: "border-run 3s linear infinite" }} />
        </svg>
      )}

      {/* Card — no overflow-hidden so SVG border renders outside bounds */}
      <div className="relative flex items-stretch rounded-[18px] border"
        style={{
          background: "color-mix(in oklch, var(--color-brand) 7%, var(--color-background))",
          borderColor: "color-mix(in oklch, var(--color-brand) 25%, transparent)",
        }}
      >
        {/* Zone A: Weight (55%) — pt-8 clears the badge overlay */}
        <div className="flex items-center justify-center pt-8 pb-3 px-3"
          style={{ width: "55%" }}>
          {onWeightChange ? (
            <WeightDial value={weight} onChange={onWeightChange}
              min={0} max={250} step={2.5} unit="kg" visible={3} pill />
          ) : (
            <p className="text-3xl font-black tabular-nums">
              {weight} <span className="text-sm font-normal text-muted-foreground">kg</span>
            </p>
          )}
        </div>

        {/* × separator */}
        <div className="flex items-center py-4">
          <span className="text-2xl text-muted-foreground/30 font-light">×</span>
        </div>

        {/* Zone B: Reps (45%) — brand-colored buttons, text-4xl rep count */}
        <div className="flex items-center justify-center py-3 pr-3 pl-2 gap-2"
          style={{ width: "45%" }}>
          <div className="flex flex-col items-center gap-1">
            <button onClick={() => onRepChange(repValue + 1)}
              aria-label={`Increase reps to ${repValue + 1}`}
              className="w-12 h-12 rounded-xl text-xl font-bold flex items-center justify-center transition-transform active:scale-90"
              style={{ background: "color-mix(in oklch, var(--color-brand) 18%, var(--color-muted))",
                       color: "var(--color-brand)" }}>+</button>
            <span className="w-12 text-center text-4xl font-black tabular-nums leading-none"
              style={{ color: "var(--color-brand)" }}>{repValue}</span>
            <button onClick={() => onRepChange(Math.max(1, repValue - 1))}
              aria-label={`Decrease reps to ${Math.max(1, repValue - 1)}`}
              className="w-12 h-12 rounded-xl text-xl font-bold flex items-center justify-center transition-transform active:scale-90"
              style={{ background: "color-mix(in oklch, var(--color-brand) 18%, var(--color-muted))",
                       color: "var(--color-brand)" }}>−</button>
          </div>
          {intensityPct != null && (
            <div className="rounded-lg px-2 py-1 text-center self-end mb-1"
              style={{ background: "color-mix(in oklch, var(--color-brand) 12%, transparent)" }}>
              <p className="text-[9px] text-muted-foreground leading-none">1RM</p>
              <p className="text-[11px] font-bold leading-none" style={{ color: "var(--color-brand)" }}>{intensityPct}%</p>
            </div>
          )}
        </div>

        {/* Set badge — top-left overlay, w-7 h-7 for visibility, pt-8 in Zone A clears it */}
        <div className="absolute top-2 left-2 w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-black z-10"
          style={{ background: "var(--color-brand)", color: "#000",
                   boxShadow: workoutPhase === "set" ? "0 0 10px var(--color-brand)" : "none" }}>
          {index + 1}
        </div>
      </div>

      {workoutPhase === "set" && (
        <div className="absolute inset-0 rounded-[18px] blur-xl opacity-15 pointer-events-none -z-10"
          style={{ background: "var(--color-brand)" }} />
      )}
    </div>
  )
}
```

> **Key fixes vs original plan:** `style={{ width: "55%" }}` instead of Tailwind `flex-[55]` (Tailwind v4 flex shorthand requires `flex-[55_55_0%]` — use inline style to be safe). `pt-8` in Zone A ensures the dial clears the badge overlay. Rep buttons use brand color fill. `text-4xl` on rep count is more prominent (was `text-3xl`). No `overflow-hidden` on the card wrapper — the SVG border lives outside card bounds.

- [ ] **Step 2: Update upcoming sets to have halo emphasis**

In the same file, replace the `// Upcoming set` return block at the bottom:

```tsx
// Upcoming set
const isNextUp = index === currentSet + 1 || (index === currentSet && workoutPhase === "rest")

return (
  <div
    className="relative flex items-center gap-3 rounded-2xl p-2.5 border transition-all"
    style={{
      background: isNextUp
        ? "color-mix(in oklch, var(--color-brand) 5%, transparent)"
        : "transparent",
      borderColor: isNextUp
        ? "color-mix(in oklch, var(--color-brand) 20%, transparent)"
        : "rgba(255,255,255,0.06)",
      opacity: index > currentSet + 2 ? 0.35 : 1,
      boxShadow: isNextUp
        ? "0 0 12px color-mix(in oklch, var(--color-brand) 12%, transparent)"
        : "none",
    }}
  >
    {/* w-8 h-8 (32px) for visual consistency with done-set badge */}
    <div
      className="w-8 h-8 rounded-xl flex items-center justify-center flex-none text-xs font-bold"
      style={{
        background: isNextUp
          ? "color-mix(in oklch, var(--color-brand) 18%, var(--color-muted))"
          : "var(--color-muted)",
        color: isNextUp ? "var(--color-brand)" : "var(--color-muted-foreground)",
      }}
    >
      {index + 1}
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-[10px] text-muted-foreground">Set {index + 1} · {isNextUp ? "Up next" : "Upcoming"}</p>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <p className="text-sm font-bold tabular-nums">{weight} kg</p>
        <p className="text-xs text-muted-foreground">× {repValue} reps</p>
      </div>
    </div>
  </div>
)
```

> **OLED note:** `boxShadow: "0 0 12px color-mix(in oklch, var(--color-brand) 12%, transparent)"` renders as a genuine glow on OLED true-black — very effective for "next up" emphasis without being distracting.

- [ ] **Step 3: Commit**

```bash
git add components/workout/set-card.tsx
git commit -m "Redesign active set card to D_Arc-style compact pill with halo on upcoming sets"
```

---

## Task 4 — Session timer arc ring in header

**Goal:** The `0:07` session timer in the active workout header should have a subtle arc/ring around it that counts down/up, giving it a workout-clock feel.

**Context:** The timer is rendered in `components/workout/active-workout-screen.tsx`. The `sessionElapsedSec` prop is the running total. A typical workout is ~45–90 minutes; use 60 minutes as the "full ring" reference so it fills up over a session.

**Files:**
- Modify: `components/workout/active-workout-screen.tsx` (header timer section ~lines 77–100)

- [ ] **Step 1: Find the timer element in the header**

In `active-workout-screen.tsx`, locate the header section. It renders something like:

```tsx
<div ... className="... text-sm tabular-nums">
  <ClockIcon ... /> {formatTime(sessionElapsedSec)}
</div>
```

- [ ] **Step 2: Replace with ringed timer**

Wrap the timer number in a 48×48px SVG arc. Use `stroke-dashoffset` (not `stroke-dasharray`) for reliable CSS transition. 60-minute reference fills the ring over a full workout:

```tsx
{/* Session timer with arc ring */}
{(() => {
  const FULL_SEC = 60 * 60
  const progress = Math.min(1, sessionElapsedSec / FULL_SEC)
  const r = 18, circ = 2 * Math.PI * r
  const offset = circ - circ * progress
  return (
    <div className="relative flex items-center justify-center w-12 h-12 flex-none">
      <svg className="absolute inset-0" width="48" height="48" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r={r} fill="none" stroke="currentColor"
          strokeOpacity="0.12" strokeWidth="2.5" />
        <circle cx="24" cy="24" r={r} fill="none"
          stroke="var(--color-brand)" strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          transform="rotate(-90 24 24)"
          style={{ filter: "drop-shadow(0 0 3px var(--color-brand))",
                   transition: "stroke-dashoffset 1s linear" }} />
      </svg>
      <span className="relative text-[11px] font-bold tabular-nums font-mono leading-none"
        style={{ color: "var(--color-brand)" }}>
        {formatTime(sessionElapsedSec)}
      </span>
    </div>
  )
})()}
```

> **Why 48px / text-[11px]:** The header is compact but "45:23" at 10px ≈ 2mm tall — below readable threshold. 48px container + 11px mono text is the minimum that reads cleanly on 350ppi OLED.

- [ ] **Step 3: Commit**

```bash
git add components/workout/active-workout-screen.tsx
git commit -m "Add arc ring to session timer in active workout header"
```

---

## Task 5 — Achievements: Lucide icons + square cards + popover

**Goal:** Replace emoji icons with Lucide React icons. Render large square badge cards with category-colored borders. Tap to show a Radix popover with the achievement description and progress.

**Files:**
- Modify: `components/profile/achievements-grid.tsx`
- Modify: `app/api/achievements/route.ts` — remove emoji `icon` field (or keep as fallback)

- [ ] **Step 1: Define icon + category-color mappings in achievements-grid.tsx**

At the top of `components/profile/achievements-grid.tsx`, add:

```tsx
import {
  Dumbbell, TrendingUp, RotateCcw, Zap, Trophy, Crown,
  Building2, Diamond, Shield, Rocket, Target, Activity,
  Flame, Star, Sunrise, Moon, Calendar, CalendarDays, CalendarCheck,
  Leaf, Utensils, Heart, CheckCircle2, Bed, BarChart2, LineChart,
  ArrowDown, Swords, Timer, Sun,
} from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

type LucideIcon = React.ComponentType<{ className?: string; style?: React.CSSProperties }>

const ACHIEVEMENT_ICONS: Record<string, LucideIcon> = {
  first_session:   Dumbbell,
  sessions_10:     TrendingUp,
  sessions_25:     RotateCcw,
  sessions_50:     Zap,
  sessions_100:    Trophy,
  sessions_250:    Crown,
  volume_1k:       Building2,
  volume_10k:      Diamond,
  volume_50k:      Shield,
  volume_100k:     Rocket,
  volume_500k:     Zap,
  sets_100:        Target,
  sets_1000:       Dumbbell,
  sets_5000:       Activity,
  streak_7:        Flame,
  streak_14:       Star,
  streak_30:       Sun,
  streak_60:       Swords,
  first_pr:        Trophy,
  prs_5:           Target,
  prs_10:          Diamond,
  prs_25:          Zap,
  early_bird:      Sunrise,
  early_bird_5:    Sun,
  night_owl:       Moon,
  months_3:        Calendar,
  months_6:        CalendarDays,
  months_12:       CalendarCheck,
  food_first:      Leaf,
  food_streak_7:   Utensils,
  food_streak_30:  Heart,
  calorie_goal_7:  Target,
  calorie_goal_30: CheckCircle2,
  sleep_first:     Bed,
  sleep_streak_7:  Moon,
  sleep_streak_30: Bed,
  weight_first:    BarChart2,
  weight_30:       LineChart,
  squat_100:       Dumbbell,
  bench_100:       Activity,
  deadlift_100:    ArrowDown,
}

const CATEGORY_COLORS: Record<string, string> = {
  'Workouts':        'var(--color-brand)',
  'Volume':          '#ff6a1a',
  'Sets':            '#00d4ff',
  'Streaks':         '#f59e0b',
  'Records':         '#a855f7',
  'Timing':          '#ec4899',
  'Consistency':     '#10b981',
  'Nutrition':       '#84cc16',
  'Sleep':           '#6366f1',
  'Body Metrics':    '#14b8a6',
  'Lift Milestones': '#ef4444',
}
```

- [ ] **Step 2: Rewrite BadgeCard to use icons + popover**

Replace the `BadgeCard` function entirely:

```tsx
function BadgeCard({ achievement }: { achievement: AchievementResult }) {
  const { id, unlocked, progress, name, description, xpReward, category, goal, current } = achievement
  const Icon = ACHIEVEMENT_ICONS[id] ?? Dumbbell
  const color = CATEGORY_COLORS[category] ?? 'var(--color-brand)'
  const showProgress = !unlocked && progress > 0

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="relative flex flex-col items-center justify-center rounded-2xl border p-2 aspect-square overflow-hidden transition-transform active:scale-95 w-full"
          style={
            unlocked
              ? { background: `color-mix(in oklch, ${color} 12%, var(--color-background))`,
                  borderColor: color,
                  boxShadow: `0 0 10px color-mix(in oklch, ${color} 25%, transparent)` }
              : { background: 'rgba(255,255,255,0.04)',
                  borderColor: 'rgba(255,255,255,0.08)' }
          }
        >
          {/* Background glow for unlocked — OLED pop */}
          {unlocked && (
            <div className="absolute inset-0 opacity-10 blur-md pointer-events-none"
              style={{ background: color }} />
          )}

          {/* h-8 w-8 (32px) fills the cell better on 87px cell width */}
          <Icon className="h-8 w-8 mb-1.5 relative flex-none"
            style={{ color: unlocked ? color : 'rgba(255,255,255,0.25)',
                     filter: unlocked ? `drop-shadow(0 0 4px ${color})` : 'none' }} />

          {/* text-[10px] — minimum readable size on 350ppi */}
          <p className="text-center text-[10px] font-semibold leading-tight line-clamp-2 px-0.5 relative"
            style={{ color: unlocked ? color : 'rgba(255,255,255,0.3)' }}>
            {name}
          </p>

          {/* Lock icon — separated from opacity so border stays visible */}
          {!unlocked && (
            <div className="absolute top-1.5 right-1.5 opacity-30">
              <Lock className="h-2.5 w-2.5 text-white" />
            </div>
          )}

          {/* h-1.5 progress bar — more visible than h-1 */}
          {showProgress && (
            <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-white/5 overflow-hidden">
              <div className="h-full" style={{ width: `${Math.round(progress * 100)}%`, background: color }} />
            </div>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-4" side="top" sideOffset={8}>
        <p className="font-bold text-sm mb-1" style={{ color }}>{name}</p>
        <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{description}</p>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Progress</span>
            <span className="font-semibold tabular-nums">{Math.min(current, goal).toLocaleString()} / {goal.toLocaleString()}</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full transition-all"
              style={{ width: `${Math.round(progress * 100)}%`, background: color }} />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Reward</span>
          <span className="font-bold" style={{ color }}>+{xpReward} XP</span>
        </div>
      </PopoverContent>
    </Popover>
  )
}
```

> **Design notes:** `opacity: 0.45` on locked cards also dims the border, making category color invisible. Instead use low-alpha background + `rgba(255,255,255,0.08)` border — locked cards still show their grid position clearly on OLED black. `h-8 w-8` icon is 32px vs 28px — fills the 87px cell much better. `p-2` instead of `p-3` reclaims 8px per side for content. Don't forget to add `Lock` to the lucide imports.

- [ ] **Step 3: Make AchievementsGrid use 4-col on mobile with slightly larger cards**

The outer grid already uses `grid-cols-4`. Keep it but ensure minimum cell height for the aspect-square to work:

```tsx
<div className="grid grid-cols-4 gap-2.5">
  {visible.map(a => (
    <BadgeCard key={a.id} achievement={a} />
  ))}
</div>
```

- [ ] **Step 4: Commit**

```bash
git add components/profile/achievements-grid.tsx
git commit -m "Replace emoji badges with Lucide icons, category colors, and tap-to-reveal popover"
```

---

## Task 6 — Level/XP interactive detail sheet

**Goal:** Tapping the level badge on the profile page opens a bottom sheet showing: current level, XP progress bar, all level thresholds listed, and a breakdown of XP earned from each unlocked achievement.

**Files:**
- Create: `components/profile/level-sheet.tsx`
- Modify: `app/profile/profile-content.tsx` — wire up the sheet trigger

- [ ] **Step 1: Create level-sheet.tsx**

> **UX note:** Add a `useRef` + `useEffect` to auto-scroll the current level row into view 300ms after mount (allows the sheet open animation to complete first). Without this, a level-7 user sees levels 1–3 on open and has to manually scroll.


Create `/home/user/TrainingAI/components/profile/level-sheet.tsx`:

```tsx
'use client'

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import type { AchievementResult } from './achievements-grid'

const LEVEL_THRESHOLDS = [0, 100, 250, 500, 900, 1400, 2100, 3000, 4200, 5800, 8000]
const LEVEL_LABELS = ['', 'Novice', 'Novice', 'Beginner', 'Beginner', 'Intermediate', 'Intermediate', 'Advanced', 'Advanced', 'Elite', 'Elite', 'Legend']

interface LevelSheetProps {
  level: number
  xp: number
  currentLevelXp: number
  nextLevelXp: number
  achievements: AchievementResult[]
  children: React.ReactNode
}

export function LevelSheet({ level, xp, currentLevelXp, nextLevelXp, achievements, children }: LevelSheetProps) {
  const xpProgress = nextLevelXp > currentLevelXp
    ? Math.min(1, (xp - currentLevelXp) / (nextLevelXp - currentLevelXp))
    : 1

  const unlockedAchievements = achievements.filter(a => a.unlocked).sort((a, b) => b.xpReward - a.xpReward)

  // Auto-scroll to current level row after sheet animation completes
  const currentLevelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const timer = setTimeout(() => {
      currentLevelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 300)
    return () => clearTimeout(timer)
  }, [])

  return (
    <Sheet>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl px-0 pb-safe">
        <SheetHeader className="px-4 pb-3 border-b border-border">
          <SheetTitle>Level & XP</SheetTitle>
        </SheetHeader>

        <div className="px-4 py-4 space-y-6">
          {/* Current level hero */}
          <div className="flex flex-col items-center gap-3">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-black"
              style={{ background: "var(--color-brand)", color: "#000", boxShadow: "0 0 24px var(--color-brand)" }}
            >
              {level}
            </div>
            <div className="text-center">
              <p className="text-lg font-bold" style={{ color: "var(--color-brand)" }}>
                Level {level} · {LEVEL_LABELS[level] ?? 'Legend'}
              </p>
              <p className="text-sm text-muted-foreground">{xp} XP total</p>
            </div>
            <div className="w-full max-w-xs">
              <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                <span>{xp - currentLevelXp} XP</span>
                <span>{nextLevelXp - currentLevelXp} XP to Level {level + 1}</span>
              </div>
              <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.round(xpProgress * 100)}%`,
                    background: "var(--color-brand)",
                    boxShadow: "0 0 6px var(--color-brand)",
                    transition: "width 0.6s ease",
                  }}
                />
              </div>
            </div>
          </div>

          {/* Level thresholds */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">All Levels</p>
            <div className="space-y-2">
              {LEVEL_THRESHOLDS.map((threshold, i) => {
                const lvl = i + 1
                const isCurrentLevel = lvl === level
                const isPast = lvl < level
                return (
                  <div
                    key={lvl}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 border transition-all"
                    style={{
                      background: isCurrentLevel ? "color-mix(in oklch, var(--color-brand) 10%, transparent)" : "transparent",
                      borderColor: isCurrentLevel ? "var(--color-brand)" : "rgba(255,255,255,0.07)",
                      opacity: isPast ? 0.55 : 1,
                    }}
                  >
                    <div
                      className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-black flex-none"
                      style={{
                        background: isPast || isCurrentLevel ? "var(--color-brand)" : "var(--color-muted)",
                        color: isPast || isCurrentLevel ? "#000" : "var(--color-muted-foreground)",
                        opacity: isPast ? 0.6 : 1,
                      }}
                    >
                      {lvl}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold">{LEVEL_LABELS[lvl] ?? 'Legend'}</p>
                      <p className="text-[10px] text-muted-foreground">{threshold.toLocaleString()} XP</p>
                    </div>
                    {isCurrentLevel && (
                      <span className="text-[10px] font-bold rounded-lg px-2 py-1" style={{ background: "var(--color-brand)", color: "#000" }}>
                        Current
                      </span>
                    )}
                    {isPast && (
                      <span className="text-[10px] text-muted-foreground">✓</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* XP earned breakdown */}
          {unlockedAchievements.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                XP Sources ({unlockedAchievements.length} unlocked)
              </p>
              <div className="space-y-1.5">
                {unlockedAchievements.map(a => (
                  <div key={a.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 text-muted-foreground truncate">{a.name}</span>
                    <span className="font-semibold tabular-nums" style={{ color: "var(--color-brand)" }}>+{a.xpReward}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Wire LevelSheet into profile-content.tsx**

In `app/profile/profile-content.tsx`, import `LevelSheet` and wrap the level badge:

```tsx
import { LevelSheet } from '@/components/profile/level-sheet'

// Replace the level badge div with:
<LevelSheet
  level={level}
  xp={xp}
  currentLevelXp={currentLevelXp}
  nextLevelXp={nextLevelXp}
  achievements={achievementsData?.achievements ?? []}
>
  <button
    className="flex items-center gap-2 rounded-2xl px-4 py-2 border cursor-pointer active:scale-95 transition-transform"
    style={{
      background: "color-mix(in oklch, var(--color-brand) 10%, transparent)",
      borderColor: "color-mix(in oklch, var(--color-brand) 30%, transparent)",
    }}
  >
    <div
      className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-black"
      style={{ background: "var(--color-brand)", color: "#000" }}
    >
      {level}
    </div>
    <div className="text-left">
      <p className="text-xs font-bold leading-none" style={{ color: "var(--color-brand)" }}>
        Level {level} · {levelLabel}
      </p>
      <p className="text-[10px] text-muted-foreground mt-0.5">{xp} XP total · tap for details</p>
    </div>
  </button>
</LevelSheet>
```

- [ ] **Step 3: Commit**

```bash
git add components/profile/level-sheet.tsx app/profile/profile-content.tsx
git commit -m "Add interactive level sheet with XP breakdown and level thresholds"
```

---

## Task 7 — Profile settings reorganization

**Goal:**
- Move "Units" and "Food Region" from `profile-content.tsx` into `edit-profile-sheet.tsx`
- Remove the "Default Rest Timer" static info row
- Make the remaining settings sections feel more like the Aurora A_Settings design — cleaner grouped cards with a visible section purpose

**Files:**
- Modify: `app/profile/profile-content.tsx`
- Modify: `components/profile/edit-profile-sheet.tsx`

- [ ] **Step 1: Add Units and Food Region to edit-profile-sheet.tsx**

In `components/profile/edit-profile-sheet.tsx`, add state for both and wire them into the save payload:

```tsx
// Add to state:
const [units, setUnits] = useState<'kg' | 'lbs'>('kg')
const [foodRegion, setFoodRegion] = useState(user?.foodRegion ?? localStorage.getItem('ta_food_region') ?? 'AU')

// Reset them in resetFromUser():
// (units is not on User type yet — store in localStorage only)
setFoodRegion(localStorage.getItem('ta_food_region') ?? 'AU')

// Add to form after Timezone section, before Change Password:

<Divider />

{/* Units */}
<div className="flex items-center justify-between px-4 py-3">
  <div>
    <Label className="text-xs text-muted-foreground">Weight Units</Label>
    <p className="text-sm font-medium mt-0.5">Kg / Lbs</p>
  </div>
  <div className="flex items-center gap-0.5 rounded-xl bg-muted p-0.5 text-xs font-semibold">
    <button
      type="button"
      onClick={() => setUnits('kg')}
      className={`rounded-lg px-3 py-1.5 transition ${units === 'kg' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
    >kg</button>
    <button
      type="button"
      onClick={() => setUnits('lbs')}
      className={`rounded-lg px-3 py-1.5 transition ${units === 'lbs' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
    >lbs</button>
  </div>
</div>

<Divider />

{/* Food Region */}
<div className="px-4 py-3 space-y-2">
  <Label className="text-xs text-muted-foreground">Food Region</Label>
  <p className="text-[10px] text-muted-foreground">Used to bias AI food analysis toward local brands.</p>
  <div className="flex items-center gap-0.5 rounded-xl bg-muted p-0.5 text-xs font-semibold border border-border self-start">
    {['AU', 'US', 'UK', 'NZ'].map(r => (
      <button
        key={r}
        type="button"
        onClick={() => { setFoodRegion(r); localStorage.setItem('ta_food_region', r) }}
        className={`rounded-lg px-4 py-1.5 transition ${foodRegion === r ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
      >{r}</button>
    ))}
  </div>
</div>
```

- [ ] **Step 2: Remove Units, Food Region, and Default Rest Timer from profile-content.tsx**

In `app/profile/profile-content.tsx`:
1. In the "App Preferences" section — remove the Units row and `foodRegion` state/handlers
2. In the "Workout Settings" section — remove the "Default Rest Timer" static row
3. Remove `foodRegion` state, `setFoodRegion`, the `localStorage` effect line for it

- [ ] **Step 3: Gamify remaining settings sections**

In `profile-content.tsx`, update the App Preferences section to remove the now-deleted Units row and keep only the theme picker as a visually distinct card. Make Workout Settings more prominent:

```tsx
{/* App Preferences */}
<div>
  <SectionHeader label="Appearance" />
  <div className="rounded-2xl border border-border overflow-hidden"
    style={{ background: "color-mix(in oklch, var(--color-brand) 4%, var(--color-muted))" }}>
    <div className="px-4 py-4">
      <ThemeColorPicker />
    </div>
  </div>
</div>

{/* Workout Settings */}
<div>
  <SectionHeader label="Training" />
  <div className="rounded-2xl bg-muted/40 border border-border overflow-hidden">
    <button
      type="button"
      onClick={() => router.push('/config')}
      className="flex w-full items-center justify-between px-4 py-3.5 hover:bg-muted/60 transition"
    >
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: "color-mix(in oklch, var(--color-brand) 15%, var(--color-muted))" }}>
          <Settings className="h-4 w-4" style={{ color: "var(--color-brand)" }} />
        </div>
        <div>
          <p className="text-sm font-semibold text-left">Program & Exercises</p>
          <p className="text-[10px] text-muted-foreground">Progression styles, exercise config</p>
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </button>
  </div>
</div>
```

Add the `Settings` import from lucide-react if not already imported.

- [ ] **Step 4: Commit**

```bash
git add app/profile/profile-content.tsx components/profile/edit-profile-sheet.tsx
git commit -m "Move Units and Food Region to Edit Profile; clean up settings sections"
```

---

## Task 8 — Add Red and Gold accent themes

**Goal:** Add two more theme color options — Red and Gold — to the theme picker.

**Files:**
- Modify: `lib/brand-themes.ts`
- Modify: `app/globals.css` — add `[data-brand="red"]` and `[data-brand="gold"]` variable blocks

- [ ] **Step 1: Add entries to BRAND_THEMES in lib/brand-themes.ts**

Append to the `BRAND_THEMES` array (before `] as const`):

```ts
  {
    key: "red",
    label: "Red",
    color: "oklch(0.55 0.25 25)",
    hex: "#ff2d55",
    cardBgDark:      "rgba(255,45,85,0.07)",
    cardBorderDark:  "rgba(255,45,85,0.18)",
    glowDark:        "rgba(255,45,85,0.25)",
    cardBgLight:     "rgba(255,45,85,0.04)",
    cardBorderLight: "rgba(255,45,85,0.10)",
    glowLight:       "rgba(255,45,85,0.12)",
  },
  {
    key: "gold",
    label: "Gold",
    color: "oklch(0.80 0.18 85)",
    hex: "#ffd700",
    cardBgDark:      "rgba(255,215,0,0.07)",
    cardBorderDark:  "rgba(255,215,0,0.18)",
    glowDark:        "rgba(255,215,0,0.25)",
    cardBgLight:     "rgba(255,215,0,0.04)",
    cardBorderLight: "rgba(255,215,0,0.10)",
    glowLight:       "rgba(255,215,0,0.12)",
  },
```

Update `BrandThemeKey` to include `"red" | "gold"` — this is automatic since it's derived from the array type.

- [ ] **Step 2: Check if globals.css needs data-brand blocks**

Open `app/globals.css` and search for `[data-brand="blue"]`. If each theme has its own CSS variable block, add equivalent blocks for `red` and `gold`:

```css
[data-brand="red"] {
  --color-brand: oklch(0.55 0.25 25);
}
[data-brand="gold"] {
  --color-brand: oklch(0.80 0.18 85);
}
```

If the CSS uses a different pattern, follow the existing convention exactly.

- [ ] **Step 3: Commit**

```bash
git add lib/brand-themes.ts app/globals.css
git commit -m "Add Red and Gold accent color themes"
```

---

## Task 9 — AI Coach widget (plan only — do not implement)

This is documented here for future reference. The `/api/readiness-score` endpoint already exists and returns:
- `score` (0–100)
- `hasSufficientData` (bool)
- `recommendation` text
- Component scores: sleep, recovery, consistency

**Planned UI:** A collapsible card on the home screen below the stats strip. When `hasSufficientData === true`, show the score with a ring indicator and the recommendation text. When false, show a "Not enough data yet" placeholder.

**Key consideration:** The widget should be context-aware of the user's schedule — if `/api/next-session` returns `isRestDay: true`, the AI coach card should show a rest day message rather than a workout recommendation. The two APIs should be composed: show AI coach only when `!isRestDay`.

**Implementation when ready:** Add `AiCoachCard` component reading from already-fetched `readiness` state in `session-select-content.tsx` (it's already fetched at line 460).

---

## Spec Coverage Check

| Requirement | Task |
|-------------|------|
| Rest day bug | Task 1 |
| Slow workout load | Task 2 |
| Session timer ring | Task 4 |
| Active set card D_Arc layout | Task 3 |
| Inactive sets halo | Task 3 (upcoming set branch) |
| Achievements Lucide icons | Task 5 |
| Achievements colored card borders | Task 5 |
| Achievement tap-to-reveal | Task 5 |
| Level interactive sheet | Task 6 |
| Settings reorg (Units, Food Region) | Task 7 |
| Remove Default Rest Timer | Task 7 |
| Gamified settings sections | Task 7 |
| New themes (Red, Gold) | Task 8 |
| AI Coach widget | Task 9 (plan only) |

All spec items covered.
