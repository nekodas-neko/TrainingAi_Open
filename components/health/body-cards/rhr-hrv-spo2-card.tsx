"use client";

import { useEffect } from "react";
import { accentCardStyle } from "@trainingai/shared/utils";
import { useTransitionRouter } from "@/lib/view-transition";
import { formatDayShort } from "@trainingai/shared/date-utils";
import { MetricScale, rangeStats } from "@/components/health/metric-scale";
import type { BodyMetaRow } from "@/app/api/body-metadata/route";

interface Props {
  metaToday: BodyMetaRow | null;
  metaRecent: BodyMetaRow[];
  metaLoading: boolean;
  onOpenSheet: (kind: "restingHR" | "hrv" | "spo2") => void;
}

// Latest value + the day it came from — staleDate is null when it's today's reading,
// otherwise the older row's date so the tile can show "· Jul 2" instead of passing a
// weeks-old value off as current.
function latestWithDate(
  metaToday: BodyMetaRow | null,
  metaRecent: BodyMetaRow[],
  key: "restingHeartRate" | "hrvMs" | "spo2Pct",
): { value: number; staleDate: string | null } | null {
  if (metaToday?.[key] != null) return { value: metaToday[key]!, staleDate: null };
  const row = metaRecent.find(r => r[key] != null);
  return row ? { value: row[key]!, staleDate: row.date } : null;
}

// The resting-HR / HRV / SpO2 grid card — extracted from health-sections.tsx
// (Task 4.4) as a pure move, no behaviour change.
export function RhrHrvSpo2Card({ metaToday, metaRecent, metaLoading, onOpenSheet }: Props) {
  const router = useTransitionRouter();
  // Warm the detail route before it's tapped — see oura-score-chip-row.
  useEffect(() => { router.prefetch("/health/heart-rate"); }, [router]);
  const rhr  = latestWithDate(metaToday, metaRecent, "restingHeartRate");
  const hrv  = latestWithDate(metaToday, metaRecent, "hrvMs");
  const spo2 = latestWithDate(metaToday, metaRecent, "spo2Pct");
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-gradient-to-b from-muted/20 to-muted/5 p-3">
    <div className="grid grid-cols-3 gap-2">
      <button
        onClick={() => onOpenSheet("restingHR")}
        className="rounded-2xl border p-3 relative overflow-hidden text-left transition active:scale-95"
        style={accentCardStyle('#ef4444')}
      >
        <div className="absolute -top-2 -right-2 w-10 h-10 rounded-full pointer-events-none" style={{ background: "#ef4444", filter: "blur(14px)", opacity: 0.2 }} />
        <p className="text-[9px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "#ef4444" }}>Resting HR</p>
        {metaLoading ? (
          <div className="h-6 w-12 animate-pulse rounded bg-muted" />
        ) : rhr != null ? (
          <p className="text-xl font-bold tabular-nums" style={{ color: "#ef4444" }}>{rhr.value}</p>
        ) : (
          <p className="text-xs text-muted-foreground">No data</p>
        )}
        <p className="text-[9px] text-muted-foreground mt-0.5">bpm{rhr?.staleDate ? ` · ${formatDayShort(rhr.staleDate)}` : ''}</p>
      </button>
      <button
        onClick={() => onOpenSheet("hrv")}
        className="rounded-2xl border p-3 relative overflow-hidden text-left transition active:scale-95"
        style={accentCardStyle('#f97316')}
      >
        <div className="absolute -top-2 -right-2 w-10 h-10 rounded-full pointer-events-none" style={{ background: "#f97316", filter: "blur(14px)", opacity: 0.2 }} />
        <p className="text-[9px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "#f97316" }}>HRV</p>
        {metaLoading ? (
          <div className="h-6 w-12 animate-pulse rounded bg-muted" />
        ) : hrv != null ? (
          <p className="text-xl font-bold tabular-nums" style={{ color: "#f97316" }}>{hrv.value.toFixed(0)}</p>
        ) : (
          <p className="text-xs text-muted-foreground">No data</p>
        )}
        <p className="text-[9px] text-muted-foreground mt-0.5">ms rMSSD · overnight{hrv?.staleDate ? ` · ${formatDayShort(hrv.staleDate)}` : ''}</p>
      </button>
      <button
        onClick={() => onOpenSheet("spo2")}
        className="rounded-2xl border p-3 relative overflow-hidden text-left transition active:scale-95"
        style={accentCardStyle('#06b6d4')}
      >
        <div className="absolute -top-2 -right-2 w-10 h-10 rounded-full pointer-events-none" style={{ background: "#06b6d4", filter: "blur(14px)", opacity: 0.2 }} />
        <p className="text-[9px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "#06b6d4" }}>SpO₂</p>
        {metaLoading ? (
          <div className="h-6 w-12 animate-pulse rounded bg-muted" />
        ) : spo2 != null ? (
          <p className="text-xl font-bold tabular-nums" style={{ color: "#06b6d4" }}>{spo2.value.toFixed(1)}</p>
        ) : (
          <p className="text-xs text-muted-foreground">No data</p>
        )}
        <p className="text-[9px] text-muted-foreground mt-0.5">% O₂{spo2?.staleDate ? ` · ${formatDayShort(spo2.staleDate)}` : ''}</p>
      </button>
    </div>
    {/* Where each reading sits vs your recent nights — the "normal range" indicator. */}
    {(() => {
      const rhrStats = rangeStats(metaRecent.map(r => r.restingHeartRate));
      const hrvStats = rangeStats(metaRecent.map(r => r.hrvMs));
      const spoStats = rangeStats(metaRecent.map(r => r.spo2Pct));
      const hasAny = (rhr && rhrStats.max != null) || (hrv && hrvStats.max != null) || (spo2 && spoStats.max != null);
      if (!hasAny) return null;
      return (
        <div className="space-y-2.5 border-t border-border/60 pt-3">
          <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">Vs your recent days</p>
          {rhr && <MetricScale label="Resting HR" value={rhr.value} min={rhrStats.min} max={rhrStats.max} avg={rhrStats.avg} accent="#ef4444" format={v => `${Math.round(v)}`} optimal="low" />}
          {hrv && <MetricScale label="HRV" value={hrv.value} min={hrvStats.min} max={hrvStats.max} avg={hrvStats.avg} accent="#f97316" format={v => `${Math.round(v)}`} optimal="high" />}
          {spo2 && <MetricScale label="SpO₂" value={spo2.value} min={spoStats.min} max={spoStats.max} avg={spoStats.avg} accent="#06b6d4" format={v => `${v.toFixed(1)}`} optimal="high" />}
        </div>
      );
    })()}
    <button
      onClick={() => router.push('/health/heart-rate')}
      className="text-[9px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
    >
      Heart rate details →
    </button>
    </div>
  );
}
