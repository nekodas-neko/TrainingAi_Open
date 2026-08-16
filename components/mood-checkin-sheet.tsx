"use client"

import { useState, useEffect, useRef } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible"
import { ChevronDownIcon } from "lucide-react"
import { toast } from "sonner"
import { invalidateCheckinAffectsPrescription, invalidatePrescriptionChanged } from "@/lib/cache-groups"
import { MOOD_TTL, MUSCLE_RECOVERY_TTL, TTL_MEDIUM } from "@trainingai/shared/cache-ttl"
import { hapticLight } from "@/lib/haptics"
import type { EnergyLevel, BodyState, MoodLog } from "@trainingai/shared/types/mood"
import { getLocalStore } from "@/lib/local-store"
import { pushMutations } from "@/lib/local-store/sync-engine"
import { todayInTz } from "@trainingai/shared/date-utils"
import { SoreMusclePicker, SORE_MUSCLE_GROUPS } from "@/components/checkin/sore-muscle-picker"
import type { PerExerciseDeloadInput } from "@trainingai/shared/ai-periodization/per-exercise-deload"
import { SessionDurationPicker } from "@/components/workout/session-duration-picker"
import { suggestedSoreMuscles } from "@trainingai/shared/checkin/suggested-soreness"
import { setCached, cachedFetch, readCacheSync } from "@/lib/sqlite/cache"
import type { DurationPreset } from "@trainingai/shared/workout/duration-model"
import type { MuscleRecoveryResponse } from "@/app/api/muscle-recovery/route"
import type { SessionPeriodization } from "@trainingai/shared/types/ai-periodization"

type PeriodizationStateResponse = { state: SessionPeriodization }

const ENERGY_OPTIONS: { value: EnergyLevel; emoji: string; label: string }[] = [
  { value: "drained", emoji: "😴", label: "Drained" },
  { value: "low",     emoji: "😑", label: "Low" },
  { value: "ok",      emoji: "😐", label: "OK" },
  { value: "good",    emoji: "😊", label: "Good" },
  { value: "pumped",  emoji: "⚡", label: "Pumped" },
]

function readinessToEnergy(score: number | null | undefined): EnergyLevel {
  if (score == null) return "ok"
  if (score >= 80) return "good"
  if (score >= 60) return "ok"
  if (score >= 40) return "low"
  return "drained"
}

// Issues that are neither muscle soreness nor an energy level — both of those now have their
// own section, so "Heavy Legs" (soreness) and "Low Motivation" (energy) were removed here as
// duplicate ways to say the same thing (owner call 2026-07-29). The BodyState union keeps them
// so historical logs still parse; they are simply no longer offered.
const ISSUE_OPTIONS: { value: BodyState; label: string; color?: string }[] = [
  { value: "stiff",      label: "Stiff / Tight" },
  { value: "joint_pain", label: "Joint Pain" },
  { value: "sick",       label: "Sick / Unwell", color: "var(--destructive)" },
]

const ALL_SORE_MUSCLES = SORE_MUSCLE_GROUPS.flatMap(g => g.muscles)

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId?: string
  readiness?: number | null        // Oura readiness score — sets energy default
  sessionName?: string
  sessionMuscles?: string[]
  /** Per-exercise main/secondary muscle assignments for today's session (Q-115-followup) — lets
   *  the sore-muscle picker predict computePerExerciseDeload's whole-session escalation. */
  sessionExercises?: PerExerciseDeloadInput[]
  onSaved?: (log: MoodLog) => void
  /**
   * Fired synchronously on the tap, from the optimistic log — before the local write and the cache
   * invalidation `onSaved` has to wait behind. The screen behind this sheet swaps its readiness
   * prompt for the tuned recommendation on this callback, and that swap must not be held hostage
   * to a SQLite write that can queue for minutes behind a sync pull's applyDelta (Q-248).
   * Use it for state the user is watching; use `onSaved` for anything that refetches.
   */
  onOptimisticSave?: (log: MoodLog) => void
  initialLog?: MoodLog | null
  /** Today's session, so the time control can read and rebuild its plan. Omit to hide it. */
  sessionId?: string
  /** The session's own configured budget — the control shows this ±30. */
  sessionBudgetMin?: number
}

