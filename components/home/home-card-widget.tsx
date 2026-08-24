'use client'

import React from 'react'
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import { usePathname, useRouter } from 'next/navigation'
import { navigateWithTransition } from '@/lib/navigate-with-transition'
import { Moon, Footprints, MessageCircle, BatteryLow, Frown, Meh, Smile, Zap, type LucideIcon } from 'lucide-react'
import { cn, accentCardStyle } from '@trainingai/shared/utils'
import { CARD_DEFAULT_COLORS } from '@/app/session-select/constants'
import { Sparkline } from '@/components/ui/sparkline'
import { ColorSwatchPicker } from '@/components/ui/color-swatch-picker'
import { HomeNutritionCard } from '@/components/home/home-nutrition-card'
import dynamic from 'next/dynamic'
import type { BodyMetaRow } from '@/app/api/body-metadata/route'
import type { TrainingLoadResponse } from '@/app/api/training-load/route'
import type { MuscleRecoveryEntry } from '@/app/api/muscle-recovery/route'
import type { MoodLog } from '@trainingai/shared/types/mood'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import { STAGE_COLOR } from '@trainingai/shared/health/hypnogram'
import { acwrBandByKey } from '@trainingai/shared/ai-periodization/acwr'
import type { HrSleepWindow } from '@trainingai/shared/health/hr-sleep-band'
import { recoveryBand } from '@trainingai/shared/health/recovery-band'

const HrDayChart = dynamic(() => import('@/components/health/hr-day-chart').then(m => m.HrDayChart), { ssr: false })
const HomeEnergyBalanceCard = dynamic(() => import('@/components/home/home-energy-balance-card').then(m => m.HomeEnergyBalanceCard), { ssr: false })

type CardWidgetKey =
  | 'weightSparkline' | 'nutritionDonut' | 'sleepWidget' | 'stepsWidget' | 'moodWidget'
  | 'acwrWidget' | 'muscleStatusWidget' | 'hrChartWidget' | 'energyBalanceWidget'

export type CardSectionKey = `card_${CardWidgetKey}`

interface SleepRow {
  date: string
  durationHours: number | null
  deepSleepHours: number | null
  remSleepHours: number | null
  lightSleepHours: number | null
  awakHours: number | null
}

interface HrReading { timestamp: string; bpm: number; source: string | null }
interface WorkoutSession { sessionName: string; startedAt: string; completedAt: string | null }

interface HomeCardWidgetProps {
  sectionKey: CardSectionKey
  sectionEditMode: boolean
  activeCardWidgets: CardWidgetKey[]
  cardColors: Record<string, string>
  onColorChange: (key: string, hex: string) => void
  // body data
  metaToday: BodyMetaRow | null
  metaRecent: BodyMetaRow[]
  metaLoading: boolean
  weekToDate: { steps: number; calories: number; waterMl: number } | null
  // goals
  calorieGoal: number | null
  calorieType: 'daily' | 'weekly'
  weightLookback: 7 | 30
  stepsGoal: number
  stepsGoalType: 'daily' | 'weekly'
  sleepGoal: number
  // sleep / mood
  sleepData: SleepRow[]
  moodLog: MoodLog | null | undefined
  // widget-specific data
  acwrData: TrainingLoadResponse | null
  muscleData: MuscleRecoveryEntry[] | null
  hrData: { readings: HrReading[]; workoutSessions: WorkoutSession[]; sleep: HrSleepWindow | null } | null
  // callbacks
  setMoodSheetOpen: (open: boolean) => void
}

