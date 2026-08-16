"use client";

import { memo, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { InfoIcon } from "lucide-react";
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
import { TTL_MEDIUM } from '@trainingai/shared/cache-ttl';
import { accentCardStyle } from "@trainingai/shared/utils";
import type { TrendsResponse } from "@/app/api/health-trends/route";

const TrendChart = dynamic(
  () => import("./trend-chart").then(m => ({ default: m.TrendChart })),
  // A-10: the parent seeds its data synchronously from readCacheSync, so an animated
  // skeleton flashed over already-in-hand data while chart.js downloaded — defeating the
  // instant-paint rule. A fixed-height static placeholder reserves the space without the
  // "loading" tell (matches trend-sparkline-lazy.tsx).
  { ssr: false, loading: () => <div className="h-32 w-full" /> },
);

const VIEWS: { key: string; label: string }[] = [
  { key: "subjective-recovery", label: "Recovery calibration" },
  { key: "session-rpe",         label: "Session effort" },
  { key: "rest-adherence",      label: "Rest discipline" },
  { key: "recovery-vs-strength", label: "Recovery vs strength" },
  { key: "hrv-volume",          label: "HRV vs volume" },
  { key: "bedtime-sleep",       label: "Bedtime vs sleep" },
  { key: "meal-timing",         label: "Meals vs sleep" },
  { key: "energy-balance",      label: "Fuelling vs strength" },
  { key: "soreness-volume",     label: "Volume vs soreness" },
];

// Views whose bucket value is a DELTA from a baseline, where a sign carries meaning. Everything
// else is an absolute reading — hours slept, efficiency %, a 1–5 rating — and prefixing those with
// "+" reads as a change that did not happen. The bars used to sign every view unconditionally.
const SIGNED_VIEWS = new Set(["rest-adherence", "recovery-vs-strength", "energy-balance"]);

function cacheKey(view: string) {
  return `health-trends:${view}`;
}

function CorrelationBars({ buckets, signed }: { buckets: TrendsResponse["buckets"]; signed: boolean }) {
  if (buckets.length === 0) return null;
  return (
    <div className="flex gap-2 mb-3">
      {buckets.map(b => (
        <div key={b.label} className="flex-1 rounded-xl bg-muted/60 p-2 text-center">
          <p className="text-[10px] text-muted-foreground">{b.label}</p>
          <p
            className="text-sm font-bold"
            style={{ color: signed && b.avg < 0 ? "#ef4444" : "var(--color-brand)" }}
          >
            {signed && b.avg >= 0 ? `+${b.avg}` : b.avg}
          </p>
          <p className="text-[9px] text-muted-foreground">{b.count}</p>
        </div>
      ))}
    </div>
  );
}

export const TrendsSection = memo(function TrendsSection() {
  const [view, setView] = useState(VIEWS[0].key);
  const [data, setData] = useState<TrendsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const seeded = readCacheSync<TrendsResponse>(cacheKey(view));
    setData(seeded);
    setLoading(!seeded);
    const url = view === "recovery-vs-strength"
      ? `/api/health-trends?view=${view}&metric=hrv`
      : `/api/health-trends?view=${view}`;
    // cachedFetch's onData callback never fires on a failed fetch (it swallows !res.ok
    // internally and just returns) — without this .finally, `loading` would stay true
    // forever on a genuine failure and the render would be stuck on the skeleton instead
    // of ever reaching the "couldn't load" empty state below.
    cachedFetch<TrendsResponse>(cacheKey(view), url, TTL_MEDIUM, d => {
      setData(d);
    }).finally(() => setLoading(false));
  }, [view]);

  return (
    <div className="rounded-2xl p-4" style={accentCardStyle("#8b5cf6")}>
      <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Trends</h3>

      <div className="flex gap-2 overflow-x-auto touch-pan-x pb-1 -mx-1 px-1 mb-3" style={{ scrollbarWidth: "none" }}>
        {VIEWS.map(v => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`flex-none rounded-full px-3 py-1 text-xs font-semibold border transition ${
              view === v.key
                ? "bg-brand text-brand-foreground border-brand"
                : "bg-muted text-muted-foreground border-border"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Fixed-height content area so switching views (chart / bars / empty / loading —
          each a different natural height) never makes the card jump as you scroll the
          pill picker. The insight is clamped to a stable line count for the same reason. */}
      <div className="min-h-[210px]">
        {loading && !data ? (
          <div className="h-[190px] animate-pulse rounded-xl bg-muted" />
        ) : !data ? (
          // cachedFetch swallows fetch failures internally (never rejects) — a failed request
          // just leaves `data` null forever, so this can't distinguish "failed" from a genuine
          // empty payload. Show an explicit line either way instead of leaving blank space
          // under the view picker (self-fetching-card failure-state rule).
          <p className="text-xs text-muted-foreground">Couldn&apos;t load this trend.</p>
        ) : !data.hasSufficientData && !(data.series && data.series.length > 0) ? (
          <div className="mb-1">
            <p className="text-base font-semibold text-foreground">Not enough data yet</p>
            <p className="text-xs text-muted-foreground mt-0.5">Keep logging to unlock this trend</p>
          </div>
        ) : (
          <>
            <p className="text-sm font-medium mb-3 leading-snug line-clamp-3">{data.insight}</p>
            {data.series ? (
              <TrendChart series={data.series} />
            ) : (
              <CorrelationBars buckets={data.buckets} signed={SIGNED_VIEWS.has(view)} />
            )}
          </>
        )}
      </div>

      <div className="flex gap-2 rounded-xl bg-muted/50 p-3 mt-3">
        <InfoIcon className="h-3.5 w-3.5 text-muted-foreground flex-none mt-0.5" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Correlations need enough paired data points to be meaningful — keep logging workouts, sleep, meals and morning check-ins to unlock each view.
        </p>
      </div>
    </div>
  );
})
