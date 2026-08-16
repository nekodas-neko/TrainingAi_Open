"use client";

import dynamic from "next/dynamic";

// chart.js is heavy — dynamically wrapped like trend-sparkline-lazy.tsx, the shared
// pattern every health detail page's chart.js widgets use, instead of dragging chart.js
// into the sleep screen's initial bundle.
export const SleepTrendToggleCard = dynamic(
  () => import("./sleep-trend-toggle-card").then(m => m.SleepTrendToggleCard),
  {
    ssr: false,
    loading: () => <div className="h-[220px] w-full" />,
  },
);
