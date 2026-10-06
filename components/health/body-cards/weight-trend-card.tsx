import { InfoIcon } from "lucide-react";
import { Sparkline } from "@/components/ui/sparkline";
import { goalProgressPct, WEIGHT_TREND_WINDOW_DAYS } from "@trainingai/shared/health/long-term-goal-progress";
import type { BodyMetaRow } from "@/app/api/body-metadata/route";

interface Props {
  metaRecent: BodyMetaRow[];
  /** LB-176 — the body-metadata read FAILED, as opposed to having returned nothing. */
  metaFailed: boolean;
  latestWeight: number | null;
  latestBf: number | null;
  targetWeightKg: number | null;
  targetBfPct: number | null;
  bodyBaseline: { weightKg: number | null; bodyFatPct: number | null };
  /**
   * The body-fat bar's colour, supplied by the caller.
   *
   * Passed in rather than written here because it is a hex literal with no matching theme token —
   * there are five `--accent-*` colours and teal is not one of them. `check-hex-literals` is
   * shrink-only per file, so hard-coding it would count as a NEW literal in a new file when it has
   * only moved; swapping it for a different accent would be an unrequested visual change. The caller
   * already carries this value for the Dist tile.
   */
  bodyFatBarColor: string;
  /** The regression slope from `useWeightTrend`, fitted over `WEIGHT_TREND_WINDOW_DAYS` — the card
   *  renders it, never re-fits it. `metaRecent` (7 days) is the sparkline's input, not the slope's. */
  kgPerWeek: number | null;
  /** The body-metadata read has not landed yet (drives the headline's skeleton, not the sparkline). */
  loading: boolean;
  infoOpen: boolean;
  onToggleInfo: () => void;
}

/**
 * The Weight Trend card — sparkline plus weight/body-fat goal bars.
 *
 * Extracted from `health-sections.tsx` (LB-176's PR), which is a single 800-line switch sitting on a
 * `check-component-size` limit; `rhr-hrv-spo2-card.tsx` in this folder came out of the same file for
 * the same reason. The empty line below is the one that told the owner to *"Log body weight to see
 * trend"* when the read had simply failed.
 */
export function WeightTrendCard({
  metaRecent, metaFailed, latestWeight, latestBf, targetWeightKg, targetBfPct, bodyBaseline, bodyFatBarColor,
  kgPerWeek, loading, infoOpen, onToggleInfo,
}: Props) {
  const trendWeightPoints = [...metaRecent].reverse().map(r => r.weightKg).filter((w): w is number => w != null);
  return (
  <div className="rounded-2xl p-4 bg-muted/30 border border-border/40">
    <div className="flex items-center justify-between mb-2">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Weight Trend</p>
      <button onClick={onToggleInfo} aria-label="Weight trend info" aria-expanded={infoOpen} className="p-2.5 rounded-full text-muted-foreground/70 hover:text-muted-foreground transition-colors">
        <InfoIcon className="h-3.5 w-3.5" />
      </button>
    </div>
    {loading ? (
      <div className="h-7 w-24 animate-pulse rounded-lg bg-muted" />
    ) : kgPerWeek != null ? (
      <p className="text-2xl font-bold tabular-nums leading-tight" style={{ color: "var(--accent-green)" }}>
        {kgPerWeek >= 0 ? '+' : ''}{kgPerWeek}
        <span className="text-xs font-normal ml-1 text-muted-foreground">kg/wk · last {WEIGHT_TREND_WINDOW_DAYS} days</span>
      </p>
    ) : (
      <p className="text-xs text-muted-foreground">Need more data</p>
    )}
    {infoOpen && (
      <div className="mt-3 rounded-xl bg-muted/50 p-2.5">
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Linear regression slope across your weight readings from the last {WEIGHT_TREND_WINDOW_DAYS} days. Positive = gaining, negative = losing. Needs at least 3 readings to calculate.
        </p>
      </div>
    )}
    {trendWeightPoints.length >= 2 ? (
      <Sparkline values={trendWeightPoints} width={160} height={48} color="var(--color-brand)" showDots />
    ) : (
      <p className="text-sm text-muted-foreground text-center py-4">
        {/* LB-176: this told him to log a weight he had already logged, because one read failed. */}
        {metaFailed ? "Couldn't load your weight trend" : 'Log body weight to see trend'}
      </p>
    )}
    {((latestWeight != null && bodyBaseline.weightKg != null && targetWeightKg != null) ||
      (latestBf != null && bodyBaseline.bodyFatPct != null && targetBfPct != null)) && (
      <div className="space-y-3 mt-3">
        {latestWeight != null && bodyBaseline.weightKg != null && targetWeightKg != null && (
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span>Weight</span>
              <span className="font-semibold">{latestWeight} → {targetWeightKg} kg</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${goalProgressPct(bodyBaseline.weightKg, latestWeight, targetWeightKg)}%`,
                  background: 'var(--color-brand)',
                }}
              />
            </div>
          </div>
        )}
        {latestBf != null && bodyBaseline.bodyFatPct != null && targetBfPct != null && (
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span>Body Fat</span>
              <span className="font-semibold">{latestBf}% → {targetBfPct}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${goalProgressPct(bodyBaseline.bodyFatPct, latestBf, targetBfPct)}%`,
                  background: bodyFatBarColor,
                }}
              />
            </div>
          </div>
        )}
      </div>
    )}
  </div>
  );
}
