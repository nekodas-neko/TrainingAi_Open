'use client'
import { useEffect, useMemo, useState } from 'react'
import { useFitnessTestStore } from '@/lib/stores/fitness-test-store'
import { getProtocol } from '@trainingai/shared/fitness-tests/protocols'
import { getLocalStore } from '@/lib/local-store'
import { TestSelect } from './test-select'
import { TestCountdown } from './test-countdown'
import { TestActive, type TestCapture } from './test-active'
import { TestResult } from './test-result'
import type { LocalFitnessTest } from '@/lib/local-store/types'

interface UserProfile {
  age: number | null
  restingHr: number
  hrMax: number
  sex: string | null
  weightKg: number | null
}

export function FitnessTestsContent({ userId, profile }: { userId?: string; profile: UserProfile }) {
  const mode = useFitnessTestStore((s) => s.mode)
  const selectedProtocolId = useFitnessTestStore((s) => s.selectedProtocolId)
  const startedAtMs = useFitnessTestStore((s) => s.startedAtMs)
  const choose = useFitnessTestStore((s) => s.choose)
  const start = useFitnessTestStore((s) => s.start)
  const finish = useFitnessTestStore((s) => s.finish)
  const reset = useFitnessTestStore((s) => s.reset)
  const [capture, setCapture] = useState<TestCapture | null>(null)
  const [previous, setPrevious] = useState<LocalFitnessTest | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, []) // avoid persisted-store hydration mismatch

  const protocol = useMemo(() => (selectedProtocolId ? getProtocol(selectedProtocolId) : undefined), [selectedProtocolId])

  // On finish, look up the most recent prior test of this type for the trend.
  useEffect(() => {
    if (mode !== 'done' || !protocol || !capture) return
    let cancelled = false
    async function loadPrev() {
      const store = userId ? getLocalStore(userId) : null
      if (!store) { setPrevious(null); return }
      const rows = (await store.getFitnessTests('0000-00-00')).filter((r) => r.testType === protocol!.id)
      rows.sort((a, b) => b.date.localeCompare(a.date))
      if (!cancelled) setPrevious(rows[0] ?? null)
    }
    loadPrev()
    return () => { cancelled = true }
  }, [mode, protocol, capture, userId])

  if (!mounted) return null

  if (mode === 'countdown' && protocol) {
    return <TestCountdown onDone={() => start(Date.now())} />
  }
  if (mode === 'active' && protocol && startedAtMs != null) {
    return <TestActive protocol={protocol} profile={profile} startedAtMs={startedAtMs}
      onFinish={(c) => { setCapture(c); finish() }} />
  }
  if (mode === 'done' && protocol && capture) {
    return <TestResult protocol={protocol} capture={capture} previous={previous}
      profile={{ age: profile.age, sex: profile.sex, weightKg: profile.weightKg, restingHr: profile.restingHr }}
      userId={userId} onDone={reset} />
  }
  return <TestSelect userId={userId} onChoose={choose} />
}
