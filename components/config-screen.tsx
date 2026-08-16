"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useRef } from "react";
import { ChevronRight, ChevronDown, Plus, Pencil, Trash2, CheckIcon, Wand2, SlidersHorizontal } from "lucide-react";
import BuilderWizard from "@/components/workout-builder/builder-wizard";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { cn } from "@trainingai/shared/utils";
import type { ProgressionStyle, Program } from "@trainingai/shared/types";
import type { PhaseSetWithPhases } from "@trainingai/shared/types/program";
import type { ExerciseLibraryEntry } from "@trainingai/shared/types/program";
import { type EditablePhase } from "@/components/config/phase-editor";
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
import { invalidateProgramStructure } from "@/lib/cache-groups";
import { pullDelta } from "@/lib/local-store/sync-engine";
import { TTL_LONG } from '@trainingai/shared/cache-ttl';
import { StyleEditorSheet } from "@/components/config/style-editor-sheet";
import { WorkoutReviewSheet } from "@/components/workout/review/workout-review-sheet";
import { PhaseSetEditorSheet } from "@/components/config/phase-set-editor-sheet";
import { ProgramEditorSheet, type EditableSession } from "@/components/config/program-editor-sheet";

interface EditableSet { key: string; pct: number; reps: number; restSec?: number; useFor1rm?: boolean }

let editKeyCounter = 0;
function nextEditKey(): string { return `edit-${++editKeyCounter}`; }

function suggestedReps(pct: number): number {
  const chart: [number, number][] = [
    [95, 1], [90, 3], [85, 4], [80, 6], [75, 8],
    [70, 10], [65, 12], [60, 15], [55, 20], [50, 25],
  ];
  if (pct >= 95) return 1;
  if (pct <= 50) return 25;
  for (let i = 0; i < chart.length - 1; i++) {
    const [hiPct, hiReps] = chart[i];
    const [loPct, loReps] = chart[i + 1];
    if (pct <= hiPct && pct >= loPct) {
      const t = (hiPct - pct) / (hiPct - loPct);
      return Math.round(hiReps + t * (loReps - hiReps));
    }
  }
  return 8;
}

