"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LineElement,
  LinearScale,
  PointElement,
  Filler,
  Tooltip,
  type ScriptableContext,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(CategoryScale, LineElement, LinearScale, PointElement, Filler, Tooltip);

// Resolve the CSS custom property to RGB via a temporary canvas so we can
// build rgba gradient stops regardless of the source color format (oklch etc.)
function resolveBrandRgb(): [number, number, number] {
  if (typeof document === "undefined") return [34, 197, 94];
  const raw =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--color-brand")
      .trim() || "#22c55e";
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const ctx = c.getContext("2d");
  if (!ctx) return [34, 197, 94];
  ctx.fillStyle = raw;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

interface SparklineChartProps {
  /** Values in chronological order — latest value last. */
  values: number[];
  unit?: string;
  height?: number;
  /** Label shown in the tooltip title, e.g. "Session 4". Defaults to session index. */
  labels?: string[];
}

export function SparklineChart({
  values,
  unit = "kg",
  height = 72,
  labels,
}: SparklineChartProps) {
  // useMemo must be called before any early return (Rules of Hooks)
  const rgb = useMemo(resolveBrandRgb, []);

  // Inline plugin — draws the last value above the final dot
  const lastValuePlugin = useMemo(() => ({
    id: "lastValueLabel",
    afterDatasetsDraw(chart: ChartJS) {
      const meta = chart.getDatasetMeta(0);
      const lastPoint = meta.data[meta.data.length - 1];
      if (!lastPoint) return;
      const lastVal = values[values.length - 1];
      const { ctx } = chart;
      ctx.save();
      ctx.font = "bold 11px system-ui, -apple-system, sans-serif";
      ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      // Keep label inside canvas bounds
      const x = Math.min(lastPoint.x, chart.width - 2);
      ctx.fillText(`${lastVal} ${unit}`, x, lastPoint.y - 6);
      ctx.restore();
    },
  }), [values, unit, rgb]);

  if (values.length < 2) return null;
  const solid = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  const rgba = (a: number) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;

  const data = {
    labels: labels ?? values.map((_, i) => `Session ${i + 1}`),
    datasets: [
      {
        data: values,
        borderColor: solid,
        backgroundColor: (ctx: ScriptableContext<"line">) => {
          const { chart } = ctx;
          const { canvas, chartArea } = chart;
          if (!chartArea) return rgba(0.15);
          const gradient = canvas
            .getContext("2d")!
            .createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          gradient.addColorStop(0, rgba(0.25));
          gradient.addColorStop(1, rgba(0));
          return gradient;
        },
        fill: true,
        tension: 0.4,
        borderWidth: 2,
        // Only the latest point is visible; all others show on hover
        pointRadius: values.map((_, i) => (i === values.length - 1 ? 5 : 0)),
        pointHoverRadius: 6,
        pointBackgroundColor: solid,
        pointBorderColor: "transparent",
        pointBorderWidth: 0,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 350 },
    // Reserve headroom above the plot for the last-value label. The plugin
    // draws it ~17px above the final point on the full canvas, so on an
    // uptrend (top point near the canvas edge) it would otherwise be clipped.
    layout: { padding: { top: 18 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        displayColors: false,
        callbacks: {
          label: (ctx: { parsed: { y: number } }) =>
            `${ctx.parsed.y} ${unit}`,
        },
      },
    },
    scales: {
      x: { display: false },
      // grace adds headroom so the top dot isn't clipped
      y: { display: false, grace: "12%" },
    },
  };

  return (
    <div style={{ height }}>
      <Line
        data={data}
        options={options as Parameters<typeof Line>[0]["options"]}
        plugins={[lastValuePlugin as never]}
      />
    </div>
  );
}
