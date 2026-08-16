"use client";

import { useRef, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FIELD_LABEL, FIELD_UNIT } from "@/lib/coach/patch";
import type { NumberDialArgs } from "@/lib/coach/widgets";
import { GOAL_LOCAL_STORAGE_KEYS } from "@/lib/coach/domains/goals";
import { invalidateCoachHistory, invalidateGoalRecommendations } from "@/lib/cache-groups";

interface NumberDialProps {
  args: NumberDialArgs;
  onApplied?: (summary: string) => void;
  onCancel?: () => void;
}

/**
 * A single number, adjustable before you commit to it.
 *
 * For tier-1 values this **is** the confirmation — no separate ChangePreview, because a number you
 * can see and set back does not need a second card agreeing that you meant it. What it must never
 * drop is the delta line: a target with no reference to the one it replaces is not something
 * anyone can judge.
 *
 * Adjustment is by step buttons rather than the scroll-wheel `weight-dial`, deliberately: that
 * component is built around kilogram plate maths (`mround125`), and calories and step counts do not
 * move in 1.25 increments.
 */
export function NumberDial({ args, onApplied, onCancel }: NumberDialProps) {
  const change = args.patch.changes[0];
  const from = change?.from == null ? null : Number(change.from);
  const [value, setValue] = useState<number>(Number(change?.to ?? 0));
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  if (!change) return null;

  const unit = FIELD_UNIT[change.field] ?? "";
  const step = stepFor(change.field);
  const delta = from == null ? null : value - from;

  async function apply() {
    if (inFlight.current) return;
    inFlight.current = true;
    setApplying(true);
    setError(null);
    try {
      // The dial's value, not the model's — the whole point of showing a dial is that the number
      // is the user's to move.
      const patch = { ...args.patch, changes: [{ ...change, to: value }] };
      const res = await fetch("/api/coach/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patch, acceptedChangeIds: [change.id] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not apply the change");
        return;
      }
      const key = GOAL_LOCAL_STORAGE_KEYS[change.field];
      if (key) {
        try {
          localStorage.setItem(key, String(Math.round(value)));
        } catch {
          /* a blocked localStorage must not fail an applied change */
        }
      }
      // The goal is in the database now; without this, Health keeps rendering the previous one
      // from the `user-goals` cache for up to its TTL (the Q-240 omission, third surface).
      if (args.patch.domain === "user_goals") invalidateGoalRecommendations().catch(() => {});
      // An applied change becomes a row in the Coach history list.
      invalidateCoachHistory().catch(() => {});
      onApplied?.(data.summary ?? "Change applied");
    } catch {
      setError("Could not reach the server");
    } finally {
      inFlight.current = false;
      setApplying(false);
    }
  }

  return (
    <div className="rounded-2xl border overflow-hidden border-[color-mix(in_oklch,var(--accent-purple)_28%,transparent)] bg-[color-mix(in_oklch,var(--accent-purple)_7%,transparent)]">
      <div className="px-3.5 py-2.5 border-b border-border/60">
        <span className="text-[11px] font-semibold tracking-wide text-muted-foreground">{args.title}</span>
      </div>

      <div className="flex flex-col items-center gap-1 pt-5 pb-2">
        <p className="text-[34px] font-extrabold tracking-tight tabular-nums leading-none">
          {Math.round(value).toLocaleString()}
        </p>
        <p className="text-[11.5px] text-muted-foreground">
          {FIELD_LABEL[change.field]}
          {unit && ` (${unit.trim()})`}
        </p>
      </div>

      <div className="flex items-center justify-center gap-3 pb-3">
        <Button
          variant="outline"
          className="h-12 w-16"
          aria-label={`Decrease by ${step}`}
          onClick={() => setValue(v => Math.max(0, v - step))}
          disabled={applying}
        >
          −{step}
        </Button>
        <Button
          variant="outline"
          className="h-12 w-16"
          aria-label={`Increase by ${step}`}
          onClick={() => setValue(v => v + step)}
          disabled={applying}
        >
          +{step}
        </Button>
      </div>

      {delta !== null && delta !== 0 && (
        <p
          className="text-center text-[12px] tabular-nums pb-2"
          style={{ color: delta > 0 ? "var(--accent-green)" : "var(--accent-amber)" }}
        >
          {delta > 0 ? "+" : "−"}
          {Math.abs(Math.round(delta)).toLocaleString()} from your current{" "}
          {Math.round(from!).toLocaleString()}
        </p>
      )}

      {error && (
        <div className="mx-3.5 mb-2 rounded-lg px-3 py-2 bg-destructive/10">
          <p className="text-[12px] text-destructive">{error}</p>
        </div>
      )}

      {onApplied && (
        <div className="flex gap-2.5 px-3.5 pt-1 pb-3.5">
          <Button variant="outline" className="flex-1 h-12" onClick={onCancel} disabled={applying}>
            Cancel
          </Button>
          <Button className="flex-[1.5] h-12" onClick={apply} disabled={applying || value === from}>
            {applying ? <Loader2Icon className="h-4 w-4 animate-spin" /> : "Set"}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Steps that match how each value is actually thought about, not one generic increment. */
function stepFor(field: string): number {
  if (field === "stepsGoal") return 500;
  if (field === "waterGoalMl") return 250;
  if (field === "calories" || field === "calorieGoal") return 50;
  return 5;
}
