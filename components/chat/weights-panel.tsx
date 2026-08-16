"use client"

import { WeightDialModal } from "@/components/ui/weight-dial-modal";
import { WeightsSummary } from "@/components/weights-summary";
import type { ExerciseSummary } from "@/app/api/weights-summary/route";

interface WeightsPanelProps {
  sessionType: string;
  isWeightDialOpen: boolean;
  setIsWeightDialOpen: (open: boolean) => void;
  isBodyWeightDialOpen: boolean;
  setIsBodyWeightDialOpen: (open: boolean) => void;
  weightsSummary: ExerciseSummary[];
  weightsSummaryLoading: boolean;
  onWeightConfirm: (weight: number) => void;
  onBodyWeightConfirm: (weight: number) => void;
  onRefresh: () => void;
}

export function WeightsPanel({
  sessionType,
  isWeightDialOpen,
  setIsWeightDialOpen,
  isBodyWeightDialOpen,
  setIsBodyWeightDialOpen,
  weightsSummary,
  weightsSummaryLoading,
  onWeightConfirm,
  onBodyWeightConfirm,
  onRefresh,
}: WeightsPanelProps) {
  return (
    <>
      {sessionType === "Overview" && (
        <WeightsSummary
          exercises={weightsSummary}
          loading={weightsSummaryLoading}
          onRefresh={onRefresh}
        />
      )}

      <WeightDialModal
        open={isWeightDialOpen}
        onOpenChange={setIsWeightDialOpen}
        onConfirm={onWeightConfirm}
      />

      <WeightDialModal
        open={isBodyWeightDialOpen}
        onOpenChange={setIsBodyWeightDialOpen}
        initialWeight={80}
        onConfirm={onBodyWeightConfirm}
      />
    </>
  );
}
