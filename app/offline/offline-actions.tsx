"use client";

import { Button } from "@/components/ui/button";

export function OfflineActions() {
  return (
    <div className="flex flex-col items-center gap-3">
      <Button
        className="bg-brand text-brand-foreground hover:opacity-90"
        onClick={() => window.location.reload()}
      >
        Try again
      </Button>
      {/* Plain <a>, not next/link — a full navigation the SW serves from cache. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className="text-sm text-muted-foreground underline underline-offset-4">
        Go to Home
      </a>
    </div>
  );
}
