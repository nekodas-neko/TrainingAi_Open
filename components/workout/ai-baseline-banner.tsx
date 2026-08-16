"use client";

import { InfoIcon } from "lucide-react";

interface ExerciseHint {
  name: string;
  suggestedWeightKg: number | null;
}

interface AiBaselineBannerProps {
  exercises: ExerciseHint[];
}

export function AiBaselineBanner({ exercises }: AiBaselineBannerProps) {
  return (
    <div className="rounded-xl border border-brand/30 bg-brand/8 px-4 py-3 space-y-2">
      <div className="flex items-start gap-2">
        <InfoIcon className="h-4 w-4 text-brand mt-0.5 flex-none" />
        <div>
          <p className="text-sm font-semibold text-brand">First session — establish baseline</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            For each exercise, load the bar and do as many clean reps as you can (AMRAP).
            The AI will calculate your 1RM and start prescribing from the next session.
          </p>
        </div>
      </div>

      {exercises.some(e => e.suggestedWeightKg != null) && (
        <div className="space-y-1 pt-1 border-t border-brand/20">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            Suggested starting weights (≈70% of PR)
          </p>
          {exercises.map(ex => (
            <div key={ex.name} className="flex items-center justify-between text-xs">
              <span className="text-foreground">{ex.name}</span>
              {ex.suggestedWeightKg != null
                ? <span className="font-semibold tabular-nums text-brand">{ex.suggestedWeightKg} kg</span>
                : <span className="text-muted-foreground">enter manually</span>
              }
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
