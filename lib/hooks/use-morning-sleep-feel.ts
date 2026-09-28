'use client'

import { useCallback, useEffect, useState } from 'react'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { useInvalidationRefetch } from '@/lib/hooks/use-invalidation-refetch'
import { useUserTimezone } from '@/components/shell/user-timezone-provider'
import { getLocalStore } from '@/lib/local-store'
import { todayInTz } from '@trainingai/shared/date-utils'
import { TTL_SHORT } from '@trainingai/shared/cache-ttl'
import { answeredMorningScales, type MorningSelfReport } from '@trainingai/shared/health/self-report'
import { sleepFeelFromStored, type MorningSleepFeel } from '@/lib/hooks/morning-sleep-feel-scale'

export type { MorningSleepFeel }

/**
 * ⛔ **Through `answeredMorningScales`, never the raw column.** The morning sheet writes a NEUTRAL
 * `3` for a scale he never tapped (`NEUTRAL_SCALES` in `morning-checkin-sheet.tsx`) with
 * `sleepQualityFeelTouched: false`, so reading the column directly puts *"OK · 3/5 · Your rating,
 * not a score"* on Home for a value nobody gave — the fabricated `Sleep: OK` LA-136 exists to undo,
 * down to the string. Four earlier readers in this repo took the column directly and were
 * calibrating, plotting and displaying 78 values nobody gave.
 */
function feelFrom(row: Partial<MorningSelfReport> | null | undefined): MorningSleepFeel | null {
  if (!row) return null
  const answered = answeredMorningScales({
    perceivedRecovery: row.perceivedRecovery ?? null,
    sleepQualityFeel: row.sleepQualityFeel ?? null,
    perceivedRecoveryTouched: Boolean(row.perceivedRecoveryTouched),
    sleepQualityFeelTouched: Boolean(row.sleepQualityFeelTouched),
  })
  return sleepFeelFromStored(answered.sleepQualityFeel)
}

/**
 * LA-136 — what the owner said about last night's sleep this morning.
 *
 * **LOCAL-FIRST, because `day_checkins` is a local-first domain.** `morning-checkin-sheet.tsx`
 * writes `store.upsertDayCheckin` + `queueMutation` before it ever reaches the network, so a rating
 * given offline — a morning with no signal is the ordinary case for this question — exists on the
 * device and nowhere else until the outbox drains. A server-only read would show nothing until then
 * and blank again on restart, which is the inverse of offline-first this repo has a strict rule
 * about. The API is the fallback for a device whose store is unavailable or has not hydrated.
 *
 * **Something must ask for a new value when a write clears the old one.** Home is in the persistent
 * tab shell and never unmounts, so a plain `useEffect(() => { … }, [])` paints once and holds that
 * value until the app is killed — the Q-402 shape this repo has shipped twelve times. A local-first
 * read cannot be handed to `useCachedValue`, so this takes the documented escape hatch,
 * `useInvalidationRefetch`, on the `day-checkin:` prefix that the sheet's own
 * `invalidateCheckinAffectsPrescription()` clears — and it clears it whether or not the push
 * succeeded, which is what makes the offline case refresh too.
 *
 * **The key rides that existing prefix on purpose**, so "registration in every write group touching
 * `day_checkins`" is satisfied by reuse rather than by adding a key to each group. The `:morning`
 * suffix is required: `day-checkin:<date>` is already the EVENING payload's key
 * (`food-logging-complete.tsx`), and two phases under one key is a stale or blank first paint.
 * `TTL_SHORT` is that sibling's own expression, so no TTL divergence is introduced.
 */
export function useMorningSleepFeel(userId?: string): MorningSleepFeel | null {
  const tz = useUserTimezone()
  const today = todayInTz(tz)
  const key = `day-checkin:${today}:morning`
  const url = `/api/day-checkin?date=${today}&phase=morning`
  const [feel, setFeel] = useState<MorningSleepFeel | null>(null)

  const load = useCallback(async () => {
    const store = userId ? getLocalStore(userId) : null
    if (store) {
      try {
        const row = await store.getDayCheckin(today, 'morning')
        if (row) { setFeel(feelFrom(row)); return }
      } catch { /* the store is there but unreadable — fall through to the API */ }
    }
    await cachedFetch<Partial<MorningSelfReport> | null>(key, url, TTL_SHORT, data => setFeel(feelFrom(data)), {
      // `cachedFetch` swallows `!res.ok` unless a caller asks for it (Q-499). There is no error
      // state to show: this line is one optional sentence on a card that stands without it, and a
      // "couldn't load your sleep rating" is noise next to the rating itself. Handled explicitly so
      // the blank is a decision rather than the default that hid six other failures.
      onError: () => setFeel(null),
    })
  }, [userId, today, key, url])

  useEffect(() => {
    // Instant paint: a synchronous seed in an EFFECT, never a `useState` initializer. A skeleton or
    // a late-appearing line on a repeat visit is the bug the seeding rule exists to stop.
    const seed = readCacheSync<Partial<MorningSelfReport> | null>(key)
    if (seed) setFeel(feelFrom(seed))
    void load()
  }, [key, load])

  useInvalidationRefetch(key, () => { void load() })

  return feel
}
