import { BottomNav } from "@/components/shell/bottom-nav";

// Instant fallback for the tab routes' loading.tsx boundaries. Neutral pulse
// blocks only — per-screen cache-seeded content paints as soon as the client
// component mounts, so this is visible for one network round-trip at most
// (and, with staleTimes retention, usually never).
export function TabLoading() {
  return (
    <>
      <div className="flex flex-col bg-page min-h-screen pt-safe-or-4 px-4 gap-4" aria-busy="true">
        <div className="h-8 w-40 rounded-lg bg-muted/60 animate-pulse" />
        <div className="h-28 rounded-2xl bg-muted/40 animate-pulse" />
        <div className="h-40 rounded-2xl bg-muted/40 animate-pulse" />
        <div className="h-28 rounded-2xl bg-muted/40 animate-pulse" />
      </div>
      <BottomNav />
    </>
  );
}
