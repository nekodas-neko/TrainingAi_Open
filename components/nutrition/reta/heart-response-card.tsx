"use client";

import { useMemo, useState } from "react";
import { useCachedValue } from "@/lib/hooks/use-cached-value";
import { TTL_MEDIUM } from "@trainingai/shared/cache-ttl";
import { CATEGORICAL_PALETTE } from "@trainingai/shared/chart-colors";
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import { recoveryResponse, type RecoveryDose, type RecoveryNight } from "./weight-response";
import { heartCardView, niceTicks, type HeartCardView, type HeartChart } from "./heart-response-view";

/**
 * "Heart after a dose" (issue 2152, mockup `docs/design/2026-10-08-reta-heart-response-card.html`).
 *
 * Resting HR and HRV by day after a dose, one card PER DOSE AMOUNT and never pooled. The numbers all
 * come from `recoveryResponse` (PR 2681); this only draws them.
 *
 * **The series colour is the categorical palette's first entry, never a verdict colour.** Sky is not
 * green, amber or red anywhere else in the app, so the line reads as "your data", not "good" or
 * "bad". "Clear pattern" is the same sky, for the same reason.
 *
 * **It describes a pattern and never a cause.** The footnote says so in words.
 */

const SERIES = CATEGORICAL_PALETTE[0];

interface Inputs {
  doses: RecoveryDose[];
  nights: RecoveryNight[];
}

const W = 340, H = 124, L = 30, R = 330, T = 8, B = 110;

