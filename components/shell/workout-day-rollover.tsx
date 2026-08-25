'use client'

import { useEffect } from 'react'
import { todayInTz } from '@trainingai/shared/date-utils'
import { useUserTimezone } from '@/components/shell/user-timezone-provider'
import { useWorkoutStore } from '@/lib/stores/workout-store'

/**
 * Stamps and rolls over the workout store's day, in the user's timezone (Q-477, final slice).
 *
 * `todayLogged` is the set of exercises ticked "done" today, and `storedDate` says which day that
 * is. Clearing it a day late leaves yesterday's ticks and the Complete-Workout button showing;
 * clearing it a day early throws away work the user did this morning. Both need the same answer to
 * "what day is it", and until now two different parts of the app gave two different ones:
 * `onRehydrateStorage` compared against **Brisbane** while `workout-screen.tsx`'s visibilitychange
 * effect compared against the **user's** zone. For anyone who has pressed Auto-detect those are
 * different dates, so the app could roll the day over on open and then roll it over again.
 *
 * **The store cannot answer the question itself**, which is what made this the last of Q-477: a
 * Zustand store has no hook, and `onRehydrateStorage` runs at store creation, before any provider
 * mounts. So the store stopped guessing — it skips the date branch there entirely — and this
 * component supplies the date from `useUserTimezone()` instead.
 *
 * **It lives in the root layout, not in the workout screen.** The check it replaces ran at
 * rehydrate, which is to say on every app open regardless of which tab that open landed on. Putting
 * it back behind a mounted `workout-screen.tsx` would leave a user who opens the app on Session
 * Select after midnight looking at yesterday's ticks — the exact WK-13 symptom, moved.
 *
 * Renders nothing. Mount plus `visibilitychange`, no interval: an app left open across local
 * midnight rolls over on the next resume, which is the first moment the state is looked at.
 */
export function WorkoutDayRollover() {
  const tz = useUserTimezone()

  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== 'visible') return
      const today = todayInTz(tz)
      if (useWorkoutStore.getState().storedDate !== today) {
        useWorkoutStore.getState().rolloverDay(today)
      }
    }
    check()
    document.addEventListener('visibilitychange', check)
    return () => document.removeEventListener('visibilitychange', check)
  }, [tz])

  return null
}
