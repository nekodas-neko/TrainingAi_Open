"use client";

import { HealthMetricSheet, type SleepDetailReading } from "@/components/health-metric-sheet";
import type { BodyMetaRow } from "@/app/api/body-metadata/route";

interface Props {
  metricSheet: string | null;
  onClose: () => void;
  metaRecentReversed: BodyMetaRow[];
  sleepReadings: SleepDetailReading[];
  // Q-93-followup: pre-opens the sleep sheet straight to this night's detail view (deep-link
  // from the home/health timeline's "Woke up"/"Fell asleep" cards), instead of the list.
  initialSleepDate?: string | null;
}

// The 7 metric-detail sheets shown from the Body tab's cards — extracted from
// health-content.tsx (Task 4.4) as a pure move, no behaviour change.
export function MetricSheets({ metricSheet, onClose, metaRecentReversed, sleepReadings, initialSleepDate }: Props) {
  return (
    <>
      <HealthMetricSheet
        open={metricSheet === "weight"}
        onClose={onClose}
        title="Body Weight"
        unit=" kg"
        color="var(--color-brand)"
        readings={metaRecentReversed.map(r => ({ date: r.date, value: r.weightKg }))}
      />
      <HealthMetricSheet
        open={metricSheet === "bodyFat"}
        onClose={onClose}
        title="Body Fat"
        unit="%"
        color="var(--color-brand)"
        readings={metaRecentReversed.map(r => ({ date: r.date, value: r.bodyFat }))}
        formatValue={v => v.toFixed(1)}
      />
      <HealthMetricSheet
        open={metricSheet === "steps"}
        onClose={onClose}
        title="Steps"
        unit=""
        color="#00d4ff"
        readings={metaRecentReversed.map(r => ({ date: r.date, value: r.steps }))}
        formatValue={v => v.toLocaleString()}
      />
      <HealthMetricSheet
        open={metricSheet === "sleep"}
        onClose={onClose}
        title="Sleep"
        unit="h"
        color="#8b5cf6"
        sleepReadings={sleepReadings}
        initialDate={initialSleepDate}
      />
      <HealthMetricSheet
        open={metricSheet === "restingHR"}
        onClose={onClose}
        title="Resting Heart Rate"
        unit=" bpm"
        color="#ef4444"
        readings={metaRecentReversed.map(r => ({ date: r.date, value: r.restingHeartRate ?? null }))}
        formatValue={v => String(Math.round(v))}
      />
      <HealthMetricSheet
        open={metricSheet === "hrv"}
        onClose={onClose}
        title="HRV (rMSSD)"
        unit=" ms"
        color="#f97316"
        readings={metaRecentReversed.map(r => ({ date: r.date, value: r.hrvMs ?? null }))}
        formatValue={v => v.toFixed(0)}
      />
      <HealthMetricSheet
        open={metricSheet === "spo2"}
        onClose={onClose}
        title="SpO₂"
        unit="%"
        color="#06b6d4"
        readings={metaRecentReversed.map(r => ({ date: r.date, value: r.spo2Pct ?? null }))}
        formatValue={v => v.toFixed(1)}
      />
    </>
  );
}
