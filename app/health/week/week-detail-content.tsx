"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronLeft, Sparkles, TrendingUp, Trophy } from "lucide-react";
import { ScreenHeader } from "@/components/shell/screen-header";
import { useTransitionRouter } from "@/lib/view-transition";
import { formatInTimeZone } from "date-fns-tz";
import type { WeeklyDigestMetrics } from "@trainingai/shared/health/weekly-digest-metrics";
import { WeekVolumeChart } from "@/components/health/week/week-volume-chart";
import { WeekMetricCard } from "@/components/health/week/week-metric-card";
import { WeeklyMuscleSetsCard } from "@/components/health/weekly-muscle-sets-card";
import { WeekTrendsSection } from "@/components/week-trends-section";

const Response = dynamic(() => import("@/components/ai/response").then(m => m.Response), { ssr: false });

interface DigestResponse {
  digest: string;
  weekStart: string;
  metrics?: WeeklyDigestMetrics;
}

/** `YYYY-MM-DD` read as a calendar date, not an instant — these are already user-local day keys, so
 *  they are formatted with a fixed UTC zone rather than re-projected through the user's. */
function dayLabel(dateStr: string, withYear = false): string {
  return formatInTimeZone(`${dateStr}T00:00:00Z`, "UTC", withYear ? "d MMM yyyy" : "d MMM");
}

