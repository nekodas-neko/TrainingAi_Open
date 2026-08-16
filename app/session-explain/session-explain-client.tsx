'use client'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { NextSessionRecommendation } from '@trainingai/shared/types/program'
import { readTodayCacheSync, cachedFetchToday } from '@/lib/sqlite/cache'
import { NEXT_SESSION_TTL } from '@trainingai/shared/cache-ttl'
import { todayInTz } from '@trainingai/shared/date-utils'
import { buildSessionExplainData, type SessionExplainData } from '@trainingai/shared/session-explain/build-explain-data'
import { SessionExplainContent } from './session-explain-content'
import { SessionExplainEmpty } from './components/session-explain-empty'

function readSeed(): NextSessionRecommendation | null {
  try {
    const raw = typeof window !== 'undefined' ? sessionStorage.getItem('ta_recommendation_v1') : null
    // Date-stamped seed (CCH-4) — ignore a stale prior-day recommendation.
    if (raw) {
      const stamped = JSON.parse(raw) as { date: string; data: NextSessionRecommendation }
      if (stamped?.date === todayInTz() && stamped.data) return stamped.data
    }
  } catch { /* fall through */ }
  return readTodayCacheSync<NextSessionRecommendation>('next-session')
}

export function SessionExplainClient() {
  const searchParams = useSearchParams()
  const sessionId = searchParams.get('sessionId') ?? undefined
  const [rec, setRec] = useState<NextSessionRecommendation | null>(null)
  const [hydrated, setHydrated] = useState(false)

  // Synchronous cache seed (effect, not initializer — hydration safety).
  useEffect(() => {
    const seed = readSeed()
    if (seed) setRec(seed)
    setHydrated(true)
  }, [])

  // Background revalidate against the same key/TTL the Home screen uses.
  useEffect(() => {
    void cachedFetchToday<NextSessionRecommendation>(
      'next-session', '/api/next-session', NEXT_SESSION_TTL,
      (fresh) => setRec(fresh),
    )
  }, [])

  const data: SessionExplainData | null = rec ? buildSessionExplainData(rec, sessionId) : null

  if (data) return <SessionExplainContent data={data} />
  // Seeded but the program has no ai_dynamic explanation, or cache empty and
  // fetch still in flight → lightweight non-skeleton empty/loading state.
  return <SessionExplainEmpty loading={!hydrated || rec === null} />
}
