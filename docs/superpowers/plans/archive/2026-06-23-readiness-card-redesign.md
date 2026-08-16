# Readiness Card Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bloated readiness score card with a compact, tappable card that shows all four Oura health pillars (readiness arc, sleep, activity, HR) as icon chips and expands to reveal the full scoring breakdown and contributor bars.

**Architecture:** Three-part change — extend the API response type + route with new fields (activity score, HR stats, sleep contributors, ACWR grace period), create a new `ReadinessCard` component with collapsed/expanded states, and wire it into `overview-screen.tsx`. No new migrations or sync changes required — all data already exists in the DB.

**Tech Stack:** Next.js 15, React 19, TypeScript, Drizzle ORM, Lucide icons, Framer Motion (`motion/react`)

---

## File Map

| Action | File | What changes |
|--------|------|-------------|
| Modify | `app/api/readiness-score/route.ts` | Add `activityScore`, `activityContributors`, `sleepContributors`, `hrCurrent/Min/Avg/Max` to interface + response; ACWR grace period; fold `getActiveProgram` + `getHrForWindow` into parallel fetch |
| Create | `components/readiness-card.tsx` | New self-contained component with collapsed row + animated expanded section |
| Modify | `components/overview-screen.tsx` | Replace inline readiness block (lines 277–332) with `<ReadinessCard>` import |

---

## Task 1: Extend ReadinessScoreResponse type and API route

**Files:**
- Modify: `app/api/readiness-score/route.ts`

- [ ] **Step 1: Update the `ReadinessScoreResponse` interface**

Replace the existing interface (lines 8–34) with:

```typescript
export interface ReadinessScoreResponse {
  score: number
  label: 'High' | 'Moderate' | 'Low'
  components: {
    sleep: number   // 0–40
    hrv: number     // 0–30
    rhr: number     // 0–20
    load: number    // 0–10
  }
  hasSufficientData: boolean
  earlyDeloadRecommended: boolean
  source: 'oura+acwr' | 'oura' | 'custom' | 'none'
  ouraScore: number | null
  temperatureDeviation: number | null
  daySummary: string | null
  resilienceLevel: string | null
  sleepScore: number | null
  activityScore: number | null
  readinessContributors: Record<string, number | null> | null
  sleepContributors: Record<string, number | null> | null
  activityContributors: Record<string, number | null> | null
  hrCurrent: number | null
  hrMin: number | null
  hrAvg: number | null
  hrMax: number | null
  vo2Max: number | null
  vascularAge: number | null
  stressHigh: number | null
  recoveryHigh: number | null
  recommendedBedtimeStart: number | null
  recommendedBedtimeEnd: number | null
  sleepTimeStatus: string | null
}
```

- [ ] **Step 2: Fold `getActiveProgram` and `getHrForWindow` into the parallel fetch**

Replace lines 86–91:

```typescript
const [bodyMetrics, sleepSessions, recentSessions, ouraRows, program, todayHrRows] = await Promise.all([
  repo.listBodyMetrics(userId, from28dIso, todayIso),
  repo.listSleepSessions(userId, from28dIso, todayIso),
  repo.getWorkoutSessionsFrom(userId, from28dDate),
  repo.getOuraDaily(userId, todayIso, todayIso),
  repo.getActiveProgram(userId),
  repo.getHrForWindow(userId, todayMid, new Date(todayMid.getTime() + 86_400_000)),
])
```

- [ ] **Step 3: Add ACWR grace period check**

In the ACWR calculation block (after the `chronicAvg` + `hasEnoughHistory` lines, around line 144), add the program age gate before the `acwr` assignment:

```typescript
const programAgeMs = program?.startedAt
  ? todayMid.getTime() - new Date(program.startedAt).getTime()
  : Infinity
const acwr = hasEnoughHistory && chronicAvg > 100 && programAgeMs >= 28 * 86_400_000
  ? acuteLoad / chronicAvg
  : null
```

- [ ] **Step 4: Remove the now-duplicate `getActiveProgram` call**

Delete line 178:
```typescript
const program = await repo.getActiveProgram(userId)
```
The variable `program` is now available from the parallel fetch above.

