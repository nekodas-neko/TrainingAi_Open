"use client";

import { ClockIcon } from "lucide-react";
import { cn } from "@trainingai/shared/utils";
import { useRovingRadioGroup } from "@/lib/hooks/use-roving-radio-group";
import {
  presetForLength, requestedBudgetMin, sessionLengthOptions, type DurationPreset,
} from "@trainingai/shared/workout/duration-model";

interface SessionDurationPickerProps {
  /** Which length the currently-shown prescription was built for. */
  value: DurationPreset;
  /** The session's own configured budget: the anchor, marked "usual" and the default. */
  standardMin: number;
  /** Estimated working minutes for the current plan, shown alongside. */
  estimatedMin?: number | null;
  disabled?: boolean;
  /** Hide the built-in "Time today" label when the caller already renders a section heading. */
  hideHeader?: boolean;
  onChange: (preset: DurationPreset) => void;
}

/** Per-day time-budget choice for today's session — "45 minutes before work" vs a
 *  weekend session with time to spare. Picking one regenerates the prescription against
 *  that budget; the choice lives on the resulting plan, never on the program.
 *  The four lengths come from `sessionLengthOptions` (30/45/60/90 around the session's own). */
export function SessionDurationPicker({
  value, standardMin, estimatedMin, disabled = false, hideHeader = false, onChange,
}: SessionDurationPickerProps) {
  const lengths = sessionLengthOptions(standardMin);
  // The stored value may be a legacy label, so compare in minutes rather than by identity.
  const selectedMin = requestedBudgetMin(standardMin, value);
  const lengthGroup = useRovingRadioGroup(lengths.includes(selectedMin));
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
        {...lengthGroup.groupProps}
        aria-label="Session length for today"
        className="grid grid-cols-4 gap-1 rounded-xl bg-muted/60 p-1"
      >
        {lengths.map((min, i) => {
          const active = min === selectedMin;
          return (
            <button
              key={min}
              type="button"
              {...lengthGroup.getRadioProps(active, i)}
              disabled={disabled}
              // A tap commits on release (click fires on pointer-up): one rebuild per choice.
              onClick={() => { if (!active) onChange(presetForLength(standardMin, min)); }}
              className={cn(
                "flex min-h-12 flex-col items-center justify-center rounded-lg px-1 py-1.5 transition-colors",
                "disabled:opacity-50",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="text-sm font-semibold leading-tight tabular-nums">{min} min</span>
              <span className="text-[10px] leading-tight opacity-70">
                {min === standardMin ? "usual" : " "}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
