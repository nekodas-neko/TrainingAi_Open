"use client";

import { useState } from "react";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { SleepPhaseTrendCard, type PhaseHoursNight } from "./sleep-phase-trend-card";
import { SleepTimingTrendCard, type TimingNight } from "./sleep-timing-trend-card";

type View = "phases" | "bedtime" | "wake";

const TABS: readonly { value: View; label: string }[] = [
  { value: "phases",  label: "Sleep Stages" },
  { value: "bedtime", label: "Bedtime" },
  { value: "wake",    label: "Wake Time" },
];

export interface SleepTrendNight extends PhaseHoursNight, TimingNight {}

// Q-90: the owner asked for "a chart that can toggle between metrics or combine several" for
// phase-hours/bedtime/wake-time. Picked "toggle" (one of the two options the owner named) over
// three permanently-stacked cards — a segmented control over one shared chart area, following
// the app's established pill-tab pattern (SegmentedTabs), so adding a future view doesn't mean
// adding another always-visible card.
export function SleepTrendToggleCard({ nights }: { nights: SleepTrendNight[] }) {
  const [view, setView] = useState<View>("phases");

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {TABS.find(t => t.value === view)?.label} — 14 days
        </p>
      </div>
      <SegmentedTabs tabs={TABS} value={view} onValueChange={setView} size="xs" />
      {view === "phases" && <SleepPhaseTrendCard nights={nights} />}
      {view === "bedtime" && <SleepTimingTrendCard nights={nights} mode="bedtime" />}
      {view === "wake" && <SleepTimingTrendCard nights={nights} mode="wake" />}
    </div>
  );
}
