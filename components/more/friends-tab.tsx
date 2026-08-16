"use client";

import { useEffect, useState } from "react";
import { FriendFeed } from "./friend-feed";
import { FriendLeaderboard } from "./friend-leaderboard";
import { ManageFriendsSheet } from "./manage-friends-sheet";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";
import type { Friendship } from "@trainingai/shared/types/friends";
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
import { TTL_MEDIUM } from '@trainingai/shared/cache-ttl';
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { TabPanels } from "@/components/ui/tab-panels";
import { useRefreshOnTabShow } from "@/components/shell/tab-visibility";

type View = "feed" | "leaderboard";

export default function FriendsTab() {
  const [view, setView] = useState<View>("feed");
  const [manageOpen, setManageOpen] = useState(false);
  const [friendships, setFriendships] = useState<Friendship[]>([]);

  const fetchFriendships = () => {
    cachedFetch<{ friendships: Friendship[] }>(
      'friends-list', '/api/friends', TTL_MEDIUM,
      d => { if (d?.friendships) setFriendships(d.friendships); },
    ).catch(() => {});
  };

  useEffect(() => {
    // Seed synchronously from cache so a repeat visit paints instantly instead of
    // flashing empty until fetchFriendships' network round-trip lands.
    const cached = readCacheSync<{ friendships: Friendship[] }>('friends-list');
    if (cached?.friendships) setFriendships(cached.friendships);
    fetchFriendships();
  }, []);

  useRefreshOnTabShow(fetchFriendships);

  const pendingCount = friendships.filter(f => f.status === 'pending').length;

  return (
    <div className="px-4 pt-4 space-y-3">
      {/* Controls bar */}
      <div className="flex items-center gap-2">
        <SegmentedTabs
          className="flex-1"
          tabs={(["feed", "leaderboard"] as View[]).map(v => ({
            value: v,
            label: v === "feed" ? "Activity" : "Leaderboard",
          }))}
          value={view}
          onValueChange={setView}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setManageOpen(true)}
          className="relative flex-shrink-0"
        >
          <Users className="w-4 h-4 mr-1" />
          Manage
          {pendingCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-destructive text-white text-[9px] flex items-center justify-center font-bold">
              {pendingCount}
            </span>
          )}
        </Button>
      </div>

      <TabPanels value={view}>
        {view === "feed" ? <FriendFeed /> : <FriendLeaderboard />}
      </TabPanels>

      <ManageFriendsSheet
        open={manageOpen}
        onOpenChange={setManageOpen}
        friendships={friendships}
        onRefresh={fetchFriendships}
      />
    </div>
  );
}
