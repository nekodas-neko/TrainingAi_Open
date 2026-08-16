import { memo } from "react";
import { ShieldCheck } from "lucide-react";

interface ResilienceTileProps {
  level: number;        // 1.0-5.0
  band: 'low' | 'limited' | 'adequate' | 'solid' | 'strong';
  confidence: number | null; // validDays / 14
}

// Derived stress-resilience (stress_resilience_2_2_1) — the live replacement for the frozen Oura
// Cloud resilience string. State is conveyed by the icon + band label, never colour alone.
function ResilienceTileImpl({ level, band, confidence }: ResilienceTileProps) {
  const bandLabel = band.charAt(0).toUpperCase() + band.slice(1);
  const learning = confidence != null && confidence < 1;
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/60 px-3 py-2.5">
      <ShieldCheck className="h-4 w-4 shrink-0 text-foreground" aria-hidden />
      <div className="text-[12px] leading-snug text-foreground">
        <span className="font-semibold">Resilience</span>
        <span className="text-muted-foreground"> · {bandLabel} ({level.toFixed(1)})</span>
        {learning && (
          <span className="block text-muted-foreground">
            Still building — based on {Math.round(confidence! * 14)} of the last 14 days.
          </span>
        )}
      </div>
    </div>
  );
}

export const ResilienceTile = memo(ResilienceTileImpl);
