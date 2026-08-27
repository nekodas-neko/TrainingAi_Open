"use client";

import { useEffect, useRef, useState } from "react";
import { SparklesIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { startOfWeekInTz, shiftDateStr } from "@trainingai/shared/date-utils";
import { DismissibleBanner } from "@/components/ui/dismissible-banner";

const Response = dynamic(() => import("@/components/ai/response").then(m => m.Response), { ssr: false });

const DISMISSED_KEY_PREFIX = "ta_weekly_recap_dismissed_";
const CONTENT_CACHE_PREFIX = "ta_weekly_recap_v1_";

interface CachedRecap {
  content: string;
  weekStart: string;
}

// A one-time notification for the week that just ended — not an always-there card.
// Fetches at most once per completed week (cached in localStorage) and stays gone
// once dismissed, mirroring the early-deload/APK-download banners on this screen.
interface Props {
  /**
   * Opened from the weekly reminder's deep link (`/?review=week`, Q-112a).
   *
   * It overrides `dismissed` deliberately: tapping the notification is a clearer request to see the
   * recap than an earlier dismissal was a request never to. It cannot override `error` or an empty
   * recap — there would be nothing to show.
   */
  forceOpen?: boolean
}

export function WeeklyRecapBanner({ forceOpen = false }: Props) {
  const weekStart = shiftDateStr(startOfWeekInTz(), -7);
  const dismissKey = DISMISSED_KEY_PREFIX + weekStart;
  const cacheKey = CONTENT_CACHE_PREFIX + weekStart;

  const [dismissed, setDismissed] = useState(true);
  const [content, setContent] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(forceOpen);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);
  const hasFetched = useRef(false);

  useEffect(() => {
    const alreadyDismissed = !forceOpen && !!localStorage.getItem(dismissKey);
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

    setIsLoading(true);
    fetch("/api/weekly-digest", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(res => { if (!res.ok) throw new Error("failed"); return res.json(); })
      .then((data: { digest: string; weekStart: string }) => {
        setContent(data.digest);
        localStorage.setItem(cacheKey, JSON.stringify({ content: data.digest, weekStart: data.weekStart }));
      })
      .catch(() => setError(true))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, forceOpen]);

  function handleDismiss() {
    localStorage.setItem(dismissKey, "1");
    setDismissed(true);
  }

  if (dismissed || error || (!isLoading && !content)) return null;

  return (
    <DismissibleBanner
      icon={<SparklesIcon className="h-4 w-4 text-brand" />}
      title={isLoading ? "Preparing your week in review…" : "Your week in review is ready"}
      expandable={!!content}
      expanded={expanded}
      onActivate={() => setExpanded(e => !e)}
      onDismiss={handleDismiss}
    >
      {content && <Response className="text-sm leading-relaxed">{content}</Response>}
    </DismissibleBanner>
  );
}
