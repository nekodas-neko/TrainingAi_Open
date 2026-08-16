> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# AI Nutrition & Activity Goal Recommender — UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Profile "Activity & Goals" section, the AI recommendation review
sheet, the bi-weekly home-screen check-in card, and the TDEE display update, per
`docs/superpowers/specs/2026-06-14-ai-goal-recommender-design.md`. This plan depends on
the APIs/types built by `docs/superpowers/plans/2026-06-14-ai-goal-recommender-backend.md`
(`lib/types/user.ts` enums, `POST /api/nutrition-goals/recommend`, `PATCH
/api/nutrition-goals/[id]`, `POST /api/nutrition-goals/touch-review`,
`invalidateGoalRecommendations`, `lib/nutrition/goal-recommendation.ts` —
`ACTIVITY_MULTIPLIERS`).

**Architecture:** `components/profile/goal-recommendation-sheet.tsx` is a self-contained
review sheet — given a `GoalRecommendationData` payload (the recommend route's response
shape, exported from this file), it renders current-vs-suggested rows with toggles and
handles both "Apply Selected" (writing to `/api/user/goals`, `/api/nutrition/targets`,
`/api/user/profile`) and "Dismiss". `components/profile/activity-goals-section.tsx` adds
the activity-level/fitness-goal pickers to the Profile tab and the "Get AI
Recommendation" button that feeds the sheet. The same sheet is reused by a new
dismissible "goals check-in" card on the home screen
(`app/session-select/session-select-content.tsx`). Finally, `app/health/health-content.tsx`
switches its hardcoded `1.4` TDEE multiplier to `ACTIVITY_MULTIPLIERS[activityLevel]`.

**Tech Stack:** Next.js 15 client components, shadcn/ui (`Sheet`, `Switch`, `Button`,
`Label`), `sonner` toasts, existing `cachedFetch`/`invalidateCache` cache layer.

---

### Task 1: Review sheet — `components/profile/goal-recommendation-sheet.tsx`

**Files:**
- Create: `components/profile/goal-recommendation-sheet.tsx`

This component is reused by both the Profile "Get AI Recommendation" flow (Task 2) and
the home-screen scheduled check-in card (Task 4), so it's built first.

- [ ] **Step 1: Create the sheet component**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { User } from '@/lib/types'
import type { ActivityLevel } from '@/lib/types/user'
import { invalidateGoalRecommendations } from '@/lib/cache-groups'

export interface GoalRecommendationData {
  id: string
  current: {
    stepsGoal: number | null
    stepsGoalType: 'daily' | 'weekly' | null
    calorieGoal: number | null
    calorieGoalType: 'daily' | 'weekly' | null
    waterGoalMl: number | null
    waterGoalType: 'daily' | 'weekly' | null
    proteinG: number | null
    carbsG: number | null
    fatG: number | null
    activityLevel: ActivityLevel | null
  }
  recommended: {
    stepsGoal: number
    calories: number
    proteinG: number
    carbsG: number
    fatG: number
    waterMl: number
    activityLevel: ActivityLevel | null
  }
  reasoning: string
  insights: string
  dataQualityNote: string
}

interface GoalRecommendationSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: GoalRecommendationData | null
  onUserSaved: (updated: User) => void
  // Called with whichever of stepsGoal/calorieGoal/waterGoalMl were applied, so the
  // caller can update its own already-rendered state (these values also live in
  // localStorage, which this component writes through to directly).
  onGoalsApplied?: (applied: { stepsGoal?: number; calorieGoal?: number; waterGoalMl?: number }) => void
}

type MetricKey = 'steps' | 'calories' | 'protein' | 'carbs' | 'fat' | 'water'

interface MetricRow {
  key: MetricKey
  label: string
  unit: string
  current: number | null
  suggested: number
}

function multiplier(goalType: 'daily' | 'weekly' | null): number {
  return goalType === 'weekly' ? 7 : 1
}

function formatActivityLevel(level: ActivityLevel | null): string {
  return level ? level.replaceAll('_', ' ') : 'unset'
}

