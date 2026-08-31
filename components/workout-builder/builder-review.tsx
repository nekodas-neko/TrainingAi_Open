'use client'

import { useState, useEffect, useMemo } from 'react'
import Image from 'next/image'
import { toast } from 'sonner'
import { ChevronLeft, ChevronDown, ChevronUp, Send, Loader2, CheckCircle2, Plus, Dumbbell, TriangleAlert } from 'lucide-react'
import { cn } from '@trainingai/shared/utils'
import { invalidateProgramStructure } from '@/lib/cache-groups'
import type { GeneratedProgram, GeneratedExercise, BuilderInputs, ChatMessage } from '@trainingai/shared/types/builder'
import type { ExerciseLibraryEntry } from '@trainingai/shared/types/program'
import { AddExerciseSheet } from '@/components/exercises/add-exercise-sheet'
import { WeeklyMuscleSetsCard } from '@/components/health/weekly-muscle-sets-card'
import { goalRange, formatGoalRange } from '@trainingai/shared/ai-periodization/goal-ranges'
import { Switch } from '@/components/ui/switch'
import { useScrollToBottom } from '@/lib/hooks/use-scroll-to-bottom'
import { useExerciseMedia } from '@/lib/hooks/use-exercise-media'
import type { MuscleSetsEntry } from '@/app/api/weekly-muscle-sets/route'

interface Props {
  program: GeneratedProgram
  inputs: BuilderInputs
  onBack: () => void
  onSaved: () => void
  onProgramChange: (p: GeneratedProgram) => void
}

const ROLE_BADGE: Record<string, string> = {
  primary:   'bg-brand/20 text-brand',
  secondary: 'bg-amber-500/20 text-amber-400',
  accessory: 'bg-zinc-500/20 text-zinc-400',
}

const ROLE_LABEL: Record<string, string> = {
  primary:   'Main',
  secondary: 'Compound',
  accessory: 'Accessory',
}

const STYLE_DISPLAY: Record<string, string> = {
  'Hypertrophy':        '4 × 10 @ 65% · 60s rest',
  'Hypertrophy 3-set':  '3 × 10 @ 65% · 60s rest',
  'Hypertrophy Plus':   '4 × 8 @ 70% · 75s rest',
  'Strength':           '5 × 5 @ 80% · 120s rest',
  'Strength 3-set':     '3 × 5 @ 80% · 120s rest',
  'Strength 4-set':     '4 × 5 @ 80% · 120s rest',
  'Strength Plus':      '4 × 3 @ 87% · 180s rest',
  'Peak':               '3 × 3 @ 90% · 180s rest',
  'Peak 4-set':         '4 × 3 @ 90% · 180s rest',
  'General':            '3 × 12 @ 60% · 60s rest',
  'General 4-set':      '4 × 12 @ 60% · 60s rest',
  'Powerbuilding':      '4 × 6 @ 80% · 120s rest',
  'Heavy Strength':     '5 × 5 @ 85% · 180s rest',
  'Max Strength':       '3 × 3 @ 92% · 240s rest',
}

function setsFromStyleName(styleName?: string): number {
  if (!styleName) return 3
  const display = STYLE_DISPLAY[styleName]
  if (!display) return 3
  const match = display.match(/^(\d+)\s*×/)
  return match ? parseInt(match[1]) : 3
}

function projectMuscleSets(program: GeneratedProgram): MuscleSetsEntry[] {
  const tally: Record<string, number> = {}
  for (const session of program.sessions) {
    for (const ex of session.exercises) {
      const sets = setsFromStyleName(ex.progressionStyleName)
      for (const m of ex.mainMuscles) {
        const key = m.toLowerCase()
        tally[key] = (tally[key] ?? 0) + sets
      }
      for (const m of ex.secondaryMuscles) {
        const key = m.toLowerCase()
        tally[key] = (tally[key] ?? 0) + sets * 0.5
      }
    }
  }
  return Object.entries(tally)
    .map(([muscle, sets]) => ({ muscle, sets: Math.round(sets * 2) / 2 }))
    .sort((a, b) => b.sets - a.sets)
}

