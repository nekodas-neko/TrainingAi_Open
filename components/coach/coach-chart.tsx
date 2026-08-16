"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import type { ChartArgs, WidgetColorKey } from "@/lib/coach/widgets";
import type { ChartPayload } from "@trainingai/shared/parse-chart-blocks";
import { resolveColor } from "@trainingai/shared/chart-colors";

// chart.js is heavy and browser-only — the same `ssr: false` treatment every other chart in the app
// gets. No `loading:` skeleton: the widget arrives mid-conversation, and a placeholder that swaps
// itself out a beat later reads as a glitch rather than progress.
const ChartMessage = dynamic(() => import("@/components/chart-message").then(m => m.ChartMessage), {
  ssr: false,
});

/** Theme tokens, never hex — a model-authored colour would break one of the two themes. They are
 *  resolved to concrete values before they reach chart.js: canvas `fillStyle` cannot read a CSS
 *  custom property and silently paints black (CLAUDE.md, and the bug that shipped twice). */
const COLOR_VAR: Record<WidgetColorKey, string> = {
  cyan: "var(--accent-cyan)",
  green: "var(--accent-green)",
  amber: "var(--accent-amber)",
  purple: "var(--accent-purple)",
  destructive: "var(--destructive)",
};
const FALLBACK: WidgetColorKey[] = ["cyan", "green", "amber", "purple"];

interface CoachChartProps {
  args: ChartArgs;
  /** Called once, on mount. A chart asks nothing, so nothing will ever answer it — and an
   *  unanswered client-side tool call makes the provider refuse every following turn. */
  onShown?: () => void;
}

export function CoachChart({ args, onShown }: CoachChartProps) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current || !onShown) return;
    sent.current = true;
    onShown();
  }, [onShown]);

  // A dataset shorter than the labels leaves chart.js drawing a line that stops mid-axis, which
  // reads as missing data rather than a malformed payload. Trim to the shorter of the two.
  const width = Math.min(args.labels.length, ...args.datasets.map(d => d.data.length));

  const payload: ChartPayload = {
    type: args.chartType,
    title: args.title,
    labels: args.labels.slice(0, width),
    datasets: args.datasets.map((d, i) => {
      const color = resolveColor(COLOR_VAR[d.colorKey ?? FALLBACK[i % FALLBACK.length]]);
      return {
        label: d.label,
        data: d.data.slice(0, width),
        borderColor: color,
        backgroundColor: color,
        borderWidth: 2,
        fill: false,
        tension: 0.3,
      };
    }),
  };

  return <ChartMessage payload={payload} />;
}
