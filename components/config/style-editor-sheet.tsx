"use client";

import { Plus, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@trainingai/shared/utils";

interface EditableSet { key: string; pct: number; reps: number; restSec?: number; useFor1rm?: boolean }

interface StyleEditorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  styleEditId: string | null;
  styleName: string;
  onStyleNameChange: (name: string) => void;
  styleSets: EditableSet[];
  onUpdateSet: (i: number, field: "pct" | "reps", raw: string) => void;
  onUpdateSetRest: (i: number, value: number) => void;
  onToggleUseFor1rm: (i: number) => void;
  onAddSet: () => void;
  onRemoveSet: (i: number) => void;
  onSave: () => void;
  saving: boolean;
}

export function StyleEditorSheet({
  open,
  onOpenChange,
  styleEditId,
  styleName,
  onStyleNameChange,
  styleSets,
  onUpdateSet,
  onUpdateSetRest,
  onToggleUseFor1rm,
  onAddSet,
  onRemoveSet,
  onSave,
  saving,
}: StyleEditorSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90dvh] flex flex-col">
        <SheetHeader className="flex-none">
          <SheetTitle>{styleEditId ? "Edit Style" : "New Style"}</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">
              Style Name
            </label>
            <Input
              value={styleName}
              onChange={e => onStyleNameChange(e.target.value)}
              placeholder="e.g. Strength"
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 block">
              Sets
            </label>
            <div className="space-y-2">
              {styleSets.map((set, i) => (
                <div key={set.key} className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground w-10 flex-none text-right">Set {i + 1}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={100}
                    value={set.pct}
                    onChange={e => onUpdateSet(i, "pct", e.target.value)}
                    className="w-16 rounded-lg border bg-muted px-2 py-1.5 text-sm text-center font-semibold focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                  <span className="text-xs text-muted-foreground">% of 1RM</span>
                  <span className="text-xs text-muted-foreground">×</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={50}
                    value={set.reps}
                    onChange={e => onUpdateSet(i, "reps", e.target.value)}
                    className="w-14 rounded-lg border bg-muted px-2 py-1.5 text-sm text-center font-semibold focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                  <span className="text-xs text-muted-foreground">reps</span>
                  <span className="text-xs text-muted-foreground">·</span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Recommended Rest</span>
                  <select
                    value={set.restSec ?? 0}
                    onChange={e => onUpdateSetRest(i, parseInt(e.target.value, 10))}
                    className="flex-1 min-w-[4.5rem] rounded-lg border bg-muted px-2 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-brand"
                  >
                    <option value={0}>—</option>
                    <option value={60}>1:00</option>
                    <option value={90}>1:30</option>
                    <option value={120}>2:00</option>
                    <option value={180}>3:00</option>
                    <option value={240}>4:00</option>
                    <option value={300}>5:00</option>
                  </select>
                  <button
                    onClick={() => onToggleUseFor1rm(i)}
                    title={set.useFor1rm ? "Counts toward 1RM calculation" : "Excluded from 1RM calculation"}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide transition border",
                      set.useFor1rm
                        ? "bg-brand text-brand-foreground border-brand"
                        : "bg-transparent text-muted-foreground border-border"
                    )}
                  >
                    1RM
                  </button>
                  {styleSets.length > 1 && (
                    <button
                      onClick={() => onRemoveSet(i)}
                      className="rounded-lg p-1.5 text-muted-foreground hover:text-destructive transition"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={onAddSet}
              className="mt-2 flex items-center gap-1 text-xs font-semibold text-brand hover:opacity-70 transition"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Set
            </button>
          </div>
        </div>
        <div className="flex-none px-4 pt-2 border-t">
          <Button
            className="w-full h-12 bg-brand hover:opacity-90 text-brand-foreground font-semibold"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save Style"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
