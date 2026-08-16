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

interface TrendChartProps {
  series: { date: string; sessionRpe: number; sessionLoad: number }[];
  height?: number;
}

// Session-RPE time series (Foster sRPE × duration = session load) as a bar chart.
export function TrendChart({ series, height = 140 }: TrendChartProps) {
  const data = useMemo(() => ({
    labels: series.map(s => s.date.slice(5)), // MM-DD
    datasets: [
      {
        data: series.map(s => s.sessionLoad),
        backgroundColor: resolveColor("var(--color-brand)"),
        borderRadius: 4,
        maxBarThickness: 18,
      },
    ],
  }), [series]);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    plugins: {
      legend: { display: false },
      tooltip: {
        displayColors: false,
        callbacks: {
          title: (items: { dataIndex: number }[]) => series[items[0].dataIndex]?.date ?? "",
          label: (item: { dataIndex: number }) => {
            const s = series[item.dataIndex];
            // J-7: label it "sRPE load" — this is Foster session-RPE×duration, a
            // different metric and scale from the zone-breakdown's Edwards-TRIMP
            // "Session Load". Same word for both numbers made one look broken.
            return `RPE ${s.sessionRpe}/10 · sRPE load ${s.sessionLoad}`;
          },
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 9 } } },
      y: { grid: { color: "rgba(128,128,128,0.15)" }, ticks: { font: { size: 9 } } },
    },
  }), [series]);

  if (series.length === 0) return null;
  return (
    <div style={{ height }}>
      <Bar data={data} options={options as Parameters<typeof Bar>[0]["options"]} />
    </div>
  );
}
