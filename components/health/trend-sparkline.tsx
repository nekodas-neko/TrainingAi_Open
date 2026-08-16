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

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler);

type Field = "readinessScore" | "sleepScore" | "activityScore" | "hrvMs" | "rhrBpm" | "hrr1Bpm" | "wornHours" | "sessionDurationMin" | "workoutDensity" | "proteinPerKg" | "steps" | "waterMl" | "temperatureDeviation";

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

  const chip = deltaChip(trends, field);
  const lineColor = resolveColor(color);
  const areaColor = fillColor(lineColor);

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label} — 14 days
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
              pointRadius: values.map((_, i) => i === values.length - 1 ? 3 : 0),
              pointBackgroundColor: lineColor,
              spanGaps: true,
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

export const TrendSparkline = memo(TrendSparklineBase);
