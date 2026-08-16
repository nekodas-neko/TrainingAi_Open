"use client";

import { MoreSubScreen } from "@/components/more/sub-screen";
import { DataSyncPanel } from "@/components/more/data-sync-panel";

export function DataContent({ userId }: { userId?: string }) {
  return (
    <MoreSubScreen title="Data & Sync">
      <DataSyncPanel userId={userId} />
    </MoreSubScreen>
  );
}
