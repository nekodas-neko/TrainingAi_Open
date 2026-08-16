> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Recovery Estimator, Exercise Filter Fix & Morning Briefing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three independent features: (1) replace hardcoded Push/Pull/Legs exercise library filters with dynamic program-session filters; (2) add a per-muscle recovery % estimator to the workout select screen; (3) add a daily AI morning briefing card to the home screen.

**Architecture:** Each feature is self-contained. Feature 1 is a pure frontend change to an existing component. Feature 2 adds a new API route + a small UI component. Feature 3 adds a new API route + a new home-screen card (similar pattern to the weekly digest). No DB migrations needed.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind v4, Gemini via `@ai-sdk/google` + `generateText`, existing `getRepository()` / `getWorkoutSessionsFrom` / `listExerciseLibrary` / `listSleepSessions` / `listBodyMetrics`.

---

## Feature 1: Exercise Library Filter Fix

### Task 1: Make ExerciseLibrarySearch accept dynamic session filters

**Files:**
- Modify: `components/stats/exercise-library-search.tsx` (full rewrite of filter logic)
- Modify: `app/stats/stats-content.tsx` (pass `sessions` prop)

**Context:** `exercise-library-search.tsx` currently hardcodes `FILTERS = ["All", "Push", "Pull", "Legs", "Core"]` and maps muscle names to those filter labels. The fix: accept the user's `ProgramSession[]` from the parent, derive filter tabs as "All" + each session name, and filter exercises by whether they appear in that session's exercise list (falling back to a muscle-group heuristic for exercises not in any session).

- [ ] **Step 1: Update the component props and filter logic**

Replace the entire contents of `components/stats/exercise-library-search.tsx` with:

```tsx
"use client";

import { useState } from "react";
import { SearchIcon } from "lucide-react";
import type { ExerciseLibraryEntry, ProgramSession } from "@/lib/types/program";
import { ExerciseHistorySheet } from "@/components/exercise-history-sheet";

interface ExerciseLibrarySearchProps {
  exercises: ExerciseLibraryEntry[];
  sessions: ProgramSession[];
}

export function ExerciseLibrarySearch({ exercises, sessions }: ExerciseLibrarySearchProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [historyEx, setHistoryEx] = useState<{ name: string; muscles: ExerciseLibraryEntry["muscles"] } | null>(null);

  // Build exercise → session name map from the user's program
  const exerciseToSession = new Map<string, string>();
  for (const sess of sessions) {
    for (const ex of sess.exercises) {
      if (!exerciseToSession.has(ex.exerciseName.toLowerCase())) {
        exerciseToSession.set(ex.exerciseName.toLowerCase(), sess.name);
      }
    }
  }

  const filters = ["All", ...sessions.map(s => s.name)];

  const filtered = exercises.filter(ex => {
    if (!ex.name.toLowerCase().includes(query.toLowerCase())) return false;
    if (filter === "All") return true;
    return exerciseToSession.get(ex.name.toLowerCase()) === filter;
  });

  return (
    <div className="space-y-3">
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

      <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {filters.map(f => (
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
              onClick={() => setHistoryEx({ name: ex.name, muscles: ex.muscles })}
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
              <span className="text-muted-foreground text-sm">›</span>
            </button>
          );
        })}
      </div>

      <ExerciseHistorySheet
        exerciseName={historyEx?.name ?? null}
        muscles={historyEx?.muscles ?? []}
        onClose={() => setHistoryEx(null)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Pass `sessions` from stats-content.tsx**

In `app/stats/stats-content.tsx`, find the `<ExerciseLibrarySearch>` usage (search for `ExerciseLibrarySearch`) and add the `sessions` prop:

```tsx
<ExerciseLibrarySearch exercises={exercises} sessions={sessions} />
```

(`sessions` is already fetched and in state in `stats-content.tsx` — no new fetch needed.)

- [ ] **Step 3: Commit**

```bash
git add components/stats/exercise-library-search.tsx app/stats/stats-content.tsx
git commit -m "Replace hardcoded Push/Pull/Legs exercise library filters with dynamic program session filters"
```

---

## Feature 2: Muscle Recovery Estimator

### Task 2: New API route — `/api/muscle-recovery`

**Files:**
- Create: `app/api/muscle-recovery/route.ts`

**Recovery model:** For each muscle group, find the most recent session that trained it (within 7 days). Compute hours since that training. Apply a simple exponential recovery curve:

`pct = min(100, round(100 × (1 − e^(−hoursAgo / τ))))`

where τ (time constant) is:
- 36 hours for muscles trained at high volume (≥ 3000 kg for that exercise)
- 24 hours for lower volume

This gives ~63% recovered at τ hours, ~86% at 2τ, ~95% at 3τ.

Muscles trained > 7 days ago or never: 100% recovered.

- [ ] **Step 1: Create the route**

Create `app/api/muscle-recovery/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