- [ ] **Step 5: Compute HR stats from `todayHrRows`**

Add this block directly after the parallel fetch (after line 93 `const ouraToday = ouraRows[0] ?? null`):

```typescript
const hrCurrent = todayHrRows.length > 0 ? todayHrRows[todayHrRows.length - 1].bpm : null
const hrMin     = todayHrRows.length > 0 ? Math.min(...todayHrRows.map(r => r.bpm)) : null
const hrMax     = todayHrRows.length > 0 ? Math.max(...todayHrRows.map(r => r.bpm)) : null
const hrAvg     = todayHrRows.length > 0
  ? Math.round(todayHrRows.reduce((s, r) => s + r.bpm, 0) / todayHrRows.length)
  : null
```

- [ ] **Step 6: Add new fields to the `return NextResponse.json(...)` call**

In the return object (currently ends at `readinessContributors`), add after the existing fields:

```typescript
    activityScore:           ouraToday?.activityScore              ?? null,
    sleepContributors:       ouraToday?.sleepContributors          ?? null,
    activityContributors:    ouraToday?.activityContributors       ?? null,
    hrCurrent,
    hrMin,
    hrAvg,
    hrMax,
```

- [ ] **Step 7: Verify TypeScript compiles with no errors**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -40
```

Expected: no errors referencing `readiness-score/route.ts`.

- [ ] **Step 8: Commit**

```bash
git add app/api/readiness-score/route.ts
git commit -m "Extend readiness API with activity/sleep contributors, HR stats, ACWR grace period"
```

---

## Task 2: Create ReadinessCard component

**Files:**
- Create: `components/readiness-card.tsx`

- [ ] **Step 1: Create the file with all sub-components and the main export**

```typescript
'use client'

import { useState } from 'react'
import {
  MoonIcon, ZapIcon, HeartIcon, CircleDotIcon,
  ThermometerIcon, AlertTriangleIcon, ChevronDownIcon,
} from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { cn } from '@/lib/utils'
import type { ReadinessScoreResponse } from '@/app/api/readiness-score/route'

type Label = ReadinessScoreResponse['label']

function labelColor(label: Label): string {
  if (label === 'High') return '#22c55e'
  if (label === 'Moderate') return '#f59e0b'
  return '#ef4444'
}

function ScoreArc({ score, label }: { score: number; label: Label }) {
  const color = labelColor(label)
  const r = 18
  const circumference = 2 * Math.PI * r
  const offset = circumference * (1 - score / 100)
  return (
    <div className="relative flex-none w-11 h-11">
      <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r={r} fill="none" strokeWidth="3.5" className="stroke-muted/30" />
        <circle
          cx="22" cy="22" r={r} fill="none" strokeWidth="3.5"
          style={{
            stroke: color,
            strokeDasharray: circumference,
            strokeDashoffset: offset,
            strokeLinecap: 'round',
          }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs font-bold tabular-nums" style={{ color }}>{score}</span>
      </div>
    </div>
  )
}

function MetricChip({ icon, value, unit }: { icon: React.ReactNode; value: number | null; unit?: string }) {
  return (
    <div className="flex items-center gap-1 bg-muted/40 rounded-lg px-2 py-1 flex-none">
      <span className="text-muted-foreground flex-none [&>svg]:h-3 [&>svg]:w-3">{icon}</span>
      <span className={cn('text-xs font-semibold tabular-nums', value == null && 'text-muted-foreground/60')}>
        {value != null ? `${value}${unit ?? ''}` : '—'}
      </span>
    </div>
  )
}

function ContributorBars({ title, contributors }: { title: string; contributors: Record<string, number | null> }) {
  const entries = Object.entries(contributors)
    .filter(([, v]) => v != null)
    .sort(([, a], [, b]) => (a ?? 0) - (b ?? 0))
  if (entries.length === 0) return null
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      {entries.map(([key, val]) => {
        const pct = val ?? 0
        const color = pct >= 70 ? '#22c55e' : pct >= 45 ? '#f59e0b' : '#ef4444'
        return (
          <div key={key} className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-28 flex-none capitalize">
              {key.replace(/_/g, ' ')}
            </span>
            <div className="flex-1 h-1 rounded-full overflow-hidden bg-muted/60">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
            </div>
            <span className="text-[10px] font-semibold tabular-nums w-5 text-right" style={{ color }}>{val}</span>
          </div>
        )
      })}
    </div>
  )
}

