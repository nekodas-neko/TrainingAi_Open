"use client";

import { useCallback, useEffect, useState } from "react";
import { SparklesIcon } from "lucide-react";
import { startOfWeekInTz, shiftDateStr } from "@trainingai/shared/date-utils";
import { DismissibleBanner } from "@/components/ui/dismissible-banner";
import { useTransitionRouter } from "@/lib/view-transition";
import { useCachedValue } from "@/lib/hooks/use-cached-value";
import { WEEKLY_DIGEST_TTL } from "@trainingai/shared/cache-ttl";

const DISMISSED_KEY_PREFIX = "ta_weekly_recap_dismissed_";

interface DigestResponse {
  digest: string;
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
// than a guess, and it distinguishes a quiet week from a broken one. Since RV-201 it also warms
// the shared `weekly-digest:<weekStart>` cache entry that `/health/week` reads, so tapping through
// paints from cache instead of waiting on the network — the reason the two must spell that key the
// same way.
//
// `forceOpen` is gone with the expansion: the weekly reminder now deep-links to `/health/week`
// itself, so there is no longer a banner state for it to override.
export function WeeklyRecapBanner() {
  const weekStart = shiftDateStr(startOfWeekInTz(), -7);
  const dismissKey = DISMISSED_KEY_PREFIX + weekStart;

  // `true` until the effect has read localStorage, so a dismissed banner never flashes. The fetch
  // lives in the child for the same reason it cannot live here: a hook cannot be skipped, so a
  // `useCachedValue` in this component would fetch the recap for a week the user has already
  // dismissed, on every Home mount. Not mounting the child is the only way to not ask.
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => { setDismissed(!!localStorage.getItem(dismissKey)); }, [dismissKey]);

  if (dismissed) return null;
  return (
    <WeeklyRecapBannerContent
      weekStart={weekStart}
      onDismiss={() => { localStorage.setItem(dismissKey, "1"); setDismissed(true); }}
    />
  );
}

function WeeklyRecapBannerContent(
  { weekStart, onDismiss: handleDismiss }: { weekStart: string; onDismiss: () => void },
) {
  const router = useTransitionRouter();
  const [error, setError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // RV-201 — the shared cache, replacing a hand-rolled `ta_weekly_recap_v1_<week>` localStorage
  // entry this component wrote and read itself. That entry was a second cache under the app's own:
  // nothing invalidated it, so a recap fetched before a late-logged Sunday session stood until the
  // week rolled over. The shared key is cleared by the three write groups that can change what it
  // says, and `/health/week` reads the very same entry.
  const cacheKey = `weekly-digest:${weekStart}`;
  const data = useCachedValue<DigestResponse>(
    cacheKey, "/api/weekly-digest", WEEKLY_DIGEST_TTL,
    { onError: () => setError(true), reloadToken },
  );
  const content = data?.digest ?? null;
  const isLoading = data === null && !error;

  // The retry re-runs the hook's own fetch rather than adding a second one beside it, so there is
  // no path here that could drift from the one the first paint took.
  const load = useCallback(() => {
    setError(false);
    setReloadToken(t => t + 1);
  }, []);

  if (!isLoading && !content && !error) return null;

  // A failed recap used to return null, so the request simply never produced anything and the user
  // had no way to tell a quiet week from a broken one (Q-499's class; the plan calls for the same
  // fix the daily digest got in Q-112a). It says so instead, and the tap retries rather than making
  // the user relaunch the app — a failed entry is not cached, so without a retry the banner would
  // sit on its error until something else invalidated the key.
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
