"use client";

import { useEffect, useState } from "react";
import { requestsCompleting, subscribeToReachability } from "@/lib/sqlite/cache";

// True when requests are actually completing. Defaults to true (SSR-safe, avoids an offline-pill
// flash for online users) and corrects on mount. Uses the DOM online/offline events plus Capacitor
// Network, which is more reliable than navigator.onLine inside the Android WebView.
//
// BF-195: **the radio being attached is not the same question.** Both sources above report true in
// low reception, where the connection carries nothing — the owner's report was a gym, which is the
// canonical case. So the radio state is ANDed with whether the fetch layer's requests are settling
// (`lib/sqlite/cache.ts`), and this hook now answers "can the app reach the server", which is what
// every caller already assumed it meant.
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);
  const [reachable, setReachable] = useState(true);

  useEffect(() => {
    // Read once on mount as well as subscribing: a timeout can have happened before this mounted,
    // and the flag is module-level, so the subscription alone would miss it.
    setReachable(requestsCompleting());
    return subscribeToReachability(setReachable);
  }, []);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);

    let removeNative = () => {};
    import("@capacitor/network")
      .then(({ Network }) =>
        Network.addListener("networkStatusChange", (s) => setOnline(s.connected)).then((h) => {
          removeNative = () => h.remove();
        }),
      )
      .catch(() => {}); // web / plugin unavailable — DOM events are enough

    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      removeNative();
    };
  }, []);

  return online && reachable;
}
