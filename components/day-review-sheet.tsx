"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
import { TTL_MEDIUM, TTL_SHORT } from "@trainingai/shared/cache-ttl";
import { todayInTz } from "@trainingai/shared/date-utils";
import type { LoadComparisonEntry } from "@/components/health/workout-load-comparison-chart";

const Response = dynamic(() => import("@/components/ai/response").then(m => m.Response), { ssr: false });
const HrDayChart = dynamic(() => import("@/components/health/hr-day-chart").then(m => ({ default: m.HrDayChart })), { ssr: false });
const WorkoutLoadComparisonChart = dynamic(
  () => import("@/components/health/workout-load-comparison-chart").then(m => m.WorkoutLoadComparisonChart),
  { ssr: false },
);

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DailyDigestResponse {
  digest: string | null;
  date: string;
}

export function DayReviewSheet({ open, onOpenChange }: Props) {
  const [digest, setDigest] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hrData, setHrData] = useState<{ readings: { timestamp: string; bpm: number; source: string | null }[]; sleep: unknown } | null>(null);
  const [loadEntries, setLoadEntries] = useState<LoadComparisonEntry[] | null>(null);
  const [sessionName, setSessionName] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const today = todayInTz();
    setLoading(true);
    fetch("/api/daily-digest", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(res => res.ok ? res.json() as Promise<DailyDigestResponse> : null)
      .then(data => setDigest(data?.digest ?? null))
      .finally(() => setLoading(false));

    cachedFetch(`oura-hr-day:${today}`, `/api/oura/hr-day?date=${today}`, TTL_MEDIUM, d => setHrData(d as typeof hrData));

    const seededSessions = readCacheSync<{ sessions: { sessionId?: string | null; sessionName: string }[] }>(`workout-sessions-day:${today}`);
    if (seededSessions?.sessions?.[0]) setSessionName(seededSessions.sessions[0].sessionName);

    cachedFetch<{ sessions: { sessionId?: string | null; sessionName: string }[] }>(
      `workout-sessions-day:${today}`, `/api/workout-sessions/day?date=${today}`, TTL_MEDIUM,
      data => {
        const sessions = data?.sessions;
        if (!sessions || sessions.length === 0) return;
        const first = sessions[0];
        setSessionName(first.sessionName);
        const query = first.sessionId
          ? `sessionId=${encodeURIComponent(first.sessionId)}`
          : `sessionName=${encodeURIComponent(first.sessionName)}`;
        cachedFetch<LoadComparisonEntry[] | null>(
          `workout-load-history:${first.sessionId ?? first.sessionName}`,
          `/api/workout-load-history?${query}`,
          TTL_SHORT,
          entries => setLoadEntries(entries),
        ).catch(() => {});
      },
    ).catch(() => {});
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto overflow-x-hidden">
        <SheetHeader>
          <SheetTitle>Your Day in Review</SheetTitle>
        </SheetHeader>
        <div className="px-4 space-y-4">
          {loading && <div className="h-16 animate-pulse rounded-xl bg-muted" />}
          {digest && <Response className="text-sm leading-relaxed">{digest}</Response>}
          {hrData && hrData.readings.length > 0 && (
            <HrDayChart readings={hrData.readings} date={todayInTz()} compact />
          )}
          {loadEntries && loadEntries.length > 0 && sessionName && (
            <WorkoutLoadComparisonChart entries={loadEntries} sessionName={sessionName} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
