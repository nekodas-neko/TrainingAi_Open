"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WeightDial } from "@/components/ui/weight-dial";
import { calc1RM, calculate1RM, type RMStyleSet } from "@trainingai/shared/1rm";

interface OneRmCalculatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialWeight: number;
  progressionStyle?: RMStyleSet[] | null;
}

export function OneRmCalculatorDialog({
  open,
  onOpenChange,
  initialWeight,
  progressionStyle,
}: OneRmCalculatorDialogProps) {
  const [calcWeight, setCalcWeight] = useState(initialWeight);
  const [calcReps, setCalcReps] = useState(5);

  // Reset to the current dial weight each time the dialog opens
  useEffect(() => {
    if (open) setCalcWeight(initialWeight);
  }, [open, initialWeight]);

  const rawResult = calcReps > 0 && calcWeight > 0 ? calc1RM(calcWeight, calcReps) : null;

  const highestPctSet = progressionStyle && progressionStyle.length > 0
    ? progressionStyle.reduce((a, b) => b.pct > a.pct ? b : a)
    : null;

  const adjustedResult = rawResult !== null && highestPctSet
    ? calculate1RM([calcWeight], [calcReps], [highestPctSet]).estimated1rm
    : null;

  const calcResult = adjustedResult ?? rawResult;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>1RM Calculator</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex gap-4">
            <div className="flex-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide text-center mb-1.5">
                Weight (kg)
              </p>
              <WeightDial value={calcWeight} onChange={setCalcWeight} visible={3} min={5} max={250} />
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide text-center mb-1.5">
                Reps
              </p>
              <WeightDial
                value={calcReps}
                onChange={setCalcReps}
                visible={3}
                min={1}
                max={36}
                step={1}
                unit=""
              />
            </div>
          </div>
          {calcResult !== null && (
            <div className="rounded-xl bg-brand/10 p-4 text-center">
              <p className="text-xs font-medium text-brand uppercase tracking-wide mb-1">
                {adjustedResult ? "Logged Estimate" : "Estimated 1RM"}
              </p>
              <p className="text-3xl font-bold text-brand tabular-nums">{calcResult} kg</p>
              {adjustedResult && rawResult && adjustedResult !== rawResult && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Raw formula: {rawResult} kg
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                80% target: {Math.round(calcResult * 0.8 * 4) / 4} kg
              </p>
              {adjustedResult && highestPctSet && (
                <p className="text-[10px] text-muted-foreground/60 mt-1">
                  Adjusted for {highestPctSet.pct}% × {highestPctSet.reps} rep prescription
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
