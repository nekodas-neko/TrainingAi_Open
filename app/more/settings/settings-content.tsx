"use client";

import { MoreSubScreen } from "@/components/more/sub-screen";
import { SettingsPanel, DeveloperSettingsGroup } from "@/components/more/settings-panel";

export function SettingsContent({ isAdmin }: { isAdmin?: boolean }) {
  return (
    <MoreSubScreen title="Settings">
      <SettingsPanel />
      {isAdmin && <DeveloperSettingsGroup />}
    </MoreSubScreen>
  );
}
