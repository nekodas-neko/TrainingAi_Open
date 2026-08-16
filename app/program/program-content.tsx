"use client";

import dynamic from "next/dynamic";
import { MoreSubScreen } from "@/components/more/sub-screen";

const ConfigScreen = dynamic(() => import("@/components/config-screen"), {
  ssr: false,
  loading: () => (
    <div className="space-y-3" aria-busy="true">
      <div className="h-24 rounded-2xl bg-muted/40 animate-pulse" />
      <div className="h-24 rounded-2xl bg-muted/40 animate-pulse" />
      <div className="h-24 rounded-2xl bg-muted/40 animate-pulse" />
    </div>
  ),
});

export function ProgramContent({ userId, openNewProgram }: { userId?: string; openNewProgram?: boolean }) {
  return (
    <MoreSubScreen title="Program">
      <ConfigScreen userId={userId} openNewProgram={openNewProgram} />
    </MoreSubScreen>
  );
}
