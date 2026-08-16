"use client";

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar, Line, Pie } from "react-chartjs-2";
import type { ChartPayload } from "@trainingai/shared/parse-chart-blocks";
import { resolveColor } from "@trainingai/shared/chart-colors";

// Re-export so existing imports from this module still work
export type { ChartPayload };

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
);

const DEFAULT_COLORS = [
  "#22c55e",
  "#3b82f6",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#14b8a6",
];

export function ChartMessage({ payload }: { payload: ChartPayload }) {
  const { type, title, labels, datasets } = payload;

  const chartData = {
    labels,
    datasets: datasets.map((ds, i) => ({
      ...ds,
      backgroundColor:
        ds.backgroundColor ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length],
      borderColor:
        ds.borderColor ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length],
      borderWidth: ds.borderWidth ?? 1,
      tension: ds.tension ?? 0.3,
    })),
  };

  const isPie = type === "pie";

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "top" as const },
      title: { display: !!title, text: title ?? "" },
    },
    ...(isPie ? {} : {
      scales: {
        // F2: chart.js paints on a canvas, which can't resolve `var(--x)` — it
        // silently renders black. Resolve to the concrete computed value.
        x: {
          ticks: { maxRotation: 45, maxTicksLimit: 8, color: resolveColor('var(--muted-foreground)') },
          grid:  { color: resolveColor('var(--border)') },
        },
        y: {
          ticks: { color: resolveColor('var(--muted-foreground)') },
          grid:  { color: resolveColor('var(--border)') },
        },
      },
    }),
  };

  const chartHeight = isPie ? 220 : 200;

  return (
    <div className="mt-2 rounded-lg border bg-card p-3">
      <div
        style={{ position: "relative", height: `${chartHeight}px` }}
        className={isPie ? "mx-auto max-w-xs" : "w-full"}
      >
        {type === "bar"  && <Bar  data={chartData} options={options} />}
        {type === "line" && <Line data={chartData} options={options} />}
        {type === "pie"  && <Pie  data={chartData} options={options} />}
      </div>
    </div>
  );
}