function phaseStyleShort(styleName?: string): string {
  if (!styleName) return ''
  const full = STYLE_DISPLAY[styleName]
  if (!full) return styleName
  return full.split(' · ')[0]
}

export default function BuilderReview({ program, inputs, onBack, onSaved, onProgramChange }: Props) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: inputs.progressionMode === 'ai'
        ? `Your AI Training program is ready! Here's how the block runs:\n\n` +
          `Phase 1 — Baseline\n` +
          `Week 1 uses AMRAP sets on your key lifts to find your true starting 1RM. All working weights are set from this — no guessing.\n\n` +
          `Phase 2 — Build\n` +
          `Load and volume increase session by session. Beat your targets consistently and the AI accelerates; fall short and it backs off and gives you more time in this phase.\n\n` +
          `Phase 3 — Peak\n` +
          `Once enough build cycles are done, the AI shifts to heavier lower-volume work to convert accumulated volume into strength and performance.\n\n` +
          `Phase 4 — Deload\n` +
          `Accumulated fatigue is tracked across sessions. When recovery is needed the AI auto-inserts a lighter week — then the block is complete.\n\n` +
          `Rest & recovery\n` +
          `The AI monitors session-to-session load and fatigue. If you're carrying too much load into the next session it will recommend a rest day or swap to a lighter muscle group to protect recovery.\n\n` +
          `No fixed duration — the AI decides when each phase is done based on your data. Typical range: 8–14 weeks.\n\n` +
          `Use the dropdowns below to swap any exercise, or ask me to make changes.`
        : `Your program is ready! ${program.reasoning} Use the dropdowns to swap any exercise, or chat with me below to make changes.`,
    },
  ])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [exerciseLibrary, setExerciseLibrary] = useState<ExerciseLibraryEntry[]>([])
  const [swapOpen, setSwapOpen] = useState<string | null>(null)
  const [addExSheetOpen, setAddExSheetOpen] = useState(false)
  const [addExSheetName, setAddExSheetName] = useState('')
  const [addExSheetTarget, setAddExSheetTarget] = useState<{ si: number; ei: number } | null>(null)
  const [oneRmInputs, setOneRmInputs] = useState<Record<string, string>>({})
  const [oneRmOpen, setOneRmOpen] = useState(false)
  const [includeBaseline, setIncludeBaseline] = useState(false)
  const [autoApplyPrescriptions, setAutoApplyPrescriptions] = useState(false)
  const [phaseCycles, setPhaseCycles] = useState<Record<number, number>>(() => {
    const phases = program.phases ?? []
    if (!phases.length) return {}
    const originalTotal = phases.reduce((sum, p) => sum + p.durationCycles, 0)
    const targetTotal = inputs.totalWeeks
    if (originalTotal === 0 || originalTotal === targetTotal) {
      return Object.fromEntries(phases.map((p, i) => [i, p.durationCycles]))
    }
    const scaled = phases.map(p => Math.max(1, Math.round(p.durationCycles * targetTotal / originalTotal)))
    const scaledTotal = scaled.reduce((a, b) => a + b, 0)
    const diff = targetTotal - scaledTotal
    if (diff !== 0) {
      const maxIdx = scaled.reduce((best, v, i) => v > scaled[best] ? i : best, 0)
      scaled[maxIdx] = Math.max(1, scaled[maxIdx] + diff)
    }
    return Object.fromEntries(phases.map((_, i) => [i, scaled[i]]))
  })
  const chatScrollRef = useScrollToBottom<HTMLDivElement>(chatMessages)
  const [failedSrcs, setFailedSrcs] = useState<Set<string>>(new Set())

  const exerciseNames = useMemo(
    () => [...new Set(program.sessions.flatMap(s => s.exercises.map(e => e.name)))],
    [program]
  )
  const { media: exerciseMedia } = useExerciseMedia(exerciseNames)

  // A name that resolves to a different clip deserves a fresh chance at rendering it; the failed
  // set is keyed by src, so clearing it when the roster changes is what un-hides a replaced URL.
  const exerciseNamesKey = exerciseNames.join('\n')
  useEffect(() => { setFailedSrcs(new Set()) }, [exerciseNamesKey])

  useEffect(() => {
    fetch('/api/exercise-library', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.exercises) setExerciseLibrary(data.exercises) })
  }, [])

  // Give every exercise a stable client id so reorder/swap key on identity, not array
  // index — otherwise deleting or moving a row leaks the row-below's transient state
  // (CLAUDE.md: editable lists get a stable client id at creation, never key={index}).
  // The AI generation and chat responses arrive without one; mint any missing ones here.
  useEffect(() => {
    const missing = program.sessions.some(s => s.exercises.some(e => !e.clientId))
    if (!missing) return
    onProgramChange({
      ...program,
      sessions: program.sessions.map(s => ({
        ...s,
        exercises: s.exercises.map(e => (e.clientId ? e : { ...e, clientId: crypto.randomUUID() })),
      })),
    })
  }, [program, onProgramChange])

  function buildEquipmentSet(selected: string[]): Set<string> {
    const set = new Set<string>(['bodyweight'])
    if (selected.includes('full_gym')) {
      ;['barbell', 'dumbbell', 'cable', 'kettlebell', 'machine', 'bodyweight'].forEach(e => set.add(e))
    } else {
      selected.forEach(e => set.add(e))
    }
    return set
  }

  function getAlternatives(exercise: GeneratedExercise): ExerciseLibraryEntry[] {
    const equipmentSet = buildEquipmentSet(inputs.equipment)
    const mainMuscles = new Set(exercise.mainMuscles.map(m => m.toLowerCase()))
    // A primary (main) slot should hold a compound movement — don't offer single-muscle
    // isolations (e.g. curls, pushdowns) as alternatives for it.
    const isPrimarySlot = exercise.exerciseRole === 'primary'
    return exerciseLibrary
      .filter(ex => {
        if (ex.name === exercise.name) return false
        if (ex.mergedInto) return false
        if (isPrimarySlot && ex.muscles.length <= 1) return false
        const hasEquip = ex.equipment.length === 0 || ex.equipment.some(e => equipmentSet.has(e.toLowerCase()))
        const sharesMain = ex.muscles.some(m => m.role === 'main' && mainMuscles.has(m.muscle.toLowerCase()))
        return hasEquip && sharesMain
      })
      .slice(0, 8)
  }

  function swapExercise(sessionIdx: number, exerciseIdx: number, newExercise: ExerciseLibraryEntry) {
    const updated: GeneratedProgram = {
      ...program,
      sessions: program.sessions.map((session, si) =>
        si !== sessionIdx ? session : {
          ...session,
          exercises: session.exercises.map((ex, ei) =>
            ei !== exerciseIdx ? ex : {
              name: newExercise.name,
              exerciseRole: ex.exerciseRole,
              progressionStyleName: ex.progressionStyleName,
              progressionStyleId: ex.progressionStyleId,
              clientId: ex.clientId,
              mainMuscles: newExercise.muscles.filter(m => m.role === 'main').map(m => m.muscle),
              secondaryMuscles: newExercise.muscles.filter(m => m.role === 'secondary').map(m => m.muscle),
            }
          ),
        }
      ),
    }
    onProgramChange(updated)
    setSwapOpen(null)
  }

  // Reorder an exercise within its session (positions are saved from array order), so the
  // user can e.g. warm up on a secondary/accessory before the main lift. Roles stay attached
  // to each exercise — only the order changes.
  function moveExercise(sessionIdx: number, exerciseIdx: number, dir: -1 | 1) {
    const session = program.sessions[sessionIdx]
    const target = exerciseIdx + dir
    if (!session || target < 0 || target >= session.exercises.length) return
    const exercises = [...session.exercises]
    ;[exercises[exerciseIdx], exercises[target]] = [exercises[target], exercises[exerciseIdx]]
    onProgramChange({
      ...program,
      sessions: program.sessions.map((s, si) => si === sessionIdx ? { ...s, exercises } : s),
    })
    setSwapOpen(null)
  }

  const compoundExercises: string[] = Array.from(
    new Set(
      program.sessions.flatMap(s =>
        s.exercises
          .filter(ex => ex.exerciseRole === 'primary' || ex.exerciseRole === 'secondary')
          .map(ex => ex.name)
      )
    )
  )

  async function handleChat() {
    const msg = chatInput.trim()
    if (!msg || chatLoading) return
    setChatInput('')
    const userMsg: ChatMessage = { role: 'user', content: msg }
    setChatMessages(prev => [...prev, userMsg])
    setChatLoading(true)
    try {
      const res = await fetch('/api/builder-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          program,
          chatHistory: chatMessages,
          equipment: inputs.equipment,
          goal: inputs.goal,
          timePerSessionMinutes: inputs.timePerSessionMinutes,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Chat failed'); return }
      onProgramChange(data.program)
      setChatMessages(prev => [...prev, { role: 'assistant', content: data.response }])
    } catch {
      toast.error('Chat request failed. Please try again.')
    } finally {
      setChatLoading(false)
    }
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      const programSessions = program.sessions.map((session, si) => {
        const sid = crypto.randomUUID()
        return {
          id: sid,
          name: session.name,
          position: si,
          icon: session.icon,
          exercises: session.exercises.map((ex, ei) => ({
            id: crypto.randomUUID(),
            sessionId: sid,
            exerciseName: ex.name,
            muscleGroups: [...(ex.mainMuscles ?? []), ...(ex.secondaryMuscles ?? [])],
            position: ei,
            exerciseRole: ex.exerciseRole,
            styleId: ex.progressionStyleId,
          })),
        }
      })

      const schedule = inputs.scheduleType === 'rotation'
        ? { type: 'rotation' as const, restAfterN: inputs.rotationRestAfterN }
        : {
            type: 'weekly' as const,
            days: inputs.weeklyDays.map((dayOfWeek, i) => ({
              dayOfWeek,
              sessionId: programSessions[i % programSessions.length]?.id,
            })),
          }

      // If any phase cycles were edited, clone the phase set before saving.
      // The clone is "owned" by this program — linked via linkPhaseSetOwnership
      // below once the program has an id, and renamed/deleted alongside it.
      let finalPhaseSetId: string | null = (inputs.progressionMode === 'linear' || inputs.progressionMode === 'ai') ? null : program.phaseSetId
      let didCloneOwnedPhaseSet = false
      if (inputs.progressionMode !== 'linear' && inputs.progressionMode !== 'ai' && program.phaseSetId && program.phases?.length) {
        const anyChanged = program.phases.some((p, i) => phaseCycles[i] !== p.durationCycles)
        if (anyChanged || includeBaseline) {
          const overrides: Record<number, number> = {}
          program.phases.forEach((_, i) => { overrides[i] = phaseCycles[i] ?? program.phases[i].durationCycles })
          const cloneRes = await fetch('/api/phase-sets/clone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phaseSetId: program.phaseSetId, overrides, includeBaseline, programName: program.name }),
          })
          if (cloneRes.ok) {
            const cloned = await cloneRes.json()
            finalPhaseSetId = cloned.id
            didCloneOwnedPhaseSet = true
          } else {
            toast.error('Failed to apply phase customisation — please try again.')
            setSaving(false)
            return
          }
        }
      }

      const res = await fetch('/api/workout-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          program: {
            userId: '',
            name: program.name,
            isActive: true,
            sessions: programSessions,
            schedule,
            createdAt: new Date(),
            updatedAt: new Date(),
            phaseMode: inputs.progressionMode === 'linear' ? 'manual' : inputs.progressionMode === 'ai' ? 'ai_dynamic' : 'automatic',
            phaseSetId: finalPhaseSetId,
            sessionsPerCycle: programSessions.length,
            totalWeeks: inputs.totalWeeks,
            // Persist the chosen goal so the AI engine prescribes from the matching
            // intensity zones (blends included) instead of defaulting to strength.
            trainingGoal: inputs.goal,
            autoApplyPrescriptions: inputs.progressionMode === 'ai' ? autoApplyPrescriptions : false,
          },
          linkPhaseSetOwnership: didCloneOwnedPhaseSet,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? 'Failed to save program')
        return
      }
      await invalidateProgramStructure().catch(() => {})
      toast.success('Program saved and activated!')

      const seedEntries = Object.entries(oneRmInputs)
        .filter(([, v]) => v.trim() && Number(v) > 0)
        .map(([exerciseName, v]) => ({ exerciseName, estimated1rm: Number(v) }))

      if (seedEntries.length > 0) {
        await fetch('/api/exercise-estimates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entries: seedEntries }),
        }).catch(() => {})
      }

      onSaved()
    } catch (err) {
      console.error('[handleSave]', err)
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error(`Failed to save program: ${msg}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-border/40">
        <button onClick={onBack} aria-label="Go back" className="p-2 -ml-2 text-muted-foreground">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm truncate">{program.name}</p>
          <p className="text-xs text-muted-foreground">{program.sessions.length} sessions · {program.phaseStructureName}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Baseline toggle — only for phase-mode programs */}
        {(program.phases?.length ?? 0) > 0 && (
          <div className="px-4 pt-3">
            <div
              className="rounded-xl border p-3 flex items-center gap-3"
              style={{ borderColor: includeBaseline ? 'var(--color-brand)' : undefined }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Add baseline test week</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Week 1 is an AMRAP session per exercise — sets your starting weights automatically.
                </p>
              </div>
              <Switch checked={includeBaseline} onCheckedChange={setIncludeBaseline} />
            </div>
          </div>
        )}

        {/* Auto-apply prescriptions toggle — AI Dynamic only */}
        {inputs.progressionMode === 'ai' && (
          <div className="px-4 pt-3">
            <div
              className="rounded-xl border p-3 flex items-center gap-3"
              style={{ borderColor: autoApplyPrescriptions ? 'var(--color-brand)' : undefined }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Auto-apply AI changes</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  On: AI adjusts load and volume automatically. Off: shows a card for your approval first.
                </p>
              </div>
              <Switch checked={autoApplyPrescriptions} onCheckedChange={setAutoApplyPrescriptions} />
            </div>
          </div>
        )}

        {/* Phase Progression */}
        {(program.phases?.length ?? 0) > 0 && (() => {
          const totalCycles = Object.values(phaseCycles).reduce((a, b) => a + b, 0)
          return (
            <div className="px-4 pt-3 pb-1 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Phase Progression</p>
                <p className="text-xs text-muted-foreground">Total: <span className="font-semibold text-foreground">{totalCycles} cycles</span></p>
              </div>
              <div className="rounded-xl bg-muted p-3 space-y-2">
                {includeBaseline && (
                  <div className="flex items-center gap-2 opacity-70">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">Baseline</p>
                      <p className="text-xs text-muted-foreground">AMRAP test · added at save</p>
                    </div>
                    <span className="text-xs text-muted-foreground flex-none">1 cycle</span>
                  </div>
                )}
                {program.phases.map((phase, i) => {
                  const cycles = phaseCycles[i] ?? phase.durationCycles
                  const styleLabel =
                    phase.phaseType === 'testing' ? 'Test day'
                    : phase.phaseType === 'deload' ? 'Recovery'
                    : phaseStyleShort(phase.primaryStyleName)
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{phase.name}</p>
                        {styleLabel && <p className="text-xs text-muted-foreground">{styleLabel}</p>}
                      </div>
                      <div className="flex items-center gap-1 flex-none">
                        <button
                          onClick={() => setPhaseCycles(prev => ({ ...prev, [i]: Math.max(1, (prev[i] ?? phase.durationCycles) - 1) }))}
                          className="w-7 h-7 rounded-lg bg-background border border-border flex items-center justify-center text-sm font-bold"
                        >−</button>
                        <span className="w-12 text-center text-sm font-bold tabular-nums">{cycles} {cycles === 1 ? 'cycle' : 'cycles'}</span>
                        <button
                          onClick={() => setPhaseCycles(prev => ({ ...prev, [i]: (prev[i] ?? phase.durationCycles) + 1 }))}
                          className="w-7 h-7 rounded-lg bg-background border border-border flex items-center justify-center text-sm font-bold"
                        >+</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}

        {/* Sessions */}
        <div className="px-4 py-3 space-y-4">
          {program.sessions.map((session, si) => (
            <div key={si} className="rounded-xl bg-muted p-3 space-y-2">
              <p className="font-bold text-sm">{session.icon} {session.name}</p>
              {session.exercises.map((ex, ei) => {
                const swapKey = `${si}-${ei}`
                const alts = getAlternatives(ex)
                return (
                  <div key={ex.clientId ?? ei}>
                    <div className="flex items-center justify-between gap-2">
                      {(() => {
                        const media = exerciseMedia[ex.name]
                        const src = media?.gifUrl ?? media?.imageUrl ?? null
                        const usableSrc = src && !failedSrcs.has(src) ? src : null
                        return usableSrc ? (
                          <div className="relative h-11 w-11 flex-none rounded-lg overflow-hidden" style={{ background: '#fff' }}>
                            <Image
                              src={usableSrc}
                              alt=""
                              fill
                              sizes="44px"
                              unoptimized={usableSrc.endsWith('.gif')}
                              className="object-cover"
                              onError={() => setFailedSrcs(prev => new Set([...prev, usableSrc]))}
                            />
                          </div>
                        ) : (
                          <div className="h-11 w-11 flex-none rounded-lg bg-muted flex items-center justify-center">
                            <Dumbbell className="w-4 h-4 text-muted-foreground" />
                          </div>
                        )
                      })()}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{ex.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={cn('text-[10px] font-semibold rounded-full px-2 py-0.5', ROLE_BADGE[ex.exerciseRole] ?? ROLE_BADGE.primary)}>
                            {ROLE_LABEL[ex.exerciseRole] ?? ex.exerciseRole}
                          </span>
                          {ex.exerciseRole === 'primary' && (ex.mainMuscles.length + ex.secondaryMuscles.length) <= 1 && (
                            <span className="flex items-center gap-0.5 text-[10px] font-semibold text-amber-500"><TriangleAlert className="w-2.5 h-2.5" /> isolation</span>
                          )}
                          <span className="text-[10px] text-muted-foreground">
                            {ex.mainMuscles.join(', ')}
                            {ex.secondaryMuscles.length > 0 && (
                              <span className="opacity-60"> · {ex.secondaryMuscles.join(', ')}</span>
                            )}
                          </span>
                        </div>
                        {inputs.progressionMode === 'ai' ? (
                          <p className="text-[10px] text-brand/70 mt-0.5 tabular-nums">
                            {formatGoalRange(goalRange(inputs.goal, ex.exerciseRole))} · AI sets each phase
                          </p>
                        ) : ex.progressionStyleName && STYLE_DISPLAY[ex.progressionStyleName] ? (
                          <p className="text-[10px] text-muted-foreground/70 mt-0.5 tabular-nums">
                            {STYLE_DISPLAY[ex.progressionStyleName]}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex flex-col -space-y-1">
                          <button
                            type="button"
                            disabled={ei === 0}
                            onClick={() => moveExercise(si, ei, -1)}
                            aria-label="Move up"
                            className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-20"
                          >
                            <ChevronUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            disabled={ei === session.exercises.length - 1}
                            onClick={() => moveExercise(si, ei, 1)}
                            aria-label="Move down"
                            className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-20"
                          >
                            <ChevronDown className="h-4 w-4" />
                          </button>
                        </div>
                        {alts.length > 0 && (
                          <button
                            onClick={() => setSwapOpen(swapOpen === swapKey ? null : swapKey)}
                            aria-expanded={swapOpen === swapKey}
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground py-1"
                          >
                            Swap <ChevronDown className={cn('h-3 w-3 transition-transform', swapOpen === swapKey && 'rotate-180')} />
                          </button>
                        )}
                        <button
                          onClick={() => { setAddExSheetName(ex.name); setAddExSheetTarget({ si, ei }); setAddExSheetOpen(true) }}
                          className="flex items-center gap-0.5 text-xs text-brand py-1"
                        >
                          <Plus className="h-3 w-3" /> Add
                        </button>
                      </div>
                    </div>
                    {swapOpen === swapKey && (
                      <div className="mt-1 rounded-lg bg-background border border-border/40 overflow-hidden">
                        {alts.map(alt => (
                          <button
                            key={alt.id}
                            onClick={() => swapExercise(si, ei, alt)}
                            className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted transition border-b border-border/20 last:border-0"
                          >
                            <span className="font-medium">{alt.name}</span>
                            <span className="text-muted-foreground ml-2">
                              {alt.muscles.filter(m => m.role === 'main').map(m => m.muscle).join(', ')}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Projected weekly volume */}
        <div className="px-4 pb-3">
          <WeeklyMuscleSetsCard
            muscles={projectMuscleSets(program)}
            loading={false}
            title="Projected Weekly Volume"
          />
        </div>

        {/* Chat */}
        <div className="px-4 pb-3 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Chat with AI</p>
          <div ref={chatScrollRef} className="rounded-xl bg-muted p-3 space-y-2 max-h-48 overflow-y-auto">
            {chatMessages.map((msg, i) => (
              <div key={i} className={cn('text-xs', msg.role === 'user' ? 'text-right' : '')}>
                <span className={cn(
                  'inline-block px-2.5 py-1.5 rounded-xl whitespace-pre-line',
                  msg.role === 'user' ? 'bg-brand text-brand-foreground' : 'bg-background text-foreground'
                )}>
                  {msg.content}
                </span>
              </div>
            ))}
            {chatLoading && (
              <div className="text-xs">
                <span className="inline-block px-2.5 py-1.5 rounded-xl bg-background">
                  <Loader2 className="h-3 w-3 animate-spin inline" />
                </span>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleChat()}
              placeholder="Ask me to change an exercise, adjust volume…"
              className="flex-1 rounded-xl bg-muted px-3 py-2 text-xs outline-none focus:ring-2 ring-brand"
              disabled={chatLoading}
            />
            <button
              onClick={handleChat}
              aria-label="Send message"
              disabled={!chatInput.trim() || chatLoading}
              className="rounded-xl px-3 py-2 bg-brand text-brand-foreground disabled:opacity-50 transition"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Starting weights (optional) */}
        <div className="px-4 pb-3">
          <button
            type="button"
            onClick={() => setOneRmOpen(v => !v)}
            aria-expanded={oneRmOpen}
            className="w-full flex items-center justify-between rounded-xl bg-muted/40 px-4 py-3 text-left"
          >
            <div>
              <p className="text-sm font-semibold">Starting weights (optional)</p>
              <p className="text-xs text-muted-foreground">Enter your 1RM for each main lift to pre-seed working weights</p>
            </div>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${oneRmOpen ? 'rotate-180' : ''}`} />
          </button>

          {oneRmOpen && (
            <div className="mt-2 rounded-xl bg-muted/40 divide-y divide-border/30 overflow-hidden">
              {compoundExercises.map(name => (
                <div key={name} className="flex items-center gap-3 px-4 py-2.5">
                  <p className="flex-1 text-sm truncate">{name}</p>
                  <div className="flex items-center gap-1 flex-none">
                    <input
                      type="number"
                      inputMode="decimal"
                      value={oneRmInputs[name] ?? ''}
                      onChange={e => setOneRmInputs(prev => ({ ...prev, [name]: e.target.value }))}
                      placeholder="kg"
                      className="w-20 rounded-lg border bg-background px-2 py-1 text-sm tabular-nums text-right focus:outline-none focus:ring-1 focus:ring-brand"
                    />
                    <span className="text-xs text-muted-foreground w-6">kg</span>
                  </div>
                </div>
              ))}
              <p className="px-4 py-2 text-[10px] text-muted-foreground">
                Leave blank for any lift — it will be estimated from your first session.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Footer — Save button above safe area */}
      <div className="px-4 pt-3 pb-safe-action border-t border-border/40">
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold bg-brand text-brand-foreground disabled:opacity-50 transition"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save Program'}
        </button>
      </div>

      <AddExerciseSheet
        open={addExSheetOpen}
        onOpenChange={setAddExSheetOpen}
        initialName={addExSheetName}
        onAdded={exercise => {
          setExerciseLibrary(prev => [...prev, exercise])
          if (addExSheetTarget) {
            swapExercise(addExSheetTarget.si, addExSheetTarget.ei, exercise)
          }
          setAddExSheetOpen(false)
        }}
      />
    </div>
  )
}
