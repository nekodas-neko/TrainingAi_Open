"use client";

import dynamic from "next/dynamic";
import type { MealPlan } from "@trainingai/shared/types/nutrition";

const MealPlanEditSheet = dynamic(
  () => import("@/components/nutrition/meal-plan-edit-sheet").then(m => m.MealPlanEditSheet),
  { ssr: false },
);
const MealPlanManageSheet = dynamic(
  () => import("@/components/nutrition/meal-plan-manage-sheet").then(m => m.MealPlanManageSheet),
  { ssr: false },
);
const MealPlanSetupSheet = dynamic(
  () => import("@/components/nutrition/meal-plan-setup-sheet").then(m => m.MealPlanSetupSheet),
  { ssr: false },
);

// The three meal-plan sheets, grouped because they hand off to each other: Manage's "rebuild"
// opens Setup and its "edit meals" opens Edit, so which one is open is one decision, not three.
// Extracted from `nutrition-content.tsx` (LB-139) as a pure move — the `dynamic({ ssr: false })`
// boundaries come across unchanged.
export function MealPlanSheets({
  plan, onPlanChanged, manageOpen, onManageOpenChange,
  editOpen, onEditOpenChange, setupOpen, onSetupOpenChange, userId,
}: {
  plan: MealPlan | null;
  onPlanChanged: (plan: MealPlan | null) => void;
  manageOpen: boolean;
  onManageOpenChange: (open: boolean) => void;
  editOpen: boolean;
  onEditOpenChange: (open: boolean) => void;
  setupOpen: boolean;
  onSetupOpenChange: (open: boolean) => void;
  userId?: string;
}) {
  return (
    <>
      <MealPlanManageSheet
        plan={manageOpen ? plan : null}
        onOpenChange={onManageOpenChange}
        onChanged={p => { onPlanChanged(p); onManageOpenChange(false); }}
        onRebuild={() => { onManageOpenChange(false); onSetupOpenChange(true); }}
        onEditMeals={() => { onManageOpenChange(false); onEditOpenChange(true); }}
      />

      <MealPlanEditSheet
        plan={editOpen ? plan : null}
        onOpenChange={onEditOpenChange}
        onChanged={onPlanChanged}
      />

      <MealPlanSetupSheet
        open={setupOpen}
        onOpenChange={onSetupOpenChange}
        onSaved={onPlanChanged}
        userId={userId}
      />
    </>
  );
}
