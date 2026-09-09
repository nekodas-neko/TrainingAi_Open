"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import { getLocalStore } from "@/lib/local-store";
import { pushMutations } from "@/lib/local-store/sync-engine";
import { formatTimeOfDay } from "@trainingai/shared/date-utils";
import { bedtimeInstant, parseClock } from "./manual-bedtime";

interface Props {
  /** The night's date, `YYYY-MM-DD`. */
  date: string
  /** What the ring actually observed, for the contrast that makes this control make sense. */
  measuredStart: string | null
  userId?: string
}

/**
 * Q-519 — the bedtime you remember, for a night the ring did not see the start of.
 *
 * The owner fitted their ring at 4 am and the night read as a 4 am bedtime, which moved the 14-day
 * bedtime estimate ~23 minutes later for a fortnight. This is the control that corrects it.
 *
 * **It writes `manual_sleep_start` and nothing else** — not the measured start, not a duration, not
 * an efficiency. An earlier design wrote the remembered value into `sleep_start` and let the
 * per-field merge sort it out; the audit found three consumers that derive behaviour from the
 * *window*, one of which turned a 3-hour night into 9 hours at 34% efficiency and moved five awake
 * hours into a nightly training set. `docs/reviews/2026-08-26-manual-bedtime-write-audit.md`.
 *
 * **The current value is read from the local store, not from `/api/sleep-sessions`** — that route
 * does not return `manualSleepStart`, so on the web build this reads as unset even when it is set.
 * The APK is the canonical runtime and reads it correctly; adding the field to the route is Lane A's
 * and is filed on Q-519.
 */
export function ManualBedtimeCard({ date, measuredStart, userId }: Props) {
  const tz = useUserTimezone()
  const [saved, setSaved] = useState<string | null>(null)
  const [clock, setClock] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    let alive = true
    const store = userId ? getLocalStore(userId) : null
    if (!store) return
    store.getSleepSessions(date)
      .then(rows => {
        if (!alive) return
        const row = rows.find(r => r.date === date)
        setSaved(row?.manualSleepStart ?? null)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [date, userId])

  const write = useCallback(async (at: string | null) => {
    if (busy) return
    setBusy(true)
    try {
      const store = userId ? getLocalStore(userId) : null
      if (store) {
        // Queued rather than posted directly, so a bedtime entered offline survives to the next
        // sync — the same shape every other offline-first write here uses.
        await store.queueMutation({ userId: userId!, domain: 'manual_bedtime', date, payload: { at } })
        pushMutations(userId!).catch(() => {})
      } else {
        const res = await fetch('/api/sleep/manual-bedtime', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, at }),
        })
        // 404 is the route saying there is no session for this date, which is a real answer and not
        // a failure to report as one.
        if (res.status === 404) { toast.error('No sleep recorded for that night'); return }
        if (!res.ok) throw new Error(String(res.status))
      }
      setSaved(at)
      setEditing(false)
      toast.success(at ? 'Bedtime saved' : 'Bedtime cleared')
    } catch {
      toast.error('Could not save that bedtime')
    } finally {
      setBusy(false)
    }
  }, [busy, date, userId])

  const onSave = () => {
    const at = bedtimeInstant(date, clock, tz)
    if (!at) { toast.error('Enter a time like 23:15'); return }
    void write(at)
  }

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Bedtime you remember
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {measuredStart
            ? `Your ring started recording at ${formatTimeOfDay(measuredStart, tz)}. If you were asleep before that, tell it when — the recorded night is left exactly as it was, and only your bedtime average uses this.`
            : 'If the ring missed the start of this night, tell it when you went to bed. Only your bedtime average uses this.'}
        </p>
      </div>

      {saved && !editing ? (
        <div className="flex items-center gap-3">
          <p className="flex-1 text-base font-semibold tabular-nums">{formatTimeOfDay(saved, tz)}</p>
          <Button variant="outline" size="sm" onClick={() => { setClock(''); setEditing(true) }} disabled={busy}>
            Change
          </Button>
          <Button variant="outline" size="sm" onClick={() => void write(null)} disabled={busy}>
            Clear
          </Button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="manual-bedtime" className="text-xs text-muted-foreground">Time you went to bed</Label>
            <Input
              id="manual-bedtime"
              type="time"
              value={clock}
              onChange={e => setClock(e.target.value)}
              className="tabular-nums"
            />
          </div>
          <Button onClick={onSave} disabled={busy || parseClock(clock) == null}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
          {saved && (
            <Button variant="outline" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
          )}
        </div>
      )}
    </div>
  )
}
