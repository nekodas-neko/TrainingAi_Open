"use client";

import dynamic from "next/dynamic";

/** chart.js is ~60 kB and this card only renders when a vial-dosed log exists in the window, so it
 *  is loaded on demand — the same shape `sleep-trend-toggle-card-lazy` uses. */
export const DoseVitalsCard = dynamic(
  () => import("./dose-vitals-card").then(m => m.DoseVitalsCard),
  { ssr: false },
);