function HrStats({
  current, min, avg, max,
}: { current: number | null; min: number | null; avg: number | null; max: number | null }) {
  const stats = [
    { label: 'Current', value: current },
    { label: 'Min', value: min },
    { label: 'Avg', value: avg },
    { label: 'Max', value: max },
  ]
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <HeartIcon className="h-3 w-3 text-muted-foreground" />
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Heart Rate Today</p>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {stats.map(s => (
          <div key={s.label} className="text-center bg-muted/40 rounded-lg py-1.5">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
            <p className="text-sm font-semibold tabular-nums">
              {s.value != null ? s.value : '—'}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ReadinessCard({ readiness }: { readiness: ReadinessScoreResponse }) {
  const [expanded, setExpanded] = useState(false)
  const color = labelColor(readiness.label)
  const adj = readiness.ouraScore != null ? readiness.score - readiness.ouraScore : null

  return (
    <div
      className="rounded-xl border border-border overflow-hidden cursor-pointer select-none"
      style={{ background: 'var(--brand-card-bg)' }}
      onClick={() => setExpanded(e => !e)}
    >
      {/* ── Collapsed row ── */}
      <div className="flex items-center gap-3 px-3 py-2">
        <ScoreArc score={readiness.score} label={readiness.label} />
        <div className="flex-none">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground leading-none">
            Readiness
          </p>
          <p className="text-sm font-semibold mt-0.5 leading-tight" style={{ color }}>
            {readiness.label}
          </p>
        </div>
        <div className="w-px h-7 bg-border/40 flex-none" />
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <MetricChip icon={<MoonIcon />} value={readiness.sleepScore} />
          <MetricChip icon={<ZapIcon />} value={readiness.activityScore} />
          <MetricChip icon={<HeartIcon />} value={readiness.hrCurrent} unit=" bpm" />
        </div>
        <ChevronDownIcon
          className="h-4 w-4 text-muted-foreground flex-none transition-transform duration-200"
          style={{ transform: expanded ? 'rotate(180deg)' : undefined }}
        />
      </div>

      {/* ── Expanded section ── */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="expanded"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-2 border-t border-border/40 space-y-3">

              {/* Score breakdown */}
              {readiness.ouraScore != null && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Score Breakdown
                  </p>
                  <div className="space-y-0.5">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <CircleDotIcon className="h-3 w-3" />
                        <span>Oura base</span>
                      </div>
                      <span className="font-semibold tabular-nums">{readiness.ouraScore}</span>
                    </div>
                    {adj != null && adj !== 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <ZapIcon className="h-3 w-3" />
                          <span>
                            {readiness.source === 'oura+acwr' ? 'Load (ACWR)' : 'Adjustment'}
                          </span>
                        </div>
                        <span className={cn('font-semibold tabular-nums', adj < 0 ? 'text-amber-400' : 'text-green-400')}>
                          {adj > 0 ? '+' : ''}{adj}
                        </span>
                      </div>
                    )}
                    {readiness.temperatureDeviation != null && Math.abs(readiness.temperatureDeviation) > 0.3 && (
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <ThermometerIcon className="h-3 w-3" />
                          <span>Temp deviation</span>
                        </div>
                        <span className="font-semibold tabular-nums text-amber-400">
                          {readiness.temperatureDeviation > 0 ? '+' : ''}
                          {readiness.temperatureDeviation.toFixed(1)}°C
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-xs border-t border-border/40 pt-1 mt-0.5">
                      <span className="text-muted-foreground font-medium">Final score</span>
                      <span className="font-bold tabular-nums" style={{ color }}>{readiness.score}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Readiness contributors */}
              {readiness.readinessContributors && (
                <ContributorBars title="Readiness" contributors={readiness.readinessContributors} />
              )}

              {/* Sleep contributors */}
              {readiness.sleepContributors && (
                <ContributorBars title="Sleep" contributors={readiness.sleepContributors} />
              )}

              {/* Activity contributors */}
              {readiness.activityContributors && (
                <ContributorBars title="Activity" contributors={readiness.activityContributors} />
              )}

              {/* HR stats */}
              <HrStats
                current={readiness.hrCurrent}
                min={readiness.hrMin}
                avg={readiness.hrAvg}
                max={readiness.hrMax}
              />

              {/* Early deload warning */}
              {readiness.earlyDeloadRecommended && (
                <div className="flex items-center gap-1.5">
                  <AlertTriangleIcon className="h-3.5 w-3.5 text-amber-400 flex-none" />
                  <span className="text-xs text-amber-400">
                    High training load — consider a deload week
                  </span>
                </div>
              )}

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles with no errors**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -40
```

Expected: no errors from `readiness-card.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/readiness-card.tsx
git commit -m "Add compact ReadinessCard component with arc, chips, and expandable breakdown"
```

---

## Task 3: Wire ReadinessCard into overview-screen

**Files:**
- Modify: `components/overview-screen.tsx`

- [ ] **Step 1: Add the import**

At the top of the file, alongside the other component imports, add:

```typescript
import { ReadinessCard } from '@/components/readiness-card'
```

- [ ] **Step 2: Replace the inline readiness block**

Find and delete the entire block from line 277 to line 332 (from the `{/* ── Readiness score ── */}` comment through the closing `</div>`). Replace it with:

```tsx
{/* ── Readiness score ── */}
{readiness && <ReadinessCard readiness={readiness} />}
```

- [ ] **Step 3: Verify TypeScript compiles with no errors**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -40
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add components/overview-screen.tsx
git commit -m "Wire ReadinessCard into overview screen, remove inline readiness block"
```

---

## Task 4: Local dev server smoke test

- [ ] **Step 1: Start the dev server**

```bash
cd /home/user/TrainingAI && pnpm dev &
sleep 8
curl -s http://localhost:3000 | head -5
```

Expected: HTML response (server is up).

- [ ] **Step 2: Hit the readiness API directly**

```bash
curl -s "http://localhost:3000/api/readiness-score" | python3 -m json.tool 2>/dev/null | head -40
```

Expected: JSON with `activityScore`, `hrCurrent`, `hrMin`, `hrAvg`, `hrMax`, `sleepContributors`, `activityContributors` fields present (values may be null if no data seeded).

- [ ] **Step 3: Verify new fields are present in response**

```bash
curl -s "http://localhost:3000/api/readiness-score" | python3 -c "
import json, sys
d = json.load(sys.stdin)
fields = ['activityScore','hrCurrent','hrMin','hrAvg','hrMax','sleepContributors','activityContributors']
for f in fields:
    print(f, ':', 'PRESENT' if f in d else 'MISSING')
"
```

Expected: all fields show `PRESENT`.

- [ ] **Step 4: Visually test the collapsed card**

Open `http://localhost:3000` in a browser (or use the preview URL). Verify:
- Readiness card is visibly shorter than before
- Circular arc appears on the left with the score inside
- Three chips appear: Moon (sleep), Zap (activity), Heart (HR) — showing `—` for any null values
- No emojis visible anywhere in the card

- [ ] **Step 5: Visually test the expanded card**

Click the readiness card. Verify:
- Card expands smoothly with animation
- Score breakdown section appears (Oura base → adj → final)
- Contributor bar sections appear (Readiness, Sleep, Activity) with colored bars
- HR stats grid appears with Current/Min/Avg/Max
- Chevron rotates 180° on expand, rotates back on collapse
- Clicking again collapses the card

- [ ] **Step 6: Stop dev server**

```bash
pkill -f "next dev" 2>/dev/null; true
```

---

## Task 5: Push to branch

- [ ] **Step 1: Push the feature branch**

```bash
git push -u origin claude/readiness-score-ui-0me5wp
```

Expected: branch pushed successfully.
