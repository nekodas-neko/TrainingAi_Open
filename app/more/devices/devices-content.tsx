"use client";

import { MoreSubScreen } from "@/components/more/sub-screen";
import { OuraConnectionSection } from "@/components/more/oura-section";
import { ChestStrapPairing } from "@/components/settings/chest-strap-pairing";
import { ScalePairing } from "@/components/settings/scale-pairing";
import { ColmiPairing } from "@/components/settings/colmi-pairing";

export function DevicesContent() {
  return (
    // No section headers: all four cards already render their own uppercase heading, and the screen
    // title is the grouping. #3844 removed the background-location card with the walk detector it
    // diagnosed.
    <MoreSubScreen title="Devices">
      <OuraConnectionSection />
      <ChestStrapPairing />
      <ScalePairing />
      <ColmiPairing />
    </MoreSubScreen>
  );
}
