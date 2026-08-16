"use client";

import dynamic from "next/dynamic";

// chart.js is heavy — this is the one dynamic wrapper every health detail
// page shares, instead of each page carrying its own dynamic() call.
export const TrendSparkline = dynamic(
  () => import("./trend-sparkline").then(m => m.TrendSparkline),
  {
    ssr: false,
    // A-10: consumers are cache-seeded (readTodayCacheSync / parent-resolved props),
    // so a pulsing skeleton flashed on every cold start / SW update even though the
    // data was in hand — defeating the instant-paint rule. A fixed-height static
    // placeholder reserves the space without the animated "loading" tell (matches
    // components/muscle-heatmap.tsx's approach).
    loading: () => <div className="h-[152px] w-full" />,
  },
);
