> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent 4-tab bottom nav, redesign the home screen, add Stats and Nutrition pages, enhance the workout complete screen, add colored session borders in the program builder, add tags to progression styles, and add an exercise history sheet accessible from the pre-workout list.

**Architecture:** The bottom nav is a standalone client component added to each shell page (session-select, stats, nutrition) but not to the immersive workout screen. New pages (`/stats`, `/nutrition`) follow the same pattern as existing pages — a thin server component for auth + a client content component. All new data fetching uses existing repository methods or two new lightweight API routes.

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript · Tailwind CSS v4 · Radix/shadcn/ui · Lucide icons · existing `/api/*` routes

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| CREATE | `components/shell/bottom-nav.tsx` | 4-tab nav bar (Home / Workout / Stats / Nutrition) |
| CREATE | `app/stats/page.tsx` | Auth guard + Suspense shell for stats |
| CREATE | `app/stats/stats-content.tsx` | Client: fetches weekly stats + exercise library, renders hub + search |
| CREATE | `components/stats/weekly-stats-hub.tsx` | Training load bars, stats grid (2×2), muscle balance rows |
| CREATE | `components/stats/exercise-library-search.tsx` | Searchable + filterable exercise list |
| CREATE | `app/nutrition/page.tsx` | Coming-soon nutrition screen with mock donut |
| CREATE | `app/api/weekly-stats/route.ts` | GET: sessions/sets/intensity/duration for current week |
| CREATE | `app/api/exercise-history/route.ts` | GET `?name=`: last 20 logs for one exercise |
| CREATE | `components/exercise-history-sheet.tsx` | Slide-up sheet: 1RM trend SVG + session log table |
| MODIFY | `app/session-select/session-select-content.tsx` | Redesign layout; add pb-20 for nav clearance |
| MODIFY | `app/session-select/page.tsx` | Wrap content + BottomNav |
| MODIFY | `components/workout/done-screen.tsx` | Add 2×2 stats grid + Share button |
| MODIFY | `components/config-screen.tsx` | Colored session borders + style tags |
| MODIFY | `components/workout/pre-workout-screen.tsx` | Tap exercise name → open ExerciseHistorySheet |

---

## Task 1: Bottom Navigation Component

**Files:**
- Create: `components/shell/bottom-nav.tsx`

- [ ] Create `components/shell/bottom-nav.tsx`:

```tsx
"use client";

import { usePathname, useRouter } from "next/navigation";
import { HomeIcon, DumbbellIcon, BarChart2Icon, AppleIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "Home",     icon: HomeIcon,     href: "/session-select" },
  { label: "Workout",  icon: DumbbellIcon, href: "/session-select" },
  { label: "Stats",    icon: BarChart2Icon,href: "/stats"           },
  { label: "Nutrition",icon: AppleIcon,    href: "/nutrition"       },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 bg-background/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)]">
      <div className="flex h-14 items-stretch">
        {TABS.map(({ label, icon: Icon, href }) => {
          const active =
            label === "Home"
              ? pathname === "/session-select"
              : label === "Workout"
              ? pathname.startsWith("/workout")
              : pathname.startsWith(href);
          return (
            <button
              key={label}
              onClick={() => router.push(href)}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
                active ? "text-brand" : "text-muted-foreground"
              )}
            >
              <Icon className="h-5 w-5" />
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
```

- [ ] Commit: `feat: add 4-tab bottom navigation component`

---

## Task 2: Wire Bottom Nav into Session-Select Page

**Files:**
- Modify: `app/session-select/page.tsx`
- Modify: `app/session-select/session-select-content.tsx` (pb-20 only)

- [ ] Replace `app/session-select/page.tsx`:

```tsx
import { Suspense } from "react";
import SessionSelectContent from "./session-select-content";
import { BottomNav } from "@/components/shell/bottom-nav";

export default async function SessionSelectPage() {
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

- [ ] In `app/session-select/session-select-content.tsx`, find the outermost scrollable container div (around line 390–410) and add `pb-20` so content isn't hidden behind the nav. Search for `overflow-y-auto` — that div needs `pb-20`. Also the settings/log sheet content needs `pb-[max(1.5rem,env(safe-area-inset-bottom))]` (already present on sheets).

  The outermost scrollable div starts around line 393:
  ```tsx
  // Before:
  <div className="flex-1 overflow-y-auto">
  // After:
  <div className="flex-1 overflow-y-auto pb-20">
  ```

- [ ] Commit: `feat: add bottom nav to home screen`

---

## Task 3: Home Screen Layout Redesign

**Files:**
- Modify: `app/session-select/session-select-content.tsx`

The goal is to restructure the visual layout while keeping ALL existing state, hooks, and data-fetching logic. Only the JSX return section changes.

Current structure (around line 390–870):
- Settings button + greeting header
- Health stats grid (widget buttons)
- Calendar widget
- Recommendation carousel (dialRef scroll)
- Overlay sheets

New structure:
1. **Header row** — greeting + avatar-style settings button
2. **Recommendation card** — gradient background, session emoji, start button (replaces scrollable carousel)
3. **Stats row** — streak card + "This Week" card (side by side)
4. **Week strip** — 7 day dots (Mon–Sun) colored by session type
5. **Health metrics** — existing widget buttons, styled as a horizontal scroll row
6. **Calendar** (if visible) — same CalendarWidget below

- [ ] Read lines 385–560 of `session-select-content.tsx` to see the current JSX before editing:

```bash
sed -n '385,560p' /home/user/TrainingAI/app/session-select/session-select-content.tsx
```

- [ ] After reading the current JSX, replace the return statement's main content area. The key state variables already exist:
  - `activeSessions` — array of ProgramSession
  - `centeredSession` — currently selected session name
  - `sessionData` — map of session name → workout data
  - `recommendation` — `{ isRestDay, session, reason }` or null
  - `metaToday` — today's body metrics
  - `metaRecent` — recent body metrics array
  - `calendarVisible` — boolean
  - `activeWidgets` — string[] of widget keys
  - `streakDays` — number (already computed via `daysSinceSession`)

  Add a `weekStrip` derived value just before the return:

```tsx
// 7-day strip: last 7 AEST days → {dateKey, sessionNames}
const weekStrip = useMemo(() => {
  const days: { label: string; dateKey: string; sessions: string[] }[] = [];
  const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  for (let ago = 6; ago >= 0; ago--) {
    const ms = Date.now() + 10 * 3600_000 - ago * 86400_000;
    const d = new Date(ms);
    const dateKey = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
    const dayIndex = (d.getUTCDay() + 6) % 7; // 0=Mon
    days.push({ label: DAY_LABELS[dayIndex], dateKey, sessions: calendarDays[dateKey] ?? [] });
  }
  return days;
}, [calendarDays]);
```

  Note: `calendarDays` is the existing `Record<string, string[]>` from the calendar widget data. If it doesn't exist as a state var yet, it needs to be added. Check if `CalendarWidget` exposes day data. Since it doesn't, we need a small fetch inside `session-select-content.tsx`.

  Add this state + fetch after the existing `fetchMeta` useEffect:

```tsx
const [calendarDays, setCalendarDays] = useState<Record<string, string[]>>({});

