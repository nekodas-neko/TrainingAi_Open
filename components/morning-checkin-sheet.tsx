'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Sunrise, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { toast } from 'sonner'
import { getLocalStore } from '@/lib/local-store'
import { pushThenRevalidate } from '@/lib/local-store/push-then-revalidate'
import { invalidateCheckinAffectsPrescription, invalidateHealthTrends } from '@/lib/cache-groups'
import { type IllnessContext, type VsYesterday } from '@trainingai/shared/types/day-checkin'
import { SleepAnnouncement } from '@/components/checkin/sleep-announcement'
import { type StoredSleepVerdict } from '@/components/health/sleep/sleep-verdict-copy'
import { saveSleepValue } from '@/components/checkin/save-sleep-value'
import { TTL_MEDIUM } from '@trainingai/shared/cache-ttl'
import { cachedFetch } from '@/lib/sqlite/cache'
import { IllnessContextPicker } from '@/components/checkin/illness-context-picker'
import { VS_YESTERDAY_DEFAULT, VsYesterdayPicker } from '@/components/checkin/vs-yesterday-picker'
import { todayInTz } from '@trainingai/shared/date-utils'
import { useUserTimezone } from '@/components/shell/user-timezone-provider'

interface Props {
  open: boolean
  onClose: () => void
  userId?: string
  readiness?: number | null   // shown in the header only — no longer drives a prefill (Q-113)
  onSaved?: () => void
}

