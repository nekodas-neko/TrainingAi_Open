'use client'
import { useMemo, useState } from 'react'
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { TrendingUpIcon, TrendingDownIcon, MinusIcon } from 'lucide-react'
import { getLocalStore } from '@/lib/local-store'
import { pushThenRevalidate } from '@/lib/local-store/push-then-revalidate'
import { invalidateFitnessTests } from '@/lib/cache-groups'
import { todayInTz } from '@trainingai/shared/date-utils'
import { sixMwtVo2max, cooperVo2max, baselineHrr1, restingHrFrom, maxHrFrom } from '@trainingai/shared/health/fitness-tests'
import type { HrReading } from '@trainingai/shared/workout/hr-analysis'
import type { FitnessTestProtocol } from '@trainingai/shared/fitness-tests/protocols'
import type { LocalFitnessTest } from '@/lib/local-store/types'
import type { TestCapture } from './test-active'

export interface TestResultProfile {
  age: number | null
  sex: string | null
  weightKg: number | null
  restingHr: number | null
}

export function TestResult({ protocol, capture, previous, profile, userId, onDone }: {
  protocol: FitnessTestProtocol
  capture: TestCapture
  previous: LocalFitnessTest | null
  profile: TestResultProfile
  userId?: string
  onDone: () => void
}) {
  const tz = useUserTimezone();
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  // Equations run ONCE here, at capture time — the stored value is read verbatim.
  const computed = useMemo(() => {
    const readings: HrReading[] = capture.hrSamples.map((s) => ({ timestamp: new Date(s.at), bpm: s.bpm }))
    const avgHr = readings.length ? Math.round(readings.reduce((a, r) => a + r.bpm, 0) / readings.length) : null
    const maxHr = maxHrFrom(readings)
    // A fixed-duration VO₂max protocol ended materially early (<90% of its window) yields a
    // truncated distance — the Ross/Cooper equations are calibrated to the FULL protocol, so
    // applying them corrupts VO₂max and poisons the fitness snapshot (review E2-10). Skip the
    // score in that case (HR + distance stats are still saved), and flag it to the user.
    const elapsedSec = (capture.endMs - capture.startMs) / 1000
    const endedEarly = protocol.durationSec != null && elapsedSec < protocol.durationSec * 0.9
    let vo2maxEst: number | null = null
    let method: string | null = null
    if (!endedEarly) {
      if (protocol.vo2Equation === '6mwt') {
        // Burr 2011 (healthy adults) when profile terms are present; Ross 2010 fallback otherwise.
        vo2maxEst = sixMwtVo2max({
          distanceM: capture.distanceM,
          age: profile.age, sex: profile.sex, weightKg: profile.weightKg, restingHr: profile.restingHr,
        })
        const usedBurr = profile.age != null && profile.weightKg != null && profile.restingHr != null &&
          (profile.sex === 'male' || profile.sex === 'female')
        method = usedBurr ? 'burr_2011' : 'ross_2010'
      } else if (protocol.vo2Equation === 'cooper') { vo2maxEst = cooperVo2max(capture.distanceM); method = 'cooper_1968' }
    }
    let restingHr: number | null = null
    let hrr1Bpm: number | null = null
    if (protocol.captureHrr) {
      restingHr = restingHrFrom(readings)
      // Peak-anchored recovery (baselineHrr1 finds the peak internally). Our guided
      // rest→effort→recovery phases keep recording through the recovery minute, so the
      // post-peak samples it reads exist.
      hrr1Bpm = baselineHrr1(readings)
    }
    return { avgHr, maxHr, vo2maxEst, method, restingHr, hrr1Bpm, endedEarly }
  }, [protocol, capture, profile])

  const primary = protocol.vo2Equation != null
    ? { label: 'Est. VO₂max', value: computed.vo2maxEst != null ? `${computed.vo2maxEst}` : '—', unit: 'mL/kg/min' }
    : { label: '1-min HR recovery', value: computed.hrr1Bpm != null ? `${computed.hrr1Bpm}` : '—', unit: 'bpm drop' }

  const prevVal = protocol.vo2Equation != null ? previous?.vo2maxEst ?? null : previous?.hrr1Bpm ?? null
  const curVal = protocol.vo2Equation != null ? computed.vo2maxEst : computed.hrr1Bpm
  const delta = prevVal != null && curVal != null ? Math.round((curVal - prevVal) * 10) / 10 : null

  async function handleSave() {
    if (saving) return
    setSaving(true)
    const today = todayInTz(tz)
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const durationSec = Math.round((capture.endMs - capture.startMs) / 1000)
    const record: LocalFitnessTest = {
      id, testType: protocol.id, date: today, durationSec,
      distanceM: protocol.captureDistance ? capture.distanceM : null,
      avgHr: computed.avgHr, maxHr: computed.maxHr,
      restingHr: computed.restingHr, hrr1Bpm: computed.hrr1Bpm,
      vo2maxEst: computed.vo2maxEst, method: computed.method, notes: null,
      updatedAt: now, deletedAt: null, syncStatus: 'pending',
    }
    const store = userId ? getLocalStore(userId) : null
    if (store) {
      try {
        await store.upsertFitnessTest(record)
        await store.queueMutation({
          userId: userId!, domain: 'fitness_tests', date: today,
          payload: {
            id, testType: protocol.id, durationSec,
            distanceM: record.distanceM ?? undefined,
            avgHr: record.avgHr ?? undefined, maxHr: record.maxHr ?? undefined,
            restingHr: record.restingHr ?? undefined, hrr1Bpm: record.hrr1Bpm ?? undefined,
            vo2maxEst: record.vo2maxEst ?? undefined, method: record.method ?? undefined,
          },
        })
        invalidateFitnessTests().catch(() => {})
        toast.success('Baseline saved')
        onDone()
        router.push('/health?tab=training')
        pushThenRevalidate(userId!, invalidateFitnessTests)
        return
      } catch (e) {
        console.error('Fitness test SQLite write failed, falling back to API:', e)
      }
    }
    // Web fallback (dev/QA only) — pure POST, no extra logic.
    try {
      const res = await fetch('/api/fitness-tests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id, testType: protocol.id, date: today, durationSec,
          distanceM: record.distanceM ?? undefined,
          avgHr: record.avgHr ?? undefined, maxHr: record.maxHr ?? undefined,
          restingHr: record.restingHr ?? undefined, hrr1Bpm: record.hrr1Bpm ?? undefined,
          vo2maxEst: record.vo2maxEst ?? undefined, method: record.method ?? undefined,
        }),
      })
      if (!res.ok) throw new Error()
      await invalidateFitnessTests()
      toast.success('Baseline saved')
      onDone()
      router.push('/health?tab=training')
    } catch {
      toast.error('Failed to save baseline')
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 pt-safe pb-safe-action-lg">
      <h1 className="mb-1 text-xl font-bold">{protocol.name}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{protocol.shortName} complete</p>

      <div className="mb-4 rounded-2xl bg-muted/60 border border-border p-5 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{primary.label}</p>
        <p className="mt-1 text-5xl font-black tabular-nums" style={{ color: 'var(--color-brand)' }}>{primary.value}</p>
        <p className="text-sm text-muted-foreground">{primary.unit}</p>
        {delta != null && (
          <p className="mt-2 flex items-center justify-center gap-1 text-sm font-semibold"
             style={{ color: delta > 0 ? 'var(--accent-green)' : delta < 0 ? 'var(--color-destructive)' : 'var(--color-muted-foreground)' }}>
            {delta > 0 ? <TrendingUpIcon className="h-4 w-4" /> : delta < 0 ? <TrendingDownIcon className="h-4 w-4" /> : <MinusIcon className="h-4 w-4" />}
            {delta > 0 ? '+' : ''}{delta} vs last test
          </p>
        )}
        {computed.endedEarly && protocol.vo2Equation != null && (
          <p className="mt-2 text-xs text-muted-foreground">
            Ended early — VO₂max needs the full {Math.round((protocol.durationSec ?? 0) / 60)} min, so it wasn&apos;t scored.
          </p>
        )}
      </div>

      <div className="mb-6 grid grid-cols-3 gap-2 text-center">
        {protocol.captureDistance && (
          <Stat label="Distance" value={`${(capture.distanceM / 1000).toFixed(2)} km`} />
        )}
        {computed.avgHr != null && <Stat label="Avg HR" value={`${computed.avgHr}`} />}
        {computed.maxHr != null && <Stat label="Max HR" value={`${computed.maxHr}`} />}
        {computed.restingHr != null && <Stat label="Resting HR" value={`${computed.restingHr}`} />}
      </div>

      <div className="mt-auto flex gap-3">
        <Button variant="outline" className="flex-1 h-12" onClick={() => { onDone(); router.push('/health?tab=training') }} disabled={saving}>
          Discard
        </Button>
        <Button className="flex-1 h-12" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save baseline'}
        </Button>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/60 border border-border px-2 py-3">
      <p className="text-base font-bold tabular-nums">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  )
}
