"use client";

import { useState } from "react";
import { BookmarkPlusIcon, RefreshCwIcon, UtensilsCrossedIcon } from "lucide-react";
import { cn } from "@trainingai/shared/utils";
import { PLAN_CARD_ACTIONS, type PlanCardArgs } from "@/lib/coach/widgets";

/**
 * The plan the coach just produced, as two actions rather than a restatement of it (LA-47).
 *
 * **It renders no meals.** The plan is already on screen above this card — the client holds it, and
 * having the model type it out again would cost roughly the ~554 output tokens a nine-row picker
 * cost before `CHOICE_SOURCES` existed. Output tokens are essentially all of Coach's latency.
 *
 * The buttons resolve as ordinary `chose` results, so there is no third result shape to keep in
 * step: a card with two buttons is a choice list with a rich body.
 */
export function PlanCard({
  args,
  onChoose,
}: {
  args: PlanCardArgs;
  /** Absent once a newer turn exists, which renders the card inert rather than removing it — a
   *  question with no visible answer is worse than a disabled one. */
  onChoose?: (choice: { id: string; label: string }) => void;
}) {
  // Guards the double-tap, and it is not cosmetic here: save-all writes every meal in the plan to
  // the library, and a second tap mid-write is the "5 rapid taps fired 4 complete-workout POSTs"
  // shape this repo has already shipped once.
  const [taken, setTaken] = useState<string | null>(null);
  const inert = !onChoose || taken != null;

  const act = (id: string, label: string) => {
    if (inert) return;
    setTaken(id);
    onChoose?.({ id, label });
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-muted/20">
      <div className="flex items-center gap-3 px-3.5 py-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[color-mix(in_oklch,var(--accent-green)_14%,transparent)]">
          <UtensilsCrossedIcon className="h-4 w-4" style={{ color: "var(--accent-green)" }} />
        </div>
        <p className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{args.title}</p>
      </div>

      <div className="flex border-t border-border/40">
        <button
          type="button"
          disabled={inert}
          onClick={() => act(PLAN_CARD_ACTIONS.saveAll, "Save all to My Foods")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 px-3.5 min-h-[48px]",
            "text-sm font-semibold transition-colors",
            inert ? "text-muted-foreground/50" : "text-[var(--accent-green)] active:bg-muted/40",
          )}
        >
          <BookmarkPlusIcon className="h-4 w-4" />
          {taken === PLAN_CARD_ACTIONS.saveAll ? "Saving…" : "Save all"}
        </button>
        <button
          type="button"
          disabled={inert}
          onClick={() => act(PLAN_CARD_ACTIONS.redo, "Plan something else")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 px-3.5 min-h-[48px] border-l border-border/40",
            "text-sm font-semibold transition-colors",
            inert ? "text-muted-foreground/50" : "text-muted-foreground active:bg-muted/40",
          )}
        >
          <RefreshCwIcon className="h-4 w-4" />
          Try again
        </button>
      </div>
    </div>
  );
}
