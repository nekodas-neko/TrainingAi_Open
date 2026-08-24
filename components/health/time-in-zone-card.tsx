"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { HeartPulseIcon } from "lucide-react";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { computeHrZones } from "@trainingai/shared/health/hr-zones";
import { resolveColor } from "@trainingai/shared/chart-colors";
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
import { ZONE_MINUTES_TTL } from "@trainingai/shared/cache-ttl";
import { todayInTz, shiftDateStr } from "@trainingai/shared/date-utils";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

type Window = "day" | "week" | "month";
const WINDOWS: readonly { value: Window; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];
const SPAN_DAYS: Record<Window, number> = { day: 1, week: 7, month: 30 };

interface ZoneMinutesResponse {
  from: string;
  to: string;
  profile: { maxHr: number; restingHr: number };
  days: { day: string; seconds: [number, number, number, number, number] }[];
}

function fmtDuration(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

// Day / week / month time-in-HR-zone, from the reconcile-on-read /api/zone-minutes rollups. One
// stacked bar per day (minutes per zone); zone colours come only from hr-zones.ts and are paired
// with the zone name in the legend (never colour-alone state).
export const TimeInZoneCard = memo(function TimeInZoneCard() {
  const tz = useUserTimezone();
  const [win, setWin] = useState<Window>("week");
  const [data, setData] = useState<ZoneMinutesResponse | null>(null);

  const range = useMemo(() => {
    const to = todayInTz(tz);
    const from = shiftDateStr(to, -(SPAN_DAYS[win] - 1));
    return { from, to };
  }, [win, tz]);

  useEffect(() => {
    const key = `zone-minutes:${range.from}:${range.to}`;
    const seed = readCacheSync<ZoneMinutesResponse>(key);
    if (seed) setData(seed);
    else setData(null);
    cachedFetch<ZoneMinutesResponse>(key, `/api/zone-minutes?from=${range.from}&to=${range.to}`, ZONE_MINUTES_TTL, d => {
      if (d) setData(d);
    });
  }, [range.from, range.to]);

  const zoneMeta = useMemo(() => {
    const profile = data?.profile ?? { maxHr: 190, restingHr: 60 };
    return computeHrZones(profile);
  }, [data?.profile]);

  const chart = useMemo(() => {
    const days = data?.days ?? [];
    const colors = zoneMeta.map(z => resolveColor(z.color));
    return {
      labels: days.map(d => d.day.slice(5)), // MM-DD
      datasets: zoneMeta.map((z, zi) => ({
        label: `Z${z.id} ${z.name}`,
        data: days.map(d => Math.round(d.seconds[zi] / 60)), // minutes
        backgroundColor: colors[zi],
        stack: "zones",
        maxBarThickness: 22,
        borderRadius: 2,
      })),
    };
  }, [data?.days, zoneMeta]);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 as const },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (item: { dataset: { label?: string }; parsed: { y: number } }) => `${item.dataset.label}: ${item.parsed.y} min`,
        },
      },
    },
    scales: {
      x: { stacked: true, grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 0 } },
      y: { stacked: true, grid: { color: "rgba(128,128,128,0.15)" }, ticks: { font: { size: 9 } } },
    },
  }), []);

  // Summary: total time in Zone 2+ (moderate and above) over the window.
  const zone2PlusSec = useMemo(
    () => (data?.days ?? []).reduce((sum, d) => sum + d.seconds[1] + d.seconds[2] + d.seconds[3] + d.seconds[4], 0),
    [data?.days],
  );
  const totalSec = useMemo(
    () => (data?.days ?? []).reduce((sum, d) => sum + d.seconds.reduce((a, b) => a + b, 0), 0),
    [data?.days],
  );

  return (
    <div className="rounded-2xl bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <HeartPulseIcon className="h-4 w-4 text-muted-foreground" aria-hidden /> Time in Zone
        </h3>
        <SegmentedTabs tabs={WINDOWS} value={win} onValueChange={setWin} size="xs" className="w-40" />
      </div>

      {totalSec > 0 ? (
        <>
          <div style={{ height: 150 }}>
            <Bar data={chart} options={options as Parameters<typeof Bar>[0]["options"]} />
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {zoneMeta.map(z => (
              <span key={z.id} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: z.color }} aria-hidden />
                Z{z.id} {z.name}
              </span>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {fmtDuration(zone2PlusSec)} in Zone 2+ over the last {SPAN_DAYS[win]} day{SPAN_DAYS[win] === 1 ? "" : "s"}.
          </p>
        </>
      ) : (
        <p className="py-6 text-center text-xs text-muted-foreground">
          No heart-rate data in this window yet — wear the ring or strap during a workout.
        </p>
      )}
    </div>
  );
});
