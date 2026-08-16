"use client";

import { useEffect, useState } from "react";

// True when the device believes it has connectivity. Defaults to true (SSR-safe,
// avoids an offline-pill flash for online users) and corrects on mount. Uses the
// DOM online/offline events plus Capacitor Network, which is more reliable than
// navigator.onLine inside the Android WebView.
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);

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

  return online;
}
