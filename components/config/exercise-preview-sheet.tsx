"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Loader2, Dumbbell } from "lucide-react";
import type { ExerciseLibraryEntry } from "@trainingai/shared/types/program";

const EQUIPMENT_LABELS: Record<string, string> = {
  barbell: "Barbell", dumbbell: "Dumbbell", cable: "Cable",
  machine: "Machine", kettlebell: "Kettlebell", bodyweight: "Bodyweight",
};

interface GifState {
  gifUrl: string | null;
  loading: boolean;
}

interface ExercisePreviewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exercise: ExerciseLibraryEntry | null;
  onSelect?: (exercise: ExerciseLibraryEntry) => void;
}

export function ExercisePreviewSheet({ open, onOpenChange, exercise, onSelect }: ExercisePreviewSheetProps) {
  const [gif, setGif] = useState<GifState>({ gifUrl: null, loading: false });

  useEffect(() => {
    if (!open || !exercise) { setGif({ gifUrl: null, loading: false }); return; }
    setGif({ gifUrl: null, loading: true });
    fetch(`/api/exercise-gif?name=${encodeURIComponent(exercise.name)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setGif({ gifUrl: d?.gifUrl ?? null, loading: false }))
      .catch(() => setGif({ gifUrl: null, loading: false }));
  }, [open, exercise?.name]);

  if (!exercise) return null;

  const mainMuscles = exercise.muscles.filter(m => m.role === "main").map(m => m.muscle);
  const secondaryMuscles = exercise.muscles.filter(m => m.role === "secondary").map(m => m.muscle);

  function handleSelect() {
    if (onSelect && exercise) {
      onSelect(exercise);
      onOpenChange(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[85dvh] p-0 flex flex-col">
        <SheetHeader className="px-4 pt-4 pb-0 flex-none">
          <SheetTitle className="text-base">{exercise.name}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {/* GIF */}
          <div className="relative bg-muted flex items-center justify-center" style={{ minHeight: 220 }}>
            {gif.loading ? (
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            ) : gif.gifUrl ? (
              <Image
                src={gif.gifUrl}
                alt={exercise.name}
                fill
                sizes="100vw"
                unoptimized={gif.gifUrl.endsWith('.gif')}
                className="object-contain"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-muted-foreground py-10">
                <Dumbbell className="h-10 w-10 opacity-30" />
                <span className="text-xs">No preview available</span>
              </div>
            )}
          </div>

          <div className="px-4 py-4 space-y-4">
            {/* Equipment */}
            {exercise.equipment.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {exercise.equipment.map(eq => (
                  <span
                    key={eq}
                    className="text-xs px-2.5 py-1 rounded-full border border-border bg-muted text-muted-foreground capitalize"
                  >
                    {EQUIPMENT_LABELS[eq] ?? eq}
                  </span>
                ))}
              </div>
            )}

            {/* Muscles */}
            {(mainMuscles.length > 0 || secondaryMuscles.length > 0) && (
              <div className="space-y-1.5">
                {mainMuscles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {mainMuscles.map(m => (
                      <span key={m} className="text-xs px-2.5 py-1 rounded-full bg-brand/15 text-brand border border-brand/30 capitalize font-medium">
                        {m}
                      </span>
                    ))}
                  </div>
                )}
                {secondaryMuscles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {secondaryMuscles.map(m => (
                      <span key={m} className="text-xs px-2.5 py-1 rounded-full bg-muted border border-border text-muted-foreground capitalize">
                        {m}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Instructions */}
            {exercise.instructions && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">How to perform</p>
                <p className="text-sm leading-relaxed text-foreground">{exercise.instructions}</p>
              </div>
            )}

            {!exercise.instructions && (
              <p className="text-sm text-muted-foreground italic">No description available.</p>
            )}
          </div>
        </div>

        {onSelect && (
          <div className="flex-none px-4 pt-3 border-t border-border">
            <Button className="w-full" onClick={handleSelect}>
              Select {exercise.name}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
