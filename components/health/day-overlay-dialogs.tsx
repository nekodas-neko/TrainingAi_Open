"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import type { DayExercise } from "@/app/api/day-log/route";
import type { ActivityLog } from "@trainingai/shared/types";

type EditExState = { ex: DayExercise; weights: number[]; reps: number[] } | null;

interface Props {
  editEx: EditExState;
  onEditExChange: (next: EditExState) => void;
  onEditSave: () => void;
  deleteEx: DayExercise | null;
  onDeleteExClose: () => void;
  onDeleteExConfirm: () => void;
  deleteActivity: ActivityLog | null;
  onDeleteActivityClose: () => void;
  onDeleteActivityConfirm: () => void;
  deleteSession: { id: string; name: string } | null;
  onDeleteSessionClose: () => void;
  onDeleteSessionConfirm: () => void;
  mutating: boolean;
}

// The edit-set / delete-entry / delete-session confirm dialogs triggered from the
// day-overlay sheet — extracted from health-content.tsx (Task 4.4) as a pure move,
// no behaviour change.
export function DayOverlayDialogs({
  editEx, onEditExChange, onEditSave,
  deleteEx, onDeleteExClose, onDeleteExConfirm,
  deleteActivity, onDeleteActivityClose, onDeleteActivityConfirm,
  deleteSession, onDeleteSessionClose, onDeleteSessionConfirm,
  mutating,
}: Props) {
  return (
    <>
      <Dialog open={editEx !== null} onOpenChange={open => { if (!open) onEditExChange(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="truncate">{editEx?.ex.name}</DialogTitle></DialogHeader>
          {editEx && (
            <div className="space-y-3">
              {editEx.weights.slice(0, editEx.ex.sets ?? 3).map((w, i) => (
                <div key={`set-${i + 1}`} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-10 flex-none">Set {i + 1}</span>
                  <div className="flex-1 flex gap-2">
                    <div className="flex-1">
                      <label className="text-[10px] text-muted-foreground">kg</label>
                      <input type="number" min={0} step={0.25} value={w}
                        onChange={e => { const n = [...editEx.weights]; n[i] = parseFloat(e.target.value) || 0; onEditExChange({ ...editEx, weights: n }); }}
                        className="w-full rounded-md border bg-background px-2 py-1 text-sm tabular-nums" />
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] text-muted-foreground">reps</label>
                      <input type="number" min={1} step={1} value={editEx.reps[i] ?? 1}
                        onChange={e => { const n = [...editEx.reps]; n[i] = parseInt(e.target.value) || 1; onEditExChange({ ...editEx, reps: n }); }}
                        className="w-full rounded-md border bg-background px-2 py-1 text-sm tabular-nums" />
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => onEditExChange(null)}>Cancel</Button>
                <Button className="flex-1" disabled={mutating} onClick={onEditSave}>{mutating ? "Saving…" : "Save"}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={deleteEx !== null} onOpenChange={open => { if (!open) onDeleteExClose(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete entry?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Remove <span className="font-medium text-foreground">{deleteEx?.name}</span>? This cannot be undone.</p>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={onDeleteExClose}>Cancel</Button>
            <Button variant="destructive" className="flex-1" disabled={mutating} onClick={onDeleteExConfirm}>{mutating ? "Deleting…" : "Delete"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteActivity !== null} onOpenChange={open => { if (!open) onDeleteActivityClose(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete activity?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Remove <span className="font-medium text-foreground">{deleteActivity?.title}</span>? This cannot be undone.</p>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={onDeleteActivityClose}>Cancel</Button>
            <Button variant="destructive" className="flex-1" disabled={mutating} onClick={onDeleteActivityConfirm}>{mutating ? "Deleting…" : "Delete"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteSession !== null}
        onOpenChange={open => { if (!open) onDeleteSessionClose(); }}
        title="Delete session?"
        message={deleteSession ? `Remove the entire ${deleteSession.name} session and all its exercises? This cannot be undone.` : ""}
        confirmLabel={mutating ? "Deleting…" : "Delete"}
        variant="destructive"
        onConfirm={onDeleteSessionConfirm}
      />
    </>
  );
}
