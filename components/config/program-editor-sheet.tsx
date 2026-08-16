"use client";

import { useRef, useState } from "react";
import { Plus, Trash2, GripVertical, Library, Info, Link2, Link2Off, XIcon } from "lucide-react";
import { ExercisePickerSheet } from "@/components/config/exercise-picker-sheet";
import { ExercisePreviewSheet } from "@/components/config/exercise-preview-sheet";
import type { ExerciseLibraryEntry } from "@trainingai/shared/types/program";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@trainingai/shared/utils";
import { getPaletteEntry } from "@trainingai/shared/session-palette";
import { FITNESS_ICONS, getSessionIcon } from "@/lib/session-icon";
import { SortableRow } from "@/components/config/sortable-row";
import { DragDropProvider, PointerSensor, type DragOverEvent } from "@dnd-kit/react";
import type { ProgressionStyle } from "@trainingai/shared/types";
import type { ExerciseRole, PhaseSetWithPhases } from "@trainingai/shared/types/program";
import type { EditablePhase } from "@/components/config/phase-editor";

export interface EditableSet { pct: number; reps: number; restSec?: number; useFor1rm?: boolean }
export interface EditableExercise {
  key: string;
  // The DB session_exercises id, round-tripped through the editor so a save keeps it instead
  // of re-minting one. Re-minted ids orphan the AI baseline-1RM map (keyed by this id) on every
  // edit. Absent only for a genuinely new exercise added in the editor.
  id?: string;
  name: string;
  styleName?: string;
  styleId?: string;
  exerciseRole?: ExerciseRole;
  muscleGroups?: string[];
  mainMuscles?: string[];
  secondaryMuscles?: string[];
  libraryId?: string;
  // Exercises sharing a group value within a session alternate as a superset
  // (v1: contiguous-by-position pairs/groups only, linked via "Link with next").
  supersetGroup?: number | null;
}
export interface EditableSession { key: string; id?: string; name: string; icon?: string; timeBudgetMinutes?: number; exercises: EditableExercise[] }

const MUSCLE_GROUPS = [
  "Chest", "Back", "Upper Back", "Lats", "Lower Back", "Traps",
  "Shoulders", "Biceps", "Triceps", "Forearms",
  "Quads", "Hamstrings", "Glutes", "Calves", "Adductors", "Hip Flexors",
  "Core", "Abs", "Full Body",
];

type SortableDragData = { type: 'session' } | { type: 'exercise'; sessionKey: string };

interface ProgramEditorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  programEditId: string | null;
  programName: string;
  onProgramNameChange: (name: string) => void;
  programSessions: EditableSession[];
  onProgramSessionsChange: (sessions: EditableSession[]) => void;
  scheduleMode: "auto" | "rotation" | "weekly";
  onScheduleModeChange: (mode: "auto" | "rotation" | "weekly") => void;
  scheduleRestAfterN: number;
  onScheduleRestAfterNChange: (n: number) => void;
  scheduleWeekDays: boolean[];
  onScheduleWeekDaysChange: (days: boolean[]) => void;
  scheduleReminderEnabled: boolean;
  onScheduleReminderEnabledChange: (enabled: boolean) => void;
  scheduleReminderTime: string;
  onScheduleReminderTimeChange: (time: string) => void;
  phaseMode: 'manual' | 'automatic' | 'ai_dynamic';
  onPhaseModeChange: (mode: 'manual' | 'automatic' | 'ai_dynamic') => void;
  phases: EditablePhase[];
  onPhasesChange: (phases: EditablePhase[]) => void;
  selectedPhaseSetId: string;
  onSelectedPhaseSetIdChange: (id: string) => void;
  currentBlockStartedAt: string | undefined;
  recalibrating: boolean;
  onRecalibrate: () => void;
  styles: ProgressionStyle[];
  exerciseLibrary: ExerciseLibraryEntry[];
  phaseSets: PhaseSetWithPhases[];
  emojiPickerSession: number | null;
  onEmojiPickerSessionChange: (si: number | null) => void;
  onSave: () => void;
  saving: boolean;
  nextEditKey: () => string;
  trainingGoal?: string;
  onTrainingGoalChange?: (goal: string) => void;
  autoApplyPrescriptions?: boolean;
  onAutoApplyPrescriptionsChange?: (value: boolean) => void;
}

