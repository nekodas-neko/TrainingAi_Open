"use client";

import { useEffect, useState } from "react";
import { HeartPulse, TriangleAlert } from "lucide-react";
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
import { HR_PROFILE_TTL } from "@trainingai/shared/cache-ttl";
import type { HrProfileResponse } from "@/app/api/hr-profile/route";

const KEY = "hr-profile";
const URL = "/api/hr-profile";

// Observed HR profile — the real max/avg/min HR recorded over the last 90 days (with
// stray-spike rejection), shown next to the age-estimated max, plus which one anchors
// your effort %. See lib/health/observed-hr.ts.
export function ObservedHrCard() {
  const [data, setData] = useState<HrProfileResponse | null>(null);
  const [error, setError] = useState(false);

  // Seed in the effect, never in a useState initializer — the server has no cache to read, so an
  // initializer makes the first client render disagree with the server's.
  useEffect(() => {
    setData(readCacheSync<HrProfileResponse>(KEY) ?? null);
    cachedFetch<HrProfileResponse>(KEY, URL, HR_PROFILE_TTL, (d) => setData(d), {
      onError: () => setError(true),
    });
  }, []);

  if (error && !data) {
    return (
      <div className="rounded-xl border border-border bg-muted/20 p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <TriangleAlert className="h-4 w-4" aria-hidden />
          Couldn&rsquo;t load your heart-rate profile — pull to refresh.
        </div>
      </div>
    );
  }
  if (!data) return null;

  const obs = data.observed;
  const maxLabel = obs.max != null ? `${obs.max}` : "—";
  const usingObserved = data.workingMaxSource === "observed";

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <div className="mb-3 flex items-center gap-2">
        <HeartPulse className="h-4 w-4 text-foreground" aria-hidden />
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Heart-rate profile
        </h3>
        <span className="ml-auto text-[10px] text-muted-foreground">last 90 days</span>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <Stat label="Max recorded" value={maxLabel} unit="bpm" emphasize />
        <Stat label="Average" value={obs.avg != null ? `${obs.avg}` : "—"} unit="bpm" />
        <Stat label="Min" value={obs.min != null ? `${obs.min}` : "—"} unit="bpm" />
      </div>

      <div className="mt-3 space-y-1 border-t border-border pt-3 text-[11px] leading-snug text-muted-foreground">
        <p>
          Working max: <span className="font-semibold text-foreground tabular-nums">{data.workingMax} bpm</span>{" "}
          ({usingObserved ? "your recorded max" : "age-estimated"}). Age estimate{" "}
          <span className="tabular-nums">{data.estimatedMax}</span> · resting{" "}
          <span className="tabular-nums">{data.restingHr}</span>.
        </p>
        {!obs.isReliable && (
          <p className="text-amber-600 dark:text-amber-400">
            Not enough monitored heart-rate data yet for a confident max — wear the ring/strap on a few
            harder sessions. Using the age estimate for now.
          </p>
        )}
        {obs.isReliable && obs.highestPlausible != null && obs.max != null && (
          <p>
            Your max is a level you&rsquo;ve reached repeatedly, not a one-off blip
            {obs.highestPlausible > obs.max && (
              <> — the single highest reading was{" "}
                <span className="tabular-nums">{obs.highestPlausible}</span> bpm</>
            )}
            .
          </p>
        )}
        {obs.outOfBandRejected > 0 && (
          <p className="text-amber-600 dark:text-amber-400">
            {obs.outOfBandRejected} reading{obs.outOfBandRejected === 1 ? " was" : "s were"} discarded as
            impossible (outside 30&ndash;220&nbsp;bpm) — worth a look if that count keeps climbing.
          </p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, unit, emphasize }: { label: string; value: string; unit: string; emphasize?: boolean }) {
  return (
    <div className="rounded-lg bg-background/40 p-2">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`tabular-nums ${emphasize ? "text-2xl font-bold text-foreground" : "text-xl font-semibold"}`}>
        {value}
      </p>
      <p className="text-[9px] text-muted-foreground">{unit}</p>
    </div>
  );
}
