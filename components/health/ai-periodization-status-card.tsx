"use client";

import { memo, useLayoutEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSessionIcon } from "@/lib/session-icon";
import { cn } from "@trainingai/shared/utils";
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
import { invalidateAiPeriodization } from "@/lib/cache-groups";
import { TTL_MEDIUM } from '@trainingai/shared/cache-ttl';
import type { SessionPeriodization } from "@trainingai/shared/types/ai-periodization";

interface SessionOverview {
  sessionId: string;
  sessionName: string;
  icon: string | null;
  state: SessionPeriodization | null;
  lastTrainedDaysAgo: number | null;
}

const PHASE_COLORS: Record<string, string> = {
  baseline: "text-muted-foreground",
  accumulation: "text-blue-500",
  intensification: "text-orange-500",
  realisation: "text-red-500",
  deload: "text-green-500",
};

const PHASE_LABELS: Record<string, string> = {
  baseline: "Baseline",
  accumulation: "Accum.",
  intensification: "Intens.",
  realisation: "Realise",
  deload: "Deload",
};

// Every ai_dynamic session either has a prescription driving it or doesn't — there's no
// per-session "auto" state worth calling out, so the right-hand slot shows recency instead
// (and doubles as the signal that would have surfaced the 7-day-stale prescription bug).
function lastTrainedLabel(daysAgo: number | null): string {
  if (daysAgo == null) return "Never trained";
  if (daysAgo <= 0) return "Trained today";
  if (daysAgo === 1) return "Yesterday";
  return `${daysAgo}d ago`;
}

export const AiPeriodizationStatusCard = memo(function AiPeriodizationStatusCard() {
  const [sessions, setSessions] = useState<SessionOverview[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);

  const loadSessions = useCallback(() => {
    cachedFetch<{ sessions: SessionOverview[] }>(
      'ai-periodization-overview', '/api/ai-periodization/program-overview', TTL_MEDIUM,
      d => { if (d?.sessions) setSessions(d.sessions); },
    ).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useLayoutEffect(() => {
    // Paint from cache synchronously so the card doesn't flash a skeleton on every open.
    const seed = readCacheSync<{ sessions: SessionOverview[] }>('ai-periodization-overview');
    if (seed?.sessions) { setSessions(seed.sessions); setLoading(false); }
    loadSessions();
  }, [loadSessions]);

  const applyExisting = useCallback(async (sessionId: string) => {
    setApplying(sessionId);
    try {
      const res = await fetch('/api/ai-periodization/baseline/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      if (res.ok) {
        setLoading(true);
        await invalidateAiPeriodization();
        loadSessions();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'Could not apply prior data');
      }
    } catch {
      // non-fatal
    } finally {
      setApplying(null);
    }
  }, [loadSessions]);

  const activeSessions = sessions?.filter(s => s.state != null) ?? [];

  if (!loading && activeSessions.length === 0) return null;

  return (
    <div className="rounded-2xl bg-muted/60 border border-border p-4">
      <div className="flex items-center gap-2 mb-3">
        <SparklesIcon className="h-4 w-4 text-brand" />
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          AI Periodization
        </h3>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-8 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {(sessions ?? []).map(s => {
            const state = s.state;
            const phase = state?.phase ?? 'baseline';
            const sessionsInPhase = state?.sessionsInPhase ?? 0;
            const baselineComplete = state?.baselineComplete ?? false;

            // A-7: render the session's Lucide icon via the shared mapping instead of
            // the raw stored emoji — every other session surface uses getSessionIcon.
            const SessionIcon = getSessionIcon(s.icon);
            return (
              <div
                key={s.sessionId}
                className="flex items-center gap-3 rounded-lg bg-background/60 px-3 py-2"
              >
                <SessionIcon className="h-4 w-4 flex-none text-muted-foreground" aria-hidden />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{s.sessionName}</p>
                  {state != null && phase === 'baseline' && !baselineComplete ? (
                    <div className="flex items-center gap-2">
                      <p className={cn("text-[11px] font-medium", PHASE_COLORS[phase])}>Baseline needed</p>
                      {/* A-8: a baseline-applying action was a ~14px bare button. Use the
                          shared Button primitive (focus ring, disabled handling, a real
                          padded hit area) in place of the raw text link. */}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={applying === s.sessionId}
                        onClick={() => applyExisting(s.sessionId)}
                        className="text-[11px] font-medium text-brand"
                      >
                        {applying === s.sessionId ? '…' : 'Use prior data →'}
                      </Button>
                    </div>
                  ) : (
                    <p className={cn("text-[11px] font-medium", PHASE_COLORS[phase])}>
                      {state == null
                        ? 'No data'
                        : `${PHASE_LABELS[phase] ?? phase} · ${sessionsInPhase} session${sessionsInPhase !== 1 ? 's' : ''}`
                      }
                    </p>
                  )}
                </div>
                {state != null && (
                  <span className="text-[10px] font-medium text-muted-foreground flex-none whitespace-nowrap">
                    {lastTrainedLabel(s.lastTrainedDaysAgo)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
})