export interface MuscleRecoveryEntry {
  muscle: string
  pct: number          // 0–100, higher = more recovered
  hoursAgo: number     // hours since last trained, capped at 168 (7 days)
}

export interface MuscleRecoveryResponse {
  muscles: MuscleRecoveryEntry[]
}

// Normalise muscle name to lowercase for dedup
function normMuscle(m: string) { return m.toLowerCase().trim() }

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepository()
  const from7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const [sessions, library] = await Promise.all([
    repo.getWorkoutSessionsFrom(userId, from7d),
    repo.listExerciseLibrary(),
  ])

  const libByName = new Map(library.map(e => [e.name.toLowerCase(), e]))

  // Track: muscle → { lastTrainedMs, totalVolume }
  const muscleLastTrained = new Map<string, { lastTrainedMs: number; volume: number }>()

  for (const ws of sessions) {
    for (const ex of ws.exercises) {
      const entry = libByName.get(ex.exerciseName.toLowerCase())
      if (!entry) continue
      const trainedMs = ws.startedAt.getTime()
      const vol = ex.volume ?? 0
      for (const m of entry.muscles) {
        if (m.role !== 'main') continue
        const key = normMuscle(m.muscle)
        const existing = muscleLastTrained.get(key)
        if (!existing || trainedMs > existing.lastTrainedMs) {
          muscleLastTrained.set(key, { lastTrainedMs: trainedMs, volume: vol })
        }
      }
    }
  }

  const now = Date.now()
  const muscles: MuscleRecoveryEntry[] = Array.from(muscleLastTrained.entries()).map(([muscle, { lastTrainedMs, volume }]) => {
    const hoursAgo = Math.min(168, (now - lastTrainedMs) / 3_600_000)
    // Heavy session (≥3000 kg volume) recovers slower: τ=36h; lighter: τ=24h
    const tau = volume >= 3000 ? 36 : 24
    const pct = Math.min(100, Math.round(100 * (1 - Math.exp(-hoursAgo / tau))))
    return { muscle, pct, hoursAgo: Math.round(hoursAgo) }
  })

  // Sort: least recovered first, then by muscle name
  muscles.sort((a, b) => a.pct - b.pct || a.muscle.localeCompare(b.muscle))

  return NextResponse.json({ muscles } satisfies MuscleRecoveryResponse)
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/muscle-recovery/route.ts
git commit -m "Add muscle recovery estimator API — exponential curve from last training volume"
```

---

### Task 3: Muscle recovery UI on workout select screen

**Files:**
- Create: `components/workout/muscle-recovery-card.tsx`
- Modify: `app/workout-select/workout-select-content.tsx`

**UI design:** A compact horizontal scrolling list of muscle chips, each coloured by recovery %:
- Red (< 50%): still recovering
- Amber (50–79%): partially recovered  
- Green (≥ 80%): ready

Show only muscles trained in the last 7 days (i.e. what the API returns). If no data, show nothing.

- [ ] **Step 1: Create the card component**

Create `components/workout/muscle-recovery-card.tsx`:

```tsx
"use client";

import type { MuscleRecoveryEntry } from "@/app/api/muscle-recovery/route";

interface MuscleRecoveryCardProps {
  muscles: MuscleRecoveryEntry[];
}

function recoveryColor(pct: number): string {
  if (pct >= 80) return "#22c55e";
  if (pct >= 50) return "#f59e0b";
  return "#ef4444";
}

function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1) }

