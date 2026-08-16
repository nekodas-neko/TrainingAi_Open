"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { Search, X, Info } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@trainingai/shared/utils";
import type { ExerciseLibraryEntry } from "@trainingai/shared/types/program";
import { ExercisePreviewSheet } from "@/components/config/exercise-preview-sheet";

const EQUIPMENT_LABELS: Record<string, string> = {
  barbell:    "Barbell",
  dumbbell:   "Dumbbell",
  cable:      "Cable",
  machine:    "Machine",
  kettlebell: "Kettlebell",
  bodyweight: "Bodyweight",
};

const EQUIPMENT_ORDER = ["barbell", "dumbbell", "cable", "machine", "kettlebell", "bodyweight"];

// Muscle group buckets for the filter row
const MUSCLE_GROUPS: { label: string; muscles: string[] }[] = [
  { label: "Chest",     muscles: ["chest"] },
  { label: "Back",      muscles: ["upper back", "lats", "lower back"] },
  { label: "Shoulders", muscles: ["shoulders"] },
  { label: "Arms",      muscles: ["biceps", "triceps", "forearms"] },
  { label: "Legs",      muscles: ["quads", "hamstrings", "calves"] },
  { label: "Glutes",    muscles: ["glutes"] },
  { label: "Core",      muscles: ["core", "abs"] },
  { label: "Traps",     muscles: ["traps"] },
];

interface ExercisePickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exerciseLibrary: ExerciseLibraryEntry[];
  onSelect: (entry: ExerciseLibraryEntry) => void;
}

export function ExercisePickerSheet({ open, onOpenChange, exerciseLibrary, onSelect }: ExercisePickerSheetProps) {
  const [search, setSearch] = useState("");
  const [equipFilter, setEquipFilter] = useState<string | null>(null);
  const [muscleFilter, setMuscleFilter] = useState<string | null>(null);
  const [preview, setPreview] = useState<ExerciseLibraryEntry | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setSearch("");
      setEquipFilter(null);
      setMuscleFilter(null);
      const t = setTimeout(() => inputRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [open]);

  const availableEquipment = useMemo(() => {
    const present = new Set(exerciseLibrary.flatMap(e => e.equipment));
    return EQUIPMENT_ORDER.filter(eq => present.has(eq));
  }, [exerciseLibrary]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const muscleGroup = muscleFilter ? MUSCLE_GROUPS.find(g => g.label === muscleFilter) : null;

    return exerciseLibrary.filter(e => {
      if (equipFilter && !e.equipment.includes(equipFilter)) return false;
      if (muscleGroup) {
        const exerciseMuscles = e.muscles.map(m => m.muscle.toLowerCase());
        if (!muscleGroup.muscles.some(gm => exerciseMuscles.includes(gm))) return false;
      }
      if (q && !e.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [exerciseLibrary, search, equipFilter, muscleFilter]);

  function handleSelect(entry: ExerciseLibraryEntry) {
    onSelect(entry);
    onOpenChange(false);
  }

  function handlePreview(e: React.MouseEvent, entry: ExerciseLibraryEntry) {
    e.stopPropagation();
    setPreview(entry);
  }

  function handlePreviewSelect(entry: ExerciseLibraryEntry) {
    handleSelect(entry);
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[85dvh] p-0 flex flex-col">
          <SheetHeader className="px-4 pt-4 pb-2 flex-none">
            <SheetTitle className="text-base">Choose exercise</SheetTitle>
          </SheetHeader>

          {/* Search */}
          <div className="px-4 pb-2 flex-none">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <input
                ref={inputRef}
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search exercises…"
                className="w-full rounded-lg border border-input bg-background pl-9 pr-9 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* Muscle group filter */}
          <div className="flex-none overflow-x-auto px-4 pb-2" style={{ scrollbarWidth: "none" }}>
            <div className="flex gap-2 w-max">
              <button
                type="button"
                onClick={() => setMuscleFilter(null)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap",
                  muscleFilter === null && !equipFilter
                    ? "bg-brand text-brand-foreground border-brand"
                    : "bg-muted text-muted-foreground border-transparent"
                )}
              >
                All
              </button>
              {MUSCLE_GROUPS.map(g => (
                <button
                  key={g.label}
                  type="button"
                  onClick={() => setMuscleFilter(muscleFilter === g.label ? null : g.label)}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap",
                    muscleFilter === g.label
                      ? "bg-brand text-brand-foreground border-brand"
                      : "bg-muted text-muted-foreground border-transparent"
                  )}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          {/* Equipment filter chips */}
          <div className="flex-none overflow-x-auto px-4 pb-3" style={{ scrollbarWidth: "none" }}>
            <div className="flex gap-2 w-max">
              {availableEquipment.map(eq => (
                <button
                  key={eq}
                  type="button"
                  onClick={() => setEquipFilter(equipFilter === eq ? null : eq)}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap",
                    equipFilter === eq
                      ? "bg-brand/20 text-brand border-brand"
                      : "bg-muted text-muted-foreground border-transparent"
                  )}
                >
                  {EQUIPMENT_LABELS[eq] ?? eq}
                </button>
              ))}
            </div>
          </div>

          {/* Exercise list */}
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-12">No exercises found</p>
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map(entry => {
                  const mainMuscles = entry.muscles
                    .filter(m => m.role === "main")
                    .map(m => m.muscle)
                    .slice(0, 2);
                  return (
                    <li key={entry.id}>
                      <div className="flex items-center gap-1 px-4 py-3">
                        <button
                          type="button"
                          onClick={() => handleSelect(entry)}
                          className="flex-1 min-w-0 text-left active:bg-muted/50 transition-colors"
                        >
                          <p className="text-sm font-medium leading-snug">{entry.name}</p>
                          {mainMuscles.length > 0 && (
                            <p className="text-xs text-muted-foreground mt-0.5 capitalize">{mainMuscles.join(" · ")}</p>
                          )}
                        </button>
                        {entry.equipment.length > 0 && (
                          <span className="flex-none text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full capitalize">
                            {EQUIPMENT_LABELS[entry.equipment[0]] ?? entry.equipment[0]}
                          </span>
                        )}
                        <button
                          type="button"
                          aria-label={`Preview ${entry.name}`}
                          onClick={e => handlePreview(e, entry)}
                          className="flex-none ml-1 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                          <Info className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <ExercisePreviewSheet
        open={preview !== null}
        onOpenChange={isOpen => { if (!isOpen) setPreview(null); }}
        exercise={preview}
        onSelect={handlePreviewSelect}
      />
    </>
  );
}
