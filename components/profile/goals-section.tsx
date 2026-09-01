'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowUpRight, ChevronDown, Loader2, Sparkles, Target } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { User } from '@trainingai/shared/types'
import type { ActivityLevel, FitnessGoal } from '@trainingai/shared/types/user'
import { invalidateGoalRecommendations } from '@/lib/cache-groups'
import {
  hydrateGoalSeeds, type GoalSeedValues,
  STEPS_GOAL_KEY, STEPS_GOAL_TYPE_KEY, SLEEP_GOAL_KEY, CALORIE_GOAL_KEY, CALORIE_TYPE_KEY,
  WATER_GOAL_KEY, WATER_GOAL_TYPE_KEY, TARGET_WEIGHT_KEY, TARGET_BF_KEY,
} from '@/lib/home/home-prefs'
import { formatDateDisplay, todayInTz } from '@trainingai/shared/date-utils'
import { cachedFetch, isBodyMetadataFresh } from '@/lib/sqlite/cache'
import { TTL_MEDIUM } from '@trainingai/shared/cache-ttl'
import { RequiredInfoSection } from './required-info-section'
import { GoalTargetsSection } from './goal-targets-section'
import { GoalRecommendationSheet, type GoalRecommendationData } from './goal-recommendation-sheet'


interface GoalsSectionProps {
  user: User | null
  onUserSaved: (updated: User) => void
}