export default function ConfigScreen({ userId, openNewProgram }: { userId?: string; openNewProgram?: boolean } = {}) {
  const [styles, setStyles] = useState<ProgressionStyle[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [exerciseLibrary, setExerciseLibrary] = useState<ExerciseLibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Style editor state
  const [styleSheetOpen, setStyleSheetOpen] = useState(false);
  const [styleEditId, setStyleEditId] = useState<string | null>(null);
  const [styleName, setStyleName] = useState("");
  const [styleSets, setStyleSets] = useState<EditableSet[]>([{ key: nextEditKey(), pct: 80, reps: 8 }]);
  const [styleSaving, setStyleSaving] = useState(false);

  // Program editor state
  const [programSheetOpen, setProgramSheetOpen] = useState(false);
  const [programEditId, setProgramEditId] = useState<string | null>(null);
  const [programName, setProgramName] = useState("");
  const [programSessions, setProgramSessions] = useState<EditableSession[]>([]);
  const [programSaving, setProgramSaving] = useState(false);
  const [trainingGoal, setTrainingGoal] = useState<string>('strength');
  const [autoApplyPrescriptions, setAutoApplyPrescriptions] = useState(false);
  const [phaseMode, setPhaseMode] = useState<'manual' | 'automatic' | 'ai_dynamic'>('manual');
  const [phases, setPhases] = useState<EditablePhase[]>([]);
  const [currentBlockStartedAt, setCurrentBlockStartedAt] = useState<string | undefined>(undefined);
  const [recalibrating, setRecalibrating] = useState(false);

  const [progressionSetsOpen, setProgressionSetsOpen] = useState(false);
  const [phaseSetsOpen, setPhaseSetsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [workoutsOpen, setWorkoutsOpen] = useState(true);
  const [phaseSets, setPhaseSets] = useState<PhaseSetWithPhases[]>([]);
  const [phaseSetSheetOpen, setPhaseSetSheetOpen] = useState(false);
  const [editingPhaseSet, setEditingPhaseSet] = useState<PhaseSetWithPhases | null>(null);
  const [phaseSetEditPhases, setPhaseSetEditPhases] = useState<EditablePhase[]>([]);
  const [phaseSetEditName, setPhaseSetEditName] = useState('');
  const [phaseSetSaving, setPhaseSetSaving] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [reviewSessionId, setReviewSessionId] = useState<string | null>(null);
  // Set by BuilderWizard — invoked when the sheet is dismissed so it can confirm before
  // discarding a generated program. Defaults to a plain close.
  const builderCloseGuardRef = useRef<() => void>(() => setBuilderOpen(false));
  const [selectedPhaseSetId, setSelectedPhaseSetId] = useState('');

  // Schedule editor state
  const [scheduleMode, setScheduleMode] = useState<"auto" | "rotation" | "weekly">("auto");
  const [scheduleRestAfterN, setScheduleRestAfterN] = useState(3);
  const [scheduleWeekDays, setScheduleWeekDays] = useState<boolean[]>(Array(7).fill(false));
  const [scheduleReminderEnabled, setScheduleReminderEnabled] = useState(false);
  const [scheduleReminderTime, setScheduleReminderTime] = useState("18:00");

  const [emojiPickerSession, setEmojiPickerSession] = useState<number | null>(null);

  const [deleting, setDeleting] = useState<string | null>(null);

  useLayoutEffect(() => {
    const stylesData = readCacheSync<{ styles: ProgressionStyle[] }>('progression-styles');
    if (stylesData) { setStyles(stylesData.styles ?? []); setLoading(false); }
    const programsData = readCacheSync<{ programs: Program[] }>('workout-templates');
    if (programsData) setPrograms(programsData.programs ?? []);
    const libData = readCacheSync<{ exercises: ExerciseLibraryEntry[] }>('exercise-library');
    if (libData) setExerciseLibrary(libData.exercises ?? []);
    const phaseSetsData = readCacheSync<{ phaseSets: PhaseSetWithPhases[] }>('phase-sets');
    if (phaseSetsData) setPhaseSets(phaseSetsData.phaseSets ?? []);
  }, []);

  const load = useCallback(async () => {
    await Promise.all([
      cachedFetch<{ styles: ProgressionStyle[] }>(
        'progression-styles', '/api/progression-styles', TTL_LONG,
        (data) => { setStyles(data.styles ?? []); setLoading(false); },
        { freshWithinTtl: true },
      ),
      cachedFetch<{ programs: Program[] }>(
        'workout-templates', '/api/workout-templates', TTL_LONG,
        (data) => setPrograms(data.programs ?? []),
      ),
      cachedFetch<{ exercises: ExerciseLibraryEntry[] }>(
        'exercise-library', '/api/exercise-library', TTL_LONG,
        (data) => setExerciseLibrary(data.exercises ?? []),
        { freshWithinTtl: true },
      ),
      cachedFetch<{ phaseSets: PhaseSetWithPhases[] }>(
        'phase-sets', '/api/phase-sets', TTL_LONG,
        (data) => {
          const sets = data.phaseSets ?? [];
          setPhaseSets(sets);
          setSelectedPhaseSetId(prev => prev || (sets.find(ps => ps.isDefault)?.id ?? sets[0]?.id ?? ''));
        },
      ),
    ]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Re-fetch phase sets whenever the section is opened so order is always live
  useEffect(() => {
    if (!phaseSetsOpen) return;
    fetch('/api/phase-sets').then(r => r.ok ? r.json() : null).then(data => {
      if (!data) return;
      const sets: PhaseSetWithPhases[] = data.phaseSets ?? [];
      setPhaseSets(sets);
      setSelectedPhaseSetId(prev => prev || (sets.find(ps => ps.isDefault)?.id ?? sets[0]?.id ?? ''));
    });
  }, [phaseSetsOpen]);

  const openNewStyle = () => {
    setStyleEditId(null);
    setStyleName("");
    setStyleSets([{ key: nextEditKey(), pct: 80, reps: 8 }]);
    setStyleSheetOpen(true);
  };

  const openEditStyle = (style: ProgressionStyle) => {
    setStyleEditId(style.id);
    setStyleName(style.name);
    setStyleSets(style.sets.map(s => ({
      key: nextEditKey(),
      pct: s.pct,
      reps: s.reps,
      restSec: s.restSec > 0 ? s.restSec : undefined,
      useFor1rm: s.useFor1rm,
    })));
    setStyleSheetOpen(true);
  };

  const saveStyle = async () => {
    const trimmed = styleName.trim();
    if (!trimmed) { toast.error("Style name is required"); return; }
    if (styleSets.length === 0) { toast.error("Add at least one set"); return; }

    setStyleSaving(true);
    try {
      const sets = styleSets.map((s, i) => ({
        setNumber: i + 1,
        pct: s.pct,
        reps: s.reps,
        restSec: s.restSec ?? 0,
        useFor1rm: s.useFor1rm ?? false,
      }));
      const style = styleEditId
        ? { id: styleEditId, name: trimmed, sets }
        : { name: trimmed, sets };
      const res = await fetch("/api/progression-styles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ style }),
      });
      if (!res.ok) throw new Error();
      toast.success("Style saved");
      await invalidateProgramStructure();
      setStyleSheetOpen(false);
      await load();
    } catch {
      toast.error("Failed to save style");
    } finally {
      setStyleSaving(false);
    }
  };

  const deleteStyle = async (style: ProgressionStyle) => {
    const key = `style:${style.id}`;
    setDeleting(key);
    try {
      const res = await fetch("/api/progression-styles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: style.id }),
      });
      if (!res.ok) throw new Error();
      toast.success("Style deleted");
      await invalidateProgramStructure();
      await load();
    } catch {
      toast.error("Failed to delete style");
    } finally {
      setDeleting(null);
    }
  };

  // ── Style editor helpers ────────────────────────────────────────────────────

  const updateSet = (i: number, field: "pct" | "reps", raw: string) => {
    const value = parseInt(raw, 10);
    if (isNaN(value)) return;
    setStyleSets(prev => prev.map((s, idx) => {
      if (idx !== i) return s;
      if (field === "pct") return { ...s, pct: value, reps: suggestedReps(value) };
      return { ...s, reps: value };
    }));
  };

  const updateSetRest = (i: number, value: number) => {
    setStyleSets(prev => prev.map((s, idx) =>
      idx === i ? { ...s, restSec: value > 0 ? value : undefined } : s
    ));
  };

  const toggleUseFor1rm = (i: number) => {
    setStyleSets(prev => prev.map((s, idx) => idx === i ? { ...s, useFor1rm: !s.useFor1rm } : s));
  };

  const addSet = () => setStyleSets(prev => [...prev, { key: nextEditKey(), pct: 80, reps: suggestedReps(80) }]);
  const removeSet = (i: number) => setStyleSets(prev => prev.filter((_, idx) => idx !== i));

  // ── Phase Set CRUD ──────────────────────────────────────────────────────────

  async function openPhaseSetEditor(ps: PhaseSetWithPhases | null) {
    // Always fetch fresh data before opening so migration-added phases
    // aren't wiped when the editor saves over a stale cached set.
    let freshSets = phaseSets;
    try {
      const res = await fetch('/api/phase-sets');
      if (res.ok) {
        const data = await res.json();
        freshSets = data.phaseSets ?? phaseSets;
        setPhaseSets(freshSets);
        await invalidateProgramStructure();
      }
    } catch { /* fall back to cached */ }

    if (ps) {
      const freshPs = freshSets.find(s => s.id === ps.id) ?? ps;
      setEditingPhaseSet(freshPs);
      setPhaseSetEditName(freshPs.name);
      setPhaseSetEditPhases(freshPs.phases.map(p => ({ ...p, localId: `local-${p.id}` })));
    } else {
      setEditingPhaseSet(null);
      setPhaseSetEditName('');
      const defaultSet = freshSets.find(s => s.isDefault);
      setPhaseSetEditPhases(
        (defaultSet?.phases ?? []).map((p, i) => ({ ...p, localId: `new-${i}` }))
      );
    }
    setPhaseSetSheetOpen(true);
  }

  async function savePhaseSet() {
    if (!phaseSetEditName.trim() && !editingPhaseSet?.isDefault) return;
    setPhaseSetSaving(true);
    try {
      const url = editingPhaseSet ? `/api/phase-sets/${editingPhaseSet.id}` : '/api/phase-sets';
      const method = editingPhaseSet ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: phaseSetEditName, phases: phaseSetEditPhases }),
      });
      if (!res.ok) { toast.error('Failed to save phase set'); return; }
      const data = await res.json();
      setPhaseSets(prev =>
        editingPhaseSet
          ? prev.map(ps => ps.id === editingPhaseSet.id ? data.phaseSet : ps)
          : [...prev, data.phaseSet]
      );
      await invalidateProgramStructure();
      toast.success('Phase set saved');
      setPhaseSetSheetOpen(false);
    } finally {
      setPhaseSetSaving(false);
    }
  }

  async function clonePhaseSet(ps: PhaseSetWithPhases) {
    const res = await fetch('/api/phase-sets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${ps.name} Copy`,
        phases: ps.phases.map((p, i) => ({ ...p, localId: `clone-${i}` })),
      }),
    });
    if (!res.ok) { toast.error('Failed to clone phase set'); return; }
    const data = await res.json();
    setPhaseSets(prev => [...prev, data.phaseSet]);
    await invalidateProgramStructure();
    toast.success('Cloned — tap the pencil to customise');
  }

  async function deletePhaseSetById(ps: PhaseSetWithPhases) {
    const res = await fetch(`/api/phase-sets/${ps.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error ?? 'Failed to delete');
      return;
    }
    setPhaseSets(prev => prev.filter(p => p.id !== ps.id));
    await invalidateProgramStructure();
    toast.success('Phase set deleted');
  }

  // ── Program CRUD ────────────────────────────────────────────────────────────

  const openNewProgramSheet = () => {
    setProgramEditId(null);
    setProgramName("");
    setProgramSessions([]);
    setScheduleMode("auto");
    setScheduleRestAfterN(3);
    setScheduleWeekDays(Array(7).fill(false));
    setPhaseMode('manual');
    setPhases([]);
    setCurrentBlockStartedAt(undefined);
    setSelectedPhaseSetId(phaseSets.find(ps => ps.isDefault)?.id ?? phaseSets[0]?.id ?? '');
    setTrainingGoal('strength');
    setAutoApplyPrescriptions(false);
    setProgramSheetOpen(true);
  };

  // Deep-link from the AI prescription card's "New program" action (post-deload cycle restart).
  // The flag arrives as a prop resolved from /program's own searchParams — it used to be read here
  // from window.location.search, which meant /config's bare redirect could drop it and the sheet
  // silently never opened (Q-256). A prop cannot be dropped without the call site changing.
  useEffect(() => {
    if (!openNewProgram) return;
    openNewProgramSheet();
    window.history.replaceState(null, '', '/program');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNewProgram]);

  const openEditProgram = (program: Program) => {
    setProgramEditId(program.id);
    setProgramName(program.name);
    setTrainingGoal(program.trainingGoal ?? 'strength');
    setAutoApplyPrescriptions(program.autoApplyPrescriptions ?? false);
    setProgramSessions(
      program.sessions
        .slice()
        .sort((a, b) => a.position - b.position)
        .map(sess => ({
          key: nextEditKey(),
          id: sess.id,
          name: sess.name,
          icon: sess.icon,
          timeBudgetMinutes: sess.timeBudgetMinutes ?? 60,
          exercises: sess.exercises
            .slice()
            .sort((a, b) => a.position - b.position)
            .map(ex => {
              const libMatch = exerciseLibrary.find(l => l.name.toLowerCase() === ex.exerciseName.toLowerCase());
              const mainMuscles = libMatch
                ? libMatch.muscles.filter(m => m.role === "main").map(m => m.muscle)
                : ex.muscleGroups ?? [];
              const secondaryMuscles = libMatch
                ? libMatch.muscles.filter(m => m.role === "secondary").map(m => m.muscle)
                : [];
              return {
                key: nextEditKey(),
                id: ex.id, // round-trip the DB id so a save keeps it (baseline-1RM map is keyed by it)
                name: ex.exerciseName,
                styleId: ex.styleId,
                styleName: ex.styleId ? (styles.find(s => s.id === ex.styleId)?.name ?? "") : "",
                exerciseRole: ex.exerciseRole ?? 'primary',
                muscleGroups: ex.muscleGroups,
                mainMuscles,
                secondaryMuscles,
                libraryId: libMatch?.id,
                supersetGroup: ex.supersetGroup ?? null,
              };
            }),
        }))
    );
    // Load schedule
    if (program.schedule?.type === "weekly") {
      setScheduleMode("weekly");
      setScheduleWeekDays(Array.from({ length: 7 }, (_, i) => program.schedule!.days?.some(d => d.dayOfWeek === i) ?? false));
      setScheduleRestAfterN(3);
    } else if (program.schedule?.type === "rotation" && program.schedule.restAfterN) {
      setScheduleMode("rotation");
      setScheduleRestAfterN(program.schedule.restAfterN);
      setScheduleWeekDays(Array(7).fill(false));
    } else {
      setScheduleMode("auto");
      setScheduleRestAfterN(3);
      setScheduleWeekDays(Array(7).fill(false));
    }
    setScheduleReminderEnabled(program.schedule?.reminderEnabled ?? false);
    setScheduleReminderTime(program.schedule?.reminderTime ?? "18:00");
    const mode = program.phaseMode ?? 'manual';
    setPhaseMode(mode);
    setPhases([]);
    setCurrentBlockStartedAt(program.startedAt);
    setSelectedPhaseSetId(program.phaseSetId ?? phaseSets.find(ps => ps.isDefault)?.id ?? phaseSets[0]?.id ?? '');
    setProgramSheetOpen(true);
  };

  const saveProgram = async () => {
    const trimmed = programName.trim();
    if (!trimmed) { toast.error("Program name is required"); return; }

    const sessionsList = programSessions
      .filter(s => s.name.trim())
      .map((sess, idx) => ({
        id: sess.id,
        name: sess.name.trim(),
        icon: sess.icon,
        timeBudgetMinutes: sess.timeBudgetMinutes ?? 60,
        position: idx,
        exercises: sess.exercises
          .filter(e => e.name.trim())
          .map((e, i) => ({
            id: e.id, // keep the DB id so saveProgram doesn't re-mint it (orphaning baseline 1RMs)
            exerciseName: e.name.trim(),
            styleId: e.styleId ?? undefined,
            exerciseRole: e.exerciseRole ?? 'primary',
            muscleGroups: e.muscleGroups ?? [],
            position: i,
            supersetGroup: e.supersetGroup ?? null,
          })),
      }));

    if (sessionsList.length === 0) { toast.error("Add at least one session"); return; }
    if (!sessionsList.some(s => s.exercises.length > 0)) {
      toast.error("Add at least one exercise to any session"); return;
    }

    setProgramSaving(true);
    try {
      const isActive = programEditId
        ? (programs.find(p => p.id === programEditId)?.isActive ?? false)
        : false;

      const schedule =
        scheduleMode === "weekly"
          ? {
              type: "weekly" as const,
              days: scheduleWeekDays.flatMap((on, i) => (on ? [{ dayOfWeek: i }] : [])),
              reminderEnabled: scheduleReminderEnabled,
              reminderTime: scheduleReminderEnabled ? scheduleReminderTime : null,
            }
          : scheduleMode === "rotation"
          ? { type: "rotation" as const, restAfterN: scheduleRestAfterN, reminderEnabled: scheduleReminderEnabled, reminderTime: scheduleReminderEnabled ? scheduleReminderTime : null }
          : null; // null = clear any existing schedule

      const res = await fetch("/api/workout-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          program: {
            id: programEditId ?? undefined,
            name: trimmed, isActive, sessions: sessionsList, schedule,
            phaseMode,
            phaseSetId: phaseMode === 'automatic' && selectedPhaseSetId ? selectedPhaseSetId : undefined,
            sessionsPerCycle: sessionsList.length,
            trainingGoal,
            autoApplyPrescriptions,
          },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Save failed');
      }
      toast.success("Program saved");
      await invalidateProgramStructure();
      // Refresh the on-device program mirror NOW, while lastSyncAt is still behind this
      // edit's timestamp so the delta actually carries the (re-saved) sessions. Without this
      // the mirror keeps its pre-edit session ids indefinitely — the delta cursor won't
      // re-fetch an unchanged-since program later — and the workout screen seeds a stale
      // session id into the AI request, which 404s ("couldn't generate the AI prescription").
      if (userId) await pullDelta(userId, true).catch(() => {});
      setProgramSheetOpen(false);
      load(); // background refresh — don't block the spinner on 4 network calls
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save program");
    } finally {
      setProgramSaving(false);
    }
  };

  const recalibrateCycle = async () => {
    if (!programEditId) return;
    setRecalibrating(true);
    try {
      const res = await fetch("/api/workout-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recalibrateCycleAnchor: true, programId: programEditId }),
      });
      if (!res.ok) throw new Error();
      toast.success("Cycle position recalculated from your training history");
      await invalidateProgramStructure();
    } catch {
      toast.error("Failed to recalibrate");
    } finally {
      setRecalibrating(false);
    }
  };

  const activateProgram = async (program: Program) => {
    // Optimistic update — flip active state immediately so there's no visible lag
    setPrograms(prev => prev.map(p => ({ ...p, isActive: p.id === program.id })));
    setDeleting(`activate:${program.id}`);
    try {
      const res = await fetch("/api/workout-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ program: { ...program, isActive: true } }),
      });
      if (!res.ok) throw new Error();
      await invalidateProgramStructure();
      toast.success(`"${program.name}" activated`);
      load(); // background refresh — don't await
    } catch {
      // Revert optimistic update
      setPrograms(prev => prev.map(p => ({ ...p, isActive: p.id === program.id ? false : p.isActive })));
      toast.error("Failed to activate");
    } finally {
      setDeleting(null);
    }
  };

  const deleteProgramById = async (program: Program) => {
    setDeleting(`program:${program.id}`);
    try {
      const res = await fetch("/api/workout-templates", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: program.id }),
      });
      if (!res.ok) throw new Error();
      toast.success("Program deleted");
      await invalidateProgramStructure();
      load(); // background refresh
    } catch {
      toast.error("Failed to delete program");
    } finally {
      setDeleting(null);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const [expandedProgramIds, setExpandedProgramIds] = useState<Set<string>>(new Set());
  const toggleProgramExpanded = (id: string) => {
    setExpandedProgramIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const approachLabel = (mode: string) => {
    if (mode === 'automatic') return 'Phase Based';
    if (mode === 'ai_dynamic') return 'AI Training';
    return 'Linear';
  };
  const approachPillClass = (mode: string) => {
    if (mode === 'ai_dynamic') return 'bg-brand/20 text-brand border-brand/30';
    if (mode === 'automatic') return 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/25';
    return 'bg-muted-foreground/10 text-muted-foreground border-muted-foreground/20';
  };

  return (
    <div className="flex flex-col bg-page min-h-screen">
      <div className="flex-1 px-4 py-4 space-y-6">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : (
          <>
            {/* ── Workouts ── */}
            <section>
              <button
                type="button"
                onClick={() => setWorkoutsOpen(o => !o)} aria-expanded={workoutsOpen}
                className="flex items-center justify-between w-full mb-3"
              >
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Programs
                </h2>
                <ChevronRight className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform",
                  workoutsOpen && "rotate-90"
                )} />
              </button>

              {workoutsOpen && (
                <div>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <button
                      onClick={() => setBuilderOpen(true)}
                      className="flex flex-col items-center gap-0.5 rounded-xl px-3 py-2.5 border border-brand bg-brand/10 hover:bg-brand/20 transition"
                    >
                      <div className="flex items-center gap-1.5">
                        <Wand2 className="h-4 w-4 text-brand" />
                        <span className="text-sm font-bold text-brand">AI Build</span>
                      </div>
                      <span className="text-[10px] text-brand/70">Generate with AI</span>
                    </button>
                    <button
                      onClick={openNewProgramSheet}
                      className="flex flex-col items-center gap-0.5 rounded-xl px-3 py-2.5 border border-border bg-muted hover:bg-muted/70 transition"
                    >
                      <div className="flex items-center gap-1.5">
                        <Plus className="h-4 w-4 text-foreground" />
                        <span className="text-sm font-bold text-foreground">Manual</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground">Build from scratch</span>
                    </button>
                  </div>
                  {programs.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No programs yet. Create one to get started.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {[...programs].sort((a, b) => (b.isActive ? 1 : 0) - (a.isActive ? 1 : 0)).map(program => {
                        const isExpanded = expandedProgramIds.has(program.id);
                        const sess = program.sessions.filter(s => s.exercises.length > 0);
                        return (
                        <div
                          key={program.id}
                          className={cn(
                            "rounded-xl border-l-4 border px-4 py-3",
                            program.isActive
                              ? "border-l-brand border-brand/30 bg-brand/10"
                              : "border-l-transparent border-transparent bg-muted"
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-semibold text-sm">{program.name}</p>
                                {program.isActive && (
                                  <span className="text-[10px] font-bold uppercase tracking-wide text-brand-foreground bg-brand px-2 py-0.5 rounded-full">
                                    Active
                                  </span>
                                )}
                                <span className={cn(
                                  "text-[10px] font-semibold px-2 py-0.5 rounded-full border",
                                  approachPillClass(program.phaseMode)
                                )}>
                                  {approachLabel(program.phaseMode)}
                                </span>
                              </div>
                              <Collapsible open={isExpanded} onOpenChange={() => toggleProgramExpanded(program.id)}>
                                <CollapsibleTrigger className="flex items-center gap-1 mt-0.5 text-left">
                                  <p className="text-xs text-muted-foreground truncate max-w-[180px]">
                                    {sess.map(s => s.name.replace(/\s*\(.*?\)\s*/g, '').trim()).join(' · ')}
                                  </p>
                                  <ChevronDown className={cn(
                                    "h-3 w-3 text-muted-foreground flex-none transition-transform",
                                    isExpanded && "rotate-180"
                                  )} />
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                  <div className="mt-2 space-y-1">
                                    {sess.map(s => (
                                      <div key={s.id} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                        <span className="truncate">{s.name}</span>
                                        <div className="flex items-center gap-1.5 flex-none">
                                          <span className="font-medium">{s.exercises.length} ex</span>
                                          {program.isActive && (
                                            <button
                                              onClick={() => setReviewSessionId(s.id)}
                                              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-brand hover:bg-brand/10 transition min-h-[36px]"
                                              title="AI review & adjust this workout to fit its time budget"
                                            >
                                              <SlidersHorizontal className="h-3 w-3" /> Review
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </CollapsibleContent>
                              </Collapsible>
                            </div>
                            <div className="flex gap-1 flex-none">
                              {!program.isActive && (
                                <button
                                  onClick={() => activateProgram(program)}
                                  disabled={deleting === `activate:${program.id}`}
                                  className="rounded-lg p-2 text-muted-foreground hover:text-brand hover:bg-background transition disabled:opacity-40"
                                  title="Set as active"
                                >
                                  <CheckIcon className="h-4 w-4" />
                                </button>
                              )}
                              <button
                                onClick={() => openEditProgram(program)}
                                className="rounded-lg p-2 text-muted-foreground hover:bg-background transition"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => deleteProgramById(program)}
                                disabled={deleting === `program:${program.id}`}
                                className="rounded-lg p-2 text-muted-foreground hover:text-destructive hover:bg-background transition disabled:opacity-40"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  )}
                  {/* ── Advanced Settings ── */}
                  <div className="mt-4 rounded-2xl bg-muted/40 border border-border overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setAdvancedOpen(v => !v)} aria-expanded={advancedOpen}
                      className="flex w-full items-center justify-between px-4 py-3.5 hover:bg-muted/60 transition"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-muted">
                          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-left">Advanced Settings</p>
                          <p className="text-[10px] text-muted-foreground">Progression styles, phase sets</p>
                        </div>
                      </div>
                      <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", advancedOpen && "rotate-180")} />
                    </button>
                    {advancedOpen && (
                      <div className="border-t border-border px-4 py-4 space-y-6">
                        {/* ── Progression Sets ── */}
                        <section>
                          <button
                            type="button"
                            onClick={() => setProgressionSetsOpen(o => !o)} aria-expanded={progressionSetsOpen}
                            className="flex items-center justify-between w-full mb-3"
                          >
                            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Progression Sets</h2>
                            <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", progressionSetsOpen && "rotate-90")} />
                          </button>
                          {progressionSetsOpen && (
                            <div>
                              <div className="flex items-center justify-between mb-3">
                                <div />
                                <button
                                  onClick={openNewStyle}
                                  className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold bg-brand text-brand-foreground hover:opacity-90 transition"
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                  New
                                </button>
                              </div>
                              {styles.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center py-4">No styles yet. Create one to get started.</p>
                              ) : (
                                <div className="space-y-2">
                                  {styles.map(style => (
                                    <div key={style.id} className="flex items-center justify-between rounded-xl bg-muted px-4 py-3">
                                      <div className="min-w-0 flex-1">
                                        <p className="font-semibold text-sm">{style.name}</p>
                                        <div className="flex flex-wrap gap-1 mt-1.5">
                                          <span className="text-[10px] rounded-full bg-brand/15 text-brand border border-brand/20 px-2 py-0.5 font-medium">
                                            {style.sets.length} set{style.sets.length !== 1 ? "s" : ""}
                                          </span>
                                          {(() => {
                                            const reps = style.sets.map(s => s.reps);
                                            const minR = Math.min(...reps); const maxR = Math.max(...reps);
                                            return <span className="text-[10px] rounded-full bg-muted border border-border px-2 py-0.5 text-muted-foreground font-medium">{minR === maxR ? `${minR} reps` : `${minR}–${maxR} reps`}</span>;
                                          })()}
                                          {(() => {
                                            const pcts = style.sets.map(s => s.pct);
                                            const minP = Math.min(...pcts); const maxP = Math.max(...pcts);
                                            return <span className="text-[10px] rounded-full bg-muted border border-border px-2 py-0.5 text-muted-foreground font-medium">{minP === maxP ? `${minP}%` : `${minP}–${maxP}%`}</span>;
                                          })()}
                                          {style.sets.some(s => s.restSec > 0) && (() => {
                                            const maxRest = Math.max(...style.sets.filter(s => s.restSec > 0).map(s => s.restSec));
                                            return <span className="text-[10px] rounded-full bg-muted border border-border px-2 py-0.5 text-muted-foreground font-medium">{maxRest >= 60 ? `${Math.round(maxRest / 60)}min rest` : `${maxRest}s rest`}</span>;
                                          })()}
                                        </div>
                                      </div>
                                      <div className="flex gap-1 ml-3 flex-none">
                                        <button onClick={() => openEditStyle(style)} className="rounded-lg p-2 text-muted-foreground hover:bg-background transition"><Pencil className="h-4 w-4" /></button>
                                        <button onClick={() => deleteStyle(style)} disabled={deleting === `style:${style.id}`} className="rounded-lg p-2 text-muted-foreground hover:text-destructive hover:bg-background transition disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </section>

                        {/* ── Phase Sets ── */}
                        <section>
                          <button
                            type="button"
                            onClick={() => setPhaseSetsOpen(o => !o)} aria-expanded={phaseSetsOpen}
                            className="flex items-center justify-between w-full mb-3"
                          >
                            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Phase Sets</h2>
                            <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", phaseSetsOpen && "rotate-90")} />
                          </button>
                          {phaseSetsOpen && (
                            <div>
                              <div className="flex justify-end mb-3">
                                <button onClick={() => openPhaseSetEditor(null)} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold bg-brand text-brand-foreground hover:opacity-90 transition">
                                  <Plus className="h-3.5 w-3.5" />New
                                </button>
                              </div>
                              {phaseSets.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center py-4">No phase sets yet.</p>
                              ) : (
                                <div className="space-y-2">
                                  {phaseSets.map(ps => (
                                    <div key={ps.id} className="rounded-xl bg-muted px-4 py-3 space-y-2">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 min-w-0">
                                          <p className="font-semibold text-sm">{ps.name}</p>
                                          {ps.isDefault && <span className="text-[10px] rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/20 px-2 py-0.5 font-medium shrink-0">Default</span>}
                                        </div>
                                        <div className="flex gap-1 ml-3 flex-none">
                                          {ps.isDefault ? (
                                            <button onClick={() => clonePhaseSet(ps)} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-background transition">Clone</button>
                                          ) : (
                                            <>
                                              <button onClick={() => openPhaseSetEditor(ps)} className="rounded-lg p-2 text-muted-foreground hover:bg-background transition"><Pencil className="h-4 w-4" /></button>
                                              <button onClick={() => deletePhaseSetById(ps)} disabled={deleting === `phaseset:${ps.id}`} className="rounded-lg p-2 text-muted-foreground hover:text-destructive hover:bg-background transition disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                      {ps.isDefault && ps.phases.length > 0 && (
                                        <div className="space-y-1 pt-1 border-t border-border/40">
                                          {ps.phases.map(ph => (
                                            <div key={ph.id} className="flex items-center justify-between text-xs text-muted-foreground">
                                              <span>{ph.name}</span>
                                              <span className="capitalize">{ph.phaseType === 'accessory' ? 'always · Accessory' : `${ph.durationCycles} cycle${ph.durationCycles !== 1 ? 's' : ''} · ${ph.phaseType}`}</span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                      {!ps.isDefault && <p className="text-xs text-muted-foreground">{ps.phases.length} phase{ps.phases.length !== 1 ? 's' : ''}</p>}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </section>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>

      <StyleEditorSheet
        open={styleSheetOpen}
        onOpenChange={setStyleSheetOpen}
        styleEditId={styleEditId}
        styleName={styleName}
        onStyleNameChange={setStyleName}
        styleSets={styleSets}
        onUpdateSet={updateSet}
        onUpdateSetRest={updateSetRest}
        onToggleUseFor1rm={toggleUseFor1rm}
        onAddSet={addSet}
        onRemoveSet={removeSet}
        onSave={saveStyle}
        saving={styleSaving}
      />

      <ProgramEditorSheet
        open={programSheetOpen}
        onOpenChange={setProgramSheetOpen}
        programEditId={programEditId}
        programName={programName}
        onProgramNameChange={setProgramName}
        programSessions={programSessions}
        onProgramSessionsChange={setProgramSessions}
        scheduleMode={scheduleMode}
        onScheduleModeChange={setScheduleMode}
        scheduleRestAfterN={scheduleRestAfterN}
        onScheduleRestAfterNChange={setScheduleRestAfterN}
        scheduleWeekDays={scheduleWeekDays}
        onScheduleWeekDaysChange={setScheduleWeekDays}
        phaseMode={phaseMode}
        onPhaseModeChange={setPhaseMode}
        phases={phases}
        onPhasesChange={setPhases}
        selectedPhaseSetId={selectedPhaseSetId}
        onSelectedPhaseSetIdChange={setSelectedPhaseSetId}
        currentBlockStartedAt={currentBlockStartedAt}
        recalibrating={recalibrating}
        onRecalibrate={recalibrateCycle}
        styles={styles}
        exerciseLibrary={exerciseLibrary}
        phaseSets={phaseSets}
        emojiPickerSession={emojiPickerSession}
        onEmojiPickerSessionChange={setEmojiPickerSession}
        scheduleReminderEnabled={scheduleReminderEnabled}
        onScheduleReminderEnabledChange={setScheduleReminderEnabled}
        scheduleReminderTime={scheduleReminderTime}
        onScheduleReminderTimeChange={setScheduleReminderTime}
        onSave={saveProgram}
        saving={programSaving}
        nextEditKey={nextEditKey}
        trainingGoal={trainingGoal}
        onTrainingGoalChange={setTrainingGoal}
        autoApplyPrescriptions={autoApplyPrescriptions}
        onAutoApplyPrescriptionsChange={setAutoApplyPrescriptions}
      />

      <PhaseSetEditorSheet
        open={phaseSetSheetOpen}
        onOpenChange={setPhaseSetSheetOpen}
        editingPhaseSet={editingPhaseSet}
        phaseSetEditName={phaseSetEditName}
        onPhaseSetEditNameChange={setPhaseSetEditName}
        phaseSetEditPhases={phaseSetEditPhases}
        onPhaseSetEditPhasesChange={setPhaseSetEditPhases}
        styles={styles}
        onSave={savePhaseSet}
        saving={phaseSetSaving}
      />

      <WorkoutReviewSheet
        sessionId={reviewSessionId}
        open={reviewSessionId !== null}
        onOpenChange={(open) => { if (!open) setReviewSessionId(null); }}
        onApplied={() => {
          fetch('/api/workout-templates')
            .then(r => r.ok ? r.json() : null)
            .then(data => { if (data?.programs) setPrograms(data.programs); });
        }}
      />

      {/* Builder Wizard Sheet — closing routes through the wizard's guard so a built
          program isn't lost to an accidental back/dismiss. */}
      <Sheet open={builderOpen} onOpenChange={(open) => { open ? setBuilderOpen(true) : builderCloseGuardRef.current(); }}>
        <SheetContent side="bottom" className="h-[92dvh] p-0 flex flex-col">
          <BuilderWizard
            onClose={() => setBuilderOpen(false)}
            registerCloseGuard={(fn) => { builderCloseGuardRef.current = fn; }}
            onSaved={() => {
              setBuilderOpen(false);
              fetch('/api/workout-templates')
                .then(r => r.ok ? r.json() : null)
                .then(data => { if (data?.programs) setPrograms(data.programs); });
            }}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
