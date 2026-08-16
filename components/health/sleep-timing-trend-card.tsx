"use client";

import { useMemo } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  type ChartData,
} from "chart.js";
import { resolveColor } from "@trainingai/shared/chart-colors";
import { timingPoints, timingValueToClock, type TimingNight } from "./sleep-timing-trend-utils";

export type { TimingNight };

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip);

export function SleepTimingTrendCard({ nights, mode }: { nights: TimingNight[]; mode: "bedtime" | "wake" }) {
  const points = useMemo(() => timingPoints(nights, mode), [nights, mode]);
  const toClock = (v: number) => timingValueToClock(v, mode);

  if (points.every(p => p.value == null)) {
    return <p className="text-xs text-muted-foreground">Not enough nights recorded yet.</p>;
  }

  const lineColor = resolveColor(mode === "bedtime" ? "#818cf8" : "#f59e0b");
  const data: ChartData<"line"> = {
    labels: points.map(p => p.date.slice(5)),
    datasets: [{
      data: points.map(p => p.value),
      borderColor: lineColor,
      backgroundColor: "transparent",
      pointRadius: 2,
      pointBackgroundColor: lineColor,
      tension: 0.3,
      spanGaps: true,
    }],
  };

  return (
    <div style={{ height: 120 }}>
      <Line
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => ctx.parsed.y == null ? "" : toClock(ctx.parsed.y) } },
          },
          scales: {
            x: { ticks: { color: resolveColor("var(--muted-foreground)"), font: { size: 9 }, maxRotation: 0 }, grid: { display: false } },
            y: {
              ticks: {
                color: resolveColor("var(--muted-foreground)"),
                font: { size: 9 },
                maxTicksLimit: 4,
                callback: (v) => toClock(Number(v)),
              },
              grid: { color: resolveColor("var(--border)") },
            },
          },
        }}
      />
    </div>
  );
}
