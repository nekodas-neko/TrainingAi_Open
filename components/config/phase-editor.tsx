"use client"

import { useState } from "react"
import { GripVertical, X, Plus } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@trainingai/shared/utils"
import type { ProgramPhase } from "@trainingai/shared/types/program"

export type EditablePhase = Omit<ProgramPhase, 'id' | 'phaseSetId'> & { localId: string }

let localIdCounter = 0
function nextLocalId() { return `local-${++localIdCounter}` }

export function newPhase(): EditablePhase {
  return {
    localId: nextLocalId(),
    position: 0,
    name: 'New Phase',
    durationCycles: 4,
    phaseType: 'normal',
  }
}

interface PhaseEditorProps {
  phases: EditablePhase[]
  styleOptions: { id: string; name: string }[]
  sessionsPerCycle: number
  sessionNames: string[]
  avgSessionsPerWeek: number
  onChange: (phases: EditablePhase[]) => void
}

const TYPE_LABELS = { normal: 'Normal', peak: 'Peak', deload: 'Deload', testing: 'Testing' } as const

export function PhaseEditor({
  phases, styleOptions, sessionsPerCycle, sessionNames, avgSessionsPerWeek, onChange,
}: PhaseEditorProps) {
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  const accessoryIdx = phases.findIndex(p => p.phaseType === 'accessory')
  const accessoryPhase = accessoryIdx !== -1 ? phases[accessoryIdx] : null
  const mainPhases = phases.filter(p => p.phaseType !== 'accessory')

  const totalCycles = mainPhases.reduce((s, p) => s + p.durationCycles, 0)
  const approxWeeks = avgSessionsPerWeek > 0
    ? Math.round((totalCycles * sessionsPerCycle) / avgSessionsPerWeek)
    : null

  function updateMain(mainIdx: number, patch: Partial<EditablePhase>) {
    const phase = mainPhases[mainIdx]
    const next = phases.map(p => p.localId === phase.localId ? { ...p, ...patch } : p)
    onChange(next.map((p, i) => ({ ...p, position: i })))
  }

  function removeMain(mainIdx: number) {
    const phase = mainPhases[mainIdx]
    const next = phases.filter(p => p.localId !== phase.localId)
    onChange(next.map((p, i) => ({ ...p, position: i })))
  }

  function updateAccessory(patch: Partial<EditablePhase>) {
    if (accessoryIdx === -1) return
    onChange(phases.map((p, i) => i === accessoryIdx ? { ...p, ...patch } : p))
  }

  function add() {
    const phase = newPhase()
    const insertAt = accessoryIdx !== -1 ? accessoryIdx : phases.length
    const next = [
      ...phases.slice(0, insertAt),
      { ...phase, position: insertAt },
      ...phases.slice(insertAt),
    ]
    onChange(next.map((p, i) => ({ ...p, position: i })))
  }

  function handleDrop(overIdx: number) {
    if (dragIdx === null || dragIdx === overIdx) { setDragIdx(null); setDragOverIdx(null); return }
    const next = [...mainPhases]
    const [moved] = next.splice(dragIdx, 1)
    next.splice(overIdx, 0, moved)
    onChange([
      ...next,
      ...(accessoryPhase ? [accessoryPhase] : []),
    ].map((p, i) => ({ ...p, position: i })))
    setDragIdx(null)
    setDragOverIdx(null)
  }

  const cycleLabel = sessionNames.length
    ? `1 cycle = 1 complete ${sessionNames.join(' / ')} rotation`
    : sessionsPerCycle > 0
    ? `1 cycle = ${sessionsPerCycle} session${sessionsPerCycle !== 1 ? 's' : ''}`
    : null

  return (
    <div className="space-y-3">

      {/* ── Accessory work — fixed, at top ── */}
      {accessoryPhase && (
        <div className="rounded-xl border bg-muted/40 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Accessory work</span>
            <span className="text-[10px] text-muted-foreground">same every phase</span>
          </div>
          <select
            value={accessoryPhase.primaryStyleId ?? ''}
            onChange={e => updateAccessory({ primaryStyleId: e.target.value || undefined })}
            className="text-xs border rounded px-2 py-1.5 bg-background w-full"
          >
            <option value="">— select style —</option>
            {styleOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <p className="text-[10px] text-muted-foreground leading-snug">
            Curls, face pulls, laterals etc. use this style throughout the entire block.
          </p>
        </div>
      )}

      {cycleLabel && <p className="text-xs text-muted-foreground">{cycleLabel}</p>}

      {/* ── Block phases (draggable) ── */}
      {mainPhases.map((phase, idx) => (
        <div
          key={phase.localId}
          draggable
          onDragStart={() => setDragIdx(idx)}
          onDragOver={e => { e.preventDefault(); setDragOverIdx(idx) }}
          onDrop={() => handleDrop(idx)}
          onDragEnd={() => { setDragIdx(null); setDragOverIdx(null) }}
          className={cn(
            "rounded-xl border bg-card p-3 space-y-2.5 transition-opacity",
            dragIdx === idx && "opacity-40",
            dragOverIdx === idx && dragIdx !== idx && "ring-2 ring-primary",
          )}
        >
          {/* Name row */}
          <div className="flex items-center gap-2">
            <button aria-label="Drag to reorder phase" className="text-muted-foreground cursor-grab active:cursor-grabbing">
              <GripVertical className="h-4 w-4" />
            </button>
            <Input
              value={phase.name}
              onChange={e => updateMain(idx, { name: e.target.value })}
              className="h-7 text-sm font-medium flex-1 border-0 bg-transparent p-0 focus-visible:ring-0"
              placeholder="Phase name"
            />
            <button onClick={() => removeMain(idx)} className="text-muted-foreground hover:text-destructive transition ml-auto">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Duration */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-24 shrink-0">Duration</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => updateMain(idx, { durationCycles: Math.max(0, phase.durationCycles - 1) })}
                className="h-6 w-6 rounded border text-sm font-bold flex items-center justify-center hover:bg-muted"
              >−</button>
              <span className="text-sm w-16 text-center">
                {phase.durationCycles} cycle{phase.durationCycles !== 1 ? 's' : ''}
              </span>
              <button
                onClick={() => updateMain(idx, { durationCycles: phase.durationCycles + 1 })}
                className="h-6 w-6 rounded border text-sm font-bold flex items-center justify-center hover:bg-muted"
              >+</button>
              {avgSessionsPerWeek > 0 && phase.durationCycles > 0 && (
                <span className="text-xs text-muted-foreground ml-1">
                  ≈ {Math.round((phase.durationCycles * sessionsPerCycle) / avgSessionsPerWeek)}w
                </span>
              )}
            </div>
          </div>

          {/* Type */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-24 shrink-0">Type</span>
            <div className="flex gap-1 flex-wrap">
              {(Object.keys(TYPE_LABELS) as Array<keyof typeof TYPE_LABELS>).map(t => (
                <button
                  key={t}
                  onClick={() => updateMain(idx, {
                    phaseType: t,
                    ...(t === 'deload' ? { primaryStyleId: undefined, secondaryStyleId: undefined } : {}),
                  })}
                  className={cn(
                    "px-2 py-0.5 rounded text-xs border transition",
                    phase.phaseType === t
                      ? "bg-primary text-primary-foreground border-primary"
                      : "hover:bg-muted",
                  )}
                >
                  {TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {/* Deload — no style picker */}
          {phase.phaseType === 'deload' && (
            <p className="text-xs text-muted-foreground pl-[100px]">
              Auto: reduced sets · 60% 1RM compounds · same weight accessories
            </p>
          )}

          {/* Main lifts — all non-deload phases */}
          {phase.phaseType !== 'deload' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-24 shrink-0">Main lifts</span>
              <select
                value={phase.primaryStyleId ?? ''}
                onChange={e => updateMain(idx, { primaryStyleId: e.target.value || undefined })}
                className="text-xs border rounded px-2 py-1 bg-background flex-1"
              >
                <option value="">— select —</option>
                {styleOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {!phase.primaryStyleId && (
                <span className="text-xs text-destructive shrink-0">Required</span>
              )}
            </div>
          )}

          {/* Supporting lifts — Normal phases only.
              During Peak the engine automatically reads back from the
              preceding normal phase's supporting style, so it only needs
              to be set here. */}
          {phase.phaseType === 'normal' && (
            <div className="flex items-center gap-2">
              <div className="w-24 shrink-0">
                <p className="text-xs text-muted-foreground leading-none">Supporting</p>
                <p className="text-[9px] text-muted-foreground/60 mt-0.5 leading-none">holds during Peak</p>
              </div>
              <select
                value={phase.secondaryStyleId ?? ''}
                onChange={e => updateMain(idx, { secondaryStyleId: e.target.value || undefined })}
                className="text-xs border rounded px-2 py-1 bg-background flex-1"
              >
                <option value="">— same as main —</option>
                {styleOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}

          {/* Peak hint */}
          {phase.phaseType === 'peak' && (
            <p className="text-xs text-muted-foreground pl-[100px]">
              Supporting lifts hold at the preceding phase&apos;s intensity.
            </p>
          )}
        </div>
      ))}

      <button
        onClick={add}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition w-full justify-center py-2 border border-dashed rounded-xl"
      >
        <Plus className="h-4 w-4" /> Add Phase
      </button>

      <p className="text-xs text-muted-foreground text-right">
        Block total: {totalCycles} cycles
        {approxWeeks != null ? ` · ~${approxWeeks} weeks` : ''}
      </p>
    </div>
  )
}