export function GoalsSection({ user, onUserSaved }: GoalsSectionProps) {
  const router = useRouter()
  const goalsPatchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [saving, setSaving] = useState(false)
  const [recommending, setRecommending] = useState(false)
  const [recommendation, setRecommendation] = useState<GoalRecommendationData | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [macroRefreshKey, setMacroRefreshKey] = useState(0)
  const [expanded, setExpanded] = useState(false)

  const [latestWeightKg, setLatestWeightKg] = useState<number | null>(null)
  const [latestWeightLabel, setLatestWeightLabel] = useState<string | null>(null)
  const [latestBfPct, setLatestBfPct] = useState<number | null>(null)
  const [latestBfLabel, setLatestBfLabel] = useState<string | null>(null)

  // Goals — localStorage-backed targets
  const [stepsGoalStr, setStepsGoalStr] = useState('')
  const [stepsGoalType, setStepsGoalType] = useState<'daily' | 'weekly'>('daily')
  const [sleepGoalStr, setSleepGoalStr] = useState('')
  const [calorieGoalStr, setCalorieGoalStr] = useState('')
  const [calorieGoalType, setCalorieGoalType] = useState<'daily' | 'weekly'>('daily')
  const [waterGoalStr, setWaterGoalStr] = useState('')
  const [waterGoalType, setWaterGoalType] = useState<'daily' | 'weekly'>('daily')
  const [targetWeightStr, setTargetWeightStr] = useState('')
  const [targetBfStr, setTargetBfStr] = useState('')
  const [todayMeta, setTodayMeta] = useState<{ steps: number | null; waterMl: number | null; calories: number | null } | null>(null)
  const [weekToDate, setWeekToDate] = useState<{ steps: number; calories: number; waterMl: number } | null>(null)

  useEffect(() => {
    // Seed from the device copy so the fields are filled on the first frame, then let the server
    // payload below correct them. Before Q-241 the seed was all there was, so opening Profile on a
    // second device — or after a re-install — offered to edit blank goals while the server held the
    // real ones, and saving from that state would have written the blanks back.
    const sg = localStorage.getItem(STEPS_GOAL_KEY)
    if (sg) setStepsGoalStr(sg)
    const st = localStorage.getItem(STEPS_GOAL_TYPE_KEY)
    if (st === 'weekly') setStepsGoalType('weekly')
    const slg = localStorage.getItem(SLEEP_GOAL_KEY)
    if (slg) setSleepGoalStr(slg)
    const cg = localStorage.getItem(CALORIE_GOAL_KEY)
    if (cg) setCalorieGoalStr(cg)
    const ct = localStorage.getItem(CALORIE_TYPE_KEY)
    if (ct === 'weekly') setCalorieGoalType('weekly')
    const wg = localStorage.getItem(WATER_GOAL_KEY)
    if (wg) setWaterGoalStr(wg)
    const wt = localStorage.getItem(WATER_GOAL_TYPE_KEY)
    if (wt === 'weekly') setWaterGoalType('weekly')
    const tw = localStorage.getItem(TARGET_WEIGHT_KEY)
    if (tw) setTargetWeightStr(tw)
    const tb = localStorage.getItem(TARGET_BF_KEY)
    if (tb) setTargetBfStr(tb)

    cachedFetch<GoalSeedValues>('user-goals', '/api/user/goals', TTL_MEDIUM, d => {
      if (!d) return
      hydrateGoalSeeds(d)
      setStepsGoalStr(d.stepsGoal != null ? String(d.stepsGoal) : '')
      setStepsGoalType(d.stepsGoalType === 'weekly' ? 'weekly' : 'daily')
      setSleepGoalStr(d.sleepGoalHours != null ? String(d.sleepGoalHours) : '')
      setCalorieGoalStr(d.calorieGoal != null ? String(d.calorieGoal) : '')
      setCalorieGoalType(d.calorieGoalType === 'weekly' ? 'weekly' : 'daily')
      setWaterGoalStr(d.waterGoalMl != null ? String(d.waterGoalMl) : '')
      setWaterGoalType(d.waterGoalType === 'weekly' ? 'weekly' : 'daily')
      setTargetWeightStr(d.targetWeightKg != null ? String(d.targetWeightKg) : '')
      setTargetBfStr(d.targetBfPct != null ? String(d.targetBfPct) : '')
    }).catch(() => {})

    cachedFetch('body-metadata', '/api/body-metadata', TTL_MEDIUM, (d: {
        today?: { date: string; steps?: number | null; waterMl?: number | null; calories?: number | null } | null
        recent?: { date: string; weightKg: number | null; bodyFat: number | null }[]
        weekToDate?: { steps: number; calories: number; waterMl: number } | null
      } | null) => {
        if (isBodyMetadataFresh(d, user?.timezone)) {
          if (d?.today) setTodayMeta({ steps: d.today.steps ?? null, waterMl: d.today.waterMl ?? null, calories: d.today.calories ?? null })
          setWeekToDate(d?.weekToDate ?? null)
        }
        const today = todayInTz(user?.timezone)
        // Same label as `More → Profile details`, through the same shared helper. This site used a
        // bare `toLocaleDateString`, which renders in the device's timezone rather than the user's.
        const dateLabel = (date: string) => date === today ? 'Today' : formatDateDisplay(date)

        const latestWeight = d?.recent?.find(r => r.weightKg != null)
        if (latestWeight?.weightKg != null) {
          setLatestWeightKg(latestWeight.weightKg)
          setLatestWeightLabel(dateLabel(latestWeight.date))
        }

        const latestBf = d?.recent?.find(r => r.bodyFat != null)
        if (latestBf?.bodyFat != null) {
          setLatestBfPct(latestBf.bodyFat)
          setLatestBfLabel(dateLabel(latestBf.date))
        }
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  async function patchProfile(patch: Record<string, unknown>) {
    setSaving(true)
    try {
      // BF-79. This section now owns only activity level and fitness goal, so it sends only what
      // the caller patched. It used to send height, date of birth and sex alongside — first because
      // the route nulled anything omitted (fixed in BF-78), then out of habit; all three are edited
      // on `More → Profile details` now, and resending a stale copy of them from here would
      // overwrite a change made there.
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

  function handleActivityLevelChange(level: ActivityLevel | null) {
    patchProfile({ activityLevel: level })
  }

  function handleFitnessGoalChange(goal: FitnessGoal | null) {
    patchProfile({ fitnessGoal: goal })
  }

  // Invalidating here rather than in each of the nine handlers is deliberate: they all funnel
  // through this one PATCH, and a tenth handler added later would otherwise have to remember.
  // `patchProfile` above has always done this; the goals path never did, so editing a steps, sleep,
  // calorie, water or target-weight goal left Health rendering the previous one for up to the
  // `user-goals` TTL, and repainting it stale on the next cold start from the same key's seed (Q-240).
  function patchGoalsDebounced(partial: Record<string, unknown>) {
    if (goalsPatchTimer.current) clearTimeout(goalsPatchTimer.current)
    goalsPatchTimer.current = setTimeout(() => {
      fetch('/api/user/goals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      })
        .then(res => { if (res.ok) return invalidateGoalRecommendations() })
        .catch(() => {})
    }, 1000)
  }

  function handleStepsGoalChange(value: string) {
    setStepsGoalStr(value)
    localStorage.setItem(STEPS_GOAL_KEY, value)
    const n = parseInt(value)
    if (!isNaN(n) && n > 0) patchGoalsDebounced({ stepsGoal: n })
    else if (value.trim() === '') patchGoalsDebounced({ stepsGoal: null })
  }

  function handleStepsGoalTypeChange(type: 'daily' | 'weekly') {
    setStepsGoalType(type)
    localStorage.setItem(STEPS_GOAL_TYPE_KEY, type)
    patchGoalsDebounced({ stepsGoalType: type })
  }

  function handleSleepGoalChange(value: string) {
    setSleepGoalStr(value)
    localStorage.setItem(SLEEP_GOAL_KEY, value)
    const n = parseFloat(value)
    if (!isNaN(n) && n > 0) patchGoalsDebounced({ sleepGoalHours: n })
    else if (value.trim() === '') patchGoalsDebounced({ sleepGoalHours: null })
  }

  function handleCalorieGoalChange(value: string) {
    setCalorieGoalStr(value)
    localStorage.setItem(CALORIE_GOAL_KEY, value)
    const n = parseInt(value)
    if (!isNaN(n) && n > 0) patchGoalsDebounced({ calorieGoal: n })
    else if (value.trim() === '') patchGoalsDebounced({ calorieGoal: null })
  }

  function handleCalorieGoalTypeChange(type: 'daily' | 'weekly') {
    setCalorieGoalType(type)
    localStorage.setItem(CALORIE_TYPE_KEY, type)
    patchGoalsDebounced({ calorieGoalType: type })
  }

  function handleWaterGoalChange(value: string) {
    setWaterGoalStr(value)
    localStorage.setItem(WATER_GOAL_KEY, value)
    const n = parseInt(value)
    if (!isNaN(n) && n > 0) patchGoalsDebounced({ waterGoalMl: n })
    else if (value.trim() === '') patchGoalsDebounced({ waterGoalMl: null })
  }

  function handleWaterGoalTypeChange(type: 'daily' | 'weekly') {
    setWaterGoalType(type)
    localStorage.setItem(WATER_GOAL_TYPE_KEY, type)
    patchGoalsDebounced({ waterGoalType: type })
  }

  // Emptying the field sends an explicit null rather than no request at all. It used to send
  // nothing, so the server kept the old target while `localStorage` held '' — invisible only
  // because Health read the device copy. Now that the server is the source of truth (Q-241), a
  // clear that never reaches it would come straight back on the next load.
  function handleTargetWeightChange(value: string) {
    setTargetWeightStr(value)
    localStorage.setItem(TARGET_WEIGHT_KEY, value)
    const n = parseFloat(value)
    if (!isNaN(n) && n > 0) patchGoalsDebounced({ targetWeightKg: n })
    else if (value.trim() === '') patchGoalsDebounced({ targetWeightKg: null })
  }

  function handleTargetBfChange(value: string) {
    setTargetBfStr(value)
    localStorage.setItem(TARGET_BF_KEY, value)
    const n = parseFloat(value)
    if (!isNaN(n) && n > 0) patchGoalsDebounced({ targetBfPct: n })
    else if (value.trim() === '') patchGoalsDebounced({ targetBfPct: null })
  }

  // Height, birth year and sex are edited on `More → Profile details` since BF-79, so a missing one
  // cannot be fixed from here. Splitting the list is what lets the button below say where to go
  // instead of naming a field this screen no longer offers.
  const missingDetails: string[] = []
  if (!user?.heightCm) missingDetails.push('Height')
  if (!user?.dateOfBirth) missingDetails.push('Birth Year')
  if (!user?.sex) missingDetails.push('Biological Sex')
  const missingHere: string[] = []
  if (!user?.activityLevel) missingHere.push('Activity Level')
  if (!user?.fitnessGoal) missingHere.push('Fitness Goal')
  const missingFields = [...missingDetails, ...missingHere]

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
      <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Goals</p>
      <div className="rounded-2xl bg-muted/40 border border-border overflow-hidden">
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-between px-4 py-3.5 hover:bg-muted/60 transition"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'color-mix(in oklab, var(--color-brand) 15%, var(--color-muted))' }}>
              <Target className="h-4 w-4" style={{ color: 'var(--color-brand)' }} />
            </div>
            <div>
              <p className="text-sm font-semibold text-left">Goals</p>
              <p className="text-[10px] text-muted-foreground">Activity level, targets &amp; AI recommendations</p>
            </div>
          </div>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>

        {expanded && (
          <div className="border-t border-border px-4 pb-4 pt-3 space-y-3">
            <RequiredInfoSection
              latestWeightKg={latestWeightKg}
              latestWeightLabel={latestWeightLabel}
              targetWeightStr={targetWeightStr}
              onTargetWeightChange={handleTargetWeightChange}
              latestBfPct={latestBfPct}
              latestBfLabel={latestBfLabel}
              targetBfStr={targetBfStr}
              onTargetBfChange={handleTargetBfChange}
              activityLevel={user?.activityLevel}
              onActivityLevelChange={handleActivityLevelChange}
              saving={saving}
            />

            <GoalTargetsSection
              fitnessGoal={user?.fitnessGoal}
              onFitnessGoalChange={handleFitnessGoalChange}
              saving={saving}
              stepsGoalStr={stepsGoalStr}
              onStepsGoalChange={handleStepsGoalChange}
              stepsGoalType={stepsGoalType}
              onStepsGoalTypeChange={handleStepsGoalTypeChange}
              sleepGoalStr={sleepGoalStr}
              onSleepGoalChange={handleSleepGoalChange}
              calorieGoalStr={calorieGoalStr}
              onCalorieGoalChange={handleCalorieGoalChange}
              calorieGoalType={calorieGoalType}
              onCalorieGoalTypeChange={handleCalorieGoalTypeChange}
              waterGoalStr={waterGoalStr}
              onWaterGoalChange={handleWaterGoalChange}
              waterGoalType={waterGoalType}
              onWaterGoalTypeChange={handleWaterGoalTypeChange}
              todayMeta={todayMeta}
              weekToDate={weekToDate}
              macroRefreshKey={macroRefreshKey}
            />

            <div className="rounded-2xl bg-muted/40 border border-border overflow-hidden px-4 py-3 space-y-1.5">
              <Button onClick={getRecommendation} disabled={recommending || missingFields.length > 0} className="w-full h-10 gap-2">
                {recommending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Get AI Recommendation
              </Button>
              {missingFields.length > 0 && (
                <p className="text-[10px] text-muted-foreground text-center">
                  Complete your profile first: {missingFields.join(', ')}
                </p>
              )}
              {/* Naming a field the user cannot reach from here is the failure mode BF-79 creates
                  by moving them, so the way there ships with the move. */}
              {missingDetails.length > 0 && (
                <button
                  type="button"
                  onClick={() => router.push('/more/details')}
                  className="mx-auto flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium hover:bg-muted transition"
                >
                  Open Profile details
                  <ArrowUpRight className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <GoalRecommendationSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        data={recommendation}
        onUserSaved={onUserSaved}
        onGoalsApplied={(applied) => {
          if (applied.stepsGoal != null) setStepsGoalStr(String(applied.stepsGoal))
          if (applied.calorieGoal != null) setCalorieGoalStr(String(applied.calorieGoal))
          if (applied.waterGoalMl != null) setWaterGoalStr(String(applied.waterGoalMl))
        }}
        onApplied={() => setMacroRefreshKey(k => k + 1)}
      />
    </div>
  )
}
