'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Sunrise, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { toast } from 'sonner'
import { useSheetBackDismiss } from '@/lib/hooks/use-sheet-back-dismiss'
import { getLocalStore } from '@/lib/local-store'
import { pushMutations } from '@/lib/local-store/sync-engine'
import { invalidateCheckinAffectsPrescription, invalidateHealthTrends } from '@/lib/cache-groups'
import { MORNING_SCALES, type MorningScaleKey, type IllnessContext } from '@trainingai/shared/types/day-checkin'
import { ScaleSelector } from '@/components/nutrition/end-of-day/scale-selector'
import { IllnessContextPicker } from '@/components/checkin/illness-context-picker'
import { todayInTz } from '@trainingai/shared/date-utils'

// Q-113: Recovery/Sleep-quality-feel default to a neutral, non-score-derived 3 — NOT
// prefillMorningScales(readiness/sleepScore) as before, which silently seeded the sheet
// with the Readiness/Sleep score's own guess. An unedited Save now genuinely means "didn't
// have an opinion," rather than masquerading as agreement with a score the lifter never saw.
const NEUTRAL_SCALES: Record<MorningScaleKey, number> = { perceivedRecovery: 3, sleepQualityFeel: 3 }

interface Props {
  open: boolean
  onClose: () => void
  userId?: string
  readiness?: number | null   // shown in the header only — no longer drives a prefill (Q-113)
  onSaved?: () => void
}

export function MorningCheckinSheet({ open, onClose, userId, readiness, onSaved }: Props) {
  useSheetBackDismiss(open, onClose)
  const [scales, setScales] = useState<Record<MorningScaleKey, number>>(() => ({ ...NEUTRAL_SCALES }))
  const [touched, setTouched] = useState<Record<MorningScaleKey, boolean>>({
    perceivedRecovery: false, sleepQualityFeel: false,
  })
  const [illnessContext, setIllnessContext] = useState<IllnessContext | null>(null)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  // Set as soon as the user taps anything — the async saved-checkin fetch below must
  // never clobber a tap that landed before it resolved (a real race on slower networks).
  const editedRef = useRef(false)

  useEffect(() => {
    if (!open) {
      setLoaded(false); editedRef.current = false
      setScales({ ...NEUTRAL_SCALES })
      setTouched({ perceivedRecovery: false, sleepQualityFeel: false })
      setIllnessContext(null)
      return
    }
    if (loaded) return
    let cancelled = false
    async function init() {
      const date = todayInTz()
      const store = userId ? getLocalStore(userId) : null
      const saved = store
        ? await store.getDayCheckin(date, 'morning')
        : await fetch(`/api/day-checkin?date=${date}&phase=morning`)
            .then(r => (r.ok ? r.json() : null)).catch(() => null)
      if (cancelled) return
      if (!editedRef.current) {
        if (saved) {
          setScales({
            perceivedRecovery: saved.perceivedRecovery ?? NEUTRAL_SCALES.perceivedRecovery,
            sleepQualityFeel:  saved.sleepQualityFeel ?? NEUTRAL_SCALES.sleepQualityFeel,
          })
          setTouched({
            perceivedRecovery: saved.perceivedRecoveryTouched ?? false,
            sleepQualityFeel:  saved.sleepQualityFeelTouched ?? false,
          })
          setIllnessContext(saved.illnessContext ?? null)
        } else {
          setScales({ ...NEUTRAL_SCALES })
        }
      }
      setLoaded(true)
    }
    init()
    return () => { cancelled = true }
  }, [open, loaded, userId])

  async function handleSave() {
    if (saving) return
    setSaving(true)
    const date = todayInTz()
    const payload = {
      phase: 'morning' as const,
      perceivedRecovery: scales.perceivedRecovery,
      sleepQualityFeel:  scales.sleepQualityFeel,
      perceivedRecoveryTouched: touched.perceivedRecovery,
      sleepQualityFeelTouched:  touched.sleepQualityFeel,
      illnessContext,
      // Retired scales — always null so a re-save clears any historical value.
      motivation:        null,
      restingSoreness:   null,
      wakeMood:          null,
      soreMuscles: [] as string[],
      journal: null,
    }
    try {
      const store = userId ? getLocalStore(userId) : null
      // Started, NOT awaited — see the mood check-in's identical note: the plugin's single
      // SQLite connection means a tap during the sync pull queues behind the whole delta.
      const localWrite: Promise<boolean> = (async () => {
        if (!store) return false
        try {
          await store.upsertDayCheckin({
            logDate: date,
            physicalTiredness: null, mentalDrain: null, barelyMoved: null,
            hydration: null, lateHeavyMeal: null,
            ...payload,
            updatedAt: new Date().toISOString(),
            deletedAt: null,
            syncStatus: 'pending',
          })
          await store.queueMutation({ userId: userId!, domain: 'day_checkins', date, payload })
          pushMutations(userId!).catch(() => {})
          return true
        } catch (sqliteErr) {
          // A local write that fails — most likely the DB not being open yet, right after an
          // app update runs a schema upgrade — must still reach the server. Without this branch
          // the check-in ends here, which is how 2026-08-13's morning check-in disappeared
          // behind a success toast.
          console.error('Morning check-in SQLite write failed, falling back to API:', sqliteErr)
          return false
        }
      })()

      toast.success('Morning check-in saved')
      onClose()

      void (async () => {
        const savedLocally = await localWrite
        if (!savedLocally) {
          try {
            const res = await fetch('/api/day-checkin', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ date, ...payload }),
            })
            if (!res.ok) throw new Error(`API ${res.status}`)
          } catch (err) {
            console.error('Morning check-in save error:', err)
            toast.error("Check-in didn't save — check your connection")
            return
          }
        }
        // Sibling of the mood check-in: `resting_soreness`/`perceived_recovery` land in
        // signals.morningCheckin and shape the prescription, so the same caches must drop.
        // Behind the write, so the refetch onSaved triggers cannot read a store the write has
        // not reached yet.
        await invalidateCheckinAffectsPrescription().catch(() => {})
        invalidateHealthTrends().catch(() => {})
        onSaved?.()
      })()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={o => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl max-h-[92vh] flex flex-col p-0 bg-secondary border-t border-border/70"
        hideCloseButton
      >
        <SheetTitle className="sr-only">Morning Check-in</SheetTitle>
        <div className="flex items-center justify-between px-4 pt-4 pb-3 shrink-0">
          <div className="flex items-center gap-2">
            <Sunrise className="w-4 h-4 text-brand" />
            <h2 className="text-base font-semibold">Morning Check-in</h2>
            {readiness != null && (
              <span className="text-[10px] text-muted-foreground">· Readiness {readiness}</span>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="p-2.5 text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4 flex flex-col gap-4">
          {MORNING_SCALES.map(scale => (
            <ScaleSelector
              key={scale.key}
              label={scale.label}
              low={scale.low}
              high={scale.high}
              color={scale.color}
              labels={scale.labels}
              value={scales[scale.key]}
              onChange={v => {
                editedRef.current = true
                setScales(s => ({ ...s, [scale.key]: v }))
                setTouched(t => ({ ...t, [scale.key]: true }))
              }}
            />
          ))}
          <IllnessContextPicker
            value={illnessContext}
            onChange={v => { editedRef.current = true; setIllnessContext(v) }}
          />
        </div>
        <div className="shrink-0 px-4 pt-2 pb-2 border-t border-border/60 bg-secondary">
          <Button onClick={handleSave} disabled={saving} className="w-full h-12 gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
