"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { FeedEvent } from "@trainingai/shared/types/friends";
import { TITLES } from "@trainingai/shared/types/friends";
import { formatDistanceToNow } from "date-fns";
import { Dumbbell, Trophy, TrendingUp, UserCircle } from "lucide-react";
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
import { TTL_SHORT } from '@trainingai/shared/cache-ttl';
import { useRefreshOnTabShow } from "@/components/shell/tab-visibility";

function FeedItem({ event }: { event: FeedEvent }) {
  const router = useRouter();
  const title = event.equippedTitle ? TITLES[event.equippedTitle] : null;

  const iconEl = event.type === 'pr'
    ? <TrendingUp className="w-4 h-4 text-purple-400" />
    : <Trophy className="w-4 h-4 text-yellow-400" />;

  const text = event.type === 'pr'
    ? `Hit a new PR on ${event.payload.exerciseName} — ${Math.round(event.payload.weightKg ?? 0)} kg`
    : event.payload.achievementName ?? 'Completed a workout';

  return (
    <div
      onClick={() => router.push(`/profile/${event.userId}`)}
      className="flex items-start gap-3 py-3 border-b border-border/30 last:border-0 cursor-pointer active:opacity-70 transition-opacity"
    >
      {event.avatar ? (
        <Image src={event.avatar} alt="" width={32} height={32}
          unoptimized={event.avatar.startsWith('data:')}
          className="w-8 h-8 rounded-full object-cover flex-shrink-0 mt-0.5" />
      ) : (
        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
          <UserCircle className="w-5 h-5 text-muted-foreground" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-semibold text-sm text-shadow-bg">{event.displayName}</span>
          {title && (
            <span className="text-xs font-medium text-shadow-bg" style={{ color: 'var(--color-brand)' }}>· {title.display}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {iconEl}
          <p className="text-xs text-muted-foreground truncate">{text}</p>
        </div>
        <p className="text-[10px] text-muted-foreground/60 mt-0.5">
          {formatDistanceToNow(new Date(event.occurredAt), { addSuffix: true })}
        </p>
      </div>
    </div>
  );
}

export function FriendFeed() {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  // Seed synchronously from cache before paint — in a useLayoutEffect, never a useState lazy
  // initializer (cache reads in initializers caused hydration mismatches, session 165).
  useLayoutEffect(() => {
    const seeded = readCacheSync<{ events: FeedEvent[] }>('friends-feed')?.events;
    if (seeded && seeded.length > 0) { setEvents(seeded); setLoading(false); }
  }, []);
  // K9: a failed fetch used to land on the "No friend activity yet" empty state,
  // indistinguishable from genuinely having none. Track it and offer a retry.
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setError(false);
    cachedFetch<{ events: FeedEvent[] }>(
      'friends-feed', '/api/friends/feed', TTL_SHORT,
      d => { if (d?.events) setEvents(d.events); },
      { onError: () => setError(true) },
    ).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useRefreshOnTabShow(load);

  if (loading) {
    return (
      <div className="space-y-3 py-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-muted/30" />
        ))}
      </div>
    );
  }

  // Only when the fetch failed AND we have nothing cached to show.
  if (error && events.length === 0) {
    return (
      <div className="py-8 text-center">
        <Dumbbell className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">Couldn&apos;t load friend activity.</p>
        <button type="button" onClick={load} className="text-xs font-medium mt-1.5" style={{ color: 'var(--color-brand)' }}>
          Retry
        </button>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="py-8 text-center">
        <Dumbbell className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No friend activity yet.</p>
        <p className="text-xs text-muted-foreground/60 mt-1">Add friends to see their progress here.</p>
      </div>
    );
  }

  return (
    <div>
      {events.map((e, i) => <FeedItem key={i} event={e} />)}
    </div>
  );
}
