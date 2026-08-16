"use client";

import { useState, useEffect, useLayoutEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ProfileTab } from "@/components/more/profile-tab";
import { SyncHealthCard } from "@/components/more/sync-health-card";
import FriendsTab from "@/components/more/friends-tab";
import type { User } from "@trainingai/shared/types/user";
import type { Season } from "@trainingai/shared/types/friends";
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
import { TTL_MEDIUM } from '@trainingai/shared/cache-ttl';
import {
  invalidateBiometrics, invalidateProgramStructure, invalidateWorkoutSummaries,
  invalidateNutritionWrite, invalidateSupplements, invalidateActivityWrites,
  invalidateInjuryWrites, invalidateOuraSync, invalidateRunningPlan, invalidateFitnessTests,
} from "@/lib/cache-groups";
import { pushMutations, pullDelta } from "@/lib/local-store/sync-engine";
import { PullToSync } from "@/components/pull-to-sync";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { ScreenHeader } from "@/components/shell/screen-header";
import { useRefreshOnTabShow } from "@/components/shell/tab-visibility";
import { toast } from "sonner";

type Tab = "profile" | "friends";

// Module-level: persists for the entire browser session across React remounts
let _user: User | null = null;
let _seasons: Season[] = [];
let _equippedTitle: string | null | undefined = undefined; // undefined = not yet overridden by client

interface MoreContentProps {
  friendCode?: string | null
}

export default function MoreContent({ friendCode }: MoreContentProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(() => {
    const p = searchParams.get('tab');
    return (p === 'profile' || p === 'friends') ? p as Tab : 'profile';
  });
  // Client-overridden value wins; else the last-loaded profile's title.
  const [equippedTitle, setEquippedTitle] = useState<string | null>(
    _equippedTitle !== undefined ? _equippedTitle : (_user?.equippedTitle ?? null)
  );

  function handleTitleChange(titleId: string | null) {
    _equippedTitle = titleId; // persist across remounts for this browser session
    setEquippedTitle(titleId);
  }
  const [user, setUser] = useState<User | null>(_user);
  const [seasons, setSeasons] = useState<Season[]>(_seasons);

  useEffect(() => {
    const p = searchParams.get('tab');
    // `?tab=workout` mounted the Program Builder here until Q-235 gave it /program. Kept as a
    // redirect for muscle memory and any bookmark — an unrecognised value must never silently fall
    // through to the default tab, which is exactly how Q-223 hid.
    if (p === 'workout') { router.replace('/program'); return; }
    if (p === 'profile' || p === 'friends') setTab(p as Tab);
  }, [searchParams, router]);

  // Seed from cache synchronously so stats show without waiting for API
  useLayoutEffect(() => {
    // Season badges: seed before paint so a repeat visit doesn't flash empty until
    // /api/seasons resolves (module-level `_seasons` survives a remount but resets on cold start).
    if (_seasons.length === 0) {
      const cachedSeasons = readCacheSync<{ seasons: Season[] }>('more-seasons');
      if (cachedSeasons?.seasons) { _seasons = cachedSeasons.seasons; setSeasons(cachedSeasons.seasons); }
    }
    if (_user) return;
    const cached = readCacheSync<{ user: User }>('more-user-profile');
    if (cached?.user) {
      _user = cached.user; setUser(cached.user);
      if (_equippedTitle === undefined) setEquippedTitle(cached.user.equippedTitle ?? null);
    }
  }, []);

  const refresh = useCallback(() => {
    cachedFetch<{ user: User }>(
      'more-user-profile', '/api/user/profile', TTL_MEDIUM,
      (d) => {
        if (d?.user) {
          _user = d.user; setUser(d.user);
          if (_equippedTitle === undefined) setEquippedTitle(d.user.equippedTitle ?? null);
        }
      },
    ).catch(() => {});
    cachedFetch<{ seasons: Season[] }>(
      'more-seasons', '/api/seasons', TTL_MEDIUM,
      (d) => { if (d?.seasons) { _seasons = d.seasons; setSeasons(d.seasons); } },
    ).catch(() => {});
  }, []);

  useEffect(() => {
    if (_user) return; // already loaded this session — the re-show pass below revalidates it
    refresh();
  }, [refresh]);

  // More was the one tab the persistent-shell plan never wired up (the other four thread `epoch`
  // through their own effects), so with every tab permanently mounted its profile, stats and season
  // badges were fetched once per app launch and never again — an app restart was the only refresh.
  // cachedFetch honours TTL_MEDIUM, so a re-show inside the window costs nothing.
  useRefreshOnTabShow(refresh);

  const handlePullSync = useCallback(async () => {
    const userId = user?.id;
    if (userId) await pushMutations(userId).catch(() => {});

    // The Oura Cloud sync that used to run alongside this pull is gone (owner, 2026-08-13) — the
    // ring has been on our own BLE key since the re-key, and it is drained by PullToSync already.
    const deltaResult = await Promise.allSettled([
      userId ? pullDelta(userId, true) : Promise.resolve(null),
    ]).then(r => r[0]);

    // Invalidate only what the pull actually changed (mirrors sync-provider.tsx)
    // — never invalidateCache(''), which wipes every screen's instant-paint seed.
    const delta = deltaResult.status === 'fulfilled' ? deltaResult.value : null;
    if (delta && delta.synced > 0) {
      if (delta.domains.biometrics)  await invalidateBiometrics();
      if (delta.domains.programs)    await invalidateProgramStructure();
      if (delta.domains.workouts)    await invalidateWorkoutSummaries();
      if (delta.domains.nutrition)   await invalidateNutritionWrite();
      if (delta.domains.supplements) await invalidateSupplements();
      if (delta.domains.activity)    await invalidateActivityWrites();
      // B6: this block claimed to mirror sync-provider but dropped the running +
      // fitnessTests domains, so a More-tab sync that reconciled a pushed run/test
      // never cleared their caches.
      if (delta.domains.running)     await invalidateRunningPlan();
      if (delta.domains.fitnessTests) await invalidateFitnessTests();
      if (delta.domains.injuries)    await invalidateInjuryWrites();
      if (delta.domains.ouraDaily)   await invalidateOuraSync();
    }
  }, [user?.id]);

  return (
    <div className="flex flex-col bg-page h-screen">
      <ScreenHeader title="More" subtitle="Profile, achievements & settings" />

      <SegmentedTabs
        className="px-4 pt-3 pb-0"
        size="xs"
        tabs={(["profile", "friends"] as Tab[]).map(t => ({
          value: t,
          label: t.charAt(0).toUpperCase() + t.slice(1),
        }))}
        value={tab}
        onValueChange={setTab}
      />

      <PullToSync
        onSync={handlePullSync}
        scrollClassName="flex-1 overflow-y-auto pb-nav-safe"
        className="flex-1 flex flex-col overflow-hidden"
      >
        <div style={{ display: tab === "profile" ? undefined : "none" }}>
          <SyncHealthCard userId={user?.id} />
          <ProfileTab user={user} equippedTitle={equippedTitle} friendCode={friendCode} seasons={seasons} onUserSaved={(updated) => { _user = updated; setUser(updated); }} onTitleChange={handleTitleChange} />
        </div>
        <div style={{ display: tab === "friends" ? undefined : "none" }}>
          <FriendsTab />
        </div>
      </PullToSync>
    </div>
  );
}
