'use client'

import { createContext, useContext } from 'react'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'

/**
 * The user's configured timezone, made readable from client components (Q-148).
 *
 * `users.timezone` has always been on the JWT and reachable in every API route, but nothing on the
 * client could read it — so every client-side `formatTimeOfDay`/`formatDayShort`/`formatDateDisplay`
 * silently fell back to `DEFAULT_TZ`, and a handful of sites rendered device-local instead. That is
 * why Q-144 could fix the server half (calendar, streak, Oura workouts) and not this one.
 *
 * Fed from the root layout's existing `auth()` call, so the value is present in the FIRST server
 * render and matches on hydration. Deliberately not a mounted-gated read: those produce a wrong
 * first frame, which is the bug class this is meant to remove, not add to.
 */
const UserTimezoneContext = createContext<string>(DEFAULT_TZ)

export function UserTimezoneProvider({
  timezone,
  children,
}: {
  timezone: string | undefined
  children: React.ReactNode
}) {
  return (
    <UserTimezoneContext.Provider value={timezone || DEFAULT_TZ}>
      {children}
    </UserTimezoneContext.Provider>
  )
}

/**
 * The user's timezone, for any client component that renders a time or a date.
 *
 * Falls back to `DEFAULT_TZ` when there is no session (sign-in, register) — the same value the
 * formatters already default to, so a logged-out screen is unchanged.
 */
export function useUserTimezone(): string {
  return useContext(UserTimezoneContext)
}
