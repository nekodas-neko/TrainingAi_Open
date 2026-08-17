"use client";

import { TrendingDownIcon } from "lucide-react";
import { cn } from "@trainingai/shared/utils";
import { useRovingRadioGroup } from "@/lib/hooks/use-roving-radio-group";

interface DeloadToggleProps {
  value: boolean;
  disabled?: boolean;
  /** Set when the readiness engine is asking for a deload today, so the toggle can say why it is
   *  worth using rather than sitting there unexplained. */
  recommended?: boolean;
  onChange: (next: boolean) => void;
}

/**
 * Today's intensity choice, next to today's length choice (Q-109-followup).
 *
 * This used to be a third button on Home's recommendation card, which decided intensity one screen
 * before you could see the session it applied to. It sits beside `SessionDurationPicker` because
 * they answer the same question — what shape is today's session — and because both are only
 * meaningful on the AI-dynamic path that actually honours them.
 *
 * Flipping it re-keys the workout-data cache and refetches, which is what the old navigation to
 * `?aiDeload=1` did; the difference is that it is now reversible without leaving the screen.
 */
export function DeloadToggle({ value, disabled = false, recommended = false, onChange }: DeloadToggleProps) {
  // Always one of Full/Deload, so `hasSelection` is unconditionally true.
  const intensityGroup = useRovingRadioGroup(true);
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <TrendingDownIcon className="h-3.5 w-3.5" aria-hidden />
          Intensity today
        </p>
        {recommended && (
          <p className="text-xs font-medium" style={{ color: "var(--accent-amber)" }}>
            Deload suggested
          </p>
        )}
      </div>
      <div
        {...intensityGroup.groupProps}
        aria-label="Intensity for today"
        className="grid grid-cols-2 gap-1 rounded-xl bg-muted/60 p-1"
      >
        {[
          { on: false, label: "Full", sub: "As prescribed" },
          { on: true, label: "Deload", sub: "Lighter loads" },
        ].map((opt, i) => {
          const active = opt.on === value;
          return (
            <button
              key={opt.label}
              type="button"
              {...intensityGroup.getRadioProps(active, i)}
              disabled={disabled}
              onClick={() => { if (!active) onChange(opt.on); }}
              className={cn(
                "flex min-h-12 flex-col items-center justify-center rounded-lg px-2 py-1.5 transition-colors",
                "disabled:opacity-50",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="text-sm font-semibold leading-tight">{opt.label}</span>
              <span className="text-[10px] leading-tight opacity-70">{opt.sub}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
