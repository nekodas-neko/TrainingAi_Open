'use client'
import { useEffect, useState } from 'react'
import { getLocalStore } from '@/lib/local-store'
import { cachedFetch } from '@/lib/sqlite/cache'
import { FITNESS_TESTS_TTL } from '@trainingai/shared/cache-ttl'
import { FITNESS_TEST_PROTOCOLS } from '@trainingai/shared/fitness-tests/protocols'
import type { FitnessTestId, FitnessTestProtocol } from '@trainingai/shared/fitness-tests/protocols'
import type { LocalFitnessTest } from '@/lib/local-store/types'
import { ChevronRightIcon } from 'lucide-react'

export function TestSelect({ userId, onChoose }: {
  userId?: string
  onChoose: (id: FitnessTestId) => void
}) {
  const [latest, setLatest] = useState<Record<string, LocalFitnessTest>>({})

  useEffect(() => {
    let cancelled = false
    function applyLatest(rows: LocalFitnessTest[]) {
      const map: Record<string, LocalFitnessTest> = {}
      for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date))) map[r.testType] = r
      if (!cancelled) setLatest(map)
    }
    async function load() {
      const store = userId ? getLocalStore(userId) : null
      if (store) {
        applyLatest(await store.getFitnessTests('0000-00-00')) // all history
        return
      }
      // Web dev/QA fallback — pure fetch → render, no logic.
      await cachedFetch<{ fitnessTests: LocalFitnessTest[] }>(
        'fitness-tests', '/api/fitness-tests', FITNESS_TESTS_TTL,
        (d) => applyLatest(d.fitnessTests),
      ).catch(() => {})
    }
    load()
    return () => { cancelled = true }
  }, [userId])

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto px-4 pt-safe pb-safe-action">
      <h1 className="mb-1 text-xl font-bold">Fitness Baselines</h1>
      <p className="mb-2 text-sm text-muted-foreground">Measure your cardio fitness. Repeat later to see progress.</p>
      {FITNESS_TEST_PROTOCOLS.map((p: FitnessTestProtocol) => {
        const last = latest[p.id]
        const lastVal = p.vo2Equation != null ? last?.vo2maxEst : last?.hrr1Bpm
        const unit = p.vo2Equation != null ? 'VO₂max' : 'HRR bpm'
        return (
          <button key={p.id} onClick={() => onChoose(p.id)}
            className="flex items-center justify-between rounded-2xl bg-muted/60 border border-border p-4 text-left active:scale-[0.98] transition">
            <div className="flex-1">
              <p className="text-base font-bold">{p.name}</p>
              <p className="text-xs text-muted-foreground">{p.description}</p>
              {lastVal != null && (
                <p className="mt-1 text-xs font-semibold" style={{ color: 'var(--color-brand)' }}>
                  Last: {lastVal} {unit} · {last!.date}
                </p>
              )}
            </div>
            <ChevronRightIcon className="h-5 w-5 text-muted-foreground flex-none" />
          </button>
        )
      })}
    </div>
  )
}
