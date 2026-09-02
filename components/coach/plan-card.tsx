"use client";

import { useEffect, useRef, useState } from "react";
import { BookmarkCheckIcon, Loader2Icon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCachedValue } from "@/lib/hooks/use-cached-value";
import { TTL_MEDIUM } from "@trainingai/shared/cache-ttl";
import { invalidateMealPlans } from "@/lib/cache-groups";
import { savePlanMealsToLibrary } from "@trainingai/shared/nutrition/save-plan-meal";
import type { MealPlan, MealPlanVariant } from "@trainingai/shared/types/nutrition";
import { PLAN_CARD_ACTIONS, type PlanCardArgs } from "@/lib/coach/widgets";

interface PlanCardProps {
  args: PlanCardArgs;
  /** Needed for the offline-first write — `savePlanMealsToLibrary` falls back to the API without
   *  it, which works on the web and leaves the device waiting on the network. */
  userId?: string;
  /** Absent once a newer turn exists, which renders the card inert. */
  onChose?: (id: string, label: string) => void;
  /** There is no plan to show. Resolves the call rather than leaving it hanging — an unanswered
   *  client-side tool call wedges every following turn (see `dangling-widgets.ts`). */
  onUnavailable?: (detail: string) => void;
}

/**
 * The meal plan as a card, ending in "Save all to My Foods" (LA-47, Q-407).
 *
 * **The model sends a title and nothing else.** Every meal below is read from the plan the app
 * already holds, for the reason `CHOICE_SOURCES` exists: a nine-meal plan typed out by the model is
 * several hundred output tokens spent transcribing rows the database hands over for free, and
 * output tokens are essentially all of Coach's latency. It also means the calories on screen are
 * the calories stored — a model retyping them can round, drop a meal, or reconcile them to a target
 * nobody asked it to hit.
 *
 * **Save all is the point of the whole conversation**, not a convenience on the end of it. The
 * owner's review: *"I want it to make the meal plan; then add each item to the saved meals/my
 * foods"*. A plan is a batch generator; what survives it is ordinary saved meals, which log in one
 * tap and can be edited ingredient by ingredient. So the copy says the plan is disposable.
 */
export function PlanCard({ args, userId, onChose, onUnavailable }: PlanCardProps) {
  const data = useCachedValue<{ plans: MealPlan[] }>(
    "meal-plans",
    "/api/nutrition/meal-plans",
    TTL_MEDIUM,
  );
  const [saving, setSaving] = useState(false);
  const resolved = useRef(false);

  const plan = data
    ? args.planId
      ? data.plans.find(p => p.id === args.planId)
      : data.plans.find(p => p.isActive)
    : undefined;

  // Report the dead end once, after the fetch has actually answered — resolving while `data` is
  // still undefined would cancel every plan card before its rows arrived.
  useEffect(() => {
    if (!data || plan || resolved.current || !onUnavailable) return;
    resolved.current = true;
    onUnavailable(args.planId ? "That plan is gone." : "There is no active meal plan yet.");
  }, [data, plan, onUnavailable, args.planId]);

  if (!data) {
    return (
      <div className="rounded-2xl border border-border bg-muted/20 px-3.5 py-4">
        <span className="text-[12px] text-muted-foreground">Loading your plan…</span>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-3.5 py-4">
        <span className="text-[12px] text-muted-foreground">
          {args.planId ? "That plan is gone." : "No meal plan yet."}
        </span>
      </div>
    );
  }

  // One variant, not both. A training/rest pair differs only in its carb number, and two stacked
  // lists of the same meals is a card nobody reads to the bottom of.
  const variant = pickVariant(plan);
  const meals = variant?.meals.slice().sort((a, b) => a.position - b.position) ?? [];
  const unsaved = meals.filter(m => m.savedMealId == null && m.ingredients.length > 0);
  const inert = !onChose || saving;

  const saveAll = async () => {
    if (!onChose) return;
    setSaving(true);
    const { stamped, failed } = await savePlanMealsToLibrary(unsaved, userId);
    if (stamped.size > 0) await invalidateMealPlans();
    setSaving(false);
    // The label is the user's answer as the model reads it back, and it is also the bubble they
    // see, so a partial save says so rather than reporting the number it hoped for.
    const saved = stamped.size;
    onChose(
      PLAN_CARD_ACTIONS.saveAll,
      failed > 0
        ? `Saved ${saved} of ${unsaved.length} meals to My Foods`
        : `Saved ${saved === 1 ? "1 meal" : `${saved} meals`} to My Foods`,
    );
  };

  return (
    <div className="rounded-2xl border border-border bg-muted/30 overflow-hidden">
      <div className="px-3.5 pt-3 pb-2">
        <p className="text-[13.5px] font-semibold leading-snug">{args.title}</p>
        <p className="text-[11.5px] text-muted-foreground">
          {/* The model usually titles the card with the plan's own name, and printing it twice
              reads as a rendering bug. Named only when it adds something. */}
          {plan.name !== args.title && `${plan.name} · `}
          {variant?.targetCalories.toLocaleString() ?? "—"} kcal · {meals.length}{" "}
          {meals.length === 1 ? "meal" : "meals"}
        </p>
      </div>

      <ul className="divide-y divide-border/60 border-y border-border/60">
        {meals.map(meal => (
          <li key={meal.id} className="flex items-center gap-3 px-3.5 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium truncate">{meal.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {Math.round(meal.targetCalories).toLocaleString()} kcal ·{" "}
                {meal.ingredients.length}{" "}
                {meal.ingredients.length === 1 ? "ingredient" : "ingredients"}
              </p>
            </div>
            {meal.savedMealId != null && (
              <BookmarkCheckIcon
                className="h-4 w-4 shrink-0"
                style={{ color: "var(--accent-green)" }}
                aria-label="In My Foods"
              />
            )}
          </li>
        ))}
      </ul>

      <div className="px-3.5 pt-2.5 pb-3">
        <p className="text-[11px] leading-snug text-muted-foreground">
          {unsaved.length === 0
            ? "Every meal here is already in My Foods, so the plan itself is disposable."
            : "Saving copies each meal into My Foods, where you can log or edit it. The plan itself is disposable after that."}
        </p>
        <div className="mt-2.5 flex gap-2">
          <Button
            variant="outline"
            className="h-12 flex-1"
            onClick={() => onChose?.(PLAN_CARD_ACTIONS.redo, "Build me a different plan")}
            disabled={inert}
          >
            <RotateCcwIcon className="h-4 w-4" />
            Redo
          </Button>
          <Button
            className="h-12 flex-[1.5]"
            onClick={saveAll}
            disabled={inert || unsaved.length === 0}
          >
            {saving ? <Loader2Icon className="h-4 w-4 animate-spin" /> : "Save all to My Foods"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The 'all' variant when the plan has one, otherwise the training day — the one the meals were
 *  written for. A rest variant alone is only possible on a malformed plan, and falling back to the
 *  first variant is better than rendering an empty card over one. */
function pickVariant(plan: MealPlan): MealPlanVariant | undefined {
  return (
    plan.variants.find(v => v.dayType === "all") ??
    plan.variants.find(v => v.dayType === "training") ??
    plan.variants[0]
  );
}
