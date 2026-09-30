"use client";

import { memo } from "react";
import { Thermometer } from "lucide-react";
import type { ReadinessScoreResponse } from "@/app/api/readiness-score/route";

/**
 * Home's illness-radar advisory, in TWO tiers (TN-45).
 *
 * **`watch` is the only band that has ever fired, and it had no UI at all** — it is the band with
 * no readiness penalty, so nothing on Home changed and nothing said anything. Two real firings
 * (2026-09-16 score 41, 2026-08-27 score 57) reached the owner as silence. The engine half shipped
 * the copy on 2026-09-18 (`illnessAdvisory(flag, biomarkers?)` names the one or two biomarkers
 * actually moving); this renders it.
 *
 * **The quiet tier is the owner's choice, not a design shortcut** — a line under the score rather
 * than this card. `watch` carries no penalty and no instruction, so a bordered advisory would
 * overstate it every time it fires, which is how a banner gets tuned out before the band that
 * matters uses it. Same two-tier reasoning as `SleepAnnouncement`'s `prominent`.
 *
 * ⛔ **The copy is `illnessAdvisory`'s and is never re-worded here.** TN-46 established that the
 * 2026-09-16 firing was Retatrutide (0.5 mg from 09-07, 1 mg from 09-13) tracking through resting
 * HR and HRV with a 2–4 day lag, **not illness** — so the line must name *what moved* and must
 * never imply infection. That is already true of the shared wording; a second phrasing here is a
 * second place for it to stop being true.
 *
 * ⛔ **And the quiet tier shows no band LABEL.** The prominent one prints `elevated`/`fever`,
 * which are words that mean something to a reader. "Watch" beside a neutral sentence reads as an
 * instruction the band does not carry.
 */
export const IllnessAdvisoryBanner = memo(function IllnessAdvisoryBanner({
  readiness,
}: {
  readiness: ReadinessScoreResponse;
}) {
  if (!readiness.illnessAdvisory) return null;

  if (readiness.illnessFlag === "watch") {
    return (
      // Matched to the chip row's own "Scores didn't load" line above it — same gutter, same size,
      // same muted colour — so it reads as a note about the scores rather than as furniture of its
      // own. `text-2xs` is the token at RV-209's 11px floor, not a literal.
      <p className="px-4 pb-2 text-2xs leading-snug text-muted-foreground">
        {readiness.illnessAdvisory}
      </p>
    );
  }

  if (readiness.illnessFlag !== "elevated" && readiness.illnessFlag !== "fever") return null;
  return (
    <div
      role="status"
      className="mx-4 mb-3 flex items-start gap-2.5 rounded-2xl border border-border bg-muted/60 px-3 py-2.5"
    >
      <Thermometer className="mt-0.5 h-4 w-4 shrink-0 text-foreground" aria-hidden />
      <div className="text-[12px] leading-snug text-foreground">
        <span className="font-semibold capitalize">{readiness.illnessFlag}</span>
        {readiness.illnessSuppression > 0 && (
          <span className="text-muted-foreground"> · readiness −{readiness.illnessSuppression}</span>
        )}
        <span className="block text-muted-foreground">{readiness.illnessAdvisory}</span>
      </div>
    </div>
  );
});
