"use client";

import { TriangleAlertIcon } from "lucide-react";
import { injuryChipLabel, injuryLabel } from "./injury-muscles";

/**
 * The injury warning on an exercise, in the two sizes the workout screen needs (BF-135).
 *
 * **Both render the same facts from the same list**, which is the point of extracting them: the
 * ready screen and the active screen now both warn, and a warning that says one thing before the
 * set and another during it is worse than one place saying it twice.
 *
 * **The full banner belongs where the decision is**, on the ready screen — swapping a movement or
 * going lighter is chosen before the bar is loaded, not between set 3 and set 4. During the set the
 * same fact is a chip, because the header there is `flex-none` above a squeezed set list and every
 * row it costs pushes a set under the log sheet.
 *
 * **The chip keeps Swap, deliberately.** BF-135 is explicit that suppressing this warning is not an
 * acceptable fix and that an injury warning you cannot act on is worse than none — so shrinking it
 * may not cost the action. It is the whole chip rather than a link inside one, which is also how it
 * clears the repo's 48 dp tap floor without a second row.
 */

export function InjuryBanner({ muscles, onSwap }: { muscles: string[]; onSwap?: () => void }) {
  if (muscles.length === 0) return null;
  return (
    <div className="w-full rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2.5 flex items-start gap-2">
      <TriangleAlertIcon className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
      <div className="flex-1 flex items-start justify-between gap-2">
        <p className="text-xs text-amber-400 text-left">
          <span className="font-semibold">Injury active: </span>
          {injuryLabel(muscles)} — train with caution
        </p>
        {onSwap && (
          <button onClick={onSwap} className="text-xs font-semibold text-amber-400 underline shrink-0">
            Swap →
          </button>
        )}
      </div>
    </div>
  );
}

export function InjuryChip({ muscles, onSwap }: { muscles: string[]; onSwap?: () => void }) {
  if (muscles.length === 0) return null;
  const label = injuryLabel(muscles);
  const body = (
    <>
      <TriangleAlertIcon className="h-3.5 w-3.5 text-amber-500 shrink-0" />
      {/* "Injury:" earns its six characters. Without it the chip beside the title reads `⚠ Back`,
          and `Back` is the word on the arrow two rows above — a safety warning is the wrong place
          to make someone work out which one is meant. */}
      <span className="text-[11px] font-semibold text-amber-400 truncate">
        Injury: {injuryChipLabel(muscles)}
      </span>
      {onSwap && <span className="text-[11px] font-semibold text-amber-400 underline shrink-0">Swap</span>}
    </>
  );
  const shell = "flex items-center gap-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 px-2 py-1 max-w-[11rem]";

  return onSwap ? (
    <button
      type="button"
      onClick={onSwap}
      // The muscles alone read as a body-part label; the accessible name has to carry that this is a
      // warning and that activating it swaps the exercise, neither of which the visible text says.
      aria-label={`Injury active: ${label} — swap this exercise`}
      className={`${shell} shrink-0`}
    >
      {body}
    </button>
  ) : (
    <div role="status" aria-label={`Injury active: ${label}`} className={`${shell} shrink-0`}>
      {body}
    </div>
  );
}
