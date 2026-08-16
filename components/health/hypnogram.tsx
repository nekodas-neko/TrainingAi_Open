"use client";

import { hypnogramSegments, sleepCycles, stageTotals, STAGE_LEVEL, STAGE_COLOR, type SleepStage } from "@trainingai/shared/health/hypnogram";
import { formatTimeOfDay } from '@trainingai/shared/date-utils';
import { useUserTimezone } from '@/components/shell/user-timezone-provider';

// Re-exported for existing importers (One Formula, One Place — canonical definition
// now lives in lib/health/hypnogram.ts, next to the SleepStage type).
export { STAGE_COLOR };

const STAGE_LABEL: Record<SleepStage, string> = { deep: "Deep", light: "Light", rem: "REM", awake: "Awake" };
// Oura's own legend order (also top-to-bottom lane order): Awake, REM, Light, Deep.
const STAGE_ORDER: SleepStage[] = ["awake", "rem", "light", "deep"];

const SIZE_CONFIG = {
  sm: { laneH: 11, barRatio: 0.62, showCaption: false },
  lg: { laneH: 34, barRatio: 0.66, showCaption: true },
} as const;

// tz is threaded rather than defaulted: this runs at module scope, so it cannot read the
// user-timezone context itself, and a silent DEFAULT_TZ fallback is the Q-148 gap (Q-148).
function fmtHourLabel(iso: string, tz: string) {
  return formatTimeOfDay(iso, tz);
}

function fmtDuration(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

interface HypnogramProps {
  phase5Min: string;
  sleepStart: string;
  sleepEnd: string;
  size?: "sm" | "lg";
}

// An Oura/Whoop-style banded ribbon: each stage sits in its own horizontal lane
// (Awake top → Deep bottom), drawn as a rounded bar in that lane, with thin vertical
// connectors bridging adjacent lanes at each stage transition so the whole thing reads
// as one continuous ribbon stepping between stages rather than a skyline of bars.
export function Hypnogram({ phase5Min, sleepStart, sleepEnd, size = "sm" }: HypnogramProps) {
  const userTz = useUserTimezone();
  const segments = hypnogramSegments(phase5Min);
  if (segments.length === 0) return null;

  const cfg = SIZE_CONFIG[size];
  const last = segments[segments.length - 1];
  const totalMin = last.startMin + last.durationMin;
  const W = 300;
  const H = cfg.laneH * 4; // 4 lanes: awake / rem / light / deep

  // Lane geometry: the bar is centred in its lane, leaving a gap above/below so the
  // four lanes read as distinct tracks.
  const barH = cfg.laneH * cfg.barRatio;
  const laneCenter = (stage: SleepStage) => STAGE_LEVEL[stage] * cfg.laneH + cfg.laneH / 2;
  const barRx = Math.min(barH / 2, 4);
  const connectorW = size === "lg" ? 2.5 : 1.75;

  const startMs = new Date(sleepStart).getTime();
  const endMs = new Date(sleepEnd).getTime();
  const totalMs = endMs - startMs;
  const labelCount = 4;
  const labels = Array.from({ length: labelCount + 1 }, (_, i) => {
    const pct = i / labelCount;
    return { pct, label: fmtHourLabel(new Date(startMs + pct * totalMs).toISOString(), userTz) };
  });

  const cycles = sleepCycles(segments);
  const totals = stageTotals(segments);

  const xOf = (min: number) => (min / totalMin) * W;

  return (
    <div className="space-y-1.5">
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        style={{ display: "block" }}
        className="rounded-lg overflow-hidden text-foreground"
        preserveAspectRatio="none"
      >
        {/* Faint per-lane tracks — currentColor keeps them theme-aware (light + dark). */}
        {STAGE_ORDER.map(stage => (
          <rect
            key={`lane-${stage}`}
            x={0}
            y={STAGE_LEVEL[stage] * cfg.laneH + cfg.laneH / 2 - barH / 2}
            width={W}
            height={barH}
            rx={barRx}
            fill="currentColor"
            opacity={0.06}
          />
        ))}

        {/* Connectors first (under the bars) — a thin vertical bridge between the
            centres of the two lanes at each transition, so the ribbon reads connected. */}
        {segments.slice(1).map((seg, i) => {
          const prev = segments[i];
          const yA = laneCenter(prev.stage);
          const yB = laneCenter(seg.stage);
          const x = xOf(seg.startMin);
          return (
            <rect
              key={`conn-${i}`}
              x={x - connectorW / 2}
              y={Math.min(yA, yB)}
              width={connectorW}
              height={Math.abs(yA - yB)}
              fill="currentColor"
              opacity={0.28}
            />
          );
        })}

        {/* Stage bars — each in its own lane. Width padded a hair so adjacent bars
            never leave a 1px seam between segment boundaries. */}
        {segments.map((s, i) => {
          const y = laneCenter(s.stage) - barH / 2;
          const w = Math.max(xOf(s.durationMin), 0.5) + 0.5;
          return (
            <rect
              key={i}
              x={xOf(s.startMin)}
              y={y}
              width={w}
              height={barH}
              rx={barRx}
              fill={STAGE_COLOR[s.stage]}
            />
          );
        })}
      </svg>
      <div className="relative h-4">
        {labels.map(({ pct, label }) => (
          <span
            key={pct}
            className="absolute text-[9px] text-muted-foreground -translate-x-1/2"
            style={{ left: `${pct * 100}%` }}
          >
            {label}
          </span>
        ))}
      </div>
      <div className="flex gap-3 flex-wrap pt-1">
        {STAGE_ORDER.map(stage => (
          <div key={stage} className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: STAGE_COLOR[stage] }} />
            <span className="text-[10px] text-muted-foreground">{STAGE_LABEL[stage]}</span>
          </div>
        ))}
      </div>
      {cfg.showCaption && (
        <p className="text-[10px] text-muted-foreground pt-0.5">
          ~{cycles.count} cycle{cycles.count === 1 ? "" : "s"} (approx.) · Deep {fmtDuration(totals.deep)} · REM {fmtDuration(totals.rem)} · Light {fmtDuration(totals.light)} · Awake {fmtDuration(totals.awake)}
        </p>
      )}
    </div>
  );
}
