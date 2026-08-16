"use client";

import { useWorkoutStore, effectiveRestSec } from "@/lib/stores/workout-store";
import { useElapsedSec } from "./session-clock";
import { RestRing } from "./rest-ring";

/**
 * Rest countdown for the set that was just logged, shown on the exercise-summary
 * screen. The last set still earns a rest period — this used to live on a separate
 * "all sets logged, tap Complete" screen (2026-07-28: reflexively spam-tapped while
 * just trying to rest), which is now skipped entirely; the summary screen doubles as
 * the rest screen instead. Self-subscribes and ticks on its own so only this small
 * leaf re-renders every second, not the whole summary screen (HR chart, sparklines).
 * Anchored on lastSetRestStartMs, same field the in-set rest ring and the beep/
 * notification/status-chip effects use (TMR-1) — cleared by advance() once the user
 * actually leaves this screen, so it never bleeds into the next exercise.
 */
export function LastSetRestTimer() {
  const restStartMs = useWorkoutStore(s => s.lastSetRestStartMs);
  const lastSetRestSec = useWorkoutStore(s => s.lastSetRestSec);
  const elapsed = useElapsedSec(restStartMs);

  if (restStartMs == null) return null;

  const currentRestSec = effectiveRestSec(lastSetRestSec);
  const restProgress = currentRestSec > 0 ? Math.min(1, elapsed / currentRestSec) : 0;
  const restRemaining = Math.max(0, currentRestSec - elapsed);
  const isRestOvertime = elapsed > currentRestSec;
  const overtimeSec = isRestOvertime ? elapsed - currentRestSec : 0;

  return (
    <div className="flex flex-col items-center py-2">
      <p
        className="text-[10px] font-bold uppercase tracking-widest mb-2"
        style={{ color: isRestOvertime ? "#ef4444" : "var(--color-muted-foreground)" }}
      >
        {isRestOvertime ? "Overtime" : "Resting"}
      </p>
      <div className="relative flex items-center justify-center">
        <RestRing
          restProgress={restProgress}
          restRemaining={restRemaining}
          currentRestSec={currentRestSec}
          isRestOvertime={isRestOvertime}
          overtimeSec={overtimeSec}
        />
      </div>
    </div>
  );
}
