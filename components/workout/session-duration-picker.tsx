"use client";

import { ClockIcon } from "lucide-react";
import { cn } from "@trainingai/shared/utils";
import { budgetForPreset, type DurationPreset } from "@trainingai/shared/workout/duration-model";

interface SessionDurationPickerProps {
  /** Which preset the currently-shown prescription was built for. */
  value: DurationPreset;
  /** The session's own configured budget, shown as the "Standard" sublabel. */
  standardMin: number;
  /** Estimated working minutes for the current plan, shown alongside. */
  estimatedMin?: number | null;
  disabled?: boolean;
  /** Hide the built-in "Time today" label when the caller already renders a section heading. */
  hideHeader?: boolean;
  onChange: (preset: DurationPreset) => void;
}

// Sublabels are derived, never hardcoded: short/long are the session's own budget ±30, so a
// 45-minute session must read 15/45/75 rather than a fixed 30/90 that doesn't apply to it.
const OPTIONS: Array<{ preset: DurationPreset; label: string }> = [
  { preset: 'short', label: 'Quick' },
  { preset: 'standard', label: 'Normal' },
  { preset: 'long', label: 'Long' },
];

/** Per-day time-budget choice for today's session — "30 minutes before work" vs a
 *  weekend session with time to spare. Picking one regenerates the prescription against
 *  that budget; the choice lives on the resulting plan, never on the program. */
export function SessionDurationPicker({
  value, standardMin, estimatedMin, disabled = false, hideHeader = false, onChange,
}: SessionDurationPickerProps) {
  return (
    <div className="mb-4">
      {!hideHeader && (
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <ClockIcon className="h-3.5 w-3.5" aria-hidden />
          Time today
        </p>
        {estimatedMin != null && (
          <p className="text-xs tabular-nums text-muted-foreground">~{estimatedMin} min of work</p>
        )}
      </div>
      )}
      <div
        role="radiogroup"
        aria-label="Session length for today"
        className="grid grid-cols-3 gap-1 rounded-xl bg-muted/60 p-1"
      >
        {OPTIONS.map(opt => {
          const active = opt.preset === value;
          return (
            <button
              key={opt.preset}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => { if (!active) onChange(opt.preset); }}
              className={cn(
                "flex min-h-12 flex-col items-center justify-center rounded-lg px-2 py-1.5 transition-colors",
                "disabled:opacity-50",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="text-sm font-semibold leading-tight">{opt.label}</span>
              <span className="text-[10px] leading-tight opacity-70 tabular-nums">
                {budgetForPreset(standardMin, opt.preset)} min
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