export const HomeCardWidget = React.memo(function HomeCardWidget(props: HomeCardWidgetProps) {
  const tz = useUserTimezone();
  const router = useRouter()
  const pathname = usePathname()
  const {
    sectionKey, sectionEditMode, activeCardWidgets, cardColors, onColorChange,
    metaToday, metaRecent, metaLoading, weekToDate,
    calorieGoal, calorieType, weightLookback, stepsGoal, stepsGoalType,
    sleepGoal, moodLog, sleepData, acwrData, muscleData, hrData, setMoodSheetOpen,
  } = props

  const sparklinePoints = [...metaRecent].reverse().map(r => r.weightKg).filter((w): w is number => w != null)
  const currentWeight   = metaToday?.weightKg ?? sparklinePoints[sparklinePoints.length - 1] ?? null

  const nutrProtein  = metaToday?.protein  ?? null
  const nutrCarbs    = metaToday?.carb     ?? null
  const nutrFat      = metaToday?.fat      ?? null
  const nutrCalories = metaToday?.calories ?? null

  switch (sectionKey) {
    case 'card_weightSparkline': {
      if (!activeCardWidgets.includes('weightSparkline')) return null
      const points = sparklinePoints.slice(-weightLookback)
      const _wColor = cardColors['weightSparkline'] ?? CARD_DEFAULT_COLORS.weightSparkline
      return (
        <div className="px-4 pb-3 relative">
          {sectionEditMode && (
            <div className="absolute top-4 right-12 z-20" onClick={e => e.stopPropagation()}>
              <ColorSwatchPicker value={_wColor} label="Weight Trend card" onChange={hex => onColorChange('weightSparkline', hex)} />
            </div>
          )}
          <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) navigateWithTransition(router, pathname, '/health?tab=body'); }} className={cn("w-full rounded-2xl p-4 flex items-center gap-4 text-left active:scale-95 transition cursor-pointer", sectionEditMode && "pointer-events-none")} style={accentCardStyle(_wColor)}>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">Body Weight</p>
              <p className="text-2xl font-bold tabular-nums">{metaLoading ? "…" : currentWeight != null ? `${currentWeight} kg` : "—"}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Last {weightLookback} days</p>
            </div>
            <div className="flex-none">{points.length >= 2 ? <Sparkline values={points} width={110} height={44} /> : <span className="text-xs text-muted-foreground">No data</span>}</div>
          </div>
        </div>
      )
    }
    case 'card_nutritionDonut': {
      if (!activeCardWidgets.includes('nutritionDonut')) return null
      return (
        <HomeNutritionCard
          sectionEditMode={sectionEditMode}
          color={cardColors['nutritionDonut'] ?? CARD_DEFAULT_COLORS.nutritionDonut}
          onColorChange={onColorChange}
          metaLoading={metaLoading}
          calorieGoal={calorieGoal}
          calorieType={calorieType}
          weekToDate={weekToDate}
          nutrCalories={nutrCalories}
          nutrProtein={nutrProtein}
          nutrCarbs={nutrCarbs}
          nutrFat={nutrFat}
        />
      )
    }
    case 'card_sleepWidget': {
      if (!activeCardWidgets.includes('sleepWidget')) return null
      const _today = todayInTz(tz)
      const _yesterday = shiftDateStr(_today, -1)
      const latest = sleepData.find(s => s.date === _today || s.date === _yesterday) ?? null
      const hrs = latest?.durationHours ?? null
      const goalPct = hrs != null ? Math.min((hrs / sleepGoal) * 100, 100) : null
      const stages = latest ? [{ label: "Deep", hours: latest.deepSleepHours, color: STAGE_COLOR.deep }, { label: "REM", hours: latest.remSleepHours, color: STAGE_COLOR.rem }, { label: "Light", hours: latest.lightSleepHours, color: STAGE_COLOR.light }, { label: "Awake", hours: latest.awakHours, color: STAGE_COLOR.awake }] : []
      const totalStageHrs = stages.reduce((s, st) => s + (st.hours ?? 0), 0)
      const _sColor = cardColors['sleepWidget'] ?? CARD_DEFAULT_COLORS.sleepWidget
      return (
        <div className="px-4 pb-3 relative">
          {sectionEditMode && (
            <div className="absolute top-4 right-12 z-20" onClick={e => e.stopPropagation()}>
              <ColorSwatchPicker value={_sColor} label="Sleep card" onChange={hex => onColorChange('sleepWidget', hex)} />
            </div>
          )}
          <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) navigateWithTransition(router, pathname, "/health?tab=body"); }} className={cn("w-full rounded-2xl p-4 text-left active:scale-95 transition cursor-pointer", sectionEditMode && "pointer-events-none")} style={accentCardStyle(_sColor)}>
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--accent-purple)" }}>Sleep</p>
                <p className="text-2xl font-bold tabular-nums leading-tight">{hrs != null ? `${hrs.toFixed(1)}h` : "—"}{hrs != null && <span className="text-sm font-normal text-muted-foreground ml-1">/ {sleepGoal}h goal</span>}</p>
              </div>
              <Moon className="h-6 w-6 flex-none" style={{ color: "var(--accent-purple)" }} />
            </div>
            {goalPct !== null && <div className="h-1.5 rounded-full overflow-hidden mb-3" style={{ background: "rgba(139,92,246,0.15)" }}><div className="h-full w-full rounded-full origin-left transition-transform duration-300 motion-reduce:transition-none" style={{ transform: `scaleX(${goalPct / 100})`, background: "linear-gradient(90deg, #6366f1, #a78bfa)" }} /></div>}
            {totalStageHrs > 0 && (<><div className="flex h-2 rounded-full overflow-hidden gap-px mb-1.5">{stages.filter(s => (s.hours ?? 0) > 0).map(s => <div key={s.label} style={{ flex: s.hours ?? 0, background: s.color }} />)}</div><div className="flex gap-3">{stages.map(s => <div key={s.label} className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} /><span className="text-xs text-muted-foreground">{s.label}</span><span className="text-xs font-bold" style={{ color: s.color }}>{s.hours != null ? `${s.hours.toFixed(1)}h` : "—"}</span></div>)}</div></>)}
          </div>
        </div>
      )
    }
    case 'card_stepsWidget': {
      if (!activeCardWidgets.includes('stepsWidget')) return null
      const isWeeklySteps = stepsGoalType === "weekly"
      const todaySteps = metaToday?.steps ?? null
      const weeklySteps = weekToDate?.steps ?? 0
      const stepsValue = isWeeklySteps ? weeklySteps : todaySteps
      const goalDisplay = isWeeklySteps ? stepsGoal * 7 : stepsGoal
      const pct = stepsValue != null && goalDisplay ? Math.min((stepsValue / goalDisplay) * 100, 100) : null
      const last7 = metaRecent.slice(0, 7).map(r => r.steps ?? 0).reverse()
      const maxSteps = Math.max(...last7, 1)
      const _stColor = cardColors['stepsWidget'] ?? CARD_DEFAULT_COLORS.stepsWidget
      return (
        <div className="px-4 pb-3 relative">
          {sectionEditMode && (
            <div className="absolute top-4 right-12 z-20" onClick={e => e.stopPropagation()}>
              <ColorSwatchPicker value={_stColor} label="Steps card" onChange={hex => onColorChange('stepsWidget', hex)} />
            </div>
          )}
          <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) navigateWithTransition(router, pathname, "/health?tab=body"); }} className={cn("w-full rounded-2xl p-4 text-left active:scale-95 transition cursor-pointer", sectionEditMode && "pointer-events-none")} style={accentCardStyle(_stColor)}>
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--accent-cyan)" }}>Steps{isWeeklySteps ? " (week)" : ""}</p>
                <p className="text-2xl font-bold tabular-nums leading-tight">{metaLoading ? "…" : stepsValue != null ? stepsValue.toLocaleString() : "—"}{goalDisplay && <span className="text-sm font-normal text-muted-foreground ml-1">/ {goalDisplay.toLocaleString()}</span>}</p>
              </div>
              <Footprints className="h-6 w-6 flex-none" style={{ color: "var(--accent-cyan)" }} />
            </div>
            {pct !== null && <div className="h-1.5 rounded-full overflow-hidden mb-3" style={{ background: "rgba(0,212,255,0.12)" }}><div className="h-full w-full rounded-full origin-left transition-transform duration-300 motion-reduce:transition-none" style={{ transform: `scaleX(${pct / 100})`, background: "linear-gradient(90deg, #00d4ff, #00ff87)" }} /></div>}
            {last7.length > 0 && <div className="flex items-end gap-1 h-10">{last7.map((steps, i) => <div key={i} className="flex-1 rounded-t-sm" style={{ height: `${Math.max((steps / maxSteps) * 100, 4)}%`, background: i === last7.length - 1 ? "#00d4ff" : "rgba(0,212,255,0.3)" }} />)}</div>}
          </div>
        </div>
      )
    }
    case 'card_moodWidget': {
      if (!activeCardWidgets.includes('moodWidget')) return null
      const ENERGY_ICON: Record<string, LucideIcon> = { drained: BatteryLow, low: Frown, ok: Meh, good: Smile, pumped: Zap }
      const SLEEP_LABEL: Record<string, string> = { terrible: "Terrible", poor: "Poor", ok: "OK", good: "Good", great: "Great" }
      const EnergyIcon = moodLog ? (ENERGY_ICON[moodLog.energyLevel] ?? Meh) : Meh
      const _mColor = cardColors['moodWidget'] ?? CARD_DEFAULT_COLORS.moodWidget
      return (
        <div className="px-4 pb-3 relative">
          {sectionEditMode && (
            <div className="absolute top-4 right-12 z-20" onClick={e => e.stopPropagation()}>
              <ColorSwatchPicker value={_mColor} label="Readiness card" onChange={hex => onColorChange('moodWidget', hex)} />
            </div>
          )}
          <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) setMoodSheetOpen(true); }} className={cn("w-full rounded-2xl p-4 text-left active:scale-95 transition cursor-pointer", sectionEditMode && "pointer-events-none")} style={accentCardStyle(_mColor)}>
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "var(--accent-amber)" }}>Exercise Readiness</p>
                {moodLog === undefined ? <p className="text-sm text-muted-foreground">Loading…</p> : moodLog === null ? <div><p className="text-base font-semibold text-foreground">How are you feeling?</p><p className="text-[10px] text-muted-foreground mt-0.5">Tap to log energy &amp; soreness</p></div> : <div className="flex items-center gap-3"><EnergyIcon className="h-8 w-8 flex-none" style={{ color: "var(--accent-amber)" }} /><div><p className="text-sm font-semibold capitalize">{moodLog.energyLevel}</p><p className="text-[10px] text-muted-foreground">Sleep: {SLEEP_LABEL[moodLog.sleepQuality] ?? moodLog.sleepQuality}</p>{moodLog.soreMuscles.length > 0 && <p className="text-[10px] mt-0.5" style={{ color: "var(--accent-amber)" }}>Sore: {moodLog.soreMuscles.join(", ")}</p>}</div></div>}
              </div>
              <MessageCircle className="h-6 w-6 ml-2 flex-none" style={{ color: "var(--accent-amber)" }} />
            </div>
          </div>
        </div>
      )
    }
    case 'card_acwrWidget': {
      if (!activeCardWidgets.includes('acwrWidget')) return null
      const _c = cardColors['acwrWidget'] ?? CARD_DEFAULT_COLORS.acwrWidget
      const acwr = acwrData?.acwr ?? null
      // Render the route's own band — never re-derive from the raw number, so this
      // card can't disagree with Health's ACWR card for the same day.
      const acwrBandInfo = acwr != null && acwrData
        ? acwrBandByKey(acwrData.interpretation as 'low' | 'optimal' | 'high' | 'very_high')
        : null
      const acwrLabel = acwrBandInfo?.label ?? null
      const acwrColor = acwrBandInfo?.color
      return (
        <div className="px-4 pb-3">
          <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) navigateWithTransition(router, pathname, "/health?tab=training"); }} className={cn("w-full rounded-2xl p-4 text-left active:scale-95 transition cursor-pointer", sectionEditMode && "pointer-events-none")} style={accentCardStyle(_c)}>
            <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: _c }}>ACWR</p>
            {acwrData === null ? (
              <div className="h-7 w-16 animate-pulse rounded-lg bg-muted" />
            ) : acwr != null ? (
              <div className="flex items-baseline gap-2">
                <p className="text-2xl font-bold tabular-nums">{acwr.toFixed(2)}</p>
                {acwrLabel && <span className="text-xs font-semibold" style={{ color: acwrColor }}>{acwrLabel}</span>}
              </div>
            ) : <p className="text-sm text-muted-foreground">Need more data</p>}
            <p className="text-[10px] text-muted-foreground mt-0.5">Acute : chronic workload ratio</p>
          </div>
        </div>
      )
    }
    case 'card_muscleStatusWidget': {
      if (!activeCardWidgets.includes('muscleStatusWidget')) return null
      const _c = cardColors['muscleStatusWidget'] ?? CARD_DEFAULT_COLORS.muscleStatusWidget
      const fatigued = muscleData ? [...muscleData].sort((a, b) => a.pct - b.pct).slice(0, 6) : null
      return (
        <div className="px-4 pb-3">
          <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) navigateWithTransition(router, pathname, "/health?tab=training"); }} className={cn("w-full rounded-2xl p-4 text-left active:scale-95 transition cursor-pointer", sectionEditMode && "pointer-events-none")} style={accentCardStyle(_c)}>
            <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: _c }}>Muscle Status</p>
            {muscleData === null ? (
              <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-4 w-full animate-pulse rounded bg-muted" />)}</div>
            ) : fatigued && fatigued.length > 0 ? (
              <div className="space-y-1.5">
                {fatigued.map(m => (
                  <div key={m.muscle}>
                    <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
                      <span className="capitalize">{m.muscle}</span>
                      <span>{m.pct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-foreground/10 overflow-hidden">
                      <div className="h-full w-full rounded-full origin-left transition-transform duration-300 motion-reduce:transition-none" style={{ transform: `scaleX(${m.pct / 100})`, background: recoveryBand(m.pct).color }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">No recent training data</p>}
          </div>
        </div>
      )
    }
    case 'card_hrChartWidget': {
      if (!activeCardWidgets.includes('hrChartWidget')) return null
      const _c = cardColors['hrChartWidget'] ?? CARD_DEFAULT_COLORS.hrChartWidget
      const hrLineColor = _c === 'transparent' ? undefined : _c
      return (
        <div className="px-4 pb-3">
          <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) navigateWithTransition(router, pathname, "/health?tab=body"); }} className={cn("w-full rounded-2xl p-4 text-left active:scale-95 transition cursor-pointer", sectionEditMode && "pointer-events-none")} style={accentCardStyle(_c)}>
            <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: _c === 'transparent' ? undefined : _c }}>Heart Rate · Today</p>
            {hrData && hrData.readings.length >= 2 ? (
              <HrDayChart readings={hrData.readings} date={todayInTz(tz)} workoutSessions={hrData.workoutSessions} lineColor={hrLineColor} sleepWindow={hrData.sleep} showBackfill />
            ) : (
              <p className="text-sm text-muted-foreground">No heart-rate data today</p>
            )}
          </div>
        </div>
      )
    }
    case 'card_energyBalanceWidget': {
      if (!activeCardWidgets.includes('energyBalanceWidget')) return null
      const _c = cardColors['energyBalanceWidget'] ?? CARD_DEFAULT_COLORS.energyBalanceWidget
      return (
        <div className="px-4 pb-3">
          <div
            role="button"
            tabIndex={0}
            onClick={() => { if (!sectionEditMode) navigateWithTransition(router, pathname, "/nutrition"); }}
            className={cn("w-full rounded-2xl text-left active:scale-95 transition cursor-pointer", sectionEditMode && "pointer-events-none")}
            style={accentCardStyle(_c)}
          >
            {/* Self-fetching via the shared hook rather than threaded through the orchestrator:
                the payload is this card's alone, and the hook already owns the cache-seeded
                instant paint so Home does not gain another prop or another fetch to keep in sync. */}
            <HomeEnergyBalanceCard />
          </div>
        </div>
      )
    }
    default: return null
  }
})