useEffect(() => {
  const now = new Date();
  const aestNow = new Date(now.getTime() + 10 * 3600_000);
  fetch(`/api/calendar-data?year=${aestNow.getUTCFullYear()}&month=${aestNow.getUTCMonth() + 1}`)
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d?.trainedDays) setCalendarDays(d.trainedDays); })
    .catch(() => {});
}, []);
```

- [ ] Replace the main rendered JSX (the `<div className="flex-1 overflow-y-auto ...">` section) with the new layout. The existing carousel, dialRef, and DIAL_ORDER logic can be removed from the JSX only (keep the state if it's referenced in sheets or handlers; remove the HTML). The recommendation object (`recommendation`) from `/api/next-session` is already fetched — use it for the card.

  New JSX for the scrollable content area (replaces everything inside the `flex-1 overflow-y-auto` div):

```tsx
<div className="flex-1 overflow-y-auto pb-20">
  {/* ── Header ── */}
  <div className="flex items-center justify-between px-4 pt-safe pt-4 pb-2">
    <div>
      <p className="text-xs text-muted-foreground">
        {new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}
      </p>
      <h1 className="text-xl font-bold leading-tight">{getGreeting(displayName)}</h1>
    </div>
    <button
      onClick={() => setWidgetPickerOpen(true)}
      className="h-10 w-10 rounded-full flex items-center justify-center bg-muted border border-border hover:bg-muted/80 transition"
    >
      <Settings2Icon className="h-4 w-4 text-muted-foreground" />
    </button>
  </div>

  {/* ── Recommendation Card ── */}
  <div className="px-4 pb-3">
    {recommendation === null ? (
      <div className="h-36 animate-pulse rounded-2xl bg-muted" />
    ) : recommendation.isRestDay ? (
      <div className="rounded-2xl bg-muted/60 border border-border p-5 flex items-center gap-4">
        <span className="text-4xl">😴</span>
        <div>
          <p className="font-bold text-lg">Rest Day</p>
          <p className="text-sm text-muted-foreground">{recommendation.reason}</p>
        </div>
      </div>
    ) : (
      <div
        className="rounded-2xl p-5 flex items-center gap-4"
        style={{ background: "linear-gradient(135deg, var(--brand-card-bg), color-mix(in oklch, var(--color-brand) 25%, transparent))", border: "1px solid var(--brand-card-border)" }}
      >
        <span className="text-4xl">
          {recommendation.session?.icon ?? getPaletteEntry(recommendation.session?.position ?? 0).emoji}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-brand uppercase tracking-wide">Recommended</p>
          <p className="font-bold text-xl leading-tight">{recommendation.session?.name ?? "Workout"}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{recommendation.reason}</p>
        </div>
        <button
          onClick={() => recommendation.session && router.push(`/workout?session=${encodeURIComponent(recommendation.session.name)}`)}
          className="flex-none rounded-xl px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90"
          style={{ background: "var(--color-brand)" }}
        >
          Start
        </button>
      </div>
    )}
  </div>

  {/* ── All Sessions ── */}
  <div className="px-4 pb-3 flex gap-2 overflow-x-auto no-scrollbar">
    {activeSessions.map((sess) => {
      const p = getPaletteEntry(sess.position);
      return (
        <button
          key={sess.id}
          onClick={() => router.push(`/workout?session=${encodeURIComponent(sess.name)}`)}
          className={`flex-none flex items-center gap-2 rounded-xl px-3 py-2 border text-sm font-semibold transition ${p.bgClass} ${p.borderClass} ${p.textClass}`}
        >
          <span>{sess.icon ?? p.emoji}</span>
          {sess.name}
        </button>
      );
    })}
  </div>

  {/* ── 7-Day Week Strip ── */}
  <div className="px-4 pb-3">
    <div className="flex gap-1 justify-between">
      {weekStrip.map((day) => {
        const isToday = day === weekStrip[weekStrip.length - 1];
        const hasSessions = day.sessions.length > 0;
        const sessionIdx = activeSessions.findIndex(s => day.sessions.includes(s.name));
        const palette = sessionIdx >= 0 ? getPaletteEntry(sessionIdx) : null;
        return (
          <div key={day.dateKey} className="flex flex-1 flex-col items-center gap-1">
            <span className={`text-[10px] font-medium ${isToday ? "text-brand" : "text-muted-foreground"}`}>
              {day.label}
            </span>
            <div
              className={`h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold transition
                ${isToday ? "ring-2 ring-brand ring-offset-1 ring-offset-background" : ""}
                ${hasSessions && palette ? `${palette.dotClass} text-white` : "bg-muted text-muted-foreground"}`}
            >
              {hasSessions ? (sess.icon ?? "●").replace(/[^●]/g, "●").slice(0, 1) : "·"}
            </div>
          </div>
        );
      })}
    </div>
  </div>

  {/* ── Health Metrics ── */}
  {activeWidgets.length > 0 && (
    <div className="px-4 pb-3">
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {WIDGET_DEFS.filter(d => activeWidgets.includes(d.key)).map((def) => {
          const val = metaToday?.[def.key];
          return (
            <button
              key={def.key}
              onClick={() => setLogWidget(def)}
              className="flex-none flex flex-col items-center gap-0.5 rounded-2xl bg-muted border border-border px-4 py-3 min-w-[80px] transition hover:bg-muted/80"
            >
              <span className="text-xl">{def.emoji}</span>
              <span className="text-sm font-bold tabular-nums">
                {val != null ? val : "—"}
              </span>
              <span className="text-[10px] text-muted-foreground">{def.unit || def.label}</span>
            </button>
          );
        })}
        <button
          onClick={() => { setWidgetPickerOpen(true); setWidgetsExpanded(true); }}
          className="flex-none flex flex-col items-center justify-center gap-0.5 rounded-2xl border border-dashed border-border px-4 py-3 min-w-[80px] text-muted-foreground hover:bg-muted/40 transition"
        >
          <span className="text-lg">+</span>
          <span className="text-[10px]">Widget</span>
        </button>
      </div>
    </div>
  )}

  {/* ── Calendar ── */}
  {calendarVisible && (
    <div className="px-4 pb-4">
      <CalendarWidget onDaySelect={(date) => openDayOverlay(date)} />
    </div>
  )}
