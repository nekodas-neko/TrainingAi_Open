"use client";

import { useMemo } from "react";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
  type ChartData,
} from "chart.js";
import { resolveColor } from "@trainingai/shared/chart-colors";
import { STAGE_COLOR } from "@trainingai/shared/health/hypnogram";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

export interface PhaseHoursNight {
  date: string;
  deepSleepHours: number | null;
  remSleepHours: number | null;
  lightSleepHours: number | null;
  awakHours: number | null;
}

// 14-day stacked-bar view of per-night sleep-stage hours (Q-90). Reuses the canonical
// stage palette (STAGE_COLOR, hypnogram.ts) rather than declaring a second copy — same
// colours a user already associates with deep/light/rem/awake from the hypnogram itself.
export function SleepPhaseTrendCard({ nights }: { nights: PhaseHoursNight[] }) {
  const data = useMemo<ChartData<"bar">>(() => ({
    labels: nights.map(n => n.date.slice(5)), // MM-DD
    datasets: [
      { label: "Deep",  data: nights.map(n => n.deepSleepHours  ?? 0), backgroundColor: resolveColor(STAGE_COLOR.deep),  stack: "phases" },
      { label: "Light", data: nights.map(n => n.lightSleepHours ?? 0), backgroundColor: resolveColor(STAGE_COLOR.light), stack: "phases" },
      { label: "REM",   data: nights.map(n => n.remSleepHours   ?? 0), backgroundColor: resolveColor(STAGE_COLOR.rem),   stack: "phases" },
      { label: "Awake", data: nights.map(n => n.awakHours       ?? 0), backgroundColor: resolveColor(STAGE_COLOR.awake), stack: "phases" },
    ],
  }), [nights]);

  if (nights.every(n => n.deepSleepHours == null && n.remSleepHours == null && n.lightSleepHours == null)) {
    return <p className="text-xs text-muted-foreground">Not enough nights with stage data yet.</p>;
  }

  return (
    <div style={{ height: 170 }}>
      <Bar
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            legend: {
              display: true,
              position: "bottom",
              labels: { boxWidth: 10, font: { size: 9 }, color: resolveColor("var(--muted-foreground)") },
            },
            tooltip: {
              mode: "index",
              intersect: false,
              callbacks: { label: ctx => `${ctx.dataset.label}: ${(ctx.raw as number).toFixed(1)}h` },
            },
          },
          scales: {
            x: { stacked: true, ticks: { color: resolveColor("var(--muted-foreground)"), font: { size: 9 } }, grid: { display: false } },
            y: { stacked: true, ticks: { color: resolveColor("var(--muted-foreground)"), font: { size: 9 }, maxTicksLimit: 4 }, grid: { color: resolveColor("var(--border)") } },
          },
        }}
      />
    </div>
  );
}
