"use client";

import { accentCardStyle } from "@trainingai/shared/utils";
import { Sparkline } from "@/components/ui/sparkline";
import type { BodyMetaRow } from "@/app/api/body-metadata/route";
import { displayBodyFat, correctedSpan, type BodyFatCalibrationMeta } from "./body-fat-display";

const BF_COLOR = "#f43f5e";

interface Props {
  metaRecent: BodyMetaRow[];
  metaLoading: boolean;
  targetBfPct: number | null;
  /** Null until a DEXA scan has been paired with a scale reading. */
  calibration: BodyFatCalibrationMeta | null;
  /** Passed through rather than pre-bound so the card owns the strings it labels itself with. */
  setMetricSheet: (kind: "bodyFat") => void;
  openLog: (field: "bodyFat", label: string, unit: string, step: number) => void;
}

/**
 * The Body Fat card on Health → Body. Extracted from `health-sections.tsx` when LA-45's calibration
 * disclosure pushed that file past the 800-line limit — the rule for that hotspot is extract, not
 * append.
 *
 * **It renders the DEXA-CORRECTED reading**, which is the value the calorie goal, the protein dose
 * and `personalRmr` are already computed from. Showing the raw scale number here while those use the
 * corrected one is the two-numbers-disagreeing-on-screen case LA-45 exists to close — worse than
 * neither being corrected, because there is no way to tell from the screen which is which.
 *
 * **`onLog` must seed from the RAW `bodyFat`, not from what this card shows.** The log sheet POSTs
 * its value back at source `manual`, which outranks `scale_ble` — so a corrected value round-tripped
 * through it would overwrite the measurement permanently and collapse the next calibration toward
 * zero. That seeding lives in `openLog` (`health-content.tsx`) and reads `metaToday.bodyFat`; this
 * card only raises the event.
 *
 * **Deliberately not `memo`'d.** `openLog` is re-created on every render of the orchestrator that
 * owns it, so a memo here would never hit — and a `memo(...)` wrapper that cannot fire is worse than
 * none, because the component then reads as optimised to everyone after you. It renders once, not in
 * a list, under a parent that re-renders anyway.
 */
export function BodyFatCard({
  metaRecent, metaLoading, targetBfPct, calibration, setMetricSheet, openLog,
}: Props) {
  const bfPoints = [...metaRecent].reverse().map(displayBodyFat).filter((v): v is number => v != null);
  const span = correctedSpan(metaRecent);
  const latest = bfPoints[bfPoints.length - 1] ?? null;
  if (latest == null) return null;
  const delta = bfPoints.length >= 2 ? parseFloat((latest - bfPoints[0]).toFixed(1)) : null;

  return (
    <div className="rounded-2xl p-4 relative overflow-hidden w-full" style={accentCardStyle(BF_COLOR)}>
      <div className="absolute -top-4 -right-4 w-20 h-20 rounded-full pointer-events-none" style={{ background: BF_COLOR, filter: "blur(28px)", opacity: 0.15 }} />
      <div className="flex items-start justify-between mb-2">
        <button onClick={() => setMetricSheet("bodyFat")} className="text-left flex-1">
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: BF_COLOR }}>Body Fat ↗</p>
          {metaLoading ? (
            <div className="h-8 w-20 animate-pulse rounded-lg bg-muted" />
          ) : (
            <p className="text-3xl font-bold tabular-nums">
              {latest.toFixed(1)}<span className="text-base font-semibold text-muted-foreground ml-1">%</span>
            </p>
          )}
        </button>
        <div className="flex items-center gap-2 ml-2 flex-none">
          {delta != null && (
            <span className="text-[11px] rounded-full px-2.5 py-1 font-semibold" style={{ background: "rgba(244,63,94,0.3)", color: BF_COLOR }}>
              {delta >= 0 ? "+" : ""}{delta.toFixed(1)}%
            </span>
          )}
          <button
            onClick={() => openLog("bodyFat", "Body Fat", "%", 0.1)}
            className="rounded-xl bg-muted px-3 py-1.5 text-xs font-semibold hover:bg-muted/80 transition-colors"
          >
            Log
          </button>
        </div>
      </div>
      {bfPoints.length >= 2 && (
        <Sparkline values={bfPoints} width={260} height={44} color={BF_COLOR} showDots fill responsive />
      )}
      <p className="text-[10px] text-muted-foreground mt-1">From {bfPoints.length} reading{bfPoints.length !== 1 ? "s" : ""}</p>
      {/* The card shows a corrected number, so it has to say so — otherwise it silently disagrees
          with the scale the owner just stood on. `pairCount` is on the line because at one pair this
          is one comparison and not a calibration, and rounding that away would overstate it. */}
      {calibration != null && (
        <p className="text-[10px] text-muted-foreground mt-0.5">
          DEXA-corrected {calibration.offsetPct >= 0 ? "+" : ""}{calibration.offsetPct.toFixed(1)}% ·{" "}
          {calibration.pairCount === 1 ? "1 scan compared" : `${calibration.pairCount} scans compared`}
        </p>
      )}
      {/* Only on a MIXED window. Two thirds of the history is on instruments this offset does not
          cover, so a trend across the changeover has a real step in it — say where the corrected
          span begins rather than let the chart draw the step unexplained. */}
      {span.corrected > 0 && span.corrected < span.total && (
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {span.corrected} of {span.total} corrected — earlier readings are on another instrument
        </p>
      )}
      {targetBfPct != null && (() => {
        const diff = parseFloat((latest - targetBfPct).toFixed(1));
        return (
          <p className="text-xs font-semibold mt-1" style={{ color: diff <= 0 ? "#22c55e" : BF_COLOR }}>
            {diff <= 0 ? "✓ Goal reached" : `↓ ${diff}% to go`}
          </p>
        );
      })()}
    </div>
  );
}