function Chart({ chart, level }: { chart: HeartChart; level: string }) {
  const lows = [chart.normal.low, ...chart.points.map(p => p.p25)];
  const highs = [chart.normal.high, ...chart.points.map(p => p.p75)];
  const pad = Math.max((Math.max(...highs) - Math.min(...lows)) * 0.12, 1);
  const lo = Math.min(...lows) - pad, hi = Math.max(...highs) + pad;
  const maxDay = Math.max(chart.days.length - 1, 1);
  const x = (d: number) => L + ((R - L) * d) / maxDay;
  const y = (v: number) => B - ((B - T) * (v - lo)) / (hi - lo);
  const ticks = niceTicks(lo, hi);
  const peak = chart.points.reduce((a, p) =>
    Math.abs(p.median - chart.normal.median) > Math.abs(a.median - chart.normal.median) ? p : a);
  const labelEvery = chart.days.length > 8 ? 2 : 1;
  const band = [
    ...chart.points.map(p => `${x(p.offset)},${y(p.p75)}`),
    ...[...chart.points].reverse().map(p => `${x(p.offset)},${y(p.p25)}`),
  ].join(" ");

  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-xs font-semibold">
        {chart.title} <span className="font-normal text-muted-foreground">{chart.unit}</span>
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${chart.title} by day after a ${level} dose`} className="block h-auto w-full overflow-visible">
        {ticks.map(t => (
          <g key={t}>
            <line x1={L} x2={R} y1={y(t)} y2={y(t)} stroke="var(--border)" />
            <text x={L - 6} y={y(t) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">{Math.round(t)}</text>
          </g>
        ))}
        {/* The person's own normal before the first dose: median ± half the interquartile range. */}
        <rect
          data-testid="normal-strip"
          x={L} width={R - L}
          y={y(chart.normal.high)} height={Math.max(2, y(chart.normal.low) - y(chart.normal.high))}
          fill="var(--muted-foreground)" fillOpacity={0.15}
        />
        <text x={R} y={y(chart.normal.median) - 4} textAnchor="end" className="fill-muted-foreground text-[10px]">
          normal {Math.round(chart.normal.median)}
        </text>
        <polygon data-testid="middle-half" points={band} fill={SERIES} fillOpacity={0.18} />
        <polyline
          data-testid="median-line"
          points={chart.points.map(p => `${x(p.offset)},${y(p.median)}`).join(" ")}
          fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
        />
        {chart.points.map(p => (
          <circle key={p.offset} cx={x(p.offset)} cy={y(p.median)} r={p === peak ? 4.5 : 3} fill={SERIES} stroke="var(--background)" strokeWidth={2}>
            <title>{`${p.offset === 0 ? "Dose day" : `Day ${p.offset}`}: ${Math.round(p.median)} ${chart.unit} (middle half ${Math.round(p.p25)} to ${Math.round(p.p75)}), ${p.cycles} doses`}</title>
          </circle>
        ))}
        <text x={x(peak.offset)} y={y(peak.median) + (peak.median >= chart.normal.median ? -9 : 15)} textAnchor="middle" className="fill-foreground text-[10px] font-semibold">
          {Math.round(peak.median)}
        </text>
        {chart.days.map(d => (d % labelEvery === 0 ? (
          <text key={d} x={x(d)} y={B + 16} textAnchor="middle" className="fill-muted-foreground text-[10px]">
            {d === 0 ? "dose" : `d${d}`}
          </text>
        ) : null))}
      </svg>
    </div>
  );
}

export function HeartResponseSection({ view }: { view: HeartCardView }) {
  const clear = view.state === "clear";
  return (
    <section className="space-y-2" data-testid="heart-response-section">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">Heart after a dose</h3>
        <span className="text-[11px] text-muted-foreground">{view.subtitle}</span>
      </div>

      <div
        className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
          clear ? "" : "border-border bg-muted text-muted-foreground"
        }`}
        style={clear ? { borderColor: `color-mix(in srgb, ${SERIES} 35%, transparent)`, backgroundColor: `color-mix(in srgb, ${SERIES} 12%, transparent)`, color: SERIES } : undefined}
      >
        {view.chip}
      </div>

      {view.state === "not_enough" ? (
        <p className="text-[11px] text-muted-foreground">
          It needs 2 doses at the same amount, each with a few nights of readings, before it shows
          anything. Different amounts are never pooled.
        </p>
      ) : (
        <>
          {view.sentence && <p className="text-[13px] leading-snug">{view.sentence}</p>}
          {view.charts.map(c => <Chart key={c.metric} chart={c} level={view.levelLabel} />)}
          <p className="text-[11px] text-muted-foreground">
            Line: the middle of your doses. Band: where the middle half sat. Grey strip: your normal
            before your first dose. Training, sleep and stress aren&apos;t controlled, so this shows
            a pattern, not proof.
          </p>
        </>
      )}
    </section>
  );
}

/** Pure part, exported so the states can be tested without the cache or the network. */
export function HeartResponseBody({ doses, nights, tz }: Inputs & { tz: string }) {
  const views = useMemo(() => {
    const substance = recoveryResponse({ doses, nights, tz })[0];
    // Newest dose amount first: that is the one the owner is watching.
    return substance ? [...substance.levels].reverse().map(heartCardView) : [];
  }, [doses, nights, tz]);
  if (views.length === 0) return null;
  return (
    <>
      {views.map((v, i) => <HeartResponseSection key={`${v.levelLabel}-${i}`} view={v} />)}
    </>
  );
}

export function HeartResponseCard({ supplementId }: { supplementId: string }) {
  const tz = useUserTimezone();
  const [failed, setFailed] = useState(false);
  // Seeded from the cache synchronously, so a repeat visit paints at once; nothing is drawn (and no
  // skeleton) until there is data. The key is a prefix of `reta-heart:` for `cache-groups.ts`.
  const data = useCachedValue<Inputs>(
    `reta-heart:${supplementId}`,
    `/api/supplements/${supplementId}/heart-response`,
    TTL_MEDIUM,
    { onError: () => setFailed(true) },
  );

  if (!data) {
    return failed ? (
      <p className="text-[11px] text-muted-foreground">Couldn&apos;t load your heart response.</p>
    ) : null;
  }
  return <HeartResponseBody doses={data.doses} nights={data.nights} tz={tz} />;
}
