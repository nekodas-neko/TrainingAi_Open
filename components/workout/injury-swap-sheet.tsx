"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
import { TTL_LONG } from "@trainingai/shared/cache-ttl";
import type { ExerciseLibraryEntry } from "@trainingai/shared/types/program";
import { injurySafeAlternatives } from "@trainingai/shared/workout/injury-substitution";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  original: { name: string; mainMuscles: string[] } | null;
  injuredMuscles: string[];
  onSwap: (alt: ExerciseLibraryEntry | null) => void;
}

export function InjurySwapSheet({ open, onOpenChange, original, injuredMuscles, onSwap }: Props) {
  const [library, setLibrary] = useState<ExerciseLibraryEntry[]>(() => {
    try {
      return readCacheSync<{ exercises: ExerciseLibraryEntry[] }>("exercise-library")?.exercises ?? [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (!open) return;
    cachedFetch<{ exercises: ExerciseLibraryEntry[] } | null>(
      "exercise-library", "/api/exercise-library", TTL_LONG,
      d => { if (d?.exercises) setLibrary(d.exercises); },
    ).catch(() => {});
  }, [open]);

  const alternatives = original ? injurySafeAlternatives(original, injuredMuscles, library) : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Swap Exercise</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-6 space-y-2">
          {alternatives.length === 0 ? (
            <div className="space-y-3 py-4">
              <p className="text-sm text-muted-foreground">
                No safe alternative targets {injuredMuscles.join(', ')} — consider skipping this exercise today.
              </p>
              <Button variant="outline" className="w-full" onClick={() => onSwap(null)}>
                Skip exercise
              </Button>
            </div>
          ) : (
            alternatives.map(ex => (
              <div key={ex.id} className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{ex.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {ex.muscles.filter(m => m.role === "main").map(m => m.muscle).join(", ")}
                    {ex.equipment.length > 0 ? ` · ${ex.equipment.join(", ")}` : ""}
                  </p>
                </div>
                <Button size="sm" variant="outline" className="h-7 text-xs px-2.5 shrink-0" onClick={() => onSwap(ex)}>
                  Use
                </Button>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
