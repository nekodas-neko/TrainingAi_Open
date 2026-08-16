"use client";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhaseEditor, type EditablePhase } from "@/components/config/phase-editor";
import type { PhaseSetWithPhases } from "@trainingai/shared/types/program";
import type { ProgressionStyle } from "@trainingai/shared/types";

interface PhaseSetEditorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingPhaseSet: PhaseSetWithPhases | null;
  phaseSetEditName: string;
  onPhaseSetEditNameChange: (name: string) => void;
  phaseSetEditPhases: EditablePhase[];
  onPhaseSetEditPhasesChange: (phases: EditablePhase[]) => void;
  styles: Pick<ProgressionStyle, "id" | "name">[];
  onSave: () => void;
  saving: boolean;
}

export function PhaseSetEditorSheet({
  open,
  onOpenChange,
  editingPhaseSet,
  phaseSetEditName,
  onPhaseSetEditNameChange,
  phaseSetEditPhases,
  onPhaseSetEditPhasesChange,
  styles,
  onSave,
  saving,
}: PhaseSetEditorSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90dvh] flex flex-col">
        <SheetHeader className="flex-none">
          <SheetTitle>{editingPhaseSet ? "Edit Phase Set" : "New Phase Set"}</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
          {(!editingPhaseSet || !editingPhaseSet.isDefault) && (
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">
                Name
              </label>
              <Input
                value={phaseSetEditName}
                onChange={e => onPhaseSetEditNameChange(e.target.value)}
                placeholder="e.g. Strength Focus"
              />
            </div>
          )}
          {editingPhaseSet?.isDefault && (
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold">Default</span> — name cannot be changed.
            </p>
          )}
          <PhaseEditor
            phases={phaseSetEditPhases}
            styleOptions={styles.map(s => ({ id: s.id, name: s.name }))}
            sessionsPerCycle={0}
            sessionNames={[]}
            avgSessionsPerWeek={0}
            onChange={onPhaseSetEditPhasesChange}
          />
        </div>
        <div className="flex-none px-4 pt-2 border-t">
          <Button
            className="w-full h-12 bg-brand hover:opacity-90 text-brand-foreground font-semibold"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save Phase Set"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
