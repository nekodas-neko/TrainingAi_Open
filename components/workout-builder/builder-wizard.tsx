'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Wand2 } from 'lucide-react'
import { cn } from '@trainingai/shared/utils'
import type { BuilderInputs, GeneratedProgram } from '@trainingai/shared/types/builder'
import BuilderReview from './builder-review'
import { MuscleHeatmap } from '@/components/muscle-heatmap'
import { WeightDial } from '@/components/ui/weight-dial'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { GoalSpectrum } from './goal-spectrum'

const HOME_EQUIPMENT = ['dumbbell', 'barbell', 'cable', 'kettlebell']

const EQUIPMENT_OPTIONS = [
  { id: 'dumbbell',   label: 'Dumbbells',  group: 'home' },
  { id: 'barbell',    label: 'Barbell',    group: 'home' },
  { id: 'cable',      label: 'Cables',     group: 'home' },
  { id: 'kettlebell', label: 'Kettlebell', group: 'home' },
  { id: 'full_gym',   label: 'Full Gym',   group: 'gym' },
]

const MUSCLE_GROUPS = [
  'Chest', 'Lats', 'Upper Back', 'Lower Back', 'Traps',
  'Shoulders', 'Biceps', 'Triceps', 'Forearms',
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core',
]

const PHASE_STRUCTURES = [
  { name: 'Baselining',              description: '8 weeks to re-establish your 1RMs after time off',                            recommendedWeeks: 8  },
  { name: 'Phase-Based Progression', description: '4 weeks accumulation → 3 weeks strength → 2 weeks peak → 1 week deload',     recommendedWeeks: 11 },
]

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function defaultRestAfterN(n: number): number {
  if (n <= 2) return n
  return 3
}

function defaultWeeklyDays(n: number): number[] {
  // Spread n days evenly across Mon–Sun (0=Mon … 6=Sun)
  const spread: Record<number, number[]> = {
    1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4],
    5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6],
  }
  return spread[n] ?? [0]
}

function buildRotationExample(restAfterN: number, totalSessions: number): string {
  const parts: string[] = []
  let sessionIdx = 1
  let consecutive = 0
  let restCount = 0
  while (restCount < 2 && parts.length < 18) {
    parts.push(`S${sessionIdx}`)
    consecutive++
    sessionIdx = (sessionIdx % totalSessions) + 1
    if (consecutive >= restAfterN) {
      parts.push('REST')
      consecutive = 0
      restCount++
    }
  }
  return parts.join(' → ') + ' → …'
}

const INITIAL_INPUTS: BuilderInputs = {
  programName: '',
  equipment: [],
  sessionsPerWeek: 3,
  timePerSessionMinutes: 60,
  musclesToFocus: [],
  goal: 'hypertrophy',
  progressionMode: 'ai',
  phaseStructureName: 'AI Dynamic',
  totalWeeks: 12,
  scheduleType: 'rotation',
  rotationRestAfterN: 3,
  weeklyDays: [0, 2, 4],
}

function toggle<T>(arr: T[], val: T): T[] {
  return arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val]
}


