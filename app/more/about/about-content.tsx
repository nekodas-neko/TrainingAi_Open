"use client";

import { MoreSubScreen } from "@/components/more/sub-screen";
import { AboutPanel } from "@/components/more/about-panel";

export function AboutContent() {
  return (
    <MoreSubScreen title="About">
      <AboutPanel />
    </MoreSubScreen>
  );
}