export function GoalRecommendationSheet({ open, onOpenChange, data, onUserSaved, onGoalsApplied }: GoalRecommendationSheetProps) {
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [applying, setApplying] = useState(false)
  const [dismissing, setDismissing] = useState(false)

  useEffect(() => {
    if (!data) return
    setChecked({
      steps: true, calories: true, protein: true, carbs: true, fat: true, water: true,
      activityLevel: true,
    })
  }, [data])

  if (!data) return null

  const rows: MetricRow[] = [
    { key: 'steps', label: 'Steps Goal', unit: '', current: data.current.stepsGoal, suggested: data.recommended.stepsGoal * multiplier(data.current.stepsGoalType) },
    { key: 'calories', label: 'Calories', unit: ' kcal', current: data.current.calorieGoal, suggested: data.recommended.calories * multiplier(data.current.calorieGoalType) },
    { key: 'protein', label: 'Protein', unit: 'g', current: data.current.proteinG, suggested: data.recommended.proteinG },
    { key: 'carbs', label: 'Carbs', unit: 'g', current: data.current.carbsG, suggested: data.recommended.carbsG },
    { key: 'fat', label: 'Fat', unit: 'g', current: data.current.fatG, suggested: data.recommended.fatG },
    { key: 'water', label: 'Water', unit: 'ml', current: data.current.waterGoalMl, suggested: data.recommended.waterMl * multiplier(data.current.waterGoalType) },
  ]

  const showActivityRow = data.recommended.activityLevel != null && data.recommended.activityLevel !== data.current.activityLevel

  async function handleApply() {
    setApplying(true)
    try {
      const goalsPatch: Record<string, number> = {}
      const stepsRow = rows.find(r => r.key === 'steps')!
      const caloriesRow = rows.find(r => r.key === 'calories')!
      const waterRow = rows.find(r => r.key === 'water')!
      if (checked.steps) goalsPatch.stepsGoal = Math.round(stepsRow.suggested)
      if (checked.calories) goalsPatch.calorieGoal = Math.round(caloriesRow.suggested)
      if (checked.water) goalsPatch.waterGoalMl = Math.round(waterRow.suggested)
      if (Object.keys(goalsPatch).length > 0) {
        await fetch('/api/user/goals', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(goalsPatch),
        })
        // The Profile "Goals" section and home-screen widgets read these values from
        // localStorage, not the DB — write through so they reflect the applied
        // suggestion without a full reload.
        if (goalsPatch.stepsGoal != null) localStorage.setItem('ta_steps_goal', String(goalsPatch.stepsGoal))
        if (goalsPatch.calorieGoal != null) localStorage.setItem('ta_calorie_goal_kcal', String(goalsPatch.calorieGoal))
        if (goalsPatch.waterGoalMl != null) localStorage.setItem('ta_water_goal_ml', String(goalsPatch.waterGoalMl))
        onGoalsApplied?.(goalsPatch)
      }

      const targetsPatch: Record<string, number> = {}
      if (checked.calories) targetsPatch.calories = data.recommended.calories
      if (checked.protein) targetsPatch.proteinG = data.recommended.proteinG
      if (checked.carbs) targetsPatch.carbsG = data.recommended.carbsG
      if (checked.fat) targetsPatch.fatG = data.recommended.fatG
      if (Object.keys(targetsPatch).length > 0) {
        await fetch('/api/nutrition/targets', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(targetsPatch),
        })
      }

      if (showActivityRow && checked.activityLevel) {
        const res = await fetch('/api/user/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activityLevel: data.recommended.activityLevel }),
        })
        if (res.ok) {
          const d = await res.json()
          onUserSaved(d.user)
        }
      }

      await fetch(`/api/nutrition-goals/${data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'applied' }),
      })
      await invalidateGoalRecommendations()
      toast.success('Goals updated')
      onOpenChange(false)
    } catch {
      toast.error('Failed to apply changes')
    } finally {
      setApplying(false)
    }
  }

  async function handleDismiss() {
    setDismissing(true)
    try {
      await fetch(`/api/nutrition-goals/${data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'dismissed' }),
      })
      onOpenChange(false)
    } catch {
      toast.error('Failed to dismiss')
    } finally {
      setDismissing(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-2xl px-0 pb-safe">
        <SheetHeader className="px-4 pb-3 border-b border-border">
          <SheetTitle>Goal Recommendation</SheetTitle>
        </SheetHeader>

        {data.dataQualityNote && (
          <div className="px-4 py-3 border-b border-border bg-amber-500/10">
            <p className="text-xs text-amber-700 dark:text-amber-400">{data.dataQualityNote}</p>
          </div>
        )}

        <div className="divide-y divide-border border-b border-border">
          {rows.map(row => (
            <div key={row.key} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{row.label}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {row.current != null ? `${Math.round(row.current).toLocaleString()}${row.unit}` : '—'}
                  {' → '}
                  <span className="font-semibold text-foreground">{Math.round(row.suggested).toLocaleString()}{row.unit}</span>
                </p>
              </div>
              <Switch checked={checked[row.key] ?? false} onCheckedChange={v => setChecked(prev => ({ ...prev, [row.key]: v }))} />
            </div>
          ))}

          {showActivityRow && (
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Activity Level</p>
                <p className="text-xs text-muted-foreground capitalize">
                  {formatActivityLevel(data.current.activityLevel)}
                  {' → '}
                  <span className="font-semibold text-foreground">{formatActivityLevel(data.recommended.activityLevel)}</span>
                </p>
              </div>
              <Switch checked={checked.activityLevel ?? false} onCheckedChange={v => setChecked(prev => ({ ...prev, activityLevel: v }))} />
            </div>
          )}
        </div>

        <div className="px-4 py-3 space-y-1 border-b border-border">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reasoning</p>
          <p className="text-sm text-foreground/90 leading-relaxed">{data.reasoning}</p>
        </div>

        {data.insights && (
          <div className="px-4 py-3 space-y-1 border-b border-border">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Insights</p>
            <p className="text-sm text-foreground/90 leading-relaxed">{data.insights}</p>
          </div>
        )}

        <div className="px-4 pt-3 pb-6 flex gap-2">
          <Button variant="outline" className="flex-1 h-11" onClick={handleDismiss} disabled={applying || dismissing}>
            {dismissing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Dismiss'}
          </Button>
          <Button className="flex-1 h-11" onClick={handleApply} disabled={applying || dismissing}>
            {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply Selected'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

`handleApply`/`handleDismiss` are plain online-only `fetch` calls with a try/catch toast on
failure — the same pattern `components/nutrition/nutrition-targets-form.tsx` already uses
for `/api/nutrition/targets` writes. Neither endpoint has offline queueing elsewhere in the
app, so this introduces no new offline-handling gap.

- [ ] **Step 2: Typecheck**

Run: `pnpm tsc --noEmit`

Expected: no errors (this depends on `ActivityLevel` from `lib/types/user.ts` and
`invalidateGoalRecommendations` from `lib/cache-groups.ts`, both added by the backend
plan's Task 2 and Task 8 — make sure those are merged first).

- [ ] **Step 3: Commit**

```bash
git add components/profile/goal-recommendation-sheet.tsx
git commit -m "Add goal recommendation review sheet"
```

---

### Task 2: Profile pickers + AI button — `components/profile/activity-goals-section.tsx`

**Files:**
- Create: `components/profile/activity-goals-section.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { User } from '@/lib/types'
import { ACTIVITY_LEVELS, FITNESS_GOALS, type ActivityLevel, type FitnessGoal } from '@/lib/types/user'
import { invalidateGoalRecommendations } from '@/lib/cache-groups'
import { GoalRecommendationSheet, type GoalRecommendationData } from './goal-recommendation-sheet'

const ACTIVITY_LABELS: Record<ActivityLevel, { label: string; description: string }> = {
  sedentary:    { label: 'Sedentary',    description: 'Little to no exercise, desk job' },
  light:        { label: 'Light',        description: 'Light exercise 1-3 days/week' },
  moderate:     { label: 'Moderate',     description: 'Moderate exercise 3-5 days/week' },
  active:       { label: 'Active',       description: 'Hard exercise 6-7 days/week' },
  extra_active: { label: 'Extra Active', description: 'Very hard exercise & physical job' },
}

const FITNESS_GOAL_LABELS: Record<FitnessGoal, { label: string; description: string }> = {
  lose_weight:  { label: 'Lose Weight',                       description: 'Calorie deficit to reduce body fat' },
  maintain:     { label: 'Maintain',                          description: 'Stay at current weight and performance' },
  build_muscle: { label: 'Build Muscle',                      description: 'Calorie surplus to support muscle growth' },
  recomp:       { label: 'Lose fat & build muscle (recomp)',  description: 'Slight deficit with high protein' },
}

interface ActivityGoalsSectionProps {
  user: User | null
  onUserSaved: (updated: User) => void
  onGoalsApplied?: (applied: { stepsGoal?: number; calorieGoal?: number; waterGoalMl?: number }) => void
}

export function ActivityGoalsSection({ user, onUserSaved, onGoalsApplied }: ActivityGoalsSectionProps) {
  const [saving, setSaving] = useState(false)
  const [recommending, setRecommending] = useState(false)
  const [recommendation, setRecommendation] = useState<GoalRecommendationData | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  async function patchProfile(patch: { activityLevel?: ActivityLevel | null; fitnessGoal?: FitnessGoal | null }) {
    setSaving(true)
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      onUserSaved(data.user)
      await invalidateGoalRecommendations()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const missingFields: string[] = []
  if (!user?.heightCm) missingFields.push('Height')
  if (!user?.dateOfBirth) missingFields.push('Birth Year')
  if (!user?.sex) missingFields.push('Biological Sex')
  if (!user?.activityLevel) missingFields.push('Activity Level')
  if (!user?.fitnessGoal) missingFields.push('Fitness Goal')

  async function getRecommendation() {
    setRecommending(true)
    try {
      const res = await fetch('/api/nutrition-goals/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'on_demand' }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.error === 'profile_incomplete') {
          toast.error(`Complete your profile first: ${(data.missing as string[]).join(', ')}`)
        } else if (data.error === 'no_weight_data') {
          toast.error('Log a body weight entry first to get a recommendation')
        } else {
          toast.error('Failed to get recommendation')
        }
        return
      }
      setRecommendation(data)
      setSheetOpen(true)
    } catch {
      toast.error('Failed to get recommendation')
    } finally {
      setRecommending(false)
    }
  }

  return (
    <div>
      <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Activity &amp; Goals</p>
      <div className="rounded-2xl bg-muted/40 border border-border overflow-hidden divide-y divide-border">
        <div className="px-4 py-3 space-y-2">
          <Label className="text-xs text-muted-foreground">Activity Level</Label>
          <div className="space-y-1.5">
            {ACTIVITY_LEVELS.map(level => {
              const active = user?.activityLevel === level
              return (
                <button
                  key={level}
                  type="button"
                  disabled={saving}
                  onClick={() => patchProfile({ activityLevel: active ? null : level })}
                  className={[
                    'w-full text-left rounded-xl border px-3 py-2 transition',
                    active ? 'bg-foreground text-background border-foreground' : 'bg-muted border-transparent text-foreground',
                  ].join(' ')}
                >
                  <p className="text-sm font-semibold">{ACTIVITY_LABELS[level].label}</p>
                  <p className={`text-[10px] ${active ? 'text-background/70' : 'text-muted-foreground'}`}>
                    {ACTIVITY_LABELS[level].description}
                  </p>
                </button>
              )
            })}
          </div>
        </div>

        <div className="px-4 py-3 space-y-2">
          <Label className="text-xs text-muted-foreground">Fitness Goal</Label>
          <div className="space-y-1.5">
            {FITNESS_GOALS.map(goal => {
              const active = user?.fitnessGoal === goal
              return (
                <button
                  key={goal}
                  type="button"
                  disabled={saving}
                  onClick={() => patchProfile({ fitnessGoal: active ? null : goal })}
                  className={[
                    'w-full text-left rounded-xl border px-3 py-2 transition',
                    active ? 'bg-foreground text-background border-foreground' : 'bg-muted border-transparent text-foreground',
                  ].join(' ')}
                >
                  <p className="text-sm font-semibold">{FITNESS_GOAL_LABELS[goal].label}</p>
                  <p className={`text-[10px] ${active ? 'text-background/70' : 'text-muted-foreground'}`}>
                    {FITNESS_GOAL_LABELS[goal].description}
                  </p>
                </button>
              )
            })}
          </div>
        </div>

        <div className="px-4 py-3 space-y-1.5">
          <Button onClick={getRecommendation} disabled={recommending || missingFields.length > 0} className="w-full h-10 gap-2">
            {recommending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Get AI Recommendation
          </Button>
          {missingFields.length > 0 && (
            <p className="text-[10px] text-muted-foreground text-center">
              Complete your profile first: {missingFields.join(', ')}
            </p>
          )}
        </div>
      </div>

      <GoalRecommendationSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        data={recommendation}
        onUserSaved={onUserSaved}
        onGoalsApplied={onGoalsApplied}
      />
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm tsc --noEmit`

Expected: no errors (depends on `ACTIVITY_LEVELS`/`FITNESS_GOALS`/`ActivityLevel`/
`FitnessGoal` from `lib/types/user.ts`, added by the backend plan's Task 2).

- [ ] **Step 3: Commit**

```bash
git add components/profile/activity-goals-section.tsx
git commit -m "Add Activity & Goals profile section with AI recommendation button"
```

---

### Task 3: Wire the section into the Profile tab

**Files:**
- Modify: `components/more/profile-tab.tsx`

- [ ] **Step 1: Import the new component**

Add to the import block near the other `components/profile/*` imports (around line 21-22):

```tsx
import { EditProfileSheet } from '@/components/profile/edit-profile-sheet'
import { ActivityGoalsSection } from '@/components/profile/activity-goals-section'
import { LevelSheet } from '@/components/profile/level-sheet'
```

- [ ] **Step 2: Render it after the Goals section**

In `components/more/profile-tab.tsx`, the "Goals" section closes at line 667 (`</div>`
twice — once for the expandable content's outer rounded card, once for the section
wrapper), immediately followed by the "Appearance" section comment at line 669. Insert
the new section between them:

```tsx
      {/* ── Appearance ────────────────────────────────────────────────────── */}
```

becomes:

```tsx
      <ActivityGoalsSection
        user={user}
        onUserSaved={onUserSaved}
        onGoalsApplied={(applied) => {
          if (applied.stepsGoal != null) setStepsGoalStr(String(applied.stepsGoal))
          if (applied.calorieGoal != null) setCalorieGoalStr(String(applied.calorieGoal))
          if (applied.waterGoalMl != null) setWaterGoalStr(String(applied.waterGoalMl))
        }}
      />

      {/* ── Appearance ────────────────────────────────────────────────────── */}
```

`setStepsGoalStr`/`setCalorieGoalStr`/`setWaterGoalStr` are the existing state setters for
the "Goals" section's input fields (declared around line 131-137) — this keeps the
already-rendered Goals inputs in sync immediately, in addition to the localStorage
write-through in Task 1's `handleApply`.

- [ ] **Step 3: Typecheck**

Run: `pnpm tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Manual verification**

Run `pnpm dev`, log in as `test@local.dev` / `testpass123`, go to the **More → Profile**
tab.

1. Confirm a new "Activity & Goals" section appears below "Goals", showing 5 activity
   level cards and 4 fitness goal cards (including "Lose fat & build muscle (recomp)"),
   and a disabled "Get AI Recommendation" button with a "Complete your profile first:
   ..." hint listing whichever of Height/Birth Year/Biological Sex/Activity
   Level/Fitness Goal are unset for the seed user.
2. Tap an activity level card — it should highlight (dark background) and a toast should
   NOT appear on success (only on failure). Refresh the page — the selection should
   persist (confirms the PATCH + `rowToUser` round-trip from the backend plan).
3. Tap a fitness goal card — same check.
4. Once Height, Birth Year, Biological Sex (via "Edit Profile"), Activity Level, and
   Fitness Goal are all set, the "Get AI Recommendation" button should become enabled
   and the hint disappear.
5. Tap "Get AI Recommendation". If the seed user has no `body_metrics` weight row, expect
   a toast "Log a body weight entry first to get a recommendation" (per the
   `no_weight_data` branch). Otherwise, the review sheet (Task 1) should open from the
   bottom showing Steps/Calories/Protein/Carbs/Fat/Water rows with current → suggested
   values, a Reasoning block, and (if non-empty) an Insights block.
6. With the sheet open, toggle a couple of switches off, then tap "Apply Selected".
   Expect a "Goals updated" toast and the sheet to close. Re-open the "Goals" section
   above — the steps/calorie/water values should reflect the applied suggestions for the
   metrics that were left checked.
7. Repeat step 5, then tap "Dismiss" instead — the sheet should close with no values
   changed.

- [ ] **Step 5: Commit**

```bash
git add components/more/profile-tab.tsx
git commit -m "Render Activity & Goals section in Profile tab"
```

---

### Task 4: Scheduled "goals check-in" card — home screen

**Files:**
- Modify: `app/session-select/session-select-content.tsx`

- [ ] **Step 1: Extend imports**

In the lucide-react import (line 11), add `Loader2`:

```tsx
import { RefreshCwIcon, LayoutGridIcon, Scale, Footprints, Flame, Route, Beef, Wheat, Droplets, Clock, Dumbbell, Calendar, Moon, MessageCircle, Download, X, Eye, Loader2, type LucideIcon } from "lucide-react";
```

Add two new imports near the other `components/profile/*` and type imports (after line
28's `WaterLogSheet` import):

```tsx
import { WaterLogSheet } from '@/components/profile/water-log-sheet'
import { GoalRecommendationSheet, type GoalRecommendationData } from '@/components/profile/goal-recommendation-sheet'
import type { User } from '@/lib/types'
```

- [ ] **Step 2: Add the `GoalsCheckinCard` component**

Add this new component right after `EarlyDeloadCard` (which ends at line 339, just
before `export default function SessionSelectContent()`):

```tsx
function GoalsCheckinCard({ onReviewNow, onRemindLater }: { onReviewNow: () => Promise<void>; onRemindLater: () => void }) {
  const [loading, setLoading] = useState(false)
  async function handleReview() {
    setLoading(true)
    await onReviewNow()
    setLoading(false)
  }
  return (
    <div className="rounded-2xl bg-muted/40 border border-border p-4 space-y-2">
      <p className="font-semibold text-sm">Time for a goals check-in</p>
      <p className="text-xs text-muted-foreground">
        It&apos;s been a couple of weeks — review your nutrition and activity goals based on your recent trends.
      </p>
      <div className="flex gap-2 mt-2">
        <button onClick={handleReview} disabled={loading} className="text-xs bg-brand text-white rounded-lg px-3 py-1.5 disabled:opacity-60">
          {loading ? <Loader2 className="h-3 w-3 animate-spin inline" /> : 'Review now'}
        </button>
        <button onClick={onRemindLater} className="text-xs text-muted-foreground hover:text-foreground">
          Remind me later
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Track activity/fitness/lastGoalReviewAt state and extend the profile fetch**

Add new state near the other `useState` declarations (around line 391, after
`apkBannerDismissed`):

```tsx
  const [apkBannerDismissed, setApkBannerDismissed] = useState(true);
  const [goalsProfile, setGoalsProfile] = useState<{ activityLevel: string | null; fitnessGoal: string | null; lastGoalReviewAt: string | null } | null>(null);
  const [goalsCheckinDismissed, setGoalsCheckinDismissed] = useState(false);
  const [goalsRecommendation, setGoalsRecommendation] = useState<GoalRecommendationData | null>(null);
  const [goalsSheetOpen, setGoalsSheetOpen] = useState(false);
```

Extend the existing `/api/user/profile` fetch effect (around line 569-577) to also
capture these fields:

```tsx
  useEffect(() => {
    fetch('/api/user/profile', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        setDisplayName(d.user?.displayName ?? d.user?.name ?? null);
        if (d.user?.avatar) setUserAvatar(d.user.avatar);
        setGoalsProfile({
          activityLevel: d.user?.activityLevel ?? null,
          fitnessGoal: d.user?.fitnessGoal ?? null,
          lastGoalReviewAt: d.user?.lastGoalReviewAt ?? null,
        });
      })
      .catch(() => {})
  }, []);
```

`/api/user/profile` GET normally has a 5-minute `Cache-Control` header — `{ cache:
'no-store' }` ensures a hard reload right after "Remind me later" doesn't read back a
stale `lastGoalReviewAt` and re-show the check-in card immediately.

- [ ] **Step 4: Add the review-now / remind-later handlers and the visibility check**

Add these alongside `fetchBriefing` (after its `useEffect` at line 634):

```tsx
  const showGoalsCheckin = !goalsCheckinDismissed
    && !!goalsProfile?.activityLevel
    && !!goalsProfile?.fitnessGoal
    && (goalsProfile.lastGoalReviewAt == null
      || (Date.now() - new Date(goalsProfile.lastGoalReviewAt).getTime()) > 14 * 24 * 3600 * 1000);

  async function handleGoalsReviewNow() {
    try {
      const res = await fetch('/api/nutrition-goals/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'scheduled' }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error('Failed to get recommendation'); return; }
      setGoalsRecommendation(data);
      setGoalsSheetOpen(true);
      setGoalsCheckinDismissed(true);
    } catch {
      toast.error('Failed to get recommendation');
    }
  }

  async function handleGoalsRemindLater() {
    setGoalsCheckinDismissed(true);
    setGoalsProfile(prev => prev ? { ...prev, lastGoalReviewAt: new Date().toISOString() } : prev);
    await fetch('/api/nutrition-goals/touch-review', { method: 'POST' }).catch(() => {});
  }

  function handleGoalsUserSaved(updated: User) {
    setGoalsProfile(prev => prev ? { ...prev, activityLevel: updated.activityLevel ?? null, fitnessGoal: updated.fitnessGoal ?? null } : prev);
  }

  function handleGoalsApplied(applied: { stepsGoal?: number; calorieGoal?: number; waterGoalMl?: number }) {
    if (applied.stepsGoal != null) setStepsGoal(applied.stepsGoal);
    if (applied.calorieGoal != null) setCalorieGoal(applied.calorieGoal);
  }
```

`goalsCheckinDismissed` is local-only (`useState(false)`), so the card re-evaluates
`showGoalsCheckin` on every fresh mount of this screen until the user picks "Review now"
or "Remind me later" — both of which persist `last_goal_review_at`, the only durable
dismissal signal per the design spec. Re-appearing on every soft-navigation back to the
home screen within those 14 days is the intended "keep nagging until acted on" behavior.

- [ ] **Step 5: Render the card and the sheet**

Render the card right after the APK download banner block (after line 930's closing
`)}`):

```tsx
        {showGoalsCheckin && (
          <div className="mx-4 mb-3">
            <GoalsCheckinCard onReviewNow={handleGoalsReviewNow} onRemindLater={handleGoalsRemindLater} />
          </div>
        )}
```

Render the sheet near the Morning Briefing Sheet (after its closing `</Sheet>`, which
ends a few lines after line 1458):

```tsx
      <GoalRecommendationSheet
        open={goalsSheetOpen}
        onOpenChange={setGoalsSheetOpen}
        data={goalsRecommendation}
        onUserSaved={handleGoalsUserSaved}
        onGoalsApplied={handleGoalsApplied}
      />
```

- [ ] **Step 6: Typecheck**

Run: `pnpm tsc --noEmit`

Expected: no errors.

- [ ] **Step 7: Manual verification**

With `pnpm dev` running and logged in as `test@local.dev` / `testpass123`:

1. Ensure the seed user has `activityLevel`/`fitnessGoal` set (via Task 3's Profile
   section) and `last_goal_review_at` is `NULL`:
   ```bash
   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d trainingai_dev \
     -c "SELECT activity_level, fitness_goal, last_goal_review_at FROM users WHERE email='test@local.dev';"
   ```
2. Go to the home screen (session-select). Expect the "Time for a goals check-in" card
   to appear (since `last_goal_review_at` is `NULL`).
3. Tap "Remind me later" — the card disappears immediately. Verify:
   ```bash
   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d trainingai_dev \
     -c "SELECT last_goal_review_at FROM users WHERE email='test@local.dev';"
   ```
   Expected: `last_goal_review_at` is now set to roughly now.
4. Refresh the page — the card should NOT reappear (last review was < 14 days ago).
5. To test "Review now", manually backdate the column:
   ```bash
   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d trainingai_dev \
     -c "UPDATE users SET last_goal_review_at = now() - interval '15 days' WHERE email='test@local.dev';"
   ```
   Refresh — the card reappears. Tap "Review now" — expect the same review sheet from
   Task 1/2 to open with a fresh recommendation, and the card to disappear.

- [ ] **Step 8: Commit**

```bash
git add app/session-select/session-select-content.tsx
git commit -m "Add bi-weekly goals check-in card to home screen"
```

---

### Task 5: TDEE calculation — use the user's actual activity level

**Files:**
- Modify: `app/health/page.tsx`
- Modify: `app/health/health-content.tsx`

- [ ] **Step 1: Pass `activityLevel` from the page**

In `app/health/page.tsx`, add `activityLevel` to the `HealthContent` props:

```tsx
      <Suspense fallback={null}>
        <HealthContent
          sex={dbUser?.sex ?? null}
          heightCm={dbUser?.heightCm ?? null}
          dateOfBirth={dbUser?.dateOfBirth ?? null}
          activityLevel={dbUser?.activityLevel ?? null}
        />
      </Suspense>
```

- [ ] **Step 2: Accept the prop and import `ACTIVITY_MULTIPLIERS`**

In `app/health/health-content.tsx`, add to the imports (near the top, alongside other
`@/lib/...` imports):

```tsx
import { ACTIVITY_MULTIPLIERS } from '@/lib/nutrition/goal-recommendation'
import type { ActivityLevel } from '@/lib/types/user'
```

Extend `HealthContentProps` (lines 145-149):

```tsx
interface HealthContentProps {
  sex?: string | null
  heightCm?: number | null
  dateOfBirth?: string | null
  activityLevel?: ActivityLevel | null
}
```

Extend the destructured props (line 151):

```tsx
export default function HealthContent({ sex: sexProp, heightCm: heightCmProp, dateOfBirth: dateOfBirthProp, activityLevel: activityLevelProp }: HealthContentProps) {
```

- [ ] **Step 3: Replace the hardcoded `1.4` multiplier**

At line 434, replace:

```ts
    const tdee = Math.round(bmr * 1.4);
```

with:

```ts
    const tdee = Math.round(bmr * (activityLevelProp ? ACTIVITY_MULTIPLIERS[activityLevelProp] : 1.4));
```

- [ ] **Step 4: Typecheck**

Run: `pnpm tsc --noEmit`

Expected: no errors.

- [ ] **Step 5: Manual verification**

With `pnpm dev` running and logged in as `test@local.dev` / `testpass123`:

1. With the seed user's `activityLevel` unset (`NULL`), go to **Health → Body** tab and
   note the "Energy Balance" figure (TDEE-derived) — it should match the old `1.4`
   multiplier behaviour (no regression for users without `activityLevel` set).
2. Set `activityLevel` to e.g. `active` via the Profile section (Task 3). Refresh the
   Health page — the TDEE-derived energy balance figure should change, consistent with
   `ACTIVITY_MULTIPLIERS.active` (1.725) instead of 1.4.
3. Confirm no console errors and the Body tab still renders all its other cards
   (weight trend, BMI, etc.) normally.

- [ ] **Step 6: Commit**

```bash
git add app/health/page.tsx app/health/health-content.tsx
git commit -m "Use user's activity level for TDEE calculation on Health page"
```

---

## Summary of new/changed files

- `components/profile/goal-recommendation-sheet.tsx` (new) — review sheet, `GoalRecommendationData` type, apply/dismiss logic
- `components/profile/activity-goals-section.tsx` (new) — activity/fitness pickers + AI recommendation button
- `components/more/profile-tab.tsx` (renders the new section)
- `app/session-select/session-select-content.tsx` (bi-weekly goals check-in card + sheet)
- `app/health/page.tsx` + `app/health/health-content.tsx` (TDEE multiplier from `activityLevel`)

This plan, together with
`docs/superpowers/plans/2026-06-14-ai-goal-recommender-backend.md`, completes the AI
Nutrition & Activity Goal Recommender feature per
`docs/superpowers/specs/2026-06-14-ai-goal-recommender-design.md`.