export function MorningCheckinSheet({ open, onClose, userId, readiness, onSaved }: Props) {
  const tz = useUserTimezone()
  // TN-82. `correction` is the stored 1–5 he set himself; null means the app's own answer stands.
  // `acknowledged` is an EXPLICIT tap on a prominent announcement — never inferred from Save.
  const [verdict, setVerdict] = useState<StoredSleepVerdict | null>(null)
  const [correction, setCorrection] = useState<number | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [illnessContext, setIllnessContext] = useState<IllnessContext | null>(null)
  // LB-191. Seeded with the neutral, by the owner's explicit call against the recommendation. Still
  // no `touched` flag: the column has no default and the sheet writes solely on Save, so DISMISSING
  // is what stores nothing — and with a value seeded, that dismissal is the only remaining signal
  // of "not answered". A restored row is the exception below: it is read back exactly as stored,
  // NULL included, so a cleared-and-saved answer is not re-seeded into agreeing with itself.
  const [vsYesterday, setVsYesterday] = useState<VsYesterday | null>(VS_YESTERDAY_DEFAULT)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  // Set as soon as the user taps anything — the async saved-checkin fetch below must
  // never clobber a tap that landed before it resolved (a real race on slower networks).
  const editedRef = useRef(false)

  useEffect(() => {
    if (!open) {
      setLoaded(false); editedRef.current = false
      setCorrection(null)
      setAcknowledged(false)
      setVsYesterday(VS_YESTERDAY_DEFAULT)
      setIllnessContext(null)
      return
    }
    if (loaded) return
    let cancelled = false
    async function init() {
      const date = todayInTz(tz)
      const store = userId ? getLocalStore(userId) : null
      const saved = store
        ? await store.getDayCheckin(date, 'morning')
        : await fetch(`/api/day-checkin?date=${date}&phase=morning`)
            .then(r => (r.ok ? r.json() : null)).catch(() => null)
      if (cancelled) return
      if (!editedRef.current) {
        if (saved) {
          // Only a TOUCHED value is restored as a correction. An untouched one is the app's own
          // auto-fill, and re-seeding the picker from it would show his own screen agreeing with
          // itself — the shape TN-57 exists to prevent.
          setCorrection(saved.sleepQualityFeelTouched ? saved.sleepQualityFeel ?? null : null)
          setIllnessContext(saved.illnessContext ?? null)
          // `?? null`, not `?? VS_YESTERDAY_DEFAULT` (LB-191): a stored NULL is either a cleared
          // answer or a row from before the seed, and re-seeding the neutral over it would show
          // his own screen agreeing with itself — the shape TN-57 exists to prevent.
          setVsYesterday(saved.vsYesterday ?? null)
        }
      }
      setLoaded(true)
    }
    init()
    return () => { cancelled = true }
  }, [open, loaded, userId, tz])

  /**
   * The verdict, in its OWN effect — and that is not tidiness.
   *
   * The effect above lists `loaded` in its deps and ends by SETTING it, so it tears itself down and
   * re-runs once per open. Its cleanup flips the `cancelled` flag the first run's callbacks close
   * over, which is harmless for state set synchronously and fatal for anything awaiting the network:
   * the fetch resolved, found `cancelled` true, and dropped the answer on the floor. The sheet then
   * showed no announcement at all, which looks exactly like a night with nothing to say.
   *
   * Keyed on `[open, tz]` only, so nothing cancels it but closing the sheet.
   */
  useEffect(() => {
    if (!open) { setVerdict(null); return }
    let cancelled = false
    const date = todayInTz(tz)
    // The SAME key and TTL the Home note uses (TN-85). A second key for one endpoint is how this app
    // has produced stale and blank first paints before, and two TTL expressions for one key make
    // freshness last-writer-wins.
    void cachedFetch<{ verdict: StoredSleepVerdict | null }>(
      `sleep-verdict:${date}`, `/api/sleep-verdict?date=${date}`, TTL_MEDIUM,
      d => { if (!cancelled) setVerdict(d?.verdict ?? null) },
      // Swallowed otherwise (Q-499). No error state is shown: the announcement is absent on a
      // failure exactly as it is when there is nothing to announce, and the sheet still works.
      { onError: () => { if (!cancelled) setVerdict(null) } },
    )
    return () => { cancelled = true }
  }, [open, tz])

  async function handleSave() {
    if (saving) return
    setSaving(true)
    const date = todayInTz(tz)
    const sleepWrite = saveSleepValue(correction, verdict)
    const payload = {
      phase: 'morning' as const,
      // TN-82. Recovery is no longer asked and has no verdict to announce in its place — there is
      // no recovery model, and its input had 0 touched answers in 102 check-ins, so it costs a
      // reading that has never once been taken. Null is the honest value for a question not put.
      perceivedRecovery: null,
      perceivedRecoveryTouched: false,
      sleepQualityFeel:  sleepWrite.value,
      sleepQualityFeelTouched:  sleepWrite.touched,
      illnessContext,
      vsYesterday,
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
          pushThenRevalidate(userId!, () => Promise.all([invalidateCheckinAffectsPrescription(), invalidateHealthTrends()]))
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

      // TN-82's guard: three states, not two. Recorded only when he acted ON the announcement —
      // a plain Save stays `none`, i.e. UNKNOWN, never promoted to agreement. He has saved 82 of 82
      // sheets while touching a scale in 3, so a Save read as assent would manufacture exactly the
      // data that looks like success and is actually absence.
      void (async () => {
        const state = correction != null ? 'corrected' : acknowledged ? 'acknowledged' : null
        if (!state || !verdict) return
        // Fire-and-forget: the VALUE is the check-in's to write and has already gone. Losing the
        // response record costs an analysis column, and must never cost the check-in.
        await fetch('/api/sleep-verdict', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, state }),
        }).catch(() => {})
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
        className="rounded-t-2xl max-h-[92dvh] flex flex-col p-0 bg-secondary border-t border-border/70"
        hideCloseButton
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-3 shrink-0">
          <div className="flex items-center gap-2">
            <Sunrise className="w-4 h-4 text-brand" />
            <SheetTitle asChild><h2 className="text-base font-semibold">Morning Check-in</h2></SheetTitle>
            {readiness != null && (
              <span className="text-[10px] text-muted-foreground">· Readiness {readiness}</span>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="p-2.5 text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4 flex flex-col gap-4">
          {/* TN-82. Renders nothing when there is no verdict — the baseline is still filling, or
              the ring has not drained the night. A line saying "not enough data" every morning is a
              line that gets tuned out, and this is the one that must not be. */}
          {verdict && (
            <SleepAnnouncement
              verdict={verdict}
              correction={correction}
              onCorrect={stored => {
                editedRef.current = true
                // Re-tapping the chosen one clears it, so a mis-tap is undoable without leaving a
                // touched value behind claiming to be his answer.
                setCorrection(c => (c === stored ? null : stored))
                setAcknowledged(false)
              }}
              acknowledged={acknowledged}
              onAcknowledge={() => { editedRef.current = true; setAcknowledged(true) }}
            />
          )}
          {/* TN-58's note said this belonged first because *"a question placed after two the owner
              skips inherits their fate"* — the two it had to escape are gone, and the announcement
              is now the thing on this sheet he is meant to READ. Burying it under a question that
              collected 2 of 82 is the failure mode the plan names (§3: him not reading it), so the
              announcement leads and this follows. */}
          <VsYesterdayPicker
            value={vsYesterday}
            onChange={v => { editedRef.current = true; setVsYesterday(v) }}
          />
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
