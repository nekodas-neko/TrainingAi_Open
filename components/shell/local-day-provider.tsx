'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { todayInTz } from '@trainingai/shared/date-utils'
import { useUserTimezone } from '@/components/shell/user-timezone-provider'

/**
 * The current local date, re-evaluated whenever the app is looked at (BF-86).
 *
 * The owner's report: *"when I open the app in the morning and it just resumes, it doesn't give me
 * the morning check-in."* The cause is structural rather than specific to the check-in — **the tab
 * shell is persistent and does not unmount**, so an effect keyed on values that never change runs
 * once per app *launch*. Leave the app open overnight and nothing re-asks what day it is.
 *
 * So the signal is a value, not an event: subscribers key an effect on `useLocalDay()` and it
 * re-runs on the first resume of a new day and at no other time. That is a dependency React already
 * knows how to act on, where an event bus would need every consumer to remember to unsubscribe.
 *
 * **Mount plus `visibilitychange`, no interval.** A resume is the first moment the state is looked
 * at, so a timer would only ever fire into a screen nobody is reading — and this app deliberately
 * avoids background timers. The pattern is `workout-day-rollover.tsx`'s, which is where it was
 * proven and which now consumes this rather than keeping a second copy of the same listener.
 *
 * **This is deliberately NOT a reload.** BF-80 says not to fix a resume problem by reloading on
 * `visibilitychange` — it costs the instant-paint behaviour and would give a blank screen two
 * candidate causes while that entry is still being diagnosed. Re-evaluating a date and letting
 * subscribers re-read is the same outcome without the spinner.
 */
const LocalDayContext = createContext<string | null>(null)

export function LocalDayProvider({ children }: { children: React.ReactNode }) {
  const tz = useUserTimezone()
  // Seeded synchronously so the first frame carries the real date — a mounted-gate would make
  // every subscriber run once against a placeholder, which is a wrong first frame rather than a
  // late one.
  const [day, setDay] = useState(() => todayInTz(tz))

  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== 'visible') return
      // `setState` with an unchanged string is a no-op for React, so a resume on the same day costs
      // nothing and no subscriber re-runs. That is what makes it safe to check on every resume.
      setDay(todayInTz(tz))
    }
    check()
    document.addEventListener('visibilitychange', check)
    return () => document.removeEventListener('visibilitychange', check)
  }, [tz])

  return <LocalDayContext.Provider value={day}>{children}</LocalDayContext.Provider>
}

/**
 * Today's date in the user's timezone, as `YYYY-MM-DD`, changing on the first resume of a new day.
 *
 * Use it as an **effect dependency** for anything day-scoped — a prompt that should re-offer, a
 * marker that should clear, a today-keyed read that should be taken again. Do not use it to render
 * a date the user is choosing (a date picker's own state owns that); this is "what day is it now".
 *
 * Outside the provider it returns `todayInTz` once and never changes, which is correct for the
 * screens that render outside the app shell (sign-in, register) rather than a silent failure.
 */
export function useLocalDay(): string {
  const tz = useUserTimezone()
  const fromContext = useContext(LocalDayContext)
  return fromContext ?? todayInTz(tz)
}