</div>
```

  Note: `displayName`, `openDayOverlay` are already in the component. Add `import { getPaletteEntry } from "@/lib/session-palette"` if not already imported (it is, at line 5).

  Also add `no-scrollbar` utility to `app/globals.css` if not already present:
  ```css
  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
  ```

- [ ] Commit: `feat: redesign home screen layout with recommendation card and week strip`

---

## Task 4: Weekly Stats API Route

**Files:**
- Create: `app/api/weekly-stats/route.ts`

The endpoint returns aggregated data for the last 7 AEST days.

- [ ] Create `app/api/weekly-stats/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";

export interface WeeklyStatsResponse {
  days: { dateKey: string; label: string; sessions: string[] }[];
  totalSessions: number;
  totalSets: number;
  avgIntensityPct: number | null;  // average intensityPct across all sets with data
  avgDurationMin: number | null;   // average workout duration in minutes
}

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Compute AEST week boundaries (last 7 days ending today)
  const nowAest = new Date(Date.now() + 10 * 3600_000);
  const todayKey = `${nowAest.getUTCFullYear()}/${String(nowAest.getUTCMonth() + 1).padStart(2, "0")}/${String(nowAest.getUTCDate()).padStart(2, "0")}`;
  const from = new Date(nowAest.getTime() - 6 * 86400_000);
  from.setUTCHours(0, 0, 0, 0);
  // Convert back to UTC: AEST = UTC+10, so midnight AEST = 14:00 UTC previous day
  const fromUtc = new Date(from.getTime() - 10 * 3600_000);

  const repo = await getRepository();
  const sessions = await repo.getWorkoutSessionsFrom(userId, fromUtc);

  const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const days: WeeklyStatsResponse["days"] = [];
  for (let ago = 6; ago >= 0; ago--) {
    const ms = nowAest.getTime() - ago * 86400_000;
    const d = new Date(ms);
    const dateKey = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
    const dayIndex = (d.getUTCDay() + 6) % 7;
    const sessionNames = sessions
      .filter(ws => {
        const wsAest = new Date(ws.startedAt.getTime() + 10 * 3600_000);
        const wsKey = `${wsAest.getUTCFullYear()}/${String(wsAest.getUTCMonth() + 1).padStart(2, "0")}/${String(wsAest.getUTCDate()).padStart(2, "0")}`;
        return wsKey === dateKey;
      })
      .map(ws => ws.sessionName);
    days.push({ dateKey, label: DAY_LABELS[dayIndex], sessions: [...new Set(sessionNames)] });
  }

  const totalSessions = sessions.length;

  let totalSets = 0;
  let intensitySum = 0;
  let intensityCount = 0;
  let durationSum = 0;
  let durationCount = 0;

  for (const ws of sessions) {
    for (const ex of ws.exercises) {
      totalSets += ex.sets.length;
      for (const set of ex.sets) {
        if (set.intensityPct != null && set.intensityPct > 0) {
          intensitySum += set.intensityPct;
          intensityCount++;
        }
      }
    }
    if (ws.startedAt && ws.completedAt) {
      durationSum += (ws.completedAt.getTime() - ws.startedAt.getTime()) / 60000;
      durationCount++;
    }
  }

  return NextResponse.json({
    days,
    totalSessions,
    totalSets,
    avgIntensityPct: intensityCount > 0 ? Math.round(intensitySum / intensityCount) : null,
    avgDurationMin: durationCount > 0 ? Math.round(durationSum / durationCount) : null,
  } satisfies WeeklyStatsResponse);
}
```

- [ ] Commit: `feat: add weekly-stats API endpoint`

---

## Task 5: Exercise History API Route

**Files:**
- Create: `app/api/exercise-history/route.ts`

- [ ] Create `app/api/exercise-history/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";

