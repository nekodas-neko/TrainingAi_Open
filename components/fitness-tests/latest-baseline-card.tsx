'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getLocalStore } from '@/lib/local-store'
import { cachedFetch } from '@/lib/sqlite/cache'
import { FITNESS_TESTS_TTL } from '@trainingai/shared/cache-ttl'
import { getProtocol } from '@trainingai/shared/fitness-tests/protocols'
import { accentCardStyle } from '@trainingai/shared/utils'
import { ActivityIcon, ChevronRightIcon } from 'lucide-react'
import type { LocalFitnessTest } from '@/lib/local-store/types'

export function LatestBaselineCard({ userId }: { userId?: string }) {
  const [rows, setRows] = useState<LocalFitnessTest[] | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const store = userId ? getLocalStore(userId) : null
      if (store) {
        const all = await store.getFitnessTests('0000-00-00')
        if (!cancelled) setRows(all)
        return
      }
      await cachedFetch<{ fitnessTests: LocalFitnessTest[] }>(
        'fitness-tests', '/api/fitness-tests', FITNESS_TESTS_TTL,
        (d) => { if (!cancelled) setRows(d.fitnessTests) },
      ).catch(() => { if (!cancelled) setRows([]) })
    }
    load()
    return () => { cancelled = true }
  }, [userId])

  // Latest per protocol.
  const latest: Record<string, LocalFitnessTest> = {}
  for (const r of [...(rows ?? [])].sort((a, b) => a.date.localeCompare(b.date))) latest[r.testType] = r
  const entries = Object.values(latest)

  return (
    <Link href="/baselines" className="block rounded-2xl p-4" style={accentCardStyle('accent-cyan')}>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ActivityIcon className="h-4 w-4" style={{ color: 'var(--accent-cyan)' }} aria-hidden />
          <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--accent-cyan)' }}>Cardio Baselines</p>
        </div>
        <ChevronRightIcon className="h-4 w-4 text-muted-foreground" />
      </div>
      {rows == null ? (
        <div className="h-7 w-32 animate-pulse rounded-lg bg-muted" />
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Take a fitness test to set your baseline</p>
      ) : (
        <div className="flex flex-wrap gap-4">
          {entries.map((e) => {
            const p = getProtocol(e.testType)
            const val = p?.vo2Equation != null ? e.vo2maxEst : e.hrr1Bpm
            const unit = p?.vo2Equation != null ? 'VO₂max' : 'HRR'
            return (
              <div key={e.testType}>
                <p className="text-[10px] text-muted-foreground">{p?.shortName ?? e.testType}</p>
                <p className="text-xl font-bold tabular-nums">{val ?? '—'}<span className="ml-1 text-[10px] font-normal text-muted-foreground">{unit}</span></p>
              </div>
            )
          })}
        </div>
      )}
    </Link>
  )
}
