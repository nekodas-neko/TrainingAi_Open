"use client";

import { useEffect } from "react";
import { formatTimeOfDay } from '@trainingai/shared/date-utils';
import { useUserTimezone } from '@/components/shell/user-timezone-provider';
import { accentCardStyle } from "@trainingai/shared/utils";
import { useTransitionRouter } from "@/lib/view-transition";
import { actualSleepWindow } from "@/lib/sleep/actual-window";
import type { SleepRow } from "@/app/health/health-sections";

interface Props {
  recentSleep: SleepRow | null;
  lastSleep: SleepRow | null;
  /** Today's computed sleep score from /api/readiness-score — the same number the
   *  Home chip shows. The stored sleep_sessions.sleep_score is Cloud-only (NULL on
   *  BLE nights) and is kept only as a fallback. */
  computedSleepScore: number | null;
  metaLoading: boolean;
  onOpenSheet: () => void;
}

// The Body tab's Sleep card — extracted from health-sections.tsx (Task 4.4) as a
// pure move, no behaviour change.
export function SleepCard({ recentSleep, lastSleep, computedSleepScore, metaLoading, onOpenSheet }: Props) {
  const userTz = useUserTimezone();
  const router = useTransitionRouter();
  // Warm the detail route before it's tapped — see oura-score-chip-row.
  useEffect(() => { router.prefetch("/health/sleep"); }, [router]);
  return (
    // A div (not a button) because it contains the "Sleep details" button,
    // and a button can't be nested inside a button (invalid HTML / hydration error).
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenSheet}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenSheet(); } }}
      className="w-full rounded-2xl p-4 relative overflow-hidden text-left transition active:scale-95 cursor-pointer"
      style={accentCardStyle('#8b5cf6')}
    >
      <div className="absolute -top-4 -right-4 w-20 h-20 rounded-full pointer-events-none" style={{ background: "#8b5cf6", filter: "blur(24px)", opacity: 0.15 }} />
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#8b5cf6" }}>Sleep</p>
          <div className="flex items-baseline gap-2 mt-0.5">
            {metaLoading ? (
              <div className="h-8 w-20 animate-pulse rounded-lg bg-muted" />
            ) : (
              <p className="text-3xl font-bold tabular-nums" style={{ color: "#8b5cf6" }}>
                {recentSleep?.durationHours != null ? `${recentSleep.durationHours.toFixed(1)}h` : "—"}
              </p>
            )}
            {recentSleep?.sleepStart && recentSleep?.sleepEnd && (() => {
              const fmtT = (iso: string) => formatTimeOfDay(iso, userTz)
              // Q-101: raw bedtime for the start (matches the Hypnogram/day-timeline convention) —
              // onset latency is already surfaced separately below via the "↓ Nm onset" badge. The
              // end still comes from actualSleepWindow(), which corrects the ~5min epoch-padding
              // overshoot on the recorded wake time; that's unrelated to the bedtime bug.
              const win = actualSleepWindow(recentSleep)
              const s = recentSleep.sleepStart!
              const e = win?.end ?? recentSleep.sleepEnd!
              return <span className="text-xs text-muted-foreground">{fmtT(s)} – {fmtT(e)}</span>
            })()}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-none">
          {(() => {
            const badgeScore = computedSleepScore ?? lastSleep?.sleepScore ?? null;
            return badgeScore != null ? (
              <span className="text-sm font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(139,92,246,0.2)', color: '#8b5cf6' }}>
                {badgeScore}
              </span>
            ) : null;
          })()}
          <span className="text-[9px] text-muted-foreground opacity-60">↗</span>
        </div>
      </div>
      {recentSleep ? (
        <div className="space-y-1.5">
          <div className="flex gap-1.5 flex-wrap">
            {recentSleep.deepSleepHours  != null && <span className="text-[9px] rounded bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5">Deep {recentSleep.deepSleepHours.toFixed(1)}h</span>}
            {recentSleep.remSleepHours   != null && <span className="text-[9px] rounded bg-violet-500/20 text-violet-400 px-1.5 py-0.5">REM {recentSleep.remSleepHours.toFixed(1)}h</span>}
            {recentSleep.lightSleepHours != null && <span className="text-[9px] rounded bg-slate-500/20 text-slate-400 px-1.5 py-0.5">Light {recentSleep.lightSleepHours.toFixed(1)}h</span>}
            {recentSleep.awakHours != null && recentSleep.awakHours > 0 && <span className="text-[9px] rounded bg-amber-500/20 text-amber-400 px-1.5 py-0.5">Awake {recentSleep.awakHours.toFixed(1)}h</span>}
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {recentSleep.efficiency      != null && <span className="text-[9px] rounded bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5">{recentSleep.efficiency}% eff</span>}
            {recentSleep.onsetLatencySec != null && <span className="text-[9px] rounded bg-amber-500/20 text-amber-400 px-1.5 py-0.5">↓ {Math.round(recentSleep.onsetLatencySec / 60)}m onset</span>}
            {recentSleep.averageHrvMs    != null && <span className="text-[9px] rounded bg-rose-500/20 text-rose-400 px-1.5 py-0.5">HRV (overnight) {recentSleep.averageHrvMs}ms</span>}
            {recentSleep.lowestHeartRate != null && <span className="text-[9px] rounded bg-pink-500/20 text-pink-400 px-1.5 py-0.5">Lowest HR {recentSleep.lowestHeartRate}bpm</span>}
            {recentSleep.respiratoryRate != null && <span className="text-[9px] rounded bg-sky-500/20 text-sky-400 px-1.5 py-0.5">{recentSleep.respiratoryRate.toFixed(1)} br/m</span>}
          </div>
        </div>
      ) : lastSleep ? (
        <p className="text-[9px] text-muted-foreground opacity-60">Last: {lastSleep.date}</p>
      ) : null}
      <button
        onClick={e => { e.stopPropagation(); router.push('/health/sleep'); }}
        className="mt-2 text-[9px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
      >
        Sleep details →
      </button>
    </div>
  );
}
