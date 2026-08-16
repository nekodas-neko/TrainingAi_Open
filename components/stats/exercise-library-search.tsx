"use client";

import { useState } from "react";
import { SearchIcon, Plus } from "lucide-react";
import type { ExerciseLibraryEntry, ProgramSession } from "@trainingai/shared/types/program";
import { ExerciseHistorySheet } from "@/components/exercise-history-sheet";
import { AddExerciseSheet } from "@/components/exercises/add-exercise-sheet";
import { EmptyState } from "@/components/ui/empty-state";

interface ExerciseLibrarySearchProps {
  exercises: ExerciseLibraryEntry[];
  sessions: ProgramSession[];
  onExerciseAdded?: () => void;
}

export function ExerciseLibrarySearch({ exercises, sessions, onExerciseAdded }: ExerciseLibrarySearchProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [historyEx, setHistoryEx] = useState<{ name: string; muscles: ExerciseLibraryEntry["muscles"] } | null>(null);
  const [addSheetOpen, setAddSheetOpen] = useState(false);

  const exerciseToSession = new Map<string, string>();
  for (const sess of sessions) {
    for (const ex of sess.exercises) {
      if (!exerciseToSession.has(ex.exerciseName.toLowerCase())) {
        exerciseToSession.set(ex.exerciseName.toLowerCase(), sess.name);
      }
    }
  }

  const filters = ["All", ...sessions.map(s => s.name)];

  const filtered = exercises.filter(ex => {
    if (!ex.name.toLowerCase().includes(query.toLowerCase())) return false;
    if (filter === "All") return true;
    return exerciseToSession.get(ex.name.toLowerCase()) === filter;
  });

  return (
    <div className="space-y-3">
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search exercises…"
          className="w-full rounded-xl border border-border bg-muted pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>

      <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {filters.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex-none rounded-full px-3 py-1 text-xs font-semibold border transition ${
              filter === f
                ? "bg-brand text-brand-foreground border-brand"
                : "bg-muted text-muted-foreground border-border"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && (
          <EmptyState
            title="No matches"
            action={
              <button
                onClick={() => setAddSheetOpen(true)}
                className="flex items-center gap-1.5 text-sm font-semibold text-brand"
              >
                <Plus className="h-4 w-4" /> Add &quot;{query || 'exercise'}&quot; to library
              </button>
            }
          />
        )}
        {filtered.map(ex => {
          const mainMuscles = ex.muscles.filter(m => m.role === "main").map(m => m.muscle);
          const secondaryMuscles = ex.muscles.filter(m => m.role === "secondary").map(m => m.muscle);
          return (
            <button
              key={ex.id}
              onClick={() => setHistoryEx({ name: ex.name, muscles: ex.muscles })}
              className="w-full text-left rounded-xl bg-muted/60 border border-border px-4 py-3 flex items-center gap-3 hover:bg-muted transition"
            >
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{ex.name}</p>
                {(mainMuscles.length > 0 || secondaryMuscles.length > 0) && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {mainMuscles.map(m => (
                      <span key={m} className="text-[10px] rounded-full bg-brand/20 text-brand border border-brand/30 px-2 py-0.5 font-medium">
                        {m}
                      </span>
                    ))}
                    {secondaryMuscles.map(m => (
                      <span key={m} className="text-[10px] rounded-full bg-muted border border-border px-2 py-0.5 text-muted-foreground">
                        {m}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <span className="text-muted-foreground text-sm">›</span>
            </button>
          );
        })}
      </div>

      <ExerciseHistorySheet
        exerciseName={historyEx?.name ?? null}
        muscles={historyEx?.muscles ?? []}
        onClose={() => setHistoryEx(null)}
      />

      <AddExerciseSheet
        open={addSheetOpen}
        onOpenChange={setAddSheetOpen}
        initialName={query}
        onAdded={() => {
          setAddSheetOpen(false);
          onExerciseAdded?.();
        }}
      />
    </div>
  );
}