export function ProgramEditorSheet({
  open,
  onOpenChange,
  programEditId,
  programName,
  onProgramNameChange,
  programSessions,
  onProgramSessionsChange,
  scheduleMode,
  onScheduleModeChange,
  scheduleRestAfterN,
  onScheduleRestAfterNChange,
  scheduleWeekDays,
  onScheduleWeekDaysChange,
  scheduleReminderEnabled,
  onScheduleReminderEnabledChange,
  scheduleReminderTime,
  onScheduleReminderTimeChange,
  phaseMode,
  onPhaseModeChange,
  phases,
  onPhasesChange,
  selectedPhaseSetId,
  onSelectedPhaseSetIdChange,
  currentBlockStartedAt,
  recalibrating,
  onRecalibrate,
  styles,
  exerciseLibrary,
  phaseSets,
  emojiPickerSession,
  onEmojiPickerSessionChange,
  onSave,
  saving,
  nextEditKey,
  trainingGoal = 'strength',
  onTrainingGoalChange,
  autoApplyPrescriptions = false,
  onAutoApplyPrescriptionsChange,
}: ProgramEditorSheetProps) {
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<{ si: number; ei: number } | null>(null);
  const [previewExercise, setPreviewExercise] = useState<ExerciseLibraryEntry | null>(null);

  function openPicker(si: number, ei: number) {
    setPickerTarget({ si, ei });
    setPickerOpen(true);
  }

  function handlePickerSelect(entry: ExerciseLibraryEntry) {
    if (!pickerTarget) return;
    selectExerciseName(pickerTarget.si, pickerTarget.ei, entry.name);
    setPickerTarget(null);
  }

  const handleDragOver = ({ operation }: DragOverEvent) => {
    const { source, target } = operation;
    if (!source || !target || source.id === target.id) return;
    const sourceId = source.id;
    const targetId = target.id;
    const sourceData = source.data as SortableDragData | undefined;
    if (!sourceData) return;

    if (sourceData.type === 'session') {
      onProgramSessionsChange((() => {
        const prev = programSessions;
        const from = prev.findIndex(s => s.key === sourceId);
        const to = prev.findIndex(s => s.key === targetId);
        if (from === -1 || to === -1) return prev;
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      })());
      return;
    }

    const { sessionKey } = sourceData;
    onProgramSessionsChange(programSessions.map(s => {
      if (s.key !== sessionKey) return s;
      const from = s.exercises.findIndex(e => e.key === sourceId);
      const to = s.exercises.findIndex(e => e.key === targetId);
      if (from === -1 || to === -1) return s;
      const exercises = [...s.exercises];
      const [moved] = exercises.splice(from, 1);
      exercises.splice(to, 0, moved);
      return { ...s, exercises };
    }));
  };

  const addSession = () => {
    onProgramSessionsChange([...programSessions, { key: nextEditKey(), name: "", exercises: [] }]);
  };

  const removeSession = (si: number) => {
    onProgramSessionsChange(programSessions.filter((_, i) => i !== si));
  };

  const renameSession = (si: number, name: string) => {
    onProgramSessionsChange(programSessions.map((s, i) => i === si ? { ...s, name } : s));
  };

  const setSessionIcon = (si: number, icon: string) => {
    onProgramSessionsChange(programSessions.map((s, i) => i === si ? { ...s, icon } : s));
    onEmojiPickerSessionChange(null);
  };

  const addExercise = (si: number) => {
    onProgramSessionsChange(programSessions.map((s, i) =>
      i === si ? { ...s, exercises: [...s.exercises, { key: nextEditKey(), name: "" }] } : s
    ));
  };

  const removeExercise = (si: number, ei: number) => {
    onProgramSessionsChange(programSessions.map((s, i) =>
      i === si ? { ...s, exercises: s.exercises.filter((_, j) => j !== ei) } : s
    ));
  };

  const selectExerciseName = (si: number, ei: number, name: string) => {
    const match = exerciseLibrary.find(l => l.name.toLowerCase() === name.toLowerCase());
    const mainMuscles = match ? match.muscles.filter(m => m.role === "main").map(m => m.muscle) : undefined;
    const secondaryMuscles = match ? match.muscles.filter(m => m.role === "secondary").map(m => m.muscle) : undefined;
    onProgramSessionsChange(programSessions.map((s, i) =>
      i === si ? {
        ...s,
        exercises: s.exercises.map((e, j) => j !== ei ? e : {
          ...e,
          name,
          libraryId: match?.id,
          mainMuscles: mainMuscles ?? e.mainMuscles,
          secondaryMuscles: secondaryMuscles ?? e.secondaryMuscles,
          muscleGroups: match
            ? match.muscles.map(m => m.muscle)
            : e.muscleGroups,
        }),
      } : s
    ));
  };

  const selectExerciseStyle = (si: number, ei: number, styleId: string) => {
    const selected = styles.find(s => s.id === styleId);
    onProgramSessionsChange(programSessions.map((s, i) =>
      i === si ? {
        ...s,
        exercises: s.exercises.map((e, j) => j !== ei ? e : {
          ...e,
          styleName: selected?.name ?? "",
          styleId: selected?.id ?? undefined,
        }),
      } : s
    ));
  };

  const updateExerciseRole = (si: number, ei: number, role: ExerciseRole) => {
    onProgramSessionsChange(programSessions.map((s, i) =>
      i === si ? {
        ...s,
        exercises: s.exercises.map((e, j) => j === ei ? { ...e, exerciseRole: role } : e),
      } : s
    ));
  };

  // Links exercise `ei` with the exercise immediately after it. If `ei` is
  // already the last member of a group, extends that same group (supporting
  // 3+ exercise circuits via repeated "link with next"); otherwise forms a
  // new pair using the lowest free group number. v1: contiguous by position
  // only — linking only ever targets the very next row.
  const linkWithNext = (si: number, ei: number) => {
    onProgramSessionsChange(programSessions.map((s, i) => {
      if (i !== si) return s;
      const existingGroup = s.exercises[ei]?.supersetGroup ?? null;
      let group = existingGroup;
      if (group == null) {
        const usedGroups = new Set(s.exercises.map(e => e.supersetGroup).filter((g): g is number => g != null));
        group = 1;
        while (usedGroups.has(group)) group++;
      }
      return {
        ...s,
        exercises: s.exercises.map((e, j) => (j === ei || j === ei + 1) ? { ...e, supersetGroup: group } : e),
      };
    }));
  };

  // Unlinking any member ungroups the whole set — no partial-group state.
  const unlinkGroup = (si: number, ei: number) => {
    onProgramSessionsChange(programSessions.map((s, i) => {
      if (i !== si) return s;
      const group = s.exercises[ei]?.supersetGroup;
      if (group == null) return s;
      return {
        ...s,
        exercises: s.exercises.map(e => e.supersetGroup === group ? { ...e, supersetGroup: null } : e),
      };
    }));
  };

  const addMuscleToRole = (si: number, ei: number, muscle: string, role: "main" | "secondary") => {
    onProgramSessionsChange(programSessions.map((s, i) =>
      i === si ? {
        ...s,
        exercises: s.exercises.map((e, j) => {
          if (j !== ei) return e;
          const main = role === "main"
            ? [...new Set([...(e.mainMuscles ?? []), muscle])]
            : (e.mainMuscles ?? []);
          const sec = role === "secondary"
            ? [...new Set([...(e.secondaryMuscles ?? []), muscle])]
            : (e.secondaryMuscles ?? []);
          return { ...e, mainMuscles: main, secondaryMuscles: sec, muscleGroups: [...main, ...sec] };
        }),
      } : s
    ));
  };

  const removeMuscleFromRole = (si: number, ei: number, muscle: string, role: "main" | "secondary") => {
    onProgramSessionsChange(programSessions.map((s, i) =>
      i === si ? {
        ...s,
        exercises: s.exercises.map((e, j) => {
          if (j !== ei) return e;
          const main = role === "main"
            ? (e.mainMuscles ?? []).filter(m => m !== muscle)
            : (e.mainMuscles ?? []);
          const sec = role === "secondary"
            ? (e.secondaryMuscles ?? []).filter(m => m !== muscle)
            : (e.secondaryMuscles ?? []);
          return { ...e, mainMuscles: main, secondaryMuscles: sec, muscleGroups: [...main, ...sec] };
        }),
      } : s
    ));
  };

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90dvh] flex flex-col">
        <SheetHeader className="flex-none">
          <SheetTitle>{programEditId ? "Edit Program" : "New Program"}</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-5">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">
              Program Name
            </label>
            <Input
              value={programName}
              onChange={e => onProgramNameChange(e.target.value)}
              placeholder="e.g. Strength Build"
              autoFocus
            />
          </div>

          {/* Schedule */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 block">
              Training Schedule
            </label>
            <div className="flex gap-1.5 mb-3">
              {(["auto", "rotation", "weekly"] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    onScheduleModeChange(mode);
                    if (phaseMode === 'ai_dynamic') onPhaseModeChange('manual');
                  }}
                  className={cn(
                    "flex-1 rounded-lg py-2 text-xs font-semibold border transition",
                    scheduleMode === mode && phaseMode !== 'ai_dynamic'
                      ? "bg-brand text-brand-foreground border-brand"
                      : "bg-muted text-muted-foreground border-transparent hover:border-muted-foreground/30"
                  )}
                >
                  {mode === "auto" ? "Auto" : mode === "rotation" ? "Rotation" : "Weekly"}
                </button>
              ))}
              <button
                type="button"
                onClick={() => onPhaseModeChange('ai_dynamic')}
                className={cn(
                  "flex-1 rounded-lg py-2 text-xs font-semibold border transition",
                  phaseMode === 'ai_dynamic'
                    ? "bg-brand text-brand-foreground border-brand"
                    : "bg-muted text-muted-foreground border-transparent hover:border-muted-foreground/30"
                )}
              >
                AI
              </button>
            </div>

            {phaseMode !== 'ai_dynamic' && scheduleMode === "rotation" && (
              <div className="rounded-xl bg-muted px-4 py-3 flex items-center justify-between">
                <p className="text-sm">Rest after</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onScheduleRestAfterNChange(Math.max(1, scheduleRestAfterN - 1))}
                    className="h-7 w-7 rounded-lg bg-background border flex items-center justify-center text-lg font-bold hover:border-brand transition"
                  >−</button>
                  <span className="w-10 text-center font-semibold text-sm">{scheduleRestAfterN} day{scheduleRestAfterN !== 1 ? "s" : ""}</span>
                  <button
                    type="button"
                    onClick={() => onScheduleRestAfterNChange(Math.min(14, scheduleRestAfterN + 1))}
                    className="h-7 w-7 rounded-lg bg-background border flex items-center justify-center text-lg font-bold hover:border-brand transition"
                  >+</button>
                </div>
              </div>
            )}

            {phaseMode !== 'ai_dynamic' && scheduleMode === "weekly" && (
              <div className="rounded-xl bg-muted px-3 py-3">
                <p className="text-xs text-muted-foreground mb-2">Tap days you train. Unticked days are rest days.</p>
                <div className="grid grid-cols-7 gap-1">
                  {["M", "T", "W", "T", "F", "S", "S"].map((label, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => onScheduleWeekDaysChange(scheduleWeekDays.map((v, j) => j === i ? !v : v))}
                      className={cn(
                        "h-9 rounded-lg text-xs font-bold border transition",
                        scheduleWeekDays[i]
                          ? "bg-brand text-brand-foreground border-brand"
                          : "bg-background text-muted-foreground border-border"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {phaseMode !== 'ai_dynamic' && scheduleMode === "auto" && (
              <p className="text-xs text-muted-foreground px-1">
                Rotates through sessions in order. No automatic rest days.
              </p>
            )}
            {phaseMode === 'ai_dynamic' && (
              <div className="rounded-xl bg-muted px-4 py-3 space-y-3">
                <p className="text-xs text-muted-foreground">
                  AI picks your session and rest days each day based on recovery, muscle balance, and training history.
                </p>
                {onTrainingGoalChange && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm flex-1">Training goal</span>
                    <select
                      value={trainingGoal}
                      onChange={e => onTrainingGoalChange(e.target.value)}
                      className="text-sm border rounded-lg px-2 py-1.5 bg-background"
                    >
                      <option value="strength">Strength</option>
                      <option value="powerbuilding">Powerbuilding</option>
                      <option value="strength+hypertrophy">Strength + Hypertrophy</option>
                      <option value="hypertrophy">Hypertrophy</option>
                      <option value="power">Power</option>
                      <option value="endurance">Endurance</option>
                    </select>
                  </div>
                )}
                {onAutoApplyPrescriptionsChange && (
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm">Auto-apply prescriptions</span>
                      <p className="text-[11px] text-muted-foreground">Applies today&apos;s plan and earned phase transitions automatically when confidence is high. Deloads always ask.</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={autoApplyPrescriptions}
                      onClick={() => onAutoApplyPrescriptionsChange(!autoApplyPrescriptions)}
                      className={cn(
                        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none",
                        autoApplyPrescriptions ? "bg-brand" : "bg-muted-foreground/30"
                      )}
                    >
                      <span className={cn(
                        "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                        autoApplyPrescriptions ? "translate-x-4" : "translate-x-0.5"
                      )} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Workout reminder */}
            {phaseMode !== 'ai_dynamic' && scheduleMode !== "auto" && (
              <div className="rounded-xl bg-muted px-4 py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Workout reminder</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={scheduleReminderEnabled}
                    onClick={() => onScheduleReminderEnabledChange(!scheduleReminderEnabled)}
                    className={cn(
                      "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-1",
                      scheduleReminderEnabled ? "bg-brand" : "bg-muted-foreground/30"
                    )}
                  >
                    <span className={cn(
                      "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                      scheduleReminderEnabled ? "translate-x-4" : "translate-x-0.5"
                    )} />
                  </button>
                </div>
                {scheduleReminderEnabled && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground flex-none">Remind me at</span>
                    <input
                      type="time"
                      value={scheduleReminderTime}
                      onChange={e => onScheduleReminderTimeChange(e.target.value)}
                      className="rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Training Approach - Creation only, hidden when AI selected via schedule row */}
          {!programEditId && phaseMode !== 'ai_dynamic' && (
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 block">
                Training Approach
              </label>
              <div className="flex gap-1.5 mb-3">
                {(['manual', 'automatic', 'ai_dynamic'] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      onPhaseModeChange(mode);
                      if (mode === 'automatic' && phases.length === 0) {
                        const find = (name: string) => styles.find(s => s.name === name)?.id;
                        onPhasesChange([
                          { localId: 'def-0', position: 0, name: 'Accumulation',     durationCycles: 4, phaseType: 'normal',    primaryStyleId: find('Hypertrophy'), secondaryStyleId: find('Hypertrophy') },
                          { localId: 'def-1', position: 1, name: 'Intensification',  durationCycles: 3, phaseType: 'normal',    primaryStyleId: find('Strength'),    secondaryStyleId: find('Strength') },
                          { localId: 'def-2', position: 2, name: 'Peak',             durationCycles: 2, phaseType: 'peak',      primaryStyleId: find('Peak'),        secondaryStyleId: undefined },
                          { localId: 'def-3', position: 3, name: 'Deload',           durationCycles: 1, phaseType: 'deload',    primaryStyleId: find('Deload'),      secondaryStyleId: undefined },
                          { localId: 'def-4', position: 4, name: 'Accessory',        durationCycles: 0, phaseType: 'accessory', primaryStyleId: find('General'),     secondaryStyleId: undefined },
                        ]);
                      }
                    }}
                    className={cn(
                      "flex-1 rounded-lg py-2 text-xs font-semibold border transition",
                      phaseMode === mode
                        ? "bg-brand text-brand-foreground border-brand"
                        : "bg-muted text-muted-foreground border-transparent hover:border-muted-foreground/30"
                    )}
                  >
                    {mode === 'manual' ? 'Linear' : mode === 'automatic' ? 'Phase Based' : 'AI Training'}
                  </button>
                ))}
              </div>
              {phaseMode === 'manual' && (
                <p className="text-xs text-muted-foreground px-1">
                  Percentage-based progression — style selected per exercise.
                </p>
              )}
              {phaseMode === 'automatic' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-20 shrink-0">Phase Set</span>
                    <select
                      value={selectedPhaseSetId}
                      onChange={e => onSelectedPhaseSetIdChange(e.target.value)}
                      className="text-xs border rounded px-2 py-1 bg-background flex-1"
                    >
                      {phaseSets.map(ps => (
                        <option key={ps.id} value={ps.id}>{ps.name}</option>
                      ))}
                    </select>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Block periodization — cycles through accumulation, intensification, peak, and deload phases.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Training Approach - Edit mode: locked for manual, phase set editable for Phase Based, hidden for ai_dynamic */}
          {programEditId && phaseMode !== 'ai_dynamic' && (
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 block">
                Training Approach
              </label>
              <div className="rounded-xl bg-muted px-4 py-3 space-y-2">
                <p className="text-sm font-semibold">
                  {phaseMode === 'manual' ? 'Linear' : phaseMode === 'automatic' ? 'Phase Based' : 'AI Training'}
                </p>
                {phaseMode === 'automatic' && (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-20 shrink-0">Phase Set</span>
                      <select
                        value={selectedPhaseSetId}
                        onChange={e => onSelectedPhaseSetIdChange(e.target.value)}
                        className="text-xs border rounded px-2 py-1 bg-background flex-1"
                      >
                        {phaseSets.map(ps => (
                          <option key={ps.id} value={ps.id}>{ps.name}</option>
                        ))}
                      </select>
                    </div>
                    {currentBlockStartedAt && (
                      <p className="text-xs text-muted-foreground">Current block started: {currentBlockStartedAt}</p>
                    )}
                    <button
                      type="button"
                      onClick={onRecalibrate}
                      disabled={recalibrating}
                      className="text-xs border rounded px-2 py-1.5 bg-background w-full disabled:opacity-50"
                    >
                      {recalibrating ? 'Recalibrating…' : 'Recalibrate cycle position'}
                    </button>
                    <p className="text-xs text-muted-foreground">
                      If the current phase/cycle looks wrong, tap this to recalculate your
                      position in the block from your full training history — no need to
                      count sessions yourself.
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          <DragDropProvider sensors={[PointerSensor]} onDragOver={handleDragOver}>
            {programSessions.map((sess, si) => (
              <SortableRow
                key={sess.key}
                id={sess.key}
                index={si}
                data={{ type: 'session' }}
                className={`rounded-xl border-l-4 border bg-muted/40 p-3 space-y-2 ${getPaletteEntry(si).borderClass}`}
              >
                {({ handleRef }) => (
                  <>
                    {/* Session header: emoji picker + name input + delete */}
                    <div className="flex items-center gap-2">
                      <button
                        ref={el => handleRef(el)}
                        type="button"
                        className="cursor-grab active:cursor-grabbing touch-none flex-none"
                        aria-label="Reorder session"
                      >
                        <GripVertical className="h-4 w-4 text-muted-foreground/40" />
                      </button>
                      {/* Icon picker button */}
                      <div className="relative flex-none">
                        <button
                          type="button"
                          onClick={() => onEmojiPickerSessionChange(emojiPickerSession === si ? null : si)}
                          className="w-9 h-9 flex items-center justify-center rounded-lg border border-border bg-background hover:bg-muted transition"
                          title="Pick icon"
                        >
                          {(() => {
                            const Icon = getSessionIcon(sess.icon, si);
                            return <Icon className="h-5 w-5 text-muted-foreground" />;
                          })()}
                        </button>
                        {emojiPickerSession === si && (
                          <div
                            ref={emojiPickerRef}
                            className="absolute left-0 top-10 z-50 rounded-xl border border-border bg-popover shadow-lg p-2 grid grid-cols-5 gap-1 w-48"
                          >
                            {FITNESS_ICONS.map(({ emoji, Icon, label }) => (
                              <button
                                key={emoji}
                                type="button"
                                onClick={() => setSessionIcon(si, emoji)}
                                title={label}
                                className={cn(
                                  "w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted transition",
                                  sess.icon === emoji && "bg-brand/20 ring-1 ring-brand"
                                )}
                              >
                                <Icon className="h-4 w-4 text-muted-foreground" />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <Input
                        value={sess.name}
                        onChange={e => renameSession(si, e.target.value)}
                        placeholder="Session name (e.g. Push)"
                        className="text-sm font-semibold flex-1"
                      />
                      {programSessions.length > 1 && (
                        <button
                          onClick={() => { removeSession(si); onEmojiPickerSessionChange(null); }}
                          className="rounded-lg p-2 text-muted-foreground hover:text-destructive transition flex-none"
                          title="Remove session"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    {/* Time budget */}
                    <div className="flex items-center gap-2 pl-6">
                      <span className="text-xs text-muted-foreground flex-1">Time budget</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            const cur = sess.timeBudgetMinutes ?? 60;
                            onProgramSessionsChange(programSessions.map((s, j) => j === si ? { ...s, timeBudgetMinutes: Math.max(20, cur - 5) } : s));
                          }}
                          className="h-6 w-6 rounded-md bg-background border flex items-center justify-center text-base font-bold hover:border-brand transition"
                        >−</button>
                        <span className="text-xs tabular-nums w-16 text-center font-medium">{sess.timeBudgetMinutes ?? 60} min</span>
                        <button
                          type="button"
                          onClick={() => {
                            const cur = sess.timeBudgetMinutes ?? 60;
                            onProgramSessionsChange(programSessions.map((s, j) => j === si ? { ...s, timeBudgetMinutes: Math.min(180, cur + 5) } : s));
                          }}
                          className="h-6 w-6 rounded-md bg-background border flex items-center justify-center text-base font-bold hover:border-brand transition"
                        >+</button>
                      </div>
                    </div>

                    {/* Exercises */}
                    <DragDropProvider sensors={[PointerSensor]} onDragOver={handleDragOver}>
                      <div className="space-y-2 pl-6">
                        {sess.exercises.map((ex, ei) => {
                          const resolvedStyle = ex.styleId
                            ? (styles.find(s => s.id === ex.styleId) ?? null)
                            : (ex.styleName ? (styles.find(s => s.name === ex.styleName) ?? null) : null);
                          const styleIsMissing = (ex.styleName || ex.styleId) && !resolvedStyle;
                          const currentStyleId = resolvedStyle?.id ?? "";
                          const group = ex.supersetGroup ?? null;
                          const groupLabel = group != null ? String.fromCharCode(64 + group) : null;
                          const indexInGroup = group != null
                            ? sess.exercises.slice(0, ei + 1).filter(e => e.supersetGroup === group).length
                            : null;
                          const canLinkWithNext = ei < sess.exercises.length - 1 && (sess.exercises[ei + 1]?.supersetGroup ?? null) == null;
                          return (
                            <SortableRow
                              key={ex.key}
                              id={ex.key}
                              index={ei}
                              data={{ type: 'exercise', sessionKey: sess.key }}
                              className={cn(
                                "flex gap-2 items-start rounded-xl p-2 bg-background",
                                styleIsMissing ? "border border-amber-400" : "",
                                group != null ? "border-l-4 border-l-brand" : "",
                              )}
                            >
                              {({ handleRef }) => (
                                <>
                                  <button
                                    ref={el => handleRef(el)}
                                    type="button"
                                    className="mt-2 cursor-grab active:cursor-grabbing touch-none flex-none"
                                    aria-label="Reorder exercise"
                                  >
                                    <GripVertical className="h-4 w-4 text-muted-foreground/40" />
                                  </button>
                                  <div className="flex-1 min-w-0 space-y-1.5">
                                    {groupLabel != null && (
                                      <span className="inline-flex items-center rounded-full bg-brand/15 text-brand px-2 py-0.5 text-[10px] font-bold">
                                        {groupLabel}{indexInGroup}
                                      </span>
                                    )}
                                    <input
                                      list={`ex-lib-${si}-${ei}`}
                                      value={ex.name}
                                      onChange={e => selectExerciseName(si, ei, e.target.value)}
                                      placeholder={`Exercise ${ei + 1}`}
                                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-semibold ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                                    />
                                    <div className="flex gap-1.5">
                                      <button
                                        type="button"
                                        aria-label="Browse exercise library"
                                        onClick={() => openPicker(si, ei)}
                                        className="flex-none rounded-md border border-input bg-muted px-2.5 py-2 text-muted-foreground hover:text-foreground transition-colors"
                                      >
                                        <Library className="h-4 w-4" />
                                      </button>
                                      {ex.name && exerciseLibrary.find(l => l.name.toLowerCase() === ex.name.toLowerCase()) && (
                                        <button
                                          type="button"
                                          aria-label="Preview exercise"
                                          onClick={() => setPreviewExercise(exerciseLibrary.find(l => l.name.toLowerCase() === ex.name.toLowerCase()) ?? null)}
                                          className="flex-none rounded-md border border-input bg-muted px-2.5 py-2 text-muted-foreground hover:text-foreground transition-colors"
                                        >
                                          <Info className="h-4 w-4" />
                                        </button>
                                      )}
                                      {group != null && (
                                        <button
                                          type="button"
                                          aria-label="Unlink superset"
                                          onClick={() => unlinkGroup(si, ei)}
                                          className="flex-none rounded-md border border-input bg-muted px-2.5 py-2 text-muted-foreground hover:text-foreground transition-colors"
                                        >
                                          <Link2Off className="h-4 w-4" />
                                        </button>
                                      )}
                                      {canLinkWithNext && (
                                        <button
                                          type="button"
                                          aria-label="Link with next exercise"
                                          onClick={() => linkWithNext(si, ei)}
                                          className="flex-none rounded-md border border-input bg-muted px-2.5 py-2 text-muted-foreground hover:text-foreground transition-colors"
                                        >
                                          <Link2 className="h-4 w-4" />
                                        </button>
                                      )}
                                    </div>
                                    <datalist id={`ex-lib-${si}-${ei}`}>
                                      {exerciseLibrary.filter(l => !l.mergedInto).map(l => (
                                        <option key={l.id} value={l.name} />
                                      ))}
                                    </datalist>
                                    {phaseMode === 'manual' && (
                                      <>
                                        <select
                                          value={currentStyleId}
                                          onChange={e => selectExerciseStyle(si, ei, e.target.value)}
                                          className="w-full rounded-lg border bg-muted px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                                        >
                                          <option value="">No style (default sets)</option>
                                          {styles.map(s => (
                                            <option key={s.id} value={s.id}>
                                              {s.name} — {s.sets.map(ss => `${ss.pct}%×${ss.reps}`).join(", ")}
                                            </option>
                                          ))}
                                        </select>
                                        {styleIsMissing && (
                                          <p className="text-xs text-amber-600 dark:text-amber-400">
                                            Style &ldquo;{ex.styleName}&rdquo; not found — please reassign
                                          </p>
                                        )}
                                      </>
                                    )}
                                    {phaseMode !== 'manual' && (
                                      <p className="text-xs text-muted-foreground px-1">
                                        Sets/reps/load are set automatically from the exercise&rsquo;s role and your current phase.
                                      </p>
                                    )}
                                    {phaseMode !== 'manual' && (
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-xs text-muted-foreground flex-none">Role</span>
                                        <div className="flex gap-1">
                                          {(['primary', 'secondary', 'accessory'] as const).map(role => {
                                            const roleLabel = role === 'primary' ? 'Main Compound' : role === 'secondary' ? 'Secondary Compound' : 'Accessory';
                                            return (
                                              <button
                                                key={role}
                                                type="button"
                                                onClick={() => updateExerciseRole(si, ei, role)}
                                                className={cn(
                                                  "px-2 py-0.5 rounded text-xs border transition",
                                                  (ex.exerciseRole ?? 'primary') === role
                                                    ? "bg-primary text-primary-foreground border-primary"
                                                    : "bg-muted text-muted-foreground border-border hover:bg-background"
                                                )}
                                              >
                                                {roleLabel}
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}
                                    {/* 2-pill muscle assignment UI */}
                                    <div className="space-y-1.5 pt-0.5">
                                      {(["main", "secondary"] as const).map(role => {
                                        const muscles = role === "main" ? (ex.mainMuscles ?? []) : (ex.secondaryMuscles ?? []);
                                        const pillColor = role === "main" ? "bg-brand/10 border-brand/30" : "bg-amber-50 border-amber-300 dark:bg-amber-950/30 dark:border-amber-800";
                                        const chipColor = role === "main" ? "bg-brand text-brand-foreground" : "bg-amber-400 text-white";
                                        const label = role === "main" ? "Primary" : "Secondary";
                                        const available = MUSCLE_GROUPS.filter(g => !muscles.includes(g));
                                        return (
                                          <div key={role} className={cn("flex flex-wrap items-center gap-1 rounded-lg border px-2 py-1.5 min-h-[32px]", pillColor)}>
                                            <span className="text-[10px] font-bold uppercase tracking-wide opacity-60 mr-0.5">{label}</span>
                                            {muscles.map(m => (
                                              <button
                                                key={m}
                                                type="button"
                                                onClick={() => removeMuscleFromRole(si, ei, m, role)}
                                                className={cn("inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 h-5 rounded-full leading-none transition-opacity hover:opacity-70", chipColor)}
                                              >
                                                {m} <XIcon className="w-2 h-2 opacity-70" />
                                              </button>
                                            ))}
                                            {available.length > 0 && (
                                              <select
                                                value=""
                                                onChange={e => { if (e.target.value) addMuscleToRole(si, ei, e.target.value, role); }}
                                                className="text-[10px] text-muted-foreground bg-transparent border-none outline-none cursor-pointer pl-0 pr-1"
                                              >
                                                <option value="">+ add</option>
                                                {available.map(g => <option key={g} value={g}>{g}</option>)}
                                              </select>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => removeExercise(si, ei)}
                                    className="mt-1 rounded-lg p-2 text-muted-foreground hover:text-destructive transition"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </>
                              )}
                            </SortableRow>
                          );
                        })}
                      </div>
                    </DragDropProvider>

                    <button
                      onClick={() => addExercise(si)}
                      className="ml-6 flex items-center gap-1 text-xs font-semibold text-brand hover:opacity-70 transition"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add {sess.name || "Exercise"}
                    </button>
                  </>
                )}
              </SortableRow>
            ))}
          </DragDropProvider>

          {/* Add session */}
          <button
            onClick={addSession}
            className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-muted-foreground/30 py-3 text-sm font-semibold text-muted-foreground hover:border-brand hover:text-brand transition"
          >
            <Plus className="h-4 w-4" />
            Add Session
          </button>
        </div>
        <div className="flex-none px-4 pt-2 border-t">
          <Button
            className="w-full h-12 bg-brand hover:opacity-90 text-brand-foreground font-semibold"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save Program"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>

    <ExercisePickerSheet
      open={pickerOpen}
      onOpenChange={setPickerOpen}
      exerciseLibrary={exerciseLibrary}
      onSelect={handlePickerSelect}
    />
    <ExercisePreviewSheet
      open={previewExercise !== null}
      onOpenChange={isOpen => { if (!isOpen) setPreviewExercise(null); }}
      exercise={previewExercise}
    />
    </>
  );
}