export function WeekDetailContent({ initialWeek }: { initialWeek: string }) {
  const router = useTransitionRouter();
  const [data, setData] = useState<DigestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const hasFetched = useRef(false);

  // A POST that runs an LLM server-side, so `cachedFetch` does not apply — it is for `/api/*` GETs.
  // The route caches the prose per ISO week and returns the metrics on the cached path too, which is
  // what makes opening this page cheap after the banner has already fetched once.
  const load = useCallback(() => {
    setError(false);
    setLoading(true);
    fetch("/api/weekly-digest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The route takes no week: it computes the recap week itself. An empty body is the whole
      // contract, and the banner sends the same one.
      body: "{}",
    })
      .then(res => { if (!res.ok) throw new Error("failed"); return res.json(); })
      .then((d: DigestResponse) => setData(d))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    load();
  }, [load]);

  const m = data?.metrics;
  const weekStart = m?.weekStart ?? initialWeek;
  const weekEnd = m?.weekEnd;
  const range = weekEnd ? `${dayLabel(weekStart)} – ${dayLabel(weekEnd, true)}` : dayLabel(weekStart, true);

  return (
    <div className="flex h-full flex-col bg-page">
      <ScreenHeader bordered={false}>
        <div className="flex w-full items-center gap-1">
          {/* Outside the tab shell, like `/health/day` — without an explicit back control the
              notification tap is a one-way trip. */}
          <button
            type="button"
            aria-label="Back"
            onClick={() => router.back()}
            className="flex h-12 w-12 flex-none items-center justify-center rounded-xl text-muted-foreground transition active:scale-95"
          >
            <ChevronLeft className="h-[22px] w-[22px]" />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-center text-[17px] font-extrabold tracking-tight">Week in review</h1>
          <span className="h-12 w-12 flex-none" aria-hidden />
        </div>
      </ScreenHeader>

      <div className="flex-1 overflow-y-auto px-4 pb-safe-action-lg">
        <p className="text-center text-xs text-muted-foreground">{range}</p>

        {loading && !data && (
          <div className="mt-4 space-y-3" aria-busy="true">
            <div className="h-24 animate-pulse rounded-2xl bg-muted" />
            <div className="h-32 animate-pulse rounded-2xl bg-muted" />
            <div className="h-32 animate-pulse rounded-2xl bg-muted" />
          </div>
        )}

        {/* An error says so and the tap retries. `fetch` here is bare rather than `cachedFetch`, so
            nothing is swallowed — but the failure still has to be visible rather than an empty
            screen, which is the shape Q-499 was filed on. */}
        {error && !data && (
          <button
            type="button"
            onClick={load}
            className="mt-6 w-full rounded-2xl border border-border bg-card px-4 py-6 text-center"
          >
            <p className="text-sm font-medium">Your week in review didn’t load</p>
            <p className="mt-1 text-xs text-muted-foreground">Tap to try again</p>
          </button>
        )}

        {data && (
          <div className="mt-3 space-y-4">
            {data.digest && (
              <section className="rounded-2xl border border-border bg-card p-4">
                <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-brand">
                  <Sparkles className="h-3 w-3" aria-hidden /> Your week
                </p>
                {/* `parseIncompleteMarkdown` is a STREAMING repair — it appends a closing `*` when it
                    counts an odd number of single asterisks. This string is finished, so an
                    unterminated `*` is text the model wrote, and completing it is what put the stray
                    trailing asterisk in front of the owner (BF-5). */}
                <Response className="text-sm leading-relaxed" parseIncompleteMarkdown={false}>
                  {data.digest}
                </Response>
              </section>
            )}

            {m && (
              <>
                <section className="rounded-2xl border border-border bg-card p-4">
                  <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                    <TrendingUp className="h-4 w-4 text-brand" aria-hidden /> Training
                  </h2>
                  <div className="mt-2 flex items-baseline gap-3">
                    <span className="text-2xl font-bold tabular-nums">{Math.round(m.training.volumeKg).toLocaleString()}</span>
                    <span className="text-xs text-muted-foreground">kg over {m.training.sessions} session{m.training.sessions === 1 ? "" : "s"}</span>
                  </div>
                  {/* `volumeChangePct` is null rather than 0 for a first week, and the two are
                      different claims — 0 draws as "no change", which would be false. */}
                  <p className="text-xs text-muted-foreground">
                    {m.training.volumeChangePct == null
                      ? "First week of data — nothing to compare it against yet"
                      : `${m.training.volumeChangePct >= 0 ? "+" : ""}${Math.round(m.training.volumeChangePct)}% on ${Math.round(m.training.priorVolumeKg).toLocaleString()} kg (${m.training.priorSessions} session${m.training.priorSessions === 1 ? "" : "s"})`}
                  </p>
                  <div className="mt-3">
                    <WeekVolumeChart byDay={m.training.byDay} />
                  </div>
                </section>

                <section>
                  <h2 className="mb-2 text-sm font-semibold">Recovery</h2>
                  <div className="grid grid-cols-2 gap-2">
                    <WeekMetricCard label="Readiness" metric={m.readiness} />
                    <WeekMetricCard label="Sleep score" metric={m.sleepScore} />
                    <WeekMetricCard label="Sleep" metric={m.sleepHours} unit="h" decimals={1} />
                    <WeekMetricCard
                      label="HRV"
                      metric={m.hrv}
                      unit="ms"
                      // The overnight/body-metrics choice is made for the WHOLE window, so naming it
                      // once here is honest; a per-day fallback would draw two instruments on one
                      // line with nothing marking the change.
                      note={m.hrv.source === "body-metrics" ? "From daytime readings" : null}
                    />
                    <WeekMetricCard label="High stress" metric={m.stressHighMinutes} unit="m" higherIsBetter={false} />
                  </div>
                </section>

                {m.prs.length > 0 && (
                  <section className="rounded-2xl border border-border bg-card p-4">
                    <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                      <Trophy className="h-4 w-4 text-brand" aria-hidden /> Personal records
                    </h2>
                    <ul className="mt-2 space-y-1.5">
                      {m.prs.map(pr => (
                        <li key={pr.exerciseName} className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 flex-1 truncate text-sm">{pr.exerciseName}</span>
                          {/* `description` is `describePersonalRecord`'s, kept rather than rebuilt
                              from `estimated1rm`: a bodyweight PR is BW_REF-relative and must never
                              be announced as a weight (Q-19). */}
                          <span className="flex-none text-xs font-semibold tabular-nums text-muted-foreground">{pr.description}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {m.muscleSets.length > 0 && (
                  <WeeklyMuscleSetsCard muscles={m.muscleSets} loading={false} title="Muscle volume this week" />
                )}

                {/* The month around the week, which this page's own metrics cannot show: five weekly
                    points against the four completed weeks before them. Already built for the
                    banner (Q-112e) and reused rather than reproduced. */}
                <WeekTrendsSection weekStart={weekStart} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
