'use client'

import { useCallback, useState } from 'react'
import { CheckCircle2, ClipboardCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useCachedValue } from '@/lib/hooks/use-cached-value'
import { invalidateNutritionWrite } from '@/lib/cache-groups'
import { TTL_SHORT } from '@trainingai/shared/cache-ttl'
import { formatTimeOfDay } from '@trainingai/shared/date-utils'
import type { DayCheckin } from '@trainingai/shared/types/day-checkin'

interface Props {
  date: string
  isToday: boolean
  /** Days the maintenance calibration has accepted so far, from `/api/nutrition/energy-balance`. */
  daysLogged: number | null
  minDays: number
  /** True once the estimate no longer needs more days. */
  calibrated: boolean
  tz?: string
}

/**
 * "I've finished logging" — the control the maintenance calibration has been waiting for (Q-387).
 *
 * The estimate averages the intake of every logged day, and **a day abandoned after lunch is
 * byte-for-byte identical to a completed light one**. Measured on the Lane A half: 14 days at a true
 * 2,600 maintenance, six of them stopping at 1,400, estimated **2,086** — 514 kcal low, at
 * `confidence: 'medium'`, with nothing flagged. That number reaches `targetFromMaintenance`, so the
 * error lands on the recommended daily target with a cut's deficit stacked on top.
 *
 * **The counter ships with the button, not after it.** The button feeds something otherwise
 * invisible — a day is either in the window or it is not, and nothing on screen said so. That
 * invisibility is why the bug survived to be reported as a question rather than as a bug.
 *
 * **Marking a past day is allowed and is the common case.** Today is excluded from the calibration
 * window entirely, so a control that only ever marked today could never move the estimate on the day
 * you pressed it.
 */
export function FoodLoggingComplete({ date, isToday, daysLogged, minDays, calibrated, tz }: Props) {
  const checkin = useCachedValue<DayCheckin | null>(
    `day-checkin:${date}`, `/api/day-checkin?date=${encodeURIComponent(date)}&phase=evening`, TTL_SHORT,
  )
  // The server's answer, until the user presses something. `undefined` means "no local opinion yet",
  // which is not the same as `false` — a `false` would flash the button over an already-marked day.
  const [pending, setPending] = useState<boolean | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const complete = pending ?? (checkin?.foodLoggingCompletedAt != null)
  const completedAt = checkin?.foodLoggingCompletedAt ?? null

  const set = useCallback(async (next: boolean) => {
    setBusy(true)
    // Feedback-first: the mode flips and the toast fires before the round-trip, like every other
    // save path in the app. The reconcile below puts it back if the write actually failed.
    setPending(next)
    toast.success(next ? 'Day marked complete' : 'Undone')
    try {
      const res = await fetch('/api/food-logging-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, complete: next }),
      })
      if (!res.ok) throw new Error()
      // The maintenance estimate is derived from which days carry the flag, so the energy-balance
      // payload every surface reads is now wrong. Reusing the nutrition group rather than adding a
      // key list here — a hand-rolled list at a write site is the single most repeated bug in this
      // project, and this group already clears `energy-balance:`.
      await invalidateNutritionWrite().catch(() => {})
    } catch {
      setPending(!next)
      toast.error(next ? 'Could not mark the day complete' : 'Could not undo')
    } finally { setBusy(false) }
  }, [date])

  const remaining = daysLogged == null ? null : Math.max(0, minDays - daysLogged)

  return (
    <div className="rounded-2xl border border-border bg-muted/60 p-4">
      {complete ? (
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none" style={{ color: 'var(--accent-green)' }} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Logging finished{isToday ? ' for today' : ''}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              This day counts toward your maintenance estimate
              {completedAt ? ` · marked ${formatTimeOfDay(completedAt, tz)}` : ''}
            </p>
          </div>
          <Button
            variant="ghost"
            className="h-12 flex-none px-3 text-xs"
            disabled={busy}
            onClick={() => set(false)}
          >
            Undo
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-3">
            <ClipboardCheck className="mt-0.5 h-5 w-5 flex-none text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Finished logging{isToday ? ' for today' : ' this day'}?</p>
              {/* Says what pressing it does AND what not pressing it does — the second half is the
                  point: an unmarked day is ignored rather than counted badly. */}
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                Only days you mark are used to work out what you burn. A day you stop logging halfway
                through would otherwise look like a light day and drag the estimate down.
              </p>
            </div>
          </div>
          <Button className="mt-3 h-12 w-full" disabled={busy} onClick={() => set(true)}>
            {busy ? 'Saving…' : 'I’ve finished logging'}
          </Button>
        </>
      )}

      {/* The counter. Absent only when the profile cannot produce an estimate at all, in which case
          a "0 of 10" would be a target the user cannot move by logging. */}
      {remaining != null && (
        <p className="mt-3 border-t border-border/60 pt-2.5 text-[11px] tabular-nums text-muted-foreground">
          {calibrated
            ? <><span className="font-semibold text-foreground">{daysLogged}</span> days marked · your maintenance is calibrated from them</>
            : <><span className="font-semibold text-foreground">{daysLogged} of {minDays}</span> days marked · {remaining} more to calibrate your maintenance</>}
        </p>
      )}
    </div>
  )
}
