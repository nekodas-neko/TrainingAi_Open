"use client";

import { memo, useCallback, useEffect, useState } from "react";
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
import { TTL_MEDIUM } from '@trainingai/shared/cache-ttl';

interface VolumeData {
  targets: Record<string, number>;
  logged: Record<string, number>;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const AiWeeklyVolumeCard = memo(function AiWeeklyVolumeCard() {
  const [data, setData] = useState<VolumeData | null>(null);
  const [loading, setLoading] = useState(true);
  // K9: distinguish "fetch failed" from "no data" — the old `return null` made a
  // rate-limit/500 look identical to an empty week (the "is my ring broken?" class).
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setError(false);
    // Paint from cache synchronously so the card doesn't flash a skeleton on every open.
    const seed = readCacheSync<VolumeData>('weekly-volume-target');
    if (seed) { setData(seed); setLoading(false); }
    cachedFetch<VolumeData>(
      'weekly-volume-target', '/api/ai-periodization/weekly-volume', TTL_MEDIUM,
      d => { if (d) setData(d); },
      { onError: () => setError(true) },
    ).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Online + no cached data + fetch failed → error-with-retry, not a vanished card.
  if (!loading && error && !data) {
    return (
      <div className="rounded-2xl bg-muted/60 border border-border p-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          Weekly Volume vs Target
        </p>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Couldn&apos;t load this</span>
          <button type="button" onClick={load} className="text-xs font-medium text-brand">Retry</button>
        </div>
      </div>
    );
  }

  if (!loading && (!data || Object.keys(data.targets).length === 0)) return null;

  const muscles = Object.keys({ ...data?.targets, ...data?.logged }).sort();

  return (
    <div className="rounded-2xl bg-muted/60 border border-border p-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
        Weekly Volume vs Target
      </p>

      {loading ? (
        <div className="space-y-2.5">
          {[80, 60, 70].map(w => (
            <div key={w} className="h-5 rounded bg-muted animate-pulse" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {muscles.map(mg => {
            const logged = data?.logged[mg] ?? 0;
            const target = data?.targets[mg] ?? 0;
            const pct = target > 0 ? Math.min(100, Math.round((logged / target) * 100)) : 0;
            const over = target > 0 && logged >= target;

            return (
              <div key={mg}>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="text-foreground">{capitalize(mg)}</span>
                  <span className={over ? "text-green-500 font-medium" : "text-muted-foreground"}>
                    {logged.toFixed(1)} / {target} sets
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${pct}%`,
                      background: over ? '#22c55e' : 'var(--color-brand)',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
})
