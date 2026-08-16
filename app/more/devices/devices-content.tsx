"use client";

import { MoreSubScreen } from "@/components/more/sub-screen";
import { OuraConnectionSection } from "@/components/more/oura-section";
import { ChestStrapPairing } from "@/components/settings/chest-strap-pairing";
import { ScalePairing } from "@/components/settings/scale-pairing";
import { BackgroundLocationCard } from "@/components/activity/background-location-card";

export function DevicesContent() {
  return (
    // No section headers: all four cards already render their own uppercase heading, and
    // BackgroundLocationCard returns null off-device — a wrapper heading would have sat above
    // nothing in the web sandbox and wherever the permission check is unavailable. The screen
    // title is the grouping.
    <MoreSubScreen title="Devices">
      <OuraConnectionSection />
      <ChestStrapPairing />
      <ScalePairing />
      {/* A permission rather than a device, but it is what makes activity detection work — someone
          asking "why wasn't my walk detected" looks here. It brings its own heading. */}
      <BackgroundLocationCard />
    </MoreSubScreen>
  );
}
