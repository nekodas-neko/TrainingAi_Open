'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2, TimerIcon, ChevronDownIcon, ChevronUpIcon, TriangleAlert, FlagIcon } from 'lucide-react'
import { MIN_TRUSTED_SAMPLES } from '@trainingai/shared/workout/time-audit'
import { todayInTz } from '@trainingai/shared/date-utils'

const DAY_OPTIONS = [30, 90, 180, 365]

interface EquipmentRow {
  equipmentClass: string
  transitionCount: number
  outlierTransitionCount: number
  medianTransitionSec: number | null
  transitionP75Sec: number | null
  currentModelSec: number
}
interface ExerciseRow {
  exerciseName: string
  setCount: number
  outlierSetCount: number
  medianSetSec: number | null
  medianSecPerRep: number | null
  medianRestSec: number | null
  transitionCount: number
  medianTransitionSec: number | null
  modelTransitionSec: number
}
interface SessionRow {
  workoutSessionId: string
  startedAt: number
  totalSec: number
  warmupSec: number | null
  rawWarmupSec: number | null
  warmupOverflowSec: number
  workSec: number
  restSec: number
  transitionSec: number
  unaccountedSec: number
  anomalies: { type: string; sec: number; detail: string }[]
}

const fmtSec = (v: number | null) => (v == null ? '—' : v >= 90 ? `${(v / 60).toFixed(1)}m` : `${Math.round(v)}s`)
// Below MIN_TRUSTED_SAMPLES, a median is a guess, not a signal — dim it rather than
// hide it (n === 0 already renders as "—", which communicates "no data" on its own).
const lowN = (n: number) => (n > 0 && n < MIN_TRUSTED_SAMPLES ? 'opacity-50' : '')

export default function TimeAuditCard() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ equipment: EquipmentRow[]; exercises: ExerciseRow[]; sessions: SessionRow[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(90)
  const [baselineDate, setBaselineDate] = useState<string | null>(null)
  const [baselineLoaded, setBaselineLoaded] = useState(false)
  const [baselineSaving, setBaselineSaving] = useState(false)

  async function load(d = days) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/time-audit?days=${d}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  async function loadBaseline() {
    const res = await fetch('/api/admin/timing-baseline')
    if (res.ok) setBaselineDate((await res.json()).date)
    setBaselineLoaded(true)
  }

  async function setBaseline(date: string | null) {
    setBaselineSaving(true)
    try {
      const res = await fetch('/api/admin/timing-baseline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      })
      if (res.ok) {
        setBaselineDate((await res.json()).date)
        await load()
      }
    } finally {
      setBaselineSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <button
        className="w-full flex items-center justify-between"
        aria-expanded={open}
        onClick={() => {
          setOpen(v => !v)
          if (!open && !data && !loading) load()
          if (!open && !baselineLoaded) loadBaseline()
        }}
      >
        <span className="flex items-center gap-2 font-semibold">
          <TimerIcon className="h-4 w-4" /> Workout time audit ({days} days)
        </span>
        {open ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
      </button>

      {open && (
        <div className="space-y-4 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground">
            <FlagIcon className="h-3.5 w-3.5 shrink-0" />
            <span>Monitoring baseline: {baselineDate ?? 'none (full history)'}</span>
            <Button size="sm" variant="ghost" disabled={baselineSaving} onClick={() => setBaseline(todayInTz())}>
              Set to today
            </Button>
            {baselineDate && (
              <Button size="sm" variant="ghost" disabled={baselineSaving} onClick={() => setBaseline(null)}>
                Clear
              </Button>
            )}
          </div>
          <div className="flex gap-1">
            {DAY_OPTIONS.map(d => (
              <Button
                key={d}
                size="sm"
                variant={days === d ? 'secondary' : 'ghost'}
                onClick={() => { setDays(d); load(d) }}
              >
                {d}
              </Button>
            ))}
          </div>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {error && <p className="text-destructive">{error} <Button size="sm" variant="ghost" onClick={() => load()}>Retry</Button></p>}
          {data && (
            <>
              <div>
                <p className="font-medium mb-1">Transitions by equipment (measured vs model)</p>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead><tr className="text-left text-muted-foreground"><th>Class</th><th>n</th><th>median</th><th>p75</th><th>model</th><th>outliers</th></tr></thead>
                    <tbody>
                      {data.equipment.map(r => (
                        <tr key={r.equipmentClass} className={lowN(r.transitionCount)}>
                          <td>{r.equipmentClass}</td><td>{r.transitionCount}</td>
                          <td>{fmtSec(r.medianTransitionSec)}</td><td>{fmtSec(r.transitionP75Sec)}</td>
                          <td>{fmtSec(r.currentModelSec)}</td><td>{r.outlierTransitionCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <p className="font-medium mb-1">Per exercise</p>
                <div className="overflow-x-auto max-h-64 overflow-y-auto">
                  <table className="w-full">
                    <thead><tr className="text-left text-muted-foreground"><th>Exercise</th><th>sets</th><th>set med</th><th>s/rep</th><th>rest med</th><th>transition med</th><th>model</th></tr></thead>
                    <tbody>
                      {data.exercises.map(r => (
                        <tr key={r.exerciseName}>
                          <td className="pr-2">
                            {r.exerciseName}
                            {r.outlierSetCount > 0 && (
                              <span className="inline-flex items-center gap-0.5 align-middle" style={{ color: "var(--accent-amber)" }}>
                                {' '}(<TriangleAlert className="h-3 w-3" /> {r.outlierSetCount})
                              </span>
                            )}
                          </td>
                          <td className={lowN(r.setCount)}>{r.setCount}</td>
                          <td className={lowN(r.setCount)}>{fmtSec(r.medianSetSec)}</td>
                          <td className={lowN(r.setCount)}>{r.medianSecPerRep != null ? r.medianSecPerRep.toFixed(1) : '—'}</td>
                          <td className={lowN(r.setCount)}>{fmtSec(r.medianRestSec)}</td>
                          <td className={lowN(r.transitionCount)}>{fmtSec(r.medianTransitionSec)}</td>
                          <td>{fmtSec(r.modelTransitionSec)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <p className="font-medium mb-1">Recent sessions — where the time went</p>
                <div className="overflow-x-auto max-h-64 overflow-y-auto">
                  <table className="w-full">
                    <thead><tr className="text-left text-muted-foreground"><th>Date</th><th>total</th><th>warmup</th><th>work</th><th>rest</th><th>transitions</th><th>unaccounted</th><th>flags</th></tr></thead>
                    <tbody>
                      {data.sessions.map(r => (
                        <tr key={r.workoutSessionId}>
                          <td>{new Date(r.startedAt).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' })}</td>
                          <td>{fmtSec(r.totalSec)}</td>
                          <td>
                            {fmtSec(r.warmupSec)}
                            {r.warmupOverflowSec > 0 && (
                              <span className="text-muted-foreground"> (raw {fmtSec(r.rawWarmupSec)})</span>
                            )}
                          </td>
                          <td>{fmtSec(r.workSec)}</td>
                          <td>{fmtSec(r.restSec)}</td><td>{fmtSec(r.transitionSec)}</td><td>{fmtSec(r.unaccountedSec)}</td>
                          <td>
                            {r.anomalies.length > 0 && (
                              <span className="inline-flex flex-col gap-0.5" style={{ color: "var(--accent-amber)" }}>
                                {r.anomalies.map((a, i) => (
                                  <span key={i} className="inline-flex items-center gap-1">
                                    <TriangleAlert className="h-3 w-3 shrink-0" /> {a.detail}
                                  </span>
                                ))}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
