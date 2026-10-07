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
import { invalidatePulledDomains } from "@/lib/cache-groups";
import { pushMutations, pullDelta } from "@/lib/local-store/sync-engine";
import { PullToSync } from "@/components/pull-to-sync";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { TabPanels } from "@/components/ui/tab-panels";
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

  // Cleared on a successful load so a retry that lands removes the line.
  const [profileFailed, setProfileFailed] = useState(false);

  const refresh = useCallback(() => {
    cachedFetch<{ user: User }>(
      'more-user-profile', '/api/user/profile', TTL_MEDIUM,
      (d) => {
        if (d?.user) {
          _user = d.user; setUser(d.user); setProfileFailed(false);
          if (_equippedTitle === undefined) setEquippedTitle(d.user.equippedTitle ?? null);
        }
      },
      // RV-150: `cachedFetch` swallows `!res.ok`, and the `.catch` cannot fire — it resolves a
      // boolean rather than rejecting (RV-84). Measured on a cold start with the routes down: the
      // whole identity block, level, XP and trophy case were absent, reading as an empty account.
      { onError: () => setProfileFailed(true), freshWithinTtl: true },
    ).catch(() => {});
    // `freshWithinTtl` — RV-183, with the written proof CLAUDE.md requires:
    //  - RV-67 purity: `listSeasonsWithResults` is two plain selects (`seasons`, then this user's
    //    `season_results`) mapped to the payload. No `now()`, nothing derived, nothing that decays
    //    with the clock — so it is a pure function of stored rows, unlike every other candidate on
    //    this screen.
    //  - Writers: there are NONE. `grep` over `lib/`, `app/` and `scripts/` finds no insert, update
    //    or delete against either table, and `/api/seasons` is GET-only. Nothing this device can do
    //    changes the payload, so the "every writer's group holds the key" half of the proof is
    //    vacuous rather than unproven. `more-user-profile` had to earn that half the hard way; see
    //    the block below `useRefreshOnTabShow`.
    //  - A cleared entry still fetches: `cachedFetchCore` only short-circuits when a cached value
    //    exists AND is fresh, so a future group that starts clearing this key needs no change here.
    // The residual risk is bounded and stated: a season result written server-side appears up to
    // TTL_MEDIUM (30 min) late. `pullDelta` does not carry seasons either, so that delay is already
    // the status quo for anything but a cold start.
    cachedFetch<{ seasons: Season[] }>(
      'more-seasons', '/api/seasons', TTL_MEDIUM,
      (d) => { if (d?.seasons) { _seasons = d.seasons; setSeasons(d.seasons); } },
      { onError: () => setProfileFailed(true), freshWithinTtl: true },
    ).catch(() => {});
  }, []);

  useEffect(() => {
    if (_user) return; // already loaded this session — the re-show pass below revalidates it
    refresh();
  }, [refresh]);

  // More was the one tab the persistent-shell plan never wired up (the other four thread `epoch`
  // through their own effects), so with every tab permanently mounted its profile, stats and season
  // badges were fetched once per app launch and never again — an app restart was the only refresh.
  // ⚠ A re-show costs a GET per unflagged key, not nothing (RV-183). An earlier version of this
  // comment said "cachedFetch honours TTL_MEDIUM, so a re-show inside the window costs nothing" — it
  // does not. `cachedFetchCore` paints the cached value and then ALWAYS revalidates over the network;
  // the TTL governs whether the cached paint is used, never whether the request is sent. Only
  // `freshWithinTtl: true` skips the round trip.
  //
  // RV-183: both keys now carry `freshWithinTtl`, so a re-show inside 30 minutes costs NO GET
  // rather than two. `more-seasons`'s proof is at its call site above.
  //
  // `more-user-profile` now carries it too, and the proof is this, because a missed writer here is
  // 30 minutes of a wrong identity block rather than a flash:
  //
  //   PURE — `GET /api/user/profile` is `getUserByEmail` plus `hasPassword`, one stored row. No
  //   clock, no `today`, no derivation. `workoutCount` was the disqualifier and `LB-180` removed it
  //   (`user-account-routes.test.ts` asserts the body no longer has it).
  //
  //   EVERY WRITER — the payload spreads the whole users row, so all eleven `update(s.users)` sites
  //   count. Nine reach a group holding this key: the profile PATCH and the goals sheet's
  //   `activityLevel` write (`invalidateGoalRecommendations`), the avatar, the equipped title and
  //   the details save (`invalidateUserProfile`), and — closed by THIS change — the goal-review
  //   touch, the password set and the preference-bag PATCH. The remaining two cannot be reached from
  //   a client write and cannot go stale here: `friendCode` is generated inside `upsertUser` at
  //   sign-in and returned by that same call, and `isActive` is an admin action on another account.
  //
  // The other three readers of this key deliberately keep revalidating — `edit-profile-sheet` is
  // where `hasPassword` is acted on, and the two one-shot reads save nothing worth the risk.
  useRefreshOnTabShow(refresh);

  const handlePullSync = useCallback(async () => {
    const userId = user?.id;
    if (userId) await pushMutations(userId).catch(() => {});

    // The Oura Cloud sync that used to run alongside this pull is gone (owner, 2026-08-13) — the
    // ring has been on our own BLE key since the re-key, and it is drained by PullToSync already.
    const deltaResult = await Promise.allSettled([
      userId ? pullDelta(userId, true) : Promise.resolve(null),
    ]).then(r => r[0]);

    // Invalidate only what the pull actually changed — the same helper sync-provider.tsx uses
    // — never invalidateCache(''), which wipes every screen's instant-paint seed.
    const delta = deltaResult.status === 'fulfilled' ? deltaResult.value : null;
    if (delta) await invalidatePulledDomains(delta.domains);
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
        // RV-112: Home and More both stay mounted in the shell, and the key is
        // `keySuffix ? pathname#suffix : pathname` — neither passed a suffix, so while the URL read
        // `/more` both containers wrote and restored `ta_scroll:/more`, with no owner check on the
        // restore. Health passed three suffixes and was never affected. The SUFFIX is what
        // separates them, not the path: `usePathname()` reads the route tree, which a tab flip
        // leaves stale (LA-109), so the pathname half cannot be relied on to differ.
        scrollKey="more"
        // RV-115: the two views share this scroller, so without a reset the incoming one opens at
        // the offset the outgoing one left behind.
        scrollResetKey={tab}
        scrollClassName="flex-1 overflow-y-auto pb-nav-safe"
        className="flex-1 flex flex-col overflow-hidden"
      >
        {/* RV-115 — a crossfade, not a `display` toggle, so this swap matches the one Friends' own
            child views already use (`TabPanels` was written for exactly this and had one call site).
            `mode="wait"` unmounts the outgoing panel: both re-seed synchronously from cache
            (`profile-tab`'s useLayoutEffect, `friends-tab`'s readCacheSync), so the data repaints
            instantly — but their local UI state does not survive, which is the accepted cost. */}
        <TabPanels value={tab}>
          {tab === "profile" ? (
            <>
              <SyncHealthCard userId={user?.id} />
              <ProfileTab user={user} profileFailed={profileFailed} equippedTitle={equippedTitle} friendCode={friendCode} seasons={seasons} onUserSaved={(updated) => { _user = updated; setUser(updated); }} onTitleChange={handleTitleChange} />
            </>
          ) : (
            <FriendsTab />
          )}
        </TabPanels>
      </PullToSync>
    </div>
  );
}