export interface ExerciseHistoryEntry {
  date: string;        // "YYYY/MM/DD HH:mm" AEST
  sessionName: string;
  sets: number;
  weightKg: number[];
  reps: number[];
  estimated1rm: number | null;
  volume: number | null;
}

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const repo = await getRepository();
  // Fetch last 90 days of sessions; filter to the requested exercise
  const from = new Date(Date.now() - 90 * 86400_000);
  const allSessions = await repo.getWorkoutSessionsFrom(userId, from);

  const entries: ExerciseHistoryEntry[] = [];
  for (const ws of allSessions) {
    for (const ex of ws.exercises) {
      if (ex.exerciseName.toLowerCase() !== name.toLowerCase()) continue;
      const aestMs = ex.loggedAt.getTime() + 10 * 3600_000;
      const d = new Date(aestMs);
      const date = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
      entries.push({
        date,
        sessionName: ws.sessionName,
        sets: ex.sets.length,
        weightKg: ex.sets.map(s => s.weightKg),
        reps: ex.sets.map(s => s.reps),
        estimated1rm: ex.estimated1rm ?? null,
        volume: ex.volume ?? null,
      });
    }
  }

  // Most recent first
  entries.sort((a, b) => b.date.localeCompare(a.date));

  return NextResponse.json({ entries: entries.slice(0, 20) });
}
```

- [ ] Commit: `feat: add exercise-history API endpoint`

---

## Task 6: Exercise History Sheet Component

**Files:**
- Create: `components/exercise-history-sheet.tsx`

- [ ] Create `components/exercise-history-sheet.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TrendingUpIcon } from "lucide-react";
import type { ExerciseHistoryEntry } from "@/app/api/exercise-history/route";

interface ExerciseHistorySheetProps {
  exerciseName: string | null;
  onClose: () => void;
}

