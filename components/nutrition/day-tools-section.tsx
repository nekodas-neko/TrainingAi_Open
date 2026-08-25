'use client'

import dynamic from 'next/dynamic'
import { MoonIcon } from 'lucide-react'
import type { NutritionAdherenceResponse } from '@/app/api/nutrition/adherence/route'
import type { SupplementWithStatus } from '@trainingai/shared/types/supplement'
import { FoodLoggingComplete } from './food-logging-complete'
import { SupplementsSection } from './supplements-section'

const WeeklyNutritionChart = dynamic(
  () => import('./weekly-nutrition-chart').then(m => m.WeeklyNutritionChart),
  { ssr: false },
)

export interface WeeklyPoint {
  date: string
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

interface Props {
  selectedDate: string
  isToday: boolean
  daysLogged: number | null
  minDays: number
  calibrated: boolean
  tz: string
  weeklyData: WeeklyPoint[]
  calorieTarget: number | null
  adherence: NutritionAdherenceResponse | null
  supplements: SupplementWithStatus[]
  supplementsLoading: boolean
  onSupplementsChanged: (s: SupplementWithStatus[]) => void
  userId?: string
  onEndOfDay: () => void
}

/**
 * Everything below the meals: the finished-logging marker, the week's chart, supplements, and the
 * end-of-day action.
 *
 * Extracted from `nutrition-content.tsx` (Q-395b) because that file sits at the 800-line hard
 * ceiling and is not on `check-component-size.js`'s baseline — so it fails CI the moment it crosses,
 * and phase 3 adds to it. The entry says *"extract before adding"* and this is that.
 */
export function DayToolsSection({
  selectedDate, isToday, daysLogged, minDays, calibrated, tz,
  weeklyData, calorieTarget, adherence,
  supplements, supplementsLoading, onSupplementsChanged, userId, onEndOfDay,
}: Props) {
  return (
    <>
      {/* Directly under the meals, because the claim it makes is about them (BF-6). It shipped as
          the last element on the argument that "I have finished logging" is about the whole day —
          and then took **zero** presses in the seven weeks to 2026-08-24, while the calibration it
          feeds treats an unmarked day as excluded rather than as light. A control nothing reaches
          withholds the feature entirely, which outranks where the sentence reads best. */}
      <FoodLoggingComplete
        date={selectedDate}
        isToday={isToday}
        daysLogged={daysLogged}
        minDays={minDays}
        calibrated={calibrated}
        tz={tz}
      />

      <WeeklyNutritionChart data={weeklyData} calorieTarget={calorieTarget} adherence={adherence} />

      {isToday && (
        <SupplementsSection
          supplements={supplements}
          loading={supplementsLoading}
          onChanged={onSupplementsChanged}
          userId={userId}
        />
      )}

      {/* Last on the page, which is where a day-review action belongs — the owner asked for this
          order. The comment here used to defend the old position; it was arguing against merging
          this button into Home's "Your Day in Review" banner (still Q-112's call, still not this
          change), never against moving it down its own screen. */}
      <button
        onClick={onEndOfDay}
        className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-border bg-muted/60 py-3 transition-colors active:bg-muted/20"
      >
        <MoonIcon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold">End of Day</span>
      </button>
    </>
  )
}
