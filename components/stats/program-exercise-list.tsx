"use client";

import { useState } from "react";
import type { ProgramSession } from "@trainingai/shared/types/program";
import type { MuscleAssignment } from "@trainingai/shared/types/program";
import { getPaletteEntry } from "@trainingai/shared/session-palette";
import { ExerciseHistorySheet } from "@/components/exercise-history-sheet";
import { cn } from "@trainingai/shared/utils";

interface ProgramExerciseListProps {
  sessions: ProgramSession[];
  muscleMap: Record<string, MuscleAssignment[]>;
}

export function ProgramExerciseList({ sessions, muscleMap }: ProgramExerciseListProps) {
  const [historyEx, setHistoryEx] = useState<{ name: string; muscles: MuscleAssignment[] } | null>(null);
  const [expandedSession, setExpandedSession] = useState<string | null>(sessions[0]?.id ?? null);

  return (
    <div className="space-y-3">
      {sessions.map(sess => {
        const p = getPaletteEntry(sess.position);
        const isExpanded = expandedSession === sess.id;
        return (
          <div key={sess.id} className={cn("rounded-2xl border overflow-hidden", p.bgClass, p.borderClass)}>
            <button
              className="w-full flex items-center gap-3 px-4 py-3 text-left"
              onClick={() => setExpandedSession(isExpanded ? null : sess.id)}
            >
              <span className="text-xl">{sess.icon ?? p.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className={cn("font-bold text-sm", p.textClass)}>{sess.name}</p>
                <p className="text-xs text-muted-foreground">{sess.exercises.length} exercises</p>
              </div>
              <svg
                className={cn("h-4 w-4 text-muted-foreground transition-transform flex-none", isExpanded && "rotate-180")}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              >
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {isExpanded && sess.exercises.length > 0 && (
              <div className="border-t border-border/40 divide-y divide-border/20">
                {sess.exercises.map(ex => {
                  const muscles = muscleMap[ex.exerciseName.toLowerCase()] ?? [];
                  const mainMuscles = muscles.filter(m => m.role === "main");
                  const secondaryMuscles = muscles.filter(m => m.role === "secondary");
                  return (
                    <button
                      key={ex.id}
                      onClick={() => setHistoryEx({ name: ex.exerciseName, muscles })}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{ex.exerciseName}</p>
                        {(mainMuscles.length > 0 || secondaryMuscles.length > 0) && (
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {mainMuscles.slice(0, 2).map(m => (
                              <span key={m.muscle} className="text-[10px] rounded-full px-2 py-0.5 font-medium"
                                style={{
                                  background: "color-mix(in oklch, var(--color-brand) 18%, transparent)",
                                  color: "var(--color-brand)",
                                  border: "1px solid color-mix(in oklch, var(--color-brand) 35%, transparent)",
                                }}>
                                {m.muscle}
                              </span>
                            ))}
                            {secondaryMuscles.slice(0, 2).map(m => (
                              <span key={m.muscle} className="text-[10px] rounded-full px-2 py-0.5 font-medium"
                                style={{
                                  background: "transparent",
                                  color: "var(--color-muted-foreground)",
                                  border: "1px solid color-mix(in oklch, var(--color-muted-foreground) 35%, transparent)",
                                }}>
                                {m.muscle}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <span className="text-muted-foreground text-sm flex-none">›</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <ExerciseHistorySheet
        exerciseName={historyEx?.name ?? null}
        muscles={historyEx?.muscles ?? []}
        onClose={() => setHistoryEx(null)}
      />
    </div>
  );
}