export default function BuilderWizard({ onClose, onSaved, registerCloseGuard }: { onClose: () => void; onSaved: () => void; registerCloseGuard?: (guard: () => void) => void }) {
  const [step, setStep] = useState(1)
  const [inputs, setInputs] = useState<BuilderInputs>(INITIAL_INPUTS)
  const [generating, setGenerating] = useState(false)
  const [program, setProgram] = useState<GeneratedProgram | null>(null)
  const [confirmExit, setConfirmExit] = useState(false)

  // Dismissing the sheet (back / outside tap / X) routes here — confirm before throwing away
  // a generated program; otherwise just close.
  useEffect(() => {
    registerCloseGuard?.(() => {
      if (program != null) setConfirmExit(true)
      else onClose()
    })
  }, [program, registerCloseGuard, onClose])

  // Step 7: Progression Mode
  // Step 8: Phase Structure (skipped when progressionMode === 'linear')
  // Step 9: Program Length
  // Step 10: Schedule (last step before generation)
  const totalSteps = 10

  // AI Dynamic picks each day's session and rest days itself, so the fixed schedule (step 10)
  // is overridden and pointless to ask — AI generates straight after the progression-mode step.
  const lastQuestionStep = inputs.progressionMode === 'ai' ? 7 : totalSteps
  const displayTotal = inputs.progressionMode === 'ai' ? 7 : totalSteps

  function canAdvance(): boolean {
    switch (step) {
      case 1: return inputs.programName.trim().length > 0
      case 2: return inputs.equipment.length > 0
      case 3: return inputs.sessionsPerWeek >= 1
      case 4: return true
      case 5: return inputs.musclesToFocus.length > 0
      case 6: return true  // Goal
      case 7: return true  // Progression Mode
      case 8: return true  // Phase Structure
      case 9: return inputs.totalWeeks >= 4  // Program Length
      case 10: return inputs.scheduleType === 'rotation'
          ? inputs.rotationRestAfterN >= 1
          : inputs.weeklyDays.length === inputs.sessionsPerWeek
      default: return true
    }
  }

  function handleSessionsChange(n: number) {
    setInputs(i => ({
      ...i,
      sessionsPerWeek: n,
      rotationRestAfterN: defaultRestAfterN(n),
      weeklyDays: defaultWeeklyDays(n),
    }))
  }

  function handleEquipmentClick(id: string) {
    if (id === 'full_gym') {
      // Full Gym is a standalone toggle — clears individual selections when picked
      setInputs(i => {
        const hasFullGym = i.equipment.includes('full_gym')
        return { ...i, equipment: hasFullGym ? [] : ['full_gym'] }
      })
    } else {
      // Individual home-gym equipment — clears Full Gym if it was selected
      setInputs(i => {
        const base = i.equipment.filter(e => e !== 'full_gym')
        return { ...i, equipment: toggle(base, id) }
      })
    }
  }

  async function handleGenerate() {
    setGenerating(true)
    try {
      const res = await fetch('/api/generate-program', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputs),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Generation failed'); return }
      setProgram(data.program)
      setStep(10)
    } catch {
      toast.error('Failed to generate program. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  function handleNext() {
    if (step === lastQuestionStep) { handleGenerate(); return }
    let next = step + 1
    if (next === 8 && (inputs.progressionMode === 'linear' || inputs.progressionMode === 'ai')) next = 9
    if (next === 9 && inputs.progressionMode === 'ai') next = 10
    setStep(next)
  }

  function handleBack() {
    if (step === 1) { onClose(); return }
    let prev = step - 1
    if (prev === 8 && (inputs.progressionMode === 'linear' || inputs.progressionMode === 'ai')) prev = 7
    if (prev === 9 && inputs.progressionMode === 'ai') prev = 7
    setStep(prev)
  }

  const confirmOverlay = (
    <ConfirmDialog
      open={confirmExit}
      onOpenChange={setConfirmExit}
      title="Discard this program?"
      message="Your generated program and any changes will be lost."
      confirmLabel="Discard"
      cancelLabel="Keep editing"
      onConfirm={() => { setConfirmExit(false); onClose() }}
    />
  )

  if (step === 10 && program) {
    return (
      <>
        <BuilderReview
          program={program}
          inputs={inputs}
          onBack={() => { setProgram(null); setStep(lastQuestionStep) }}
          onSaved={onSaved}
          onProgramChange={setProgram}
        />
        {confirmOverlay}
      </>
    )
  }

  return (
    <>
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <button onClick={handleBack} aria-label="Go back" className="p-2 -ml-2 text-muted-foreground">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <p className="text-xs text-muted-foreground">Step {step} of {displayTotal}</p>
        <div className="w-9" />
      </div>

      {/* Progress bar */}
      <div className="px-4 mb-4">
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-brand rounded-full transition-all duration-300"
            style={{ width: `${(step / displayTotal) * 100}%` }}
          />
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">

        {/* Step 1: Program Name */}
        {step === 1 && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold">Name your program</h2>
            <input
              type="text"
              value={inputs.programName}
              onChange={e => setInputs(i => ({ ...i, programName: e.target.value }))}
              placeholder="e.g. Push-Pull-Legs"
              className="w-full rounded-xl bg-muted px-4 py-3 text-sm outline-none focus:ring-2 ring-brand"
              maxLength={100}
              autoFocus
            />
          </div>
        )}

        {/* Step 2: Equipment */}
        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold">What equipment do you have?</h2>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Home gym</p>
              <div className="grid grid-cols-2 gap-2">
                {EQUIPMENT_OPTIONS.filter(o => o.group === 'home').map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => handleEquipmentClick(opt.id)}
                    className={cn(
                      'rounded-xl border px-4 py-3 text-sm font-semibold text-left transition',
                      inputs.equipment.includes(opt.id) ? 'bg-brand text-brand-foreground border-brand' : 'bg-muted border-transparent'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Commercial gym</p>
              <button
                onClick={() => handleEquipmentClick('full_gym')}
                className={cn(
                  'w-full rounded-xl border px-4 py-3 text-sm font-semibold text-left transition',
                  inputs.equipment.includes('full_gym') ? 'bg-brand text-brand-foreground border-brand' : 'bg-muted border-transparent'
                )}
              >
                Full Gym
                <span className="text-xs font-normal opacity-80 ml-1">— all machines, cables, free weights</span>
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Training Frequency */}
        {step === 3 && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold">How many days per week?</h2>
            <p className="text-sm text-muted-foreground">Scroll to select</p>
            <div className="flex flex-col items-center gap-2">
              <WeightDial
                value={inputs.sessionsPerWeek}
                onChange={handleSessionsChange}
                min={1}
                max={7}
                step={1}
                unit="days"
                visible={5}
              />
            </div>
          </div>
        )}

        {/* Step 4: Time Budget */}
        {step === 4 && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold">How long per session?</h2>
            <div className="space-y-2">
              {[
                { label: '30 minutes', value: 30 },
                { label: '45 minutes', value: 45 },
                { label: '60 minutes', value: 60 },
                { label: '90 minutes', value: 90 },
                { label: 'No time constraint (max sets per muscle group per week)', value: null },
              ].map(opt => (
                <button
                  key={String(opt.value)}
                  onClick={() => setInputs(i => ({ ...i, timePerSessionMinutes: opt.value }))}
                  className={cn(
                    'w-full rounded-xl border px-4 py-3 text-sm font-semibold text-left transition',
                    inputs.timePerSessionMinutes === opt.value ? 'bg-brand text-brand-foreground border-brand' : 'bg-muted border-transparent'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 5: Muscles */}
        {step === 5 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Which muscles to focus on?</h2>
              <button
                onClick={() => setInputs(i => ({
                  ...i,
                  musclesToFocus: i.musclesToFocus.length === MUSCLE_GROUPS.length ? [] : [...MUSCLE_GROUPS],
                }))}
                className="text-xs text-brand font-semibold"
              >
                {inputs.musclesToFocus.length === MUSCLE_GROUPS.length ? 'Clear all' : 'Select all'}
              </button>
            </div>
            <MuscleHeatmap muscleNames={inputs.musclesToFocus} compact />
            <div className="flex flex-wrap gap-2">
              {MUSCLE_GROUPS.map(muscle => (
                <button
                  key={muscle}
                  onClick={() => setInputs(i => ({ ...i, musclesToFocus: toggle(i.musclesToFocus, muscle) }))}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm font-medium transition',
                    inputs.musclesToFocus.includes(muscle) ? 'bg-brand text-brand-foreground border-brand' : 'bg-muted border-transparent'
                  )}
                >
                  {muscle}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 6: Goal */}
        {step === 6 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-bold">What is your training goal?</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Your goal shapes the intensity range and phase progression.</p>
            </div>

            {/* Spectrum scale */}
            <GoalSpectrum
              value={inputs.goal}
              onChange={(g) => setInputs(i => ({ ...i, goal: g as BuilderInputs['goal'] }))}
            />
          </div>
        )}

        {/* Step 7: Progression Mode */}
        {step === 7 && (
          <div className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-lg font-bold">Progression style</h2>
              <p className="text-sm text-muted-foreground">How should your program load increase over time?</p>
            </div>

            <div className="space-y-3">
              {([
                {
                  value: 'ai' as const,
                  label: 'AI Training',
                  pillLabel: 'AI Training',
                  pillClass: 'bg-brand/20 text-brand border-brand/30',
                  recommended: true,
                  description: 'Runs one complete block — Baseline → Build → Peak → Deload — at a pace driven by your performance. Picks each day’s session and rest days for you. No fixed duration.',
                },
                {
                  value: 'linear' as const,
                  label: 'Linear Progression',
                  pillLabel: 'Linear',
                  pillClass: 'bg-muted-foreground/10 text-muted-foreground border-muted-foreground/20',
                  recommended: false,
                  description: 'Add weight to the bar each session. Simple, effective for beginners and intermediates returning to training. No complex phases.',
                },
                {
                  value: 'phase' as const,
                  label: 'Phase Periodization',
                  pillLabel: 'Phase Based',
                  pillClass: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
                  recommended: false,
                  description: 'Structured blocks (Accumulation → Intensification → Peak). More sophisticated programming for consistent progress over months.',
                },
              ]).map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setInputs(prev => ({
                    ...prev,
                    progressionMode: opt.value,
                    phaseStructureName: opt.value === 'linear' ? 'Linear Progression' : opt.value === 'ai' ? 'AI Dynamic' : (PHASE_STRUCTURES.find(ps => ps.name === prev.phaseStructureName) ? prev.phaseStructureName : PHASE_STRUCTURES[0].name),
                    totalWeeks: (opt.value === 'linear' || opt.value === 'ai') ? 12 : (PHASE_STRUCTURES.find(ps => ps.name === prev.phaseStructureName)?.recommendedWeeks ?? 11),
                  }))}
                  className={cn(
                    'w-full rounded-2xl border p-4 text-left transition active:scale-[0.98]',
                    inputs.progressionMode === opt.value
                      ? 'border-brand bg-brand/10'
                      : 'border-border bg-muted/30'
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{opt.label}</p>
                      <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border', opt.pillClass)}>
                        {opt.pillLabel}
                      </span>
                    </div>
                    {opt.recommended && (
                      <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand text-brand-foreground">
                        Recommended
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{opt.description}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 8: Phase Structure */}
        {step === 8 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-bold">Phase structure</h2>
              <p className="text-sm text-muted-foreground mt-0.5">Choose a periodization model for your phases.</p>
            </div>
            <div className="space-y-2">
              {PHASE_STRUCTURES.map(ps => (
                <button
                  key={ps.name}
                  onClick={() => setInputs(i => ({ ...i, phaseStructureName: ps.name, totalWeeks: ps.recommendedWeeks }))}
                  className={cn(
                    'w-full rounded-xl border px-4 py-3 text-left transition',
                    inputs.phaseStructureName === ps.name ? 'bg-brand/10 border-brand' : 'bg-muted border-transparent'
                  )}
                >
                  <p className="text-sm font-semibold">{ps.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{ps.description}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 9: Program Length */}
        {step === 9 && (() => {
          const selectedPhase = PHASE_STRUCTURES.find(ps => ps.name === inputs.phaseStructureName)
          const recommended = (inputs.progressionMode === 'linear' || inputs.progressionMode === 'ai') ? 12 : (selectedPhase?.recommendedWeeks ?? 11)
          const WEEK_PRESETS = [8, 10, 12, 14, 16, 20]
          return (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-bold">How long should the program run?</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Recommended for {inputs.phaseStructureName}: <span className="text-foreground font-semibold">{recommended} weeks</span>
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {WEEK_PRESETS.map(w => (
                  <button
                    key={w}
                    onClick={() => setInputs(i => ({ ...i, totalWeeks: w }))}
                    className={cn(
                      'rounded-xl border py-3 text-sm font-semibold transition',
                      inputs.totalWeeks === w ? 'bg-brand/10 border-brand text-brand' : 'bg-muted border-transparent text-foreground'
                    )}
                  >
                    {w} weeks
                  </button>
                ))}
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Custom</p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setInputs(i => ({ ...i, totalWeeks: Math.max(4, i.totalWeeks - 1) }))}
                    className="h-11 w-11 rounded-lg bg-muted border border-border flex items-center justify-center text-lg font-bold"
                  >−</button>
                  <div className="flex-1 text-center">
                    <span className="text-2xl font-bold tabular-nums">{inputs.totalWeeks}</span>
                    <span className="text-sm text-muted-foreground ml-1">weeks</span>
                  </div>
                  <button
                    onClick={() => setInputs(i => ({ ...i, totalWeeks: Math.min(52, i.totalWeeks + 1) }))}
                    className="h-11 w-11 rounded-lg bg-muted border border-border flex items-center justify-center text-lg font-bold"
                  >+</button>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Step 10: Schedule */}
        {step === 10 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-bold">How do you schedule sessions?</h2>
              <p className="text-sm text-muted-foreground mt-0.5">This sets your rest day pattern.</p>
            </div>

            <div className="space-y-2">
              <button
                onClick={() => setInputs(i => ({ ...i, scheduleType: 'rotation' }))}
                className={cn(
                  'w-full rounded-xl border px-4 py-3 text-left transition',
                  inputs.scheduleType === 'rotation' ? 'bg-brand/10 border-brand' : 'bg-muted border-transparent'
                )}
              >
                <p className="text-sm font-semibold">Rolling rotation</p>
                <p className="text-xs text-muted-foreground mt-0.5">Rest after every N sessions — rolls across weeks, never tied to Mon/Tue/Wed</p>
              </button>
              <button
                onClick={() => setInputs(i => ({ ...i, scheduleType: 'weekly' }))}
                className={cn(
                  'w-full rounded-xl border px-4 py-3 text-left transition',
                  inputs.scheduleType === 'weekly' ? 'bg-brand/10 border-brand' : 'bg-muted border-transparent'
                )}
              >
                <p className="text-sm font-semibold">Fixed weekly days</p>
                <p className="text-xs text-muted-foreground mt-0.5">Same days every week — e.g. Mon / Wed / Fri</p>
              </button>
            </div>

            {inputs.scheduleType === 'rotation' && (
              <div className="rounded-xl bg-muted p-4 space-y-3">
                <p className="text-sm font-semibold">Rest after how many sessions?</p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setInputs(i => ({ ...i, rotationRestAfterN: Math.max(1, i.rotationRestAfterN - 1) }))}
                    className="h-11 w-11 rounded-lg bg-background border border-border flex items-center justify-center text-lg font-bold"
                  >−</button>
                  <div className="flex-1 text-center">
                    <span className="text-2xl font-bold tabular-nums">{inputs.rotationRestAfterN}</span>
                    <span className="text-sm text-muted-foreground ml-1">session{inputs.rotationRestAfterN !== 1 ? 's' : ''}</span>
                  </div>
                  <button
                    onClick={() => setInputs(i => ({ ...i, rotationRestAfterN: Math.min(i.sessionsPerWeek, i.rotationRestAfterN + 1) }))}
                    className="h-11 w-11 rounded-lg bg-background border border-border flex items-center justify-center text-lg font-bold"
                  >+</button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {buildRotationExample(inputs.rotationRestAfterN, inputs.sessionsPerWeek)
                    .split('REST')
                    .flatMap((seg, i, arr) => i < arr.length - 1
                      ? [seg, <span key={i} className="font-semibold text-foreground">REST</span>]
                      : [seg]
                    )}
                </p>
                {inputs.rotationRestAfterN < inputs.sessionsPerWeek && (
                  <p className="text-xs text-brand">
                    ✓ Rest days spread through the week — no two consecutive rest days
                  </p>
                )}
              </div>
            )}

            {inputs.scheduleType === 'weekly' && (
              <div className="rounded-xl bg-muted p-4 space-y-3">
                <p className="text-sm font-semibold">
                  Pick {inputs.sessionsPerWeek} training day{inputs.sessionsPerWeek !== 1 ? 's' : ''}
                  <span className={cn('ml-2 text-xs font-normal', inputs.weeklyDays.length === inputs.sessionsPerWeek ? 'text-brand' : 'text-muted-foreground')}>
                    {inputs.weeklyDays.length}/{inputs.sessionsPerWeek} selected
                  </span>
                </p>
                <div className="grid grid-cols-7 gap-1.5">
                  {DAY_LABELS.map((label, idx) => (
                    <button
                      key={idx}
                      onClick={() => setInputs(i => {
                        const has = i.weeklyDays.includes(idx)
                        if (has) return { ...i, weeklyDays: i.weeklyDays.filter(d => d !== idx) }
                        if (i.weeklyDays.length >= i.sessionsPerWeek) return i
                        return { ...i, weeklyDays: [...i.weeklyDays, idx].sort((a, b) => a - b) }
                      })}
                      className={cn(
                        'rounded-lg py-2 text-xs font-semibold transition',
                        inputs.weeklyDays.includes(idx) ? 'bg-brand text-brand-foreground' : 'bg-background border border-border text-muted-foreground'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {inputs.weeklyDays.length === inputs.sessionsPerWeek && (() => {
                  const sorted = [...inputs.weeklyDays].sort((a, b) => a - b)
                  const hasConsecutiveRest = sorted.some((d, i) => i > 0 && d - sorted[i - 1] === 1 && !(sorted.includes(d - 1)))
                  return !hasConsecutiveRest ? (
                    <p className="text-xs text-brand">✓ Good spread — no back-to-back rest days</p>
                  ) : null
                })()}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 pt-3 pb-safe-action border-t border-border/40">
        <button
          onClick={handleNext}
          disabled={!canAdvance() || generating}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold bg-brand text-brand-foreground disabled:opacity-50 transition"
        >
          {generating ? (
            <>
              <span className="animate-spin inline-block">⏳</span>
              Generating…
            </>
          ) : step === lastQuestionStep ? (
            <>
              <Wand2 className="h-4 w-4" />
              Generate Program
            </>
          ) : (
            <>
              Next
              <ChevronRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </div>
    {confirmOverlay}
    </>
  )
}
