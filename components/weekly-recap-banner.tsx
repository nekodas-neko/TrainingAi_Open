"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SparklesIcon } from "lucide-react";
import { startOfWeekInTz, shiftDateStr } from "@trainingai/shared/date-utils";
import { DismissibleBanner } from "@/components/ui/dismissible-banner";
import { useTransitionRouter } from "@/lib/view-transition";

const DISMISSED_KEY_PREFIX = "ta_weekly_recap_dismissed_";
const CONTENT_CACHE_PREFIX = "ta_weekly_recap_v1_";

interface CachedRecap {
  content: string;
  weekStart: string;
}

// A one-time notification for the week that just ended — not an always-there card.
// Fetches at most once per completed week (cached in localStorage) and stays gone
// once dismissed, mirroring the early-deload/APK-download banners on this screen.
//
// **The banner is the ENTRY POINT, not the content (BF-5).** It used to expand into the prose and
// the month-at-a-glance; the owner asked for the opposite — *"rather than chevron type display; id
// rathee its own page that you can get to from a banner notifcation"* — so a tap now opens
// `/health/week`, which holds the paragraph, the charts and the trends together.
//
// **The fetch stays, and it is not wasted.** It is what makes "is ready" a true statement rather
// than a guess, it distinguishes a quiet week from a broken one, and it warms the route's per-week
// server cache so the page opens on the cached path. `tabs-instant-paint.spec.ts` records that this
// POST fires on every Home mount.
//
// `forceOpen` is gone with the expansion: the weekly reminder now deep-links to `/health/week`
// itself, so there is no longer a banner state for it to override.
export function WeeklyRecapBanner() {
  const router = useTransitionRouter();
  const weekStart = shiftDateStr(startOfWeekInTz(), -7);
  const dismissKey = DISMISSED_KEY_PREFIX + weekStart;
  const cacheKey = CONTENT_CACHE_PREFIX + weekStart;

  const [dismissed, setDismissed] = useState(true);
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);
  const hasFetched = useRef(false);

  // Held in a ref so the effect below does not depend on it — `cacheKey` is derived from
  // `weekStart`, which the effect already tracks.
  const cacheKeyRef = useRef(cacheKey);
  cacheKeyRef.current = cacheKey;

  const load = useCallback(() => {
    setError(false);
    setIsLoading(true);
    fetch("/api/weekly-digest", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(res => { if (!res.ok) throw new Error("failed"); return res.json(); })
      .then((data: { digest: string; weekStart: string; degraded?: boolean }) => {
        setContent(data.digest);
        // RV-69: `degraded` is a deterministic readout of the week, returned because the model
        // failed. It is worth showing and not worth keeping — this cache is keyed on the week, and
        // the effect below returns early on a hit, so storing it would stand in for the real recap
        // until the week rolls over.
        if (!data.degraded) {
          localStorage.setItem(cacheKeyRef.current, JSON.stringify({ content: data.digest, weekStart: data.weekStart }));
        }
      })
      .catch(() => setError(true))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    const alreadyDismissed = !!localStorage.getItem(dismissKey);
    setDismissed(alreadyDismissed);
    if (alreadyDismissed || hasFetched.current) return;
    hasFetched.current = true;

    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const cached: CachedRecap = JSON.parse(raw);
        if (cached.weekStart === weekStart) {
          setContent(cached.content);
          return;
        }
      }
    } catch { /* fall through to fetch */ }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  function handleDismiss() {
    localStorage.setItem(dismissKey, "1");
    setDismissed(true);
  }

  if (dismissed || (!isLoading && !content && !error)) return null;

  // A failed recap used to return null, so the request simply never produced anything and the user
  // had no way to tell a quiet week from a broken one (Q-499's class; the plan calls for the same
  // fix the daily digest got in Q-112a). It says so instead, and the tap retries rather than making
  // the user relaunch the app — the fetch runs once per week behind a `hasFetched` guard, so
  // without a retry a single failure costs the whole week's recap.
  if (error) {
    return (
      <DismissibleBanner
        icon={<SparklesIcon className="h-4 w-4 text-muted-foreground" />}
        title="Your week in review didn’t load"
        subtitle="Tap to try again"
        onActivate={load}
        onDismiss={handleDismiss}
      />
    );
  }

  return (
    <DismissibleBanner
      icon={<SparklesIcon className="h-4 w-4 text-brand" />}
      title={isLoading ? "Preparing your week in review…" : "Your week in review is ready"}
      subtitle={content ? "Tap to open" : undefined}
      // `router.push`, not the component's `href`: that renders a bare anchor, and a document
      // navigation inside the WebView reloads the app and discards every mounted tab.
      onActivate={content ? () => router.push("/health/week") : undefined}
      onDismiss={handleDismiss}
    />
  );
}