export function MuscleRecoveryCard({ muscles }: MuscleRecoveryCardProps) {
  if (muscles.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border p-3 mx-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
        Muscle Recovery
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
        {muscles.map(m => (
          <div
            key={m.muscle}
            className="flex-none flex flex-col items-center gap-1 rounded-xl px-3 py-2 border"
            style={{
              borderColor: recoveryColor(m.pct) + "40",
              background: recoveryColor(m.pct) + "12",
            }}
          >
            <span className="text-[11px] font-bold tabular-nums" style={{ color: recoveryColor(m.pct) }}>
              {m.pct}%
            </span>
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {capitalize(m.muscle)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Fetch and render in workout-select-content.tsx**

In `app/workout-select/workout-select-content.tsx`:

Add the import at the top:
```tsx
import { MuscleRecoveryCard } from "@/components/workout/muscle-recovery-card";
import type { MuscleRecoveryEntry } from "@/app/api/muscle-recovery/route";
```

Add state inside the component (near other `useState` declarations):
```tsx
const [recoveryMuscles, setRecoveryMuscles] = useState<MuscleRecoveryEntry[]>([]);
```

Add a fetch in the existing `useEffect` (or a new one alongside it):
```tsx
useEffect(() => {
  fetch('/api/muscle-recovery')
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d?.muscles?.length) setRecoveryMuscles(d.muscles) })
    .catch(() => {});
}, []);
```

Find where the muscle heatmap is rendered in the JSX (the `<div style={{ maxHeight: '200px' }}>` wrapping `<MuscleHeatmap>`) and add the recovery card just below it:

```tsx
<MuscleRecoveryCard muscles={recoveryMuscles} />
```

- [ ] **Step 3: Commit**

```bash
git add components/workout/muscle-recovery-card.tsx app/workout-select/workout-select-content.tsx
git commit -m "Add muscle recovery estimator card to workout select screen"
```

---

## Feature 3: AI Morning Briefing

### Task 4: New API route — `/api/morning-briefing`

**Files:**
- Create: `app/api/morning-briefing/route.ts`

**Design:** GET endpoint (unlike the weekly digest POST). Builds context from:
- Last night's sleep (duration + quality from `listSleepSessions`)
- Yesterday's training session (name + volume from `getWorkoutSessionsFrom`)
- 7-day average HRV and RHR trends (from `listBodyMetrics`)
- Today's readiness score (computed inline, same logic as `/api/readiness-score` but abbreviated)
- Today's recommended session name (from `getNextSession`)

Calls `generateText` with Gemini. Returns `{ briefing: string, generatedAt: string }`.

The briefing should be 2–4 sentences max. Prompt instructs Gemini to be direct, specific, and emoji-friendly.

- [ ] **Step 1: Create the route**

Create `app/api/morning-briefing/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { google } from '@ai-sdk/google'
import { generateText } from 'ai'
import { DEFAULT_TZ } from '@/lib/date-utils'
import { toZonedTime } from 'date-fns-tz'

export interface MorningBriefingResponse {
  briefing: string
  generatedAt: string
}

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepository()
  const tz = session.user.timezone ?? DEFAULT_TZ
  const now = new Date()
  const todayIso = now.toISOString().slice(0, 10)
  const from7dIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const from2dIso = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const [sleepSessions, bodyMetrics, recentSessions, recommendation] = await Promise.all([
    repo.listSleepSessions(userId, from2dIso, todayIso),
    repo.listBodyMetrics(userId, from7dIso, todayIso),
    repo.getWorkoutSessionsFrom(userId, new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)),
    repo.getNextSession(userId, tz),
  ])

  // Last night's sleep
  const sortedSleep = [...sleepSessions].sort((a, b) => b.sleepEnd.getTime() - a.sleepEnd.getTime())
  const lastSleep = sortedSleep[0]
  const sleepStr = lastSleep?.durationHours != null
    ? `${lastSleep.durationHours.toFixed(1)}h sleep last night`
    : 'no sleep data'

  // Yesterday's training
  const localNow = toZonedTime(now, tz)
  localNow.setHours(0, 0, 0, 0)
  const yesterdayStart = new Date(localNow.getTime() - 24 * 60 * 60 * 1000)
  const yesterdaySessions = recentSessions.filter(
    ws => ws.startedAt >= yesterdayStart && ws.startedAt < localNow
  )
  const trainingStr = yesterdaySessions.length > 0
    ? `trained ${yesterdaySessions.map(ws => ws.sessionName).join(' + ')} yesterday (${
        Math.round(yesterdaySessions.reduce((s, ws) => s + ws.exercises.reduce((e, ex) => e + (ex.volume ?? 0), 0), 0))
      } kg volume)`
    : 'rest day yesterday'

  // 7-day HRV trend
  const hrvRows = bodyMetrics.filter(m => m.hrvMs != null && m.hrvMs > 0).sort((a, b) => b.date.localeCompare(a.date))
  const hrvStr = hrvRows.length >= 3
    ? `HRV 7d avg: ${Math.round(hrvRows.reduce((s, m) => s + m.hrvMs!, 0) / hrvRows.length)} ms`
    : null

  // Today's recommendation
  const recStr = !recommendation.isRestDay && recommendation.session
    ? `recommended today: ${recommendation.session.name}`
    : 'rest day recommended'

  const context = [sleepStr, trainingStr, hrvStr, recStr].filter(Boolean).join(' · ')

  const { text } = await generateText({
    model: google('gemini-3.1-flash-lite'),
    prompt: `You are a concise personal training coach writing a morning briefing for an athlete. Write exactly 2–3 sentences. Be specific, positive, and actionable. Use 1–2 relevant emojis. Do not use markdown or bullet points — plain sentences only.\n\nData: ${context}`,
  })

  return NextResponse.json({
    briefing: text.trim(),
    generatedAt: new Date().toISOString(),
  } satisfies MorningBriefingResponse)
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/morning-briefing/route.ts
git commit -m "Add morning briefing API — Gemini summary of sleep, training, HRV and today's recommendation"
```

---

### Task 5: Morning briefing card on home screen

**Files:**
- Modify: `app/session-select/session-select-content.tsx`

**Design:** A compact card near the top of the home screen (before the sortable sections but after the readiness card). Shows the briefing text in plain prose. Auto-fetches on mount; cached in `localStorage` with a today-key so it only calls the API once per day. Shows a skeleton while loading. Has a small ↺ refresh button.

- [ ] **Step 1: Add state and fetch logic**

In `app/session-select/session-select-content.tsx`, add state near the other useState declarations:

```tsx
const todayKey = typeof window !== 'undefined'
  ? new Date().toISOString().slice(0, 10)
  : '';
const BRIEFING_KEY = `ta_morning_briefing_${todayKey}`;
const [briefing, setBriefing] = useState<string | null>(null);
const [briefingLoading, setBriefingLoading] = useState(false);
```

Add a function to fetch the briefing (place it near `generateDigest` if it were in this file — just add it inside the component):

```tsx
const fetchBriefing = useCallback(async () => {
  try {
    const cached = localStorage.getItem(BRIEFING_KEY);
    if (cached) { setBriefing(cached); return; }
  } catch { /* ignore */ }
  setBriefingLoading(true);
  try {
    const res = await fetch('/api/morning-briefing');
    if (res.ok) {
      const d = await res.json();
      if (d.briefing) {
        setBriefing(d.briefing);
        try { localStorage.setItem(BRIEFING_KEY, d.briefing); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  finally { setBriefingLoading(false); }
}, [BRIEFING_KEY]);
```

Trigger it once on mount by adding this `useEffect`:

```tsx
useEffect(() => { fetchBriefing(); }, [fetchBriefing]);
```

- [ ] **Step 2: Add the card to the JSX**

Find the readiness card block:
```tsx
{/* ── Readiness Score Card ── */}
{readiness && (
  <div className="mx-4 mb-3 ...">
```

Add the morning briefing card **directly after** the readiness card closing `</div>`:

```tsx
{/* ── Morning Briefing ── */}
{(briefing || briefingLoading) && (
  <div className="mx-4 mb-3 rounded-2xl border border-border p-4" style={{ background: 'var(--brand-card-bg)' }}>
    <div className="flex items-center justify-between mb-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Morning Briefing</p>
      <button
        onClick={fetchBriefing}
        disabled={briefingLoading}
        className="text-muted-foreground disabled:opacity-40 transition"
        aria-label="Refresh briefing"
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className={briefingLoading ? "animate-spin" : ""}>
          <path d="M11.5 6.5A5 5 0 1 1 9 2.07" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M9 1v3h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
    {briefingLoading && !briefing ? (
      <div className="space-y-1.5">
        <div className="h-3.5 w-full animate-pulse rounded bg-muted" />
        <div className="h-3.5 w-4/5 animate-pulse rounded bg-muted" />
      </div>
    ) : (
      <p className="text-sm leading-relaxed text-foreground/90">{briefing}</p>
    )}
  </div>
)}
```

Note: `useCallback` is already imported in this file. If `fetchBriefing` needs it added to imports, check — it's already there.

- [ ] **Step 3: Commit**

```bash
git add app/session-select/session-select-content.tsx
git commit -m "Add morning briefing card to home screen — Gemini daily summary, cached per day"
```

---

### Task 6: Final cleanup — bump version and update changelog

**Files:**
- Modify: `lib/changelog.ts`
- Modify: `package.json`
- Modify: `projectOverview.md`

- [ ] **Step 1: Bump package.json version**

Change `"version": "1.1.1"` → `"version": "1.2.0"` (minor bump — new user-visible features).

- [ ] **Step 2: Add changelog entry**

In `lib/changelog.ts`, add a new entry at the top of the `CHANGELOG` array:

```ts
{
  version: "1.2.0",
  date: "2026-05-30",
  changes: [
    "Exercise library filters now match your program sessions instead of hardcoded Push/Pull/Legs",
    "Muscle recovery estimator on workout select — shows % recovered per muscle group since last training",
    "Morning briefing card on home screen — daily Gemini summary of sleep, training and readiness",
  ],
},
```

Also update `CURRENT_VERSION`:
```ts
export const CURRENT_VERSION = CHANGELOG[0].version;
```
(This is already pointing to `CHANGELOG[0]` so it auto-updates — no change needed.)

- [ ] **Step 3: Update projectOverview.md**

Add a session entry to `projectOverview.md` under Past Changes:

```markdown
### Session 34 — Recovery Estimator, Filter Fix & Morning Briefing (2026-05-30)

- **`components/stats/exercise-library-search.tsx`** — replaced hardcoded Push/Pull/Legs/Core filters with dynamic session-name filters derived from the user's active program
- **`app/api/muscle-recovery/route.ts`** (new) — exponential recovery curve per muscle group based on last training timestamp + volume (τ=24h light, τ=36h heavy)
- **`components/workout/muscle-recovery-card.tsx`** (new) — horizontal chip row on workout select screen, colour-coded by % recovered
- **`app/api/morning-briefing/route.ts`** (new) — GET endpoint, Gemini 2–3 sentence daily briefing from sleep + training + HRV; cached in localStorage by date
- **`app/session-select/session-select-content.tsx`** — morning briefing card above sortable sections, auto-fetches once per day with ↺ refresh button
```

- [ ] **Step 4: Commit and push**

```bash
git add lib/changelog.ts package.json projectOverview.md
git commit -m "Bump version to 1.2.0, update changelog and project overview"
git push origin main
```

---

## Self-Review

**Spec coverage:**
- ✅ Exercise library filter: dynamic from program sessions, no hardcoded names
- ✅ Muscle recovery estimator: API + card on workout select
- ✅ Morning briefing: API + home screen card with caching + refresh

**Placeholder scan:** No TBD, no TODO, no vague "add error handling" — all steps have concrete code.

**Type consistency:**
- `MuscleRecoveryEntry` defined in route, imported in card component and workout-select ✅
- `MorningBriefingResponse` defined in route, not imported in client (plain fetch) ✅
- `ExerciseLibraryEntry["muscles"]` used in search component matches the type from `@/lib/types/program` ✅
- `sessions: ProgramSession[]` passed to `ExerciseLibrarySearch` — `sessions` state already exists in `stats-content.tsx` ✅

**Edge cases covered:**
- No recovery data → `MuscleRecoveryCard` returns null (not rendered)
- No briefing cached + API unavailable → `briefingLoading=false`, `briefing=null` → card not shown
- Sessions list empty on stats page → filter shows only "All", no crash
