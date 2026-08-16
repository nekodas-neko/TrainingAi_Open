"use client";

import { useCallback, useEffect, useState } from "react";
import { MoonStarIcon } from "lucide-react";
import type { NextSessionPrescriptionResponse } from "@/app/api/next-session/prescription/route";
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
import { NEXT_SESSION_PRESCRIPTION_TTL } from "@trainingai/shared/cache-ttl";

const CACHE_KEY = "next-session-prescription";

// Tap-to-load, matching the Session Recap / HR Recovery cards on this screen — never
// auto-fires (CLAUDE.md: don't auto-fire slow external round-trips on a screen the
// user is trying to leave).
export function NextWorkoutCard() {
  const [data, setData] = useState<NextSessionPrescriptionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  // Instant paint from cache when the next session's prescription is already known —
  // the tap-to-load button below only appears when there is nothing to show. Seeded in an
  // effect, never a useState initializer (hydration mismatch, session 165).
  useEffect(() => {
    const seed = readCacheSync<NextSessionPrescriptionResponse>(CACHE_KEY);
    if (seed) setData(seed);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    await cachedFetch<NextSessionPrescriptionResponse>(
      CACHE_KEY, "/api/next-session/prescription", NEXT_SESSION_PRESCRIPTION_TTL,
      (d) => { setData(d); setLoading(false); },
      { onError: () => { setError(true); setLoading(false); } },
    );
  }, []);

  return (
    <div className="w-full max-w-xs rounded-2xl bg-muted/40 border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Next workout</p>
        {!data && (
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="text-[10px] text-muted-foreground hover:text-foreground transition"
          >
            {loading ? "Loading…" : "Show"}
          </button>
        )}
      </div>

      {data ? (
        data.isRestDay ? (
          <p className="flex items-center gap-1.5 text-sm text-left">
            <MoonStarIcon className="h-4 w-4 text-muted-foreground flex-none" />
            Next up: a rest day
          </p>
        ) : (
          <div className="space-y-2 text-left">
            <p className="text-sm font-semibold">{data.sessionName}</p>
            {data.source === 'pending' && (
              <p className="text-[10px] text-muted-foreground">
                Your next prescription is still being generated — it&apos;ll be ready when you start.
              </p>
            )}
            <div className="space-y-1.5">
              {data.exercises?.map(ex => (
                <div key={ex.name} className="text-xs">
                  <p className="font-medium truncate">{ex.name}</p>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {ex.sets.map((s, i) => (
                      <span
                        key={i}
                        className="rounded-md bg-background border border-border/60 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground"
                      >
                        {s.weightKg != null ? `${s.weightKg}kg × ${s.reps}` : `${s.reps} reps`}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      ) : error ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] text-red-400">Couldn&apos;t load the next session.</p>
          <button
            type="button"
            onClick={load}
            className="tap-dense text-[10px] text-muted-foreground hover:text-foreground transition underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground">
          {loading ? "Loading your next session…" : "Tap Show for a preview of your next scheduled workout."}
        </p>
      )}
    </div>
  );
}
