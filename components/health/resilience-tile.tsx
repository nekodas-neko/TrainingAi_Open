import { memo } from "react";
import { ShieldCheck } from "lucide-react";
import { todayInTz } from "@trainingai/shared/date-utils";
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import {
  resilienceAsOfLine, resilienceShortfallLine, type ResilienceCoverage,
} from "./resilience-copy";

interface ResilienceTileProps {
  /** null when the model has published nothing — the tile then states what was observed. */
  level: number | null;        // 1.0-5.0
  band: 'low' | 'limited' | 'adequate' | 'solid' | 'strong' | null;
  confidence: number | null; // validDays / 14
  /** 'YYYY-MM-DD' the level was produced for. Null on a payload from before LA-158. */
  asOf: string | null;
  /**
   * What was seen when there is no level. A field off the fetched payload, never an object literal
   * at the call site — that would defeat the `memo` silently (Q-490).
   */
  unavailable: ResilienceCoverage | null;
  /**
   * The availability module's reason there is no level (`scoreGapText`), a string rather than an
   * object so the `memo` holds. It speaks only when `unavailable` has nothing to say: the coverage
   * line is the more specific explanation and two reasons for one absence would contradict.
   */
  gapText?: string | null;
}

/**
 * Derived stress-resilience (stress_resilience_2_2_1) — the live replacement for the frozen Oura
 * Cloud resilience string. State is conveyed by the icon + band label, never colour alone.
 *
 * **It renders three states, and the two new ones are LA-158's** — a level that is not today's, and
 * no level at all. It used to render only the first and take `level`/`band` as required, so the
 * call site hid the other two behind `ownResilienceLevel != null` and showed nothing. Rendering
 * nothing is the failure that entry was filed on: the tile had been showing a five-day-old level as
 * current, and would have gone blank without a word once that day left the window.
 *
 * Returns null only when there is no level, no observation and no availability reason — a payload
 * from before those fields existed. Absent data with nothing to say is not a state worth a sentence.
 * With a reason (issue 2423) it is: the tile was the one place that rendered nothing at all.
 */
function ResilienceTileImpl({ level, band, confidence, asOf, unavailable, gapText = null }: ResilienceTileProps) {
  const tz = useUserTimezone();
  const hasLevel = level != null && band != null;
  const shortfall = hasLevel ? null : unavailable ? resilienceShortfallLine(unavailable) : null;
  const gap = hasLevel || shortfall != null ? null : gapText;
  if (!hasLevel && shortfall == null && gap == null) return null;

  const bandLabel = band ? band.charAt(0).toUpperCase() + band.slice(1) : null;
  const learning = hasLevel && confidence != null && confidence < 1;
  const staleness = hasLevel ? resilienceAsOfLine(asOf, todayInTz(tz)) : null;

  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/60 px-3 py-2.5">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-foreground" aria-hidden />
      <div className="text-[12px] leading-snug text-foreground">
        <span className="font-semibold">Resilience</span>
        {hasLevel
          ? <span className="text-muted-foreground"> · {bandLabel} ({level!.toFixed(1)})</span>
          // Not "unavailable" or "no data": the model has not published one, and "yet" is the
          // honest part — the history accrues on its own.
          : <span className="text-muted-foreground"> · Not published yet</span>}
        {staleness && <span className="block text-muted-foreground">{staleness}</span>}
        {learning && (
          <span className="block text-muted-foreground">
            Still building — based on {Math.round(confidence! * 14)} of the last 14 days.
          </span>
        )}
        {shortfall && <span className="block text-muted-foreground">{shortfall}</span>}
        {gap && <span className="block text-muted-foreground">{gap}</span>}
      </div>
    </div>
  );
}

export const ResilienceTile = memo(ResilienceTileImpl);