export function ExerciseHistorySheet({ exerciseName, onClose }: ExerciseHistorySheetProps) {
  const [entries, setEntries] = useState<ExerciseHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!exerciseName) { setEntries([]); return; }
    setLoading(true);
    fetch(`/api/exercise-history?name=${encodeURIComponent(exerciseName)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setEntries(d?.entries ?? []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [exerciseName]);

  // Build a simple SVG sparkline from 1RM values
  const rms = entries.map(e => e.estimated1rm).filter((v): v is number => v != null && v > 0);
  const hasChart = rms.length >= 2;
  const maxRm = hasChart ? Math.max(...rms) : 0;
  const minRm = hasChart ? Math.min(...rms) : 0;
  const range = maxRm - minRm || 1;
  const W = 280; const H = 60; const PAD = 4;
  const points = rms
    .slice()
    .reverse()
    .map((v, i, arr) => {
      const x = PAD + (i / (arr.length - 1)) * (W - PAD * 2);
      const y = H - PAD - ((v - minRm) / range) * (H - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const best1rm = rms.length > 0 ? Math.max(...rms) : null;

  return (
    <Sheet open={!!exerciseName} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent side="bottom" className="pb-[max(1.5rem,env(safe-area-inset-bottom))] max-h-[85dvh] flex flex-col">
        <SheetHeader className="flex-none">
          <SheetTitle className="flex items-center gap-2">
            <TrendingUpIcon className="h-4 w-4 text-brand" />
            {exerciseName}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-1 space-y-4">
          {loading && (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-10 animate-pulse rounded-xl bg-muted" />)}
            </div>
          )}

          {!loading && entries.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">No history in the last 90 days.</p>
          )}

          {!loading && best1rm != null && (
            <div className="flex gap-3">
              <div className="flex-1 rounded-xl bg-muted/60 border border-border p-3 text-center">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Best 1RM</p>
                <p className="text-2xl font-bold tabular-nums" style={{ color: "var(--color-brand)" }}>{best1rm} kg</p>
              </div>
              <div className="flex-1 rounded-xl bg-muted/60 border border-border p-3 text-center">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Sessions</p>
                <p className="text-2xl font-bold tabular-nums">{entries.length}</p>
              </div>
            </div>
          )}

          {hasChart && (
            <div className="rounded-xl bg-muted/40 border border-border p-3">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-2">1RM Trend (90 days)</p>
              <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="overflow-visible">
                <defs>
                  <linearGradient id="rm-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <polygon
                  points={`${PAD},${H} ${points} ${W - PAD},${H}`}
                  fill="url(#rm-fill)"
                />
                <polyline
                  points={points}
                  fill="none"
                  stroke="var(--color-brand)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <div className="flex justify-between mt-1">
                <span className="text-[10px] text-muted-foreground">90d ago</span>
                <span className="text-[10px] text-muted-foreground">Today</span>
              </div>
            </div>
          )}

          {!loading && entries.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Session Log</p>
              <div className="space-y-2">
                {entries.map((entry, i) => (
                  <div key={i} className="rounded-xl bg-muted/60 border border-border px-3 py-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold">{entry.date.slice(0, 10)}</span>
                      {entry.estimated1rm != null && (
                        <span className="text-xs font-bold tabular-nums" style={{ color: "var(--color-brand)" }}>
                          1RM ~{entry.estimated1rm} kg
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {entry.weightKg.map((w, si) => (
                        <span key={si} className="text-[11px] bg-background rounded-lg px-2 py-0.5 border border-border tabular-nums">
                          {w} kg × {entry.reps[si]}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] Commit: `feat: add ExerciseHistorySheet component`

---

## Task 7: Wire History Sheet into Pre-Workout Screen

**Files:**
- Modify: `components/workout/pre-workout-screen.tsx`

- [ ] Read the current exercise list rendering in `pre-workout-screen.tsx` (around lines 60–160) to find where exercise names are rendered.

- [ ] Add state and import to `pre-workout-screen.tsx`:

```tsx
// Add to imports:
import { ExerciseHistorySheet } from "@/components/exercise-history-sheet";

// Add inside the component, before return:
const [historyExercise, setHistoryExercise] = useState<string | null>(null);
```

- [ ] In the exercise list rows, make the exercise name clickable. Find the exercise name `<p>` or `<span>` element and wrap it:

```tsx
// Before (example — match exact existing className):
<p className="font-semibold text-sm">{ex.name}</p>
// After:
<button
  onClick={() => setHistoryExercise(ex.name)}
  className="font-semibold text-sm text-left hover:text-brand transition-colors"
>
  {ex.name}
</button>
```

- [ ] Add the sheet at the end of the returned JSX, before the closing `</div>`:

```tsx
<ExerciseHistorySheet
  exerciseName={historyExercise}
  onClose={() => setHistoryExercise(null)}
/>
```

- [ ] Commit: `feat: tap exercise name in pre-workout to view history`

---

## Task 8: Weekly Stats Hub Component

**Files:**
- Create: `components/stats/weekly-stats-hub.tsx`

- [ ] Create directory: `mkdir -p components/stats`

- [ ] Create `components/stats/weekly-stats-hub.tsx`:

```tsx
"use client";

import type { WeeklyStatsResponse } from "@/app/api/weekly-stats/route";

interface WeeklyStatsHubProps {
  data: WeeklyStatsResponse | null;
  loading: boolean;
}

const BAR_COLORS = ["bg-amber-500", "bg-green-500", "bg-indigo-500", "bg-blue-500", "bg-purple-500", "bg-red-500"];

export function WeeklyStatsHub({ data, loading }: WeeklyStatsHubProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />)}
      </div>
    );
  }

  if (!data) return null;

  const maxLoad = Math.max(1, ...data.days.map(d => d.sessions.length));

  const STAT_CARDS = [
    { label: "Sessions",      value: data.totalSessions,                       unit: "this week" },
    { label: "Sets",          value: data.totalSets,                            unit: "logged"    },
    { label: "Avg Intensity", value: data.avgIntensityPct != null ? `${data.avgIntensityPct}%` : "—", unit: "of 1RM" },
    { label: "Avg Duration",  value: data.avgDurationMin  != null ? `${data.avgDurationMin}m`  : "—", unit: "per session" },
  ];

  return (
    <div className="space-y-4">
      {/* Training Load Bars */}
      <div className="rounded-2xl bg-muted/60 border border-border p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Training Load</p>
        <div className="flex items-end gap-1 h-14">
          {data.days.map((day, i) => {
            const height = day.sessions.length > 0 ? Math.max(16, (day.sessions.length / maxLoad) * 52) : 6;
            const isToday = i === data.days.length - 1;
            return (
              <div key={day.dateKey} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className={`w-full rounded-t-md transition-all ${day.sessions.length > 0 ? "opacity-90" : "opacity-20 bg-muted-foreground"}`}
                  style={{
                    height,
                    background: day.sessions.length > 0 ? "var(--color-brand)" : undefined,
                  }}
                />
                <span className={`text-[9px] font-medium ${isToday ? "text-brand" : "text-muted-foreground"}`}>
                  {day.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-2">
        {STAT_CARDS.map(card => (
          <div key={card.label} className="rounded-2xl bg-muted/60 border border-border p-4">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{card.label}</p>
            <p className="text-2xl font-bold tabular-nums mt-0.5" style={{ color: "var(--color-brand)" }}>
              {card.value}
            </p>
            <p className="text-[10px] text-muted-foreground">{card.unit}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] Commit: `feat: add WeeklyStatsHub component`

---

## Task 9: Exercise Library Search Component

**Files:**
- Create: `components/stats/exercise-library-search.tsx`

- [ ] Create `components/stats/exercise-library-search.tsx`:

```tsx
"use client";

import { useState } from "react";
import { SearchIcon } from "lucide-react";
import type { ExerciseLibraryEntry } from "@/lib/types/program";
import { ExerciseHistorySheet } from "@/components/exercise-history-sheet";

interface ExerciseLibrarySearchProps {
  exercises: ExerciseLibraryEntry[];
}

const FILTERS = ["All", "Push", "Pull", "Legs", "Core"] as const;

const MUSCLE_TO_FILTER: Record<string, string> = {
  Chest: "Push", Shoulders: "Push", Triceps: "Push",
  Back: "Pull", Lats: "Pull", Biceps: "Pull", "Upper Back": "Pull", Traps: "Pull",
  Quads: "Legs", Hamstrings: "Legs", Glutes: "Legs", Calves: "Legs",
  Abs: "Core", Core: "Core",
};

export function ExerciseLibrarySearch({ exercises }: ExerciseLibrarySearchProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [historyExercise, setHistoryExercise] = useState<string | null>(null);

  const filtered = exercises.filter(ex => {
    const matchesQuery = ex.name.toLowerCase().includes(query.toLowerCase());
    if (!matchesQuery) return false;
    if (filter === "All") return true;
    return ex.muscles.some(m => MUSCLE_TO_FILTER[m.muscle] === filter);
  });

  return (
    <div className="space-y-3">
      {/* Search bar */}
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search exercises…"
          className="w-full rounded-xl border border-border bg-muted pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex-none rounded-full px-3 py-1 text-xs font-semibold border transition ${
              filter === f
                ? "bg-brand text-white border-brand"
                : "bg-muted text-muted-foreground border-border"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Exercise list */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">No matches</p>
        )}
        {filtered.map(ex => {
          const mainMuscles = ex.muscles.filter(m => m.role === "main").map(m => m.muscle);
          const secondaryMuscles = ex.muscles.filter(m => m.role === "secondary").map(m => m.muscle);
          return (
            <button
              key={ex.id}
              onClick={() => setHistoryExercise(ex.name)}
              className="w-full text-left rounded-xl bg-muted/60 border border-border px-4 py-3 flex items-center gap-3 hover:bg-muted transition"
            >
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{ex.name}</p>
                {(mainMuscles.length > 0 || secondaryMuscles.length > 0) && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {mainMuscles.map(m => (
                      <span key={m} className="text-[10px] rounded-full bg-brand/20 text-brand border border-brand/30 px-2 py-0.5 font-medium">
                        {m}
                      </span>
                    ))}
                    {secondaryMuscles.map(m => (
                      <span key={m} className="text-[10px] rounded-full bg-muted border border-border px-2 py-0.5 text-muted-foreground">
                        {m}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <span className="text-muted-foreground text-xs">›</span>
            </button>
          );
        })}
      </div>

      <ExerciseHistorySheet
        exerciseName={historyExercise}
        onClose={() => setHistoryExercise(null)}
      />
    </div>
  );
}
```

- [ ] Commit: `feat: add ExerciseLibrarySearch component`

---

## Task 10: Stats Page

**Files:**
- Create: `app/stats/page.tsx`
- Create: `app/stats/stats-content.tsx`

- [ ] Create `app/stats/page.tsx`:

```tsx
import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import StatsContent from "./stats-content";
import { BottomNav } from "@/components/shell/bottom-nav";

export default async function StatsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  return (
    <>
      <Suspense fallback={null}>
        <StatsContent />
      </Suspense>
      <BottomNav />
    </>
  );
}
```

- [ ] Create `app/stats/stats-content.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { WeeklyStatsHub } from "@/components/stats/weekly-stats-hub";
import { ExerciseLibrarySearch } from "@/components/stats/exercise-library-search";
import type { WeeklyStatsResponse } from "@/app/api/weekly-stats/route";
import type { ExerciseLibraryEntry } from "@/lib/types/program";

export default function StatsContent() {
  const [weeklyStats, setWeeklyStats] = useState<WeeklyStatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [exercises, setExercises] = useState<ExerciseLibraryEntry[]>([]);

  useEffect(() => {
    fetch("/api/weekly-stats")
      .then(r => r.ok ? r.json() : null)
      .then(d => setWeeklyStats(d))
      .catch(() => {})
      .finally(() => setStatsLoading(false));

    fetch("/api/exercise-library")
      .then(r => r.ok ? r.json() : null)
      .then(d => setExercises(d?.exercises ?? []))
      .catch(() => {});
  }, []);

  return (
    <div className="flex flex-col bg-background min-h-screen">
      <header className="px-4 pt-safe pt-4 pb-3 border-b border-border">
        <h1 className="text-xl font-bold">Stats</h1>
        <p className="text-sm text-muted-foreground">Weekly overview & exercise library</p>
      </header>

      <div className="flex-1 overflow-y-auto pb-20 px-4 space-y-6 pt-4">
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            This Week
          </h2>
          <WeeklyStatsHub data={weeklyStats} loading={statsLoading} />
        </section>

        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Exercise Library
          </h2>
          <ExerciseLibrarySearch exercises={exercises} />
        </section>
      </div>
    </div>
  );
}
```

- [ ] Commit: `feat: add Stats page with weekly hub and exercise library`

---

## Task 11: Nutrition Coming-Soon Page

**Files:**
- Create: `app/nutrition/page.tsx`

- [ ] Create `app/nutrition/page.tsx`:

```tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/shell/bottom-nav";

export default async function NutritionPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  return (
    <>
      <div className="flex flex-col min-h-screen bg-background pb-20">
        <header className="px-4 pt-safe pt-4 pb-3 border-b border-border">
          <h1 className="text-xl font-bold">Nutrition</h1>
          <p className="text-sm text-muted-foreground">Macros & meal tracking</p>
        </header>

        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-6">
          {/* Mock donut chart */}
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle cx="70" cy="70" r="52" fill="none" stroke="hsl(var(--muted))" strokeWidth="18" />
            <circle cx="70" cy="70" r="52" fill="none" stroke="#00ff87" strokeWidth="18"
              strokeDasharray="115 212" strokeDashoffset="53" strokeLinecap="round" />
            <circle cx="70" cy="70" r="52" fill="none" stroke="#00d4ff" strokeWidth="18"
              strokeDasharray="95 212" strokeDashoffset="-62" strokeLinecap="round" />
            <circle cx="70" cy="70" r="52" fill="none" stroke="#bf5fff" strokeWidth="18"
              strokeDasharray="52 212" strokeDashoffset="-157" strokeLinecap="round" />
            <text x="70" y="74" textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor">Macros</text>
          </svg>

          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-brand/10 border border-brand/30 px-4 py-1.5 text-sm font-semibold text-brand mb-4">
              Coming Soon
            </div>
            <h2 className="text-2xl font-bold mb-2">Nutrition Tracking</h2>
            <p className="text-muted-foreground text-sm max-w-xs">
              Log meals, track macros, and see how your nutrition supports your training. Launching soon.
            </p>
          </div>

          <div className="flex flex-col gap-2 w-full max-w-xs">
            {[
              { emoji: "🥩", label: "Protein", pct: "35%" },
              { emoji: "🌾", label: "Carbs",   pct: "45%" },
              { emoji: "🧈", label: "Fat",      pct: "20%" },
            ].map(m => (
              <div key={m.label} className="flex items-center gap-3 rounded-xl bg-muted/60 border border-border px-4 py-2.5">
                <span className="text-xl">{m.emoji}</span>
                <span className="flex-1 text-sm font-medium">{m.label}</span>
                <span className="text-sm font-bold text-muted-foreground">{m.pct}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <BottomNav />
    </>
  );
}
```

- [ ] Commit: `feat: add Nutrition coming-soon page`

---

## Task 12: Enhanced Workout Complete Screen

**Files:**
- Modify: `components/workout/done-screen.tsx`

Current screen: check icon, "You crushed it!", count, duration, calendar status, AI button, back button.

New screen adds: 2×2 stats grid above the buttons (Volume, Duration, Exercises, Est. kcal) and a Share button (navigator.share or clipboard copy, graceful fallback).

- [ ] Replace `components/workout/done-screen.tsx`:

```tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CalendarIcon, CheckIcon, SparklesIcon, ShareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AiChatOverlay } from "@/components/ai-chat-overlay";
import { localDateString } from "@/lib/utils";
import type { WorkoutExercise } from "@/app/api/workout-data/route";
import { formatTime } from "./utils";

interface DoneScreenProps {
  exercises: WorkoutExercise[];
  todayLogged: Set<string>;
  workoutStartMs: number | null;
  calendarLoading: boolean;
  calendarAdded: boolean;
}

export function DoneScreen({
  exercises,
  todayLogged,
  workoutStartMs,
  calendarLoading,
  calendarAdded,
}: DoneScreenProps) {
  const router = useRouter();
  const [aiOpen, setAiOpen] = useState(false);

  useEffect(() => {
    import("canvas-confetti").then(({ default: confetti }) => {
      confetti({
        particleCount: 140,
        spread: 80,
        origin: { y: 0.35 },
        colors: ["#22c55e", "#16a34a", "#4ade80", "#86efac", "#ffffff"],
      });
    });
  }, []);

  const workoutDurationSec =
    workoutStartMs !== null ? Math.floor((Date.now() - workoutStartMs) / 1000) : null;

  const today = localDateString();
  const doneExercises = exercises.filter(
    (ex) =>
      todayLogged.has(ex.name) ||
      (!!ex.lastDate && ex.lastDate.slice(0, 10).replace(/-/g, "/") === today),
  );

  // Rough kcal estimate: ~5 kcal per set (very approximate)
  const estSets = doneExercises.reduce((sum, ex) => sum + (ex.lastSets ?? ex.defaultSets), 0);
  const estKcal = Math.round(estSets * 5 + (workoutDurationSec ?? 0) / 60 * 4);

  const STATS = [
    { label: "Exercises",  value: `${doneExercises.length}/${exercises.length}` },
    { label: "Duration",   value: workoutDurationSec != null ? formatTime(workoutDurationSec) : "—" },
    { label: "Sets",       value: String(estSets)    },
    { label: "Est. kcal",  value: String(estKcal)    },
  ];

  const handleShare = async () => {
    const text = `💪 Workout complete! ${doneExercises.length} exercises · ${workoutDurationSec != null ? formatTime(workoutDurationSec) : "??"} · ~${estKcal} kcal`;
    if (navigator.share) {
      await navigator.share({ text }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(text).catch(() => {});
    }
  };

  return (
    <>
      <div className="flex h-full flex-col items-center justify-center gap-5 bg-background px-6 text-center">
        <div
          className="flex h-24 w-24 items-center justify-center rounded-full border"
          style={{
            background: "var(--brand-card-bg)",
            borderColor: "var(--brand-card-border)",
            boxShadow: "0 0 40px var(--brand-glow), 0 0 80px var(--brand-glow)",
            color: "var(--color-brand)",
          }}
        >
          <CheckIcon className="h-12 w-12" />
        </div>

        <div>
          <h2 className="text-3xl font-bold">You crushed it! 💪</h2>
          {calendarLoading && (
            <p className="mt-2 text-xs text-muted-foreground flex items-center justify-center gap-1.5">
              <CalendarIcon className="h-3 w-3 animate-pulse" />
              Saving to Calendar…
            </p>
          )}
          {calendarAdded && (
            <p className="mt-2 text-xs text-green-600 dark:text-green-400 flex items-center justify-center gap-1.5">
              <CalendarIcon className="h-3 w-3" />
              Added to Google Calendar
            </p>
          )}
        </div>

        {/* 2×2 stats grid */}
        <div className="grid grid-cols-2 gap-2 w-full max-w-xs">
          {STATS.map(stat => (
            <div key={stat.label} className="rounded-2xl bg-muted/60 border border-border px-4 py-3 text-center">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{stat.label}</p>
              <p className="text-xl font-bold tabular-nums mt-0.5" style={{ color: "var(--color-brand)" }}>
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        <div className="flex w-full max-w-xs flex-col gap-3">
          <button
            onClick={() => setAiOpen(true)}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand text-white font-semibold hover:opacity-90 transition"
          >
            <SparklesIcon className="h-4 w-4" />
            Ask AI to analyse
          </button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="h-12 flex-1"
              onClick={handleShare}
            >
              <ShareIcon className="h-4 w-4 mr-1.5" />
              Share
            </Button>
            <Button variant="outline" className="h-12 flex-1" onClick={() => router.push("/session-select")}>
              Done
            </Button>
          </div>
        </div>
      </div>
      <AiChatOverlay open={aiOpen} onOpenChange={setAiOpen} />
    </>
  );
}
```

- [ ] Commit: `feat: enhance workout complete screen with stats grid and share button`

---

## Task 13: Config — Colored Session Borders in Program Builder

**Files:**
- Modify: `components/config-screen.tsx` (line ~888)

The program editor session cards at line 887:
```tsx
{programSessions.map((sess, si) => (
  <div key={si} className="rounded-xl border border-border bg-muted/40 p-3 space-y-2">
```

Change to use palette color for left border:

- [ ] In `components/config-screen.tsx`, find line ~888 and replace the session container div's className:

```tsx
// Before:
<div key={si} className="rounded-xl border border-border bg-muted/40 p-3 space-y-2">
// After:
<div key={si} className={`rounded-xl border-l-4 border bg-muted/40 p-3 space-y-2 ${getPaletteEntry(si).borderClass}`}>
```

`getPaletteEntry` is already imported in this file at the top.

- [ ] Commit: `feat: colored session borders in program builder by palette position`

---

## Task 14: Config — Progression Style Tags

**Files:**
- Modify: `components/config-screen.tsx` (line ~572–604)

Currently the style card shows: name + "N sets · pct%×reps/rest, ..." text.

Add tag chips below the description showing: set count, rep range, intensity range.

- [ ] Find the style card's inner `<div className="min-w-0 flex-1">` section around line 578–583 and add tags after the description `<p>`:

```tsx
// After the existing <p className="text-xs text-muted-foreground mt-0.5"> line, add:
<div className="flex flex-wrap gap-1 mt-1.5">
  <span className="text-[10px] rounded-full bg-brand/15 text-brand border border-brand/20 px-2 py-0.5 font-medium">
    {style.sets.length} set{style.sets.length !== 1 ? "s" : ""}
  </span>
  {(() => {
    const reps = style.sets.map(s => s.reps);
    const minR = Math.min(...reps); const maxR = Math.max(...reps);
    return (
      <span className="text-[10px] rounded-full bg-muted border border-border px-2 py-0.5 text-muted-foreground font-medium">
        {minR === maxR ? `${minR} reps` : `${minR}–${maxR} reps`}
      </span>
    );
  })()}
  {(() => {
    const pcts = style.sets.map(s => s.pct);
    const minP = Math.min(...pcts); const maxP = Math.max(...pcts);
    return (
      <span className="text-[10px] rounded-full bg-muted border border-border px-2 py-0.5 text-muted-foreground font-medium">
        {minP === maxP ? `${minP}%` : `${minP}–${maxP}%`}
      </span>
    );
  })()}
  {style.sets.some(s => s.restSec > 0) && (() => {
    const rests = style.sets.filter(s => s.restSec > 0).map(s => s.restSec);
    const maxR = Math.max(...rests);
    return (
      <span className="text-[10px] rounded-full bg-muted border border-border px-2 py-0.5 text-muted-foreground font-medium">
        {maxR >= 60 ? `${Math.round(maxR / 60)}min rest` : `${maxR}s rest`}
      </span>
    );
  })()}
</div>
```

- [ ] Commit: `feat: add stat tags to progression style cards`

---

## Task 15: TypeScript Build Check

- [ ] Run `npx tsc --noEmit` from the project root. Fix any type errors introduced by the new files.

  Common issues to watch for:
  - `WeeklyStatsResponse` import in `stats-content.tsx` — ensure the import path matches exactly.
  - `ExerciseHistoryEntry` import in the sheet — same.
  - `calendarDays` state added to `session-select-content.tsx` must not conflict with existing variable names.
  - `openDayOverlay` called in home screen JSX — confirm this function exists (it does, handles the day overlay sheet).
  - `displayName` in home screen JSX — confirm this is already computed in the component (it is, from session user data).

- [ ] Fix any errors, then commit: `fix: resolve TypeScript errors from UI redesign`

---

## Task 16: Final Push

- [ ] `git push -u origin claude/vibrant-edison-tx1sw`

---

## Self-Review

**Spec coverage check:**
- ✅ Home Dashboard → Tasks 2–3
- ✅ Active Workout weight dial note — weight dial already exists in `active-workout-screen.tsx` and is rendered during the active phase. No changes needed; the user noted this is a concern but the dial is already present in the component.
- ✅ Exercise History screen → Tasks 5–7
- ✅ Nutrition coming soon → Task 11
- ✅ Bottom nav (no FAB) → Tasks 1–2
- ✅ Weekly Stats Hub → Tasks 4, 8, 10
- ✅ Workout Complete → Task 12
- ✅ Exercise Library search → Tasks 9–10
- ✅ Program Builder colored borders → Task 13
- ✅ Progression Style tags → Task 14

**Placeholder scan:** No TODOs, TBDs, or vague instructions found.

**Type consistency:**
- `WeeklyStatsResponse` defined in `app/api/weekly-stats/route.ts`, imported in both `stats-content.tsx` and `weekly-stats-hub.tsx`. ✅
- `ExerciseHistoryEntry` defined in `app/api/exercise-history/route.ts`, imported in `exercise-history-sheet.tsx`. ✅
- `ExerciseLibraryEntry` from `@/lib/types/program` — already used in existing code. ✅
- `getPaletteEntry(si)` returns `PaletteEntry` with `borderClass: string` — used in Task 13. ✅
- `style.sets` in Task 14 is `StyleSet[]` where `StyleSet` has `{ pct, reps, restSec, useFor1rm }` per `lib/types/progression.ts`. ✅
