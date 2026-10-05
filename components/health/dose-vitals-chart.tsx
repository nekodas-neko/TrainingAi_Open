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
import {
  METRIC_LABEL, METRIC_UNIT, hasAnyReading,
  type DoseMetric, type DoseVitalsPoint,
} from "./dose-vitals-series";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip);

/**
 * TN-46 — one metric against the baseline stored for that same night, with the doses marked.
 *
 * One metric at a time rather than two y-axes: resting HR is bpm and HRV is ms, and a dual axis at
 * 384 px invites reading a crossing as a relationship. The baseline is the pre-dose reference — the
 * night before a first dose keeps its own baseline however far the live one adapts afterwards.
 */
export function DoseVitalsChart({ points, metric }: { points: DoseVitalsPoint[]; metric: DoseMetric }) {
  const data = useMemo<ChartData<"line">>(() => {
    const line = resolveColor(metric === "rhr" ? "var(--accent-cyan)" : "var(--accent-purple)");
    const dim = resolveColor("var(--muted-foreground)");
    return {
      labels: points.map(p => p.date.slice(5)), // MM-DD
      datasets: [
        {
          label: METRIC_LABEL[metric],
          data: points.map(p => p.value),
          borderColor: line,
          backgroundColor: line,
          borderWidth: 2,
          tension: 0.3,
          spanGaps: true,
          // A dose day is a ring on the line rather than a separate series: it marks WHEN, and the
          // reader's eye follows the days after it, which is where the effect is.
          pointRadius: points.map(p => (p.dosedOn ? 4.5 : 0)),
          pointBackgroundColor: resolveColor("var(--accent-amber)"),
          pointBorderColor: resolveColor("var(--accent-amber)"),
        },
        {
          label: "Baseline",
          data: points.map(p => p.baseline),
          borderColor: dim,
          borderWidth: 1,
          borderDash: [4, 4],
          pointRadius: 0,
          tension: 0.3,
          spanGaps: true,
        },
      ],
    };
  }, [points, metric]);

  if (!hasAnyReading(points)) {
    return <p className="text-xs text-[color:var(--muted-foreground)]">No nights with a reading in this window yet.</p>;
  }

  return (
    <div style={{ height: 170 }}>
      <Line
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                afterBody: (items) => {
                  const p = points[items[0]?.dataIndex ?? -1];
                  if (!p) return "";
                  if (p.dosedOn) return "Dose taken";
                  return p.inEffectWindow ? "Within the post-dose window" : "";
                },
                label: (item) => `${item.dataset.label}: ${item.formattedValue} ${METRIC_UNIT[metric]}`,
              },
            },
          },
          scales: {
            x: { ticks: { maxTicksLimit: 6, color: resolveColor("var(--muted-foreground)") }, grid: { display: false } },
            y: {
              ticks: { maxTicksLimit: 5, color: resolveColor("var(--muted-foreground)") },
              grid: { color: resolveColor("var(--border)") },
            },
          },
        }}
      />
    </div>
  );
}
