"use client";

import dynamic from "next/dynamic";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";

const MealTypeManager = dynamic(
  () => import("@/components/nutrition/meal-type-manager").then(m => m.MealTypeManager),
  { ssr: false },
);

// The Nutrition tab's settings sheet — meal-reminder toggle and the meal-type manager. Extracted
// from `nutrition-content.tsx` (LB-139) as a pure move: that file sat at exactly the 800-line
// ceiling, and this sheet is the largest block in it that owns its own markup rather than wiring
// up a component that already exists.
export function NutritionSettingsSheet({
  open, onOpenChange, mealRemindersEnabled, onToggleMealReminders,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mealRemindersEnabled: boolean;
  onToggleMealReminders: (val: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] flex flex-col">
        <SheetHeader className="border-b border-border/30 pb-3 shrink-0">
          <SheetTitle>Nutrition Settings</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto scrollbar-hide p-4 space-y-6">
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Meal Reminders</h3>
            <div className="rounded-xl bg-muted px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Remind me to log meals</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Get a notification if a meal window ends with nothing logged
                </p>
              </div>
              <Switch checked={mealRemindersEnabled} onCheckedChange={onToggleMealReminders} aria-label="Remind me to log meals" />
            </div>
          </div>
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Meal Types</h3>
            <MealTypeManager />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
