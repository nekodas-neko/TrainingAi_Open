"use client";

import { useMemo, useState } from "react";
import { useCachedValue } from "@/lib/hooks/use-cached-value";
import { TTL_MEDIUM } from "@trainingai/shared/cache-ttl";
import type { DoseEvent } from "@trainingai/shared/health/dose-context";
import { DoseVitalsChart } from "./dose-vitals-chart";
import {
  buildDoseVitalsSeries, doseLabel, latestDoses, METRIC_LABEL,
  type DoseMetric, type DoseVitalsNightInput,
} from "./dose-vitals-series";

interface DoseVitalsResponse {
  from: string;
  to: string;
  effectLookbackDays: number;
  doses: DoseEvent[];
  nights: DoseVitalsNightInput[];
}

const DAYS = 60;
const METRICS: DoseMetric[] = ["rhr", "hrv"];

/**
 * TN-46 — the overlay half. The engine (`/api/health/dose-vitals`) joins vial-dosed administrations
 * to each night's resting HR and HRV beside the baseline stored for that night; this draws it.
 *
 * It annotates and never corrects, which was the owner's decision: nothing here feeds a score, and
 * no threshold is re-tuned against the dosing period.
 */
export function DoseVitalsCard() {
  const [metric, setMetric] = useState<DoseMetric>("rhr");
  const [failed, setFailed] = useState(false);

  const data = useCachedValue<DoseVitalsResponse>(
    `dose-vitals:${DAYS}`, `/api/health/dose-vitals?days=${DAYS}`, TTL_MEDIUM,
    // `cachedFetch` swallows `!res.ok`, this route's own rate limit included, so without this the
    // card would simply vanish instead of saying anything (Q-499).
    { onError: () => setFailed(true) },
  );

  const points = useMemo(
    () => (data ? buildDoseVitalsSeries(data.nights, data.doses, metric, data.effectLookbackDays) : []),
    [data, metric],
  );

  if (failed && !data) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--muted)]/20 p-4">
        <p className="text-sm text-[color:var(--muted-foreground)]">Couldn&apos;t load your dose overlay.</p>
      </div>
    );
  }
  // Nothing to annotate: no vial-dosed log in the window. Saying so would be noise on a screen the
  // owner reads daily, so the card is simply absent.
  if (!data || data.doses.length === 0) return null;

  return (
    // A landmark because the Readiness screen already carries an "HRV" control of its own — without
    // one, neither metric button on this card can be addressed unambiguously.
    <section aria-label="Doses against vitals" className="rounded-xl border border-[color:var(--border)] bg-[color:var(--muted)]/20 p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)]">
          Doses against vitals
        </p>
        <div className="flex gap-1">
          {METRICS.map(m => (
            <button
              key={m}
              type="button"
              onClick={() => setMetric(m)}
              aria-pressed={metric === m}
              className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                metric === m
                  ? "bg-[color:var(--secondary)] text-[color:var(--foreground)]"
                  : "text-[color:var(--muted-foreground)]"
              }`}
            >
              {METRIC_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      <DoseVitalsChart points={points} metric={metric} />

      <p className="mt-2 text-[11px] leading-snug text-[color:var(--muted-foreground)]">
        Amber rings mark a dose. The effect was measured to peak 2&ndash;4 days later, so read the days{" "}
        <em>after</em> a ring rather than the ring itself. The dashed line is the baseline stored for
        that night.
      </p>

      <ul className="mt-2 space-y-0.5">
        {latestDoses(data.doses).map((d, i) => (
          <li key={`${d.date}-${i}`} className="font-mono text-[10px] tabular-nums text-[color:var(--muted-foreground)]">
            {d.date.slice(5)} &middot; {doseLabel(d)}
          </li>
        ))}
      </ul>
    </section>
  );
}
