"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { LeaderboardEntry } from "@trainingai/shared/types/friends";
import { TITLES } from "@trainingai/shared/types/friends";
import { UserCircle, Medal, Eye } from "lucide-react";
import { cn } from "@trainingai/shared/utils";
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
import { TTL_SHORT } from '@trainingai/shared/cache-ttl';
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useRefreshOnTabShow } from "@/components/shell/tab-visibility";

type Period = "weekly" | "alltime";
type Metric = "sessions" | "volume" | "streak";

function getRankValue(entry: LeaderboardEntry, period: Period, metric: Metric): number {
  if (metric === "sessions") return period === "weekly" ? entry.weeklySessions : entry.allTimeSessions;
  if (metric === "volume") return period === "weekly" ? entry.weeklyVolumeKg : entry.allTimeVolumeKg;
  return period === "weekly" ? entry.weeklyStreak : entry.allTimeStreak;
}

function formatValue(value: number, metric: Metric): string {
  if (metric === "volume") return `${Math.round(value / 1000).toLocaleString()}k kg`;
  if (metric === "streak") return `${value}d`;
  return String(value);
}

export function FriendLeaderboard() {
  const router = useRouter();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  // Seed synchronously from cache before paint — in a useLayoutEffect, never a useState lazy
  // initializer (cache reads in initializers caused hydration mismatches, session 165).
  useLayoutEffect(() => {
    const seeded = readCacheSync<{ entries: LeaderboardEntry[] }>('friends-leaderboard')?.entries;
    if (seeded && seeded.length > 0) { setEntries(seeded); setLoading(false); }
  }, []);
  const [period, setPeriod] = useState<Period>("weekly");
  const [metric, setMetric] = useState<Metric>("sessions");
  // K9: a failed fetch used to land on "No data yet", indistinguishable from an
  // empty leaderboard. Track it so the user can retry rather than mistrust the data.
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setError(false);
    cachedFetch<{ entries: LeaderboardEntry[] }>(
      'friends-leaderboard', '/api/friends/leaderboard', TTL_SHORT,
      d => { if (d?.entries) setEntries(d.entries); },
      { onError: () => setError(true) },
    ).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useRefreshOnTabShow(load);

  const sorted = [...entries]
    .sort((a, b) => getRankValue(b, period, metric) - getRankValue(a, period, metric));

  const myValue = entries.find(e => e.isSelf) ? getRankValue(entries.find(e => e.isSelf)!, period, metric) : 0;

  return (
    <div className="space-y-3">
      {/* Controls */}
      <SegmentedTabs
        size="xs"
        tabs={(["weekly", "alltime"] as Period[]).map(p => ({
          value: p,
          label: p === "weekly" ? "This Week" : "All Time",
        }))}
        value={period}
        onValueChange={setPeriod}
      />
      <SegmentedTabs
        size="xs"
        tabs={(["sessions", "volume", "streak"] as Metric[]).map(m => ({
          value: m,
          label: m.charAt(0).toUpperCase() + m.slice(1),
        }))}
        value={metric}
        onValueChange={setMetric}
      />

      {/* Rankings */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 bg-muted/30" />)}
        </div>
      ) : error && sorted.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load the leaderboard.</p>
          <button type="button" onClick={load} className="text-xs font-medium mt-1.5" style={{ color: 'var(--color-brand)' }}>
            Retry
          </button>
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState title="No data yet" />
      ) : (
        <div className="space-y-1.5">
          {sorted.map((entry, index) => {
            const value = getRankValue(entry, period, metric);
            const isChasing = !entry.isSelf && value > 0 && myValue > 0 && Math.abs(value - myValue) / Math.max(value, myValue) < 0.1;
            const title = entry.equippedTitle ? TITLES[entry.equippedTitle] : null;

            return (
              <div
                key={entry.userId}
                onClick={() => router.push(`/profile/${entry.userId}`)}
                className={cn(
                  "flex items-center gap-3 rounded-xl p-3 cursor-pointer active:opacity-70 transition-opacity",
                  entry.isSelf ? "bg-muted/50 border border-border/60" : "bg-muted/20",
                )}
              >
                <span className="text-sm font-bold w-5 text-center text-muted-foreground">
                  {index + 1}
                </span>
                {entry.avatar ? (
                  <Image src={entry.avatar} alt="" width={32} height={32}
                    unoptimized={entry.avatar.startsWith('data:')} className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                    <UserCircle className="w-5 h-5 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={cn("text-sm font-semibold truncate", entry.isSelf && "text-brand")}>
                      {entry.displayName}{entry.isSelf && " (you)"}
                    </span>
                    {/* The review found this as an unlabelled emoji: it is the only marker that
                        someone is within striking distance, so it needs a name, not just a glyph. */}
                    {isChasing && <Eye className="h-3.5 w-3.5 flex-none text-muted-foreground" aria-label="closing in on you" />}
                  </div>
                  {title && (
                    <span className="text-[10px] font-medium" style={{ color: 'var(--color-brand)' }}>{title.display}</span>
                  )}
                </div>
                <span className="text-sm font-bold tabular-nums">
                  {formatValue(value, metric)}
                </span>
                {index === 0 && <Medal className="w-4 h-4 text-yellow-400 flex-shrink-0" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
