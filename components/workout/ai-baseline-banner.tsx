"use client";

import { InfoIcon } from "lucide-react";
import { type BaselineHint, hasAnyHint } from "@/components/workout/baseline-hints";

interface ExerciseHint {
  name: string;
  hint: BaselineHint;
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
            For each exercise, do as many clean reps as you can (AMRAP). Weighted movements start
            at roughly 70% of your PR; bodyweight ones are just your bodyweight.
            The AI will calculate your 1RM and start prescribing from the next session.
          </p>
        </div>
      </div>

      {/* BF-127: the heading no longer promises a weight for every row. A bodyweight movement has
          no load to suggest, and its stored 1RM is a BW_REF-relative index rather than kilograms —
          printing 70% of it as kg told the owner to hang 82.5 kg from a pull-up bar. */}
      {hasAnyHint(exercises.map(e => e.hint)) && (
        <div className="space-y-1 pt-1 border-t border-brand/20">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            Suggested starting point
          </p>
          {exercises.map(ex => (
            <div key={ex.name} className="flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate text-foreground">{ex.name}</span>
              <HintValue hint={ex.hint} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The right-hand value of one row: a load, a bodyweight note, or an admission that there is none. */
function HintValue({ hint }: { hint: BaselineHint }) {
  if (hint.kind === 'load') {
    return <span className="flex-none font-semibold tabular-nums text-brand">{hint.kg} kg</span>;
  }
  if (hint.kind === 'bodyweight') {
    return (
      <span className="flex-none font-semibold text-brand">
        Bodyweight
        {/* Their rep max, not a target: 70% of a rep max is not a prescription, because reps do not
            scale that way. It is the number an AMRAP set is measured against. */}
        {hint.repMax != null && (
          <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">{hint.repMax} RM</span>
        )}
      </span>
    );
  }
  return <span className="flex-none text-muted-foreground">enter manually</span>;
}
