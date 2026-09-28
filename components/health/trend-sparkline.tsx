"use client";

import { memo } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement,
  LineElement, Tooltip, Filler,
} from "chart.js";
import type { HealthTrendDay } from "@/app/api/health/trends/route";
import { useHeroColorScheme } from "./detail-hero";
import { resolveColor } from "@trainingai/shared/chart-colors";
import { gapDataset } from "./trend-sparkline-gaps";
import { trendSparklinePropsEqual } from "./trend-sparkline-equal";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler);

// One definition, beside the comparator that has to agree with it.
import type { TrendField as Field } from "./trend-sparkline-equal";

interface TrendSparklineProps {
  trends: HealthTrendDay[];
  field: Field;
  label: string;
  color: string;
  unit?: string;
}

// Translucent fill for the area under the line. The `+"18"` hex-alpha shortcut
// only works for #rrggbb; anything else (oklch, rgb, resolved var) needs color-mix.
function fillColor(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color)
    ? color + "22"
    : `color-mix(in srgb, ${color} 14%, transparent)`;
}

function deltaChip(trends: HealthTrendDay[], field: Field) {
  const values = trends.map(t => t[field] as number | null);
  const today = values[values.length - 1];
  const weekAgo = values.slice(0, 7).filter((v): v is number => v != null);
  if (today == null || weekAgo.length === 0) return null;
  const weekAvg = weekAgo.reduce((s, v) => s + v, 0) / weekAgo.length;
  const diff = Math.round(today - weekAvg);
  if (diff === 0) return { text: "— same as last week", colorClass: "text-muted-foreground" };
  const sign = diff > 0 ? "▲" : "▼";
  // A-9: paired with ▲/▼ so state survives, but the -400 shade washed out in light theme.
  const colorClass = diff > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400";
  return { text: `${sign} ${Math.abs(diff)} vs last week`, colorClass };
}

function TrendSparklineBase({ trends, field, label, color, unit }: TrendSparklineProps) {
  const isLight = useHeroColorScheme() === "light";
  if (trends.length === 0) return null;

  const allValues = trends.map(t => t[field] as number | null);
  const firstIdx = allValues.findIndex(v => v != null);
  if (firstIdx === -1) return null;

  // Trim leading nulls so chart starts at the first real data point
  const trimmed = trends.slice(firstIdx);
  const values = trimmed.map(t => t[field] as number | null);

  const labels = trimmed.map(t => {
    const d = new Date(t.date + "T00:00:00");
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  });

  const gaps = gapDataset(values);
  const chip = deltaChip(trends, field);
  const lineColor = resolveColor(color);
  const areaColor = fillColor(lineColor);

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label} — 14 days
          {gaps.coverage && (
            <span className="ml-1.5 font-normal normal-case tracking-normal opacity-70">
              {gaps.coverage}
            </span>
          )}
        </p>
        {chip && (
          <span className={`text-[10px] font-semibold ${chip.colorClass}`}>{chip.text}</span>
        )}
      </div>
      <div style={{ height: 88 }}>
        <Line
          data={{
            labels,
            datasets: [{
              data: values,
              borderColor: lineColor,
              backgroundColor: areaColor,
              fill: true,
              tension: 0.4,
              pointRadius: gaps.pointRadius,
              pointBackgroundColor: lineColor,
              spanGaps: gaps.spanGaps,
            }],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: ctx => `${ctx.parsed.y}${unit ? ` ${unit}` : ""}`,
                },
              },
            },
            scales: {
              x: {
                ticks: { color: isLight ? "#6b7280" : "#9ca3af", font: { size: 9 }, maxRotation: 0 },
                grid: { display: false },
                border: { display: false },
              },
              y: {
                ticks: {
                  display: true,
                  color: isLight ? "#6b7280" : "#9ca3af",
                  font: { size: 8 },
                  maxTicksLimit: 4,
                  padding: 4,
                },
                grid: { color: isLight ? "#00000010" : "#ffffff10" },
                border: { display: false },
              },
            },
          }}
        />
      </div>
    </div>
  );
}

/**
 * **`memo` with a VALUE comparator, because the default shallow one is defeated here (DV-12).**
 *
 * Every tab re-show bumps `TabVisibilityProvider`'s `epoch`, the screens refetch because of it — that
 * is deliberate, since all five tabs stay mounted and a bare mount effect would show one snapshot
 * forever — and the refetch hands down a **new `trends` array with the same contents**. A shallow
 * compare sees a different reference, so this re-renders, rebuilds `data`/`options` inline, and
 * `react-chartjs-2` runs `chart.update()`, which re-measures every axis label.
 *
 * **Measured: 578 canvas `font`-setter calls on every single switch to the Health tab** (five of these
 * on screen), against 0 on a tab with no charts — and the canvas `font` setter is the top self-time
 * item in the device CPU profile of a tab tap, at 7–48 ms. It is not a resize: instrumenting
 * `ResizeObserver` shows 5 chart callbacks during load and **zero** on a tab switch, which is also why
 * `resizeDelay` did nothing when it was tried.
 *
 * So compare the values this component actually READS — `date` and `t[field]` — rather than the array
 * identity. An unchanged refetch then re-renders nothing. The other props are primitives and compare
 * shallowly as before. This is the repo's standing `React.memo` rule (*"only works with stable props"*)
 * one level up: the prop is not an inline literal, it is a new array with equal contents.
 */
export const TrendSparkline = memo(TrendSparklineBase, trendSparklinePropsEqual);