export function MoodCheckInSheet({
  open, onOpenChange, userId, readiness, sessionName, sessionMuscles, sessionExercises, onSaved,
  onOptimisticSave, initialLog,
  sessionId, sessionBudgetMin,
}: Props) {
  const [energy, setEnergy]           = useState<EnergyLevel>(() => readinessToEnergy(readiness))
  const [soreMuscles, setSoreMuscles] = useState<string[]>([])
  const [issues, setIssues]           = useState<BodyState[]>([])
  const [saving, setSaving]           = useState(false)
  const [suggested, setSuggested]     = useState<string[]>([])
  const [preset, setPreset]           = useState<DurationPreset>('standard')
  const [presetBusy, setPresetBusy]   = useState(false)
  const [issuesOpen, setIssuesOpen]   = useState(false)

  // Seed synchronously from cache, then revalidate — the sheet must not flash an empty muscle
  // section on open. Reuses the key sync-provider already warms; never a bare fetch.
  useEffect(() => {
    if (!open) return
    const seed = readCacheSync<MuscleRecoveryResponse>('muscle-recovery')
    // Assign unconditionally, including on a cache miss (Q-226). This sheet is rendered with `open`
    // as a prop and never remounts, so `suggested` survives every close — and a `if (seed)` guard
    // left the *previous* open's value in place whenever the cache had since been cleared. That
    // stale list is then what the picker seeds from, because the network value cannot arrive until a
    // later render. Reproduced in a browser: with the cache cleared between opens, the second open
    // showed the first open's five muscles and never corrected.
    setSuggested(seed ? suggestedSoreMuscles(seed.muscles, ALL_SORE_MUSCLES) : [])
    cachedFetch<MuscleRecoveryResponse>(
      'muscle-recovery', '/api/muscle-recovery', MUSCLE_RECOVERY_TTL,
      d => setSuggested(suggestedSoreMuscles(d?.muscles, ALL_SORE_MUSCLES)),
    ).catch(() => {})
  }, [open])

  // Which length today's plan was actually built for. Read from the same cached periodization
  // state the pre-workout picker uses, so the two controls are one shared value rather than two
  // that can disagree — the stored prescription is the single source of truth for both.
  // Once the lifter picks a length, their choice owns the control. The fetch below can resolve
  // seconds later (a rebuild takes a real round-trip) and would otherwise answer with the
  // PRE-rebuild preset, silently snapping the segment back to what they just changed away from.
  const userPickedPresetRef = useRef(false)

  useEffect(() => {
    if (!open || !sessionId) return
    userPickedPresetRef.current = false
    const key = `ai-periodization-session:${sessionId}`
    const seed = readCacheSync<PeriodizationStateResponse>(key)
    if (seed?.state?.prescription?.durationPreset) setPreset(seed.state.prescription.durationPreset)
    cachedFetch<PeriodizationStateResponse>(key, `/api/ai-periodization/session/${sessionId}`, TTL_MEDIUM,
      d => {
        if (userPickedPresetRef.current) return
        setPreset(d?.state?.prescription?.durationPreset ?? 'standard')
      },
    ).catch(() => {})
  }, [open, sessionId])

  // Rebuilding is a real round-trip, so the control reflects the choice immediately and reverts
  // if the rebuild fails — the lifter never sees a segment they didn't pick stay selected.
  async function handlePresetChange(next: DurationPreset) {
    if (!sessionId || next === preset) return
    const previous = preset
    userPickedPresetRef.current = true
    setPreset(next)
    setPresetBusy(true)
    hapticLight()
    try {
      const res = await fetch(`/api/ai-periodization/session/${sessionId}/prescribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ durationPreset: next }),
      })
      if (!res.ok) {
        setPreset(previous)
        toast.error(res.status === 429
          ? "Too many plan rebuilds this hour — try again shortly"
          : "Couldn't rebuild for that length — try again")
        return
      }
      await invalidatePrescriptionChanged(sessionId)
    } catch {
      setPreset(previous)
      toast.error("Couldn't rebuild for that length — check your connection")
    } finally {
      setPresetBusy(false)
    }
  }

  useEffect(() => {
    if (initialLog) {
      setEnergy(initialLog.energyLevel)
      setSoreMuscles(initialLog.soreMuscles)
      const filteredIssues = initialLog.bodyState.filter(s =>
        ISSUE_OPTIONS.some(o => o.value === s)
      ) as BodyState[]
      setIssues(filteredIssues)
      setIssuesOpen(filteredIssues.length > 0)
    } else {
      setEnergy(readinessToEnergy(readiness))
      // A fresh check-in starts from the suggestions — but this effect must NOT be what seeds them
      // (Q-226). It has no `suggested` dependency, so it closed over whatever that state was left at
      // by the *previous* time the sheet was open: this sheet is rendered unconditionally with `open`
      // as a prop, so it never remounts and its state survives every close. The owner saw last
      // session's 5-muscle list on open — wide enough to trip the whole-session-deload banner — and
      // the correct 2-muscle list only after closing and reopening.
      //
      // So this clears, and the effect below seeds. That one reruns when `suggested` resolves, which
      // is the whole point: `cachedFetch` always awaits a real request before its onData fires, so
      // the correct value arrives a render or two later, never in this pass.
      setSoreMuscles([])
      setIssues([])
      setIssuesOpen(false)
    }
    // `readiness` is deliberately absent: energy resets from it on open, and re-running mid-open
    // would overwrite a level the lifter had just changed.
  }, [initialLog, open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Suggestions can land after the sheet opens (cache miss → network). Only ever ADD them to an
  // untouched fresh check-in; never re-add a muscle the lifter has already deselected.
  //
  // Since Q-226 this is the ONLY thing that seeds `soreMuscles` from suggestions — the reset above
  // clears instead of stamping a stale value. The `prev.length === 0` guard used to be unreachable
  // for the case it mattered in, because the effect above had already filled the list with the
  // previous open's leftovers; now it means what it says.
  const [seededFromSuggestions, setSeededFromSuggestions] = useState(false)
  useEffect(() => {
    if (!open) { setSeededFromSuggestions(false); return }
    if (initialLog || seededFromSuggestions || suggested.length === 0) return
    setSoreMuscles(prev => (prev.length === 0 ? suggested : prev))
    setSeededFromSuggestions(true)
  }, [open, initialLog, suggested, seededFromSuggestions])

  function toggleSoreMuscle(m: string) {
    setSoreMuscles(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])
  }

  function toggleIssue(val: BodyState) {
    setIssues(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val])
  }

  const sickSelected = issues.includes('sick')

  async function handleSave() {
    setSaving(true)
    try {
      const date = todayInTz()
      // Preserve 'sore_muscles' flag in bodyState so AI periodization signals still work
      const bodyState: BodyState[] = [
        ...issues,
        ...(soreMuscles.length > 0 ? ['sore_muscles' as BodyState] : []),
      ]
      const leanPayload = {
        energyLevel:  energy,
        bodyState,
        soreMuscles,
      }
      const log: MoodLog = {
        id:           '',
        userId:       userId ?? '',
        logDate:      date,
        energyLevel:  energy,
        sleepQuality: 'ok',
        bodyState,
        soreMuscles,
        createdAt:    new Date(),
      }
      const store = userId ? getLocalStore(userId) : null
      // Started, NOT awaited. "The local write is fast" held only while nothing else was using
      // the DB: the Capacitor plugin has one connection, so a tap that lands during the sync
      // pull's applyDelta transaction queues behind the whole delta. Awaiting it left the button
      // reading "Saving…" for ~2 minutes on 2026-08-13 while the write was merely waiting its
      // turn. The sheet now closes on the tap and the write finishes behind it.
      const localWrite: Promise<boolean> = (async () => {
        if (!store) return false
        try {
          await store.upsertMoodLog({
            logDate:      date,
            ...leanPayload,
            sleepQuality: 'ok',
            updatedAt:    new Date().toISOString(),
            deletedAt:    null,
            syncStatus:   'pending',
          })
          await store.queueMutation({ userId: userId!, domain: 'mood_logs', date, payload: leanPayload })
          pushMutations(userId!).catch(() => {})
          return true
        } catch (sqliteErr) {
          console.error('Mood SQLite write failed, falling back to API:', sqliteErr)
          return false
        }
      })()

      // Feedback-first for both branches: the web fallback fires its POST after the UI has
      // moved on instead of blocking the sheet close on the round-trip.
      hapticLight()
      toast.success("Readiness saved")
      onOpenChange(false)
      // Same beat as the toast and the close. Without this the card behind the sheet keeps showing
      // "How are you feeling?" underneath a "Readiness saved" toast for as long as the write below
      // is contended — which is exactly what the owner photographed (Q-248).
      onOptimisticSave?.(log)
      setCached(`mood:${date}`, log, MOOD_TTL).catch(() => {})

      void (async () => {
        const savedLocally = await localWrite
        // Awaited, and BEFORE onSaved: the callback triggers a refetch of the prescription this
        // check-in changes, and a refetch that starts first reads the stale `workout-data` cache
        // straight back — the session-164 ordering rule. Both now sit behind the local write so
        // the refetch cannot read a store the write has not reached yet. This ordering is why the
        // card's own state flip moved to onOptimisticSave above rather than being hoisted here.
        await invalidateCheckinAffectsPrescription().catch(() => {})
        onSaved?.(log)

        if (!savedLocally) {
          try {
            const res = await fetch("/api/mood", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(leanPayload),
            })
            if (!res.ok) throw new Error(`API ${res.status}`)
            const saved = await res.json() as MoodLog
            setCached(`mood:${date}`, saved, MOOD_TTL).catch(() => {})
            onSaved?.(saved)
          } catch (err) {
            console.error('Mood save error:', err)
            toast.error("Check-in didn't save — check your connection")
          }
        }
      })()
    } catch (err) {
      console.error('Mood save error:', err)
      toast.error("Failed to save check-in")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto px-5">
        <SheetHeader className="mb-5">
          <SheetTitle className="text-left">
            Exercise Readiness
            {sessionName && <span className="text-sm font-normal text-muted-foreground ml-2">Before {sessionName}</span>}
          </SheetTitle>
          <p className="text-left text-sm text-muted-foreground">
            Log today&apos;s energy and any muscle soreness so the AI can calibrate your session.
          </p>
        </SheetHeader>

        <div className="space-y-6">

          {/* ── 1. Energy ─────────────────────────────────────────── */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              Energy Level
              {readiness != null && (
                <span className="ml-2 normal-case font-normal tracking-normal">
                  · Readiness {readiness}
                </span>
              )}
            </p>
            <div className="flex justify-between">
              {ENERGY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setEnergy(opt.value)}
                  className="flex flex-col items-center gap-1"
                >
                  <span
                    className="text-3xl transition-all duration-150"
                    style={{
                      filter:    energy === opt.value ? "none" : "grayscale(1) opacity(0.35)",
                      transform: energy === opt.value ? "scale(1.25)" : "scale(1)",
                    }}
                  >
                    {opt.emoji}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-border/50" />

          {/* ── 2. Sore Muscles ───────────────────────────────────── */}
          <div>
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Sore Muscles{soreMuscles.length > 0 ? ` · ${soreMuscles.length}` : ""}
            </p>
            <SoreMusclePicker
              selected={soreMuscles}
              suggested={suggested}
              sessionMuscles={sessionMuscles}
              sessionExercises={sessionExercises}
              onToggle={toggleSoreMuscle}
            />
          </div>

          <div className="border-t border-border/50" />

          {/* ── 3. Issues (collapsible) ────────────────────────────── */}
          <Collapsible open={issuesOpen} onOpenChange={setIssuesOpen}>
            <CollapsibleTrigger className="w-full flex items-center justify-between py-1">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Issues{issues.length > 0 ? ` · ${issues.length}` : ""}
              </span>
              <ChevronDownIcon
                className={`h-4 w-4 text-muted-foreground transition-transform ${issuesOpen ? "rotate-180" : ""}`}
              />
            </CollapsibleTrigger>

            <CollapsibleContent>
              <div className="mt-3 flex gap-2 flex-wrap">
                {ISSUE_OPTIONS.map(opt => {
                  const isSelected = issues.includes(opt.value)
                  const color = opt.color ?? "var(--color-brand)"
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => toggleIssue(opt.value)}
                      className="rounded-full px-3 py-1.5 text-xs font-medium border transition-all"
                      style={{
                        borderColor: isSelected ? color : undefined,
                        background:  isSelected ? `color-mix(in oklch, ${color} 15%, transparent)` : undefined,
                        color:       isSelected ? color : undefined,
                      }}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {sickSelected && (
            <div
              className="rounded-xl px-3 py-2.5 text-xs font-medium leading-snug"
              style={{
                background: "color-mix(in oklch, var(--destructive) 12%, transparent)",
                color: "var(--destructive)",
              }}
            >
              Feeling unwell — a rest day will be recommended. If you train anyway, today&apos;s
              session is deloaded.
            </div>
          )}

          {/* ── 4. Time Constraints ───────────────────────────────── */}
          {sessionBudgetMin != null && sessionId && (
            <>
              <div className="border-t border-border/50" />
              <div>
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Time Constraints
                </p>
                <SessionDurationPicker
                  value={preset}
                  standardMin={sessionBudgetMin}
                  disabled={saving || presetBusy}
                  hideHeader
                  onChange={handlePresetChange}
                />
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Changes today&apos;s plan only — sets and exercises are rebalanced against your
                  weekly volume, so a quick session drops what you&apos;re already ahead on.
                </p>
              </div>
            </>
          )}

          {/* ── Save ──────────────────────────────────────────────── */}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="w-full rounded-xl py-3.5 text-sm font-bold transition hover:opacity-90 active:scale-95 disabled:opacity-50"
            style={{ background: "var(--color-brand)", color: "var(--brand-foreground)" }}
          >
            {saving ? "Saving…" : "Save Readiness"}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
