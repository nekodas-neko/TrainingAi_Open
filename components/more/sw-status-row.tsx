"use client";

import { useEffect, useState } from "react";

// Surfaces whether the service worker is actually alive in this WebView (SW
// registration failure is otherwise silently swallowed) and how much is cached.
export function ServiceWorkerStatusRow() {
  const [state, setState] = useState<{ controller: boolean; generations: number; precache: number } | null>(null);

  useEffect(() => {
    (async () => {
      const controller = typeof navigator !== "undefined" && !!navigator.serviceWorker?.controller;
      let generations = 0;
      let precache = 0;
      try {
        const names = await caches.keys();
        const buildCaches = names.filter((n) => n.startsWith("ta-") && n !== "ta-meta");
        generations = buildCaches.length;
        // The current build's cache is the one whose /offline entry exists.
        for (const n of buildCaches) {
          const c = await caches.open(n);
          const count = (await c.keys()).length;
          if (count > precache) precache = count;
        }
      } catch { /* CacheStorage unavailable */ }
      setState({ controller, generations, precache });
    })();
  }, []);

  if (!state) return null;
  return (
    <div className="px-4 py-3">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Offline cache
      </p>
      <p className="text-xs text-muted-foreground">
        Service worker {state.controller ? "active" : "not active"} · {state.precache} files cached · {state.generations} generation(s)
      </p>
    </div>
  );
}
