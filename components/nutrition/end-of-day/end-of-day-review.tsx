'use client'

import { useEffect, useMemo, useState } from 'react'
import { X, Moon, Loader2, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { toast } from 'sonner'
import { getLocalStore } from '@/lib/local-store'
import { pushMutations } from '@/lib/local-store/sync-engine'
import { invalidateHealthTrends } from '@/lib/cache-groups'
import { usePageGradient, useHeroColorScheme } from '@/components/health/detail-hero'
import { cachedFetch, readCacheSync, cachedFetchToday, readTodayCacheSync, isBodyMetadataFresh } from '@/lib/sqlite/cache'
import { useUserTimezone } from '@/components/shell/user-timezone-provider'
import { BODY_BATTERY_TTL, TTL_MEDIUM } from '@trainingai/shared/cache-ttl'
import { prefillEveningScales } from '@trainingai/shared/nutrition/day-checkin-prefill'
import { buildTodayInsight } from '@trainingai/shared/nutrition/day-insight'
import type { EveningScaleKey } from '@trainingai/shared/types/day-checkin'
import type { FoodLogWithItem, MealType, NutritionTargets } from '@trainingai/shared/types/nutrition'
import type { BodyBatteryLabel } from '@trainingai/shared/health/body-battery-band'
import { DaySummaryCard } from './day-summary-card'
import { MealBackfillSection } from './meal-backfill-section'
import { WellnessSection } from './wellness-section'
import { JournalSection } from './journal-section'
import { TodayInsightCard } from './today-insight-card'
import { DayDigestCard } from './day-digest-card'
import { DayReadThroughSection } from './day-read-through-section'
import { visibleReviewSteps, STEP_TITLES } from './review-steps'

interface BodyBattery {
  current: number
  label: BodyBatteryLabel
  trend: string
  charged: number
  drained: number
}

interface Props {
  open: boolean
  onClose: () => void
  mealTypes: MealType[]
  logs: FoodLogWithItem[]
  date: string
  userId?: string
  targets: NutritionTargets | null
  onLogged: (log?: FoodLogWithItem) => void
}

const DEFAULT_SCALES: Record<EveningScaleKey, number> = {
  physicalTiredness: 3,
  mentalDrain: 3,
  barelyMoved: 3,
  hydration: 3,
  lateHeavyMeal: 3,
}

export function EndOfDayReview({ open, onClose, mealTypes, logs, date, userId, targets, onLogged }: Props) {
  const tz = useUserTimezone()
  const pageGradient = usePageGradient('sleep')
  const isLight = useHeroColorScheme() === 'light'
  const [scales, setScales] = useState<Record<EveningScaleKey, number>>({ ...DEFAULT_SCALES })
  const [soreMuscles, setSoreMuscles] = useState<string[]>([])
  const [journal, setJournal] = useState('')
  // Seeded in the `init` effect below (gated on `open`), not here — a cache read in a
  // useState lazy initializer causes a hydration mismatch (CLAUDE.md rule).
  const [battery, setBattery] = useState<BodyBattery | null>(null)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)

  // Recomputed as meals are logged, so backfilling the last empty meal on step 2 removes step 2 —
  // which is why `stepIndex` is clamped rather than trusted below.
  const steps = useMemo(
    () => visibleReviewSteps({ mealTypes, loggedMealTypeIds: logs.map(l => l.mealTypeId) }),
    [mealTypes, logs],
  )
  const safeIndex = Math.min(stepIndex, steps.length - 1)
  const step = steps[safeIndex]
  const isLast = safeIndex === steps.length - 1

  useEffect(() => {
    if (!open) {
      setLoaded(false)
      setStepIndex(0)
      return
    }
    if (loaded) return
    let cancelled = false

    async function init() {
      let bb: BodyBattery | null = readTodayCacheSync<BodyBattery | null>('body-battery') ?? null
      await cachedFetchToday<BodyBattery | null>('body-battery', '/api/body-battery', BODY_BATTERY_TTL, d => { bb = d }).catch(() => {})
      if (!cancelled) setBattery(bb)

      type BodyMetaToday = { today?: { date: string; steps?: number | null; waterMl?: number | null } | null }
      let meta = readCacheSync<BodyMetaToday | null>('body-metadata')
      if (meta && !isBodyMetadataFresh(meta, tz)) meta = null
      await cachedFetch<BodyMetaToday | null>(
        'body-metadata', '/api/body-metadata', TTL_MEDIUM, d => { if (isBodyMetadataFresh(d, tz)) meta = d },
      ).catch(() => {})
      const steps: number | null = meta?.today?.steps ?? null
      const waterMl: number | null = meta?.today?.waterMl ?? null

      const store = userId ? getLocalStore(userId) : null
      const saved = store
        ? await store.getDayCheckin(date, 'evening')
        : await fetch('/api/day-checkin?date=' + date + '&phase=evening').then(r => (r.ok ? r.json() : null)).catch(() => null)

      if (cancelled) return

      if (saved) {
        setScales({
          physicalTiredness: saved.physicalTiredness ?? 3,
          mentalDrain: saved.mentalDrain ?? 3,
          barelyMoved: saved.barelyMoved ?? 3,
          hydration: saved.hydration ?? 3,
          lateHeavyMeal: saved.lateHeavyMeal ?? 3,
        })
        setSoreMuscles(saved.soreMuscles ?? [])
        setJournal(saved.journal ?? '')
      } else {
        const pre = prefillEveningScales({
          batteryLabel: (bb?.label ?? null) as 'Charged' | 'Good' | 'Low' | 'Drained' | null,
          steps,
          waterMl,
        })
        setScales({
          physicalTiredness: pre.physicalTiredness,
          mentalDrain: pre.mentalDrain,
          barelyMoved: pre.barelyMoved,
          hydration: pre.hydration,
          lateHeavyMeal: pre.lateHeavyMeal,
        })
      }
      setLoaded(true)
    }

    init()
    return () => {
      cancelled = true
    }
  }, [open, loaded, userId, date, tz])

  const totals = logs.reduce(
    (acc, l) => ({
      calories: acc.calories + l.calories,
      proteinG: acc.proteinG + l.proteinG,
      carbsG: acc.carbsG + l.carbsG,
      fatG: acc.fatG + l.fatG,
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  )

  const insight = buildTodayInsight({
    batteryCurrent: battery?.current ?? null,
    batteryDrained: battery?.drained ?? null,
    scales,
    soreMuscles,
  })

  function toggleMuscle(m: string) {
    setSoreMuscles(prev => (prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]))
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    const payload = {
      phase: 'evening' as const,
      physicalTiredness: scales.physicalTiredness,
      mentalDrain: scales.mentalDrain,
      barelyMoved: scales.barelyMoved,
      hydration: scales.hydration,
      lateHeavyMeal: scales.lateHeavyMeal,
      soreMuscles,
      journal: journal.trim() || null,
    }
    try {
      const store = userId ? getLocalStore(userId) : null
      // The local branch owns its own failure (Q-216): without this, a throw from the store write
      // reached the outer catch and reported "Failed to save" without ever trying the API that sits
      // in the `else` arm right below it.
      let savedLocally = false
      if (store) {
        try {
        await store.upsertDayCheckin({
          logDate: date,
          ...payload,
          wakeMood: null, perceivedRecovery: null, motivation: null,
          sleepQualityFeel: null, restingSoreness: null,
          illnessContext: null, perceivedRecoveryTouched: false, sleepQualityFeelTouched: false,
          updatedAt: new Date().toISOString(),
          deletedAt: null,
          syncStatus: 'pending',
        })
        await store.queueMutation({ userId: userId!, domain: 'day_checkins', date, payload })
        pushMutations(userId!).catch(() => {})
        savedLocally = true
        } catch (e) {
          console.error('Day check-in SQLite write failed, falling back to API:', e)
        }
      }
      if (!savedLocally) {
        const res = await fetch('/api/day-checkin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, ...payload }),
        })
        if (!res.ok) throw new Error()
      }
      invalidateHealthTrends().catch(() => {})
      toast.success('Day saved')
      onClose()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={o => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl max-h-[92vh] flex flex-col p-0 border-t border-border/70"
        style={{ background: pageGradient }}
        hideCloseButton
      >
        <SheetTitle className="sr-only">End of Day</SheetTitle>
        <div className="flex items-center justify-between px-4 pt-4 pb-3 shrink-0">
          <div className="flex items-center gap-2">
            <Moon className="w-4 h-4 text-brand" />
            <h2 className="text-base font-semibold">End of Day</h2>
            <span className="text-xs text-muted-foreground">· {STEP_TITLES[step]}</span>
          </div>
          <button onClick={onClose} aria-label="Close" className="min-w-[48px] min-h-[48px] flex items-center justify-center text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4 flex flex-col gap-4">
          {step === 'day' && (
            <>
              {/* The narrative opener, above the numbers it is talking about (Q-112a), then the
                  day's totals, then the read-through those totals came out of (Q-112b). */}
              <DayDigestCard active={open} />
              <DaySummaryCard totals={totals} targets={targets} battery={battery} />
              <DayReadThroughSection date={date} tz={tz} logs={logs} />
            </>
          )}
          {step === 'meals' && (
            <MealBackfillSection mealTypes={mealTypes} logs={logs} date={date} userId={userId} onLogged={onLogged} />
          )}
          {step === 'wrapUp' && (
            <>
              <WellnessSection scales={scales} onScale={(k, v) => setScales(s => ({ ...s, [k]: v }))} soreMuscles={soreMuscles} onToggleMuscle={toggleMuscle} />
              <JournalSection value={journal} onChange={setJournal} />
              <TodayInsightCard text={insight} />
            </>
          )}
        </div>

        {/* No `pb-safe*` here: `SheetContent side="bottom"` bakes the bottom inset and `p-0` does not
            strip it, so adding one would double the clearance (CLAUDE.md, safe-area). */}
        <div
          className="shrink-0 px-4 pt-2 pb-2 border-t border-border/60 backdrop-blur-sm flex gap-2"
          style={{ background: isLight ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.3)' }}
        >
          {/* "Previous", not "Back": the wrap-up step's sore-muscle chips include one labelled
              **Back**, and two controls with the same accessible name on one screen is ambiguous to
              a screen reader before it is ambiguous to a test. */}
          {safeIndex > 0 && (
            <Button variant="outline" onClick={() => setStepIndex(i => Math.max(0, i - 1))} className="h-12 px-4 gap-1">
              <ChevronLeft className="w-4 h-4" />
              Previous
            </Button>
          )}
          {isLast ? (
            <Button onClick={handleSave} disabled={saving} className="flex-1 h-12 gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Save
            </Button>
          ) : (
            <Button onClick={() => setStepIndex(i => i + 1)} className="flex-1 h-12">
              Next
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
