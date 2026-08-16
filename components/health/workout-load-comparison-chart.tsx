"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { resolveColor } from "@trainingai/shared/chart-colors";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

export interface LoadComparisonEntry {
  date: string; // YYYY-MM-DD
  volumeKg: number;
  durationMin: number | null;
  isToday: boolean;
}

interface Props {
  entries: LoadComparisonEntry[]; // oldest first, today last
  sessionName: string;
  height?: number;
}

export function WorkoutLoadComparisonChart({ entries, sessionName, height = 140 }: Props) {
  const data = useMemo(() => {
    const brand = resolveColor("var(--color-brand)");
    return {
      labels: entries.map(e => e.date.slice(5)), // MM-DD
      datasets: [
        {
          data: entries.map(e => e.volumeKg),
          backgroundColor: entries.map(e => e.isToday ? brand : "rgba(128,128,128,0.35)"),
          borderRadius: 4,
          maxBarThickness: 24,
        },
      ],
    };
  }, [entries]);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    plugins: {
      legend: { display: false },
      tooltip: {
        displayColors: false,
        callbacks: {
          title: (items: { dataIndex: number }[]) => entries[items[0].dataIndex]?.date ?? "",
          label: (item: { dataIndex: number }) => {
            const e = entries[item.dataIndex];
            return `${e.volumeKg} kg${e.durationMin != null ? ` · ${e.durationMin} min` : ""}`;
          },
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 9 } } },
      y: { grid: { color: "rgba(128,128,128,0.15)" }, ticks: { font: { size: 9 } } },
    },
  }), [entries]);

  if (entries.length === 0) return null;

  const todayEntry = entries.find(e => e.isToday);
  const priorEntries = entries.filter(e => !e.isToday);
  const priorAvgVol = priorEntries.length > 0
    ? priorEntries.reduce((s, e) => s + e.volumeKg, 0) / priorEntries.length
    : null;
  const pctChange = todayEntry && priorAvgVol && priorAvgVol > 0
    ? Math.round(((todayEntry.volumeKg - priorAvgVol) / priorAvgVol) * 100)
    : null;

  return (
    <div className="space-y-1.5">
      <div style={{ height }}>
        <Bar data={data} options={options as Parameters<typeof Bar>[0]["options"]} />
      </div>
      {pctChange != null && (
        <p className="text-[11px] text-muted-foreground">
          {pctChange > 0 ? "+" : ""}{pctChange}% volume vs. your last {priorEntries.length} {sessionName} session{priorEntries.length === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}
