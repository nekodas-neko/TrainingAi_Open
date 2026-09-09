"use client";

import { useEffect, useState } from "react";
import { getLocalStore } from "@/lib/local-store";
import { cachedFetch } from "@/lib/sqlite/cache";
import { TTL_MEDIUM } from "@trainingai/shared/cache-ttl";
import type { WeightPoint } from "@trainingai/shared/health/long-term-goal-progress";
import { weightResponse, formatRange, type ResponseVerdict } from "./weight-response";

/**
 * Weight response over the current vial (OR-102b ④).
 *
 * **Anchored on the vial, not on the last injection**, and that is a correction to the request
 * rather than a shortcut. The owner asked for the delta *since injection day*, which is a seven-day
 * window — and the entry's own measurement is that seven days of weigh-ins resolve a rate to about
 * ±1.3 kg/wk against a band 0.35 kg wide. The vial is the dosing period: it is the span over which
 * the dose is actually constant, it is typically two to four weeks, and it is the shortest window
 * that can answer the question at all.
 *
 * **The colour is withheld far more often than it is shown, and that is the feature.** A chip that
 * commits on thin data is worse than no chip, because it looks authoritative — so grey with
 * *"not enough weigh-ins yet"* is the normal early state, and the number and its interval are
 * printed underneath either way.
 *
 * **No recommendation, ever.** Naming a dose is a medical decision and out of scope per this
 * entry's parent. This reports the owner's own data against a band the owner set.
 */

const TONE: Record<ResponseVerdict, { chip: string; label: string }> = {
  too_fast: { chip: 'bg-red-500/15 text-red-400 border-red-500/30', label: 'Faster than your band' },
  in_band: { chip: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', label: 'In your band' },
  too_slow: { chip: 'bg-amber-500/15 text-amber-400 border-amber-500/30', label: 'Slower than your band' },
  gaining: { chip: 'bg-amber-500/15 text-amber-400 border-amber-500/30', label: 'Gaining' },
}

const UNDECIDED = 'bg-muted text-muted-foreground border-border'

export function WeightResponseCard({ userId, sinceDate }: { userId?: string; sinceDate?: string | null }) {
  const [points, setPoints] = useState<WeightPoint[] | null>(null);

  useEffect(() => {
    if (!sinceDate) { setPoints(null); return }
    let alive = true;
    // Local-first: `body_metrics` is written to the local store, so it is read from there. The
    // server window is only seven days and this needs the whole dosing period.
    const store = userId ? getLocalStore(userId) : null;
    if (store) {
      store.getBodyMetrics(sinceDate)
        .then(rows => { if (alive) setPoints(rows as unknown as WeightPoint[]) })
        .catch(() => { if (alive) setPoints([]) });
      return () => { alive = false };
    }
    cachedFetch<{ recent?: WeightPoint[] }>(
      'body-metadata', '/api/body-metadata', TTL_MEDIUM,
      d => { if (alive) setPoints(d.recent ?? []) },
    ).catch(() => { if (alive) setPoints([]) });
    return () => { alive = false };
  }, [userId, sinceDate]);

  if (!sinceDate) return null;

  const windowed = (points ?? []).filter(p => p.date >= sinceDate);
  const result = weightResponse({ points: windowed });
  const tone = result?.verdict ? TONE[result.verdict] : null;

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">Weight response</h3>
        <span className="text-[11px] text-muted-foreground">since this vial</span>
      </div>

      <div className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${tone?.chip ?? UNDECIDED}`}>
        {tone?.label ?? 'Not enough weigh-ins yet'}
      </div>

      {result ? (
        <>
          <p className="text-sm tabular-nums">{formatRange(result)}</p>
          <p className="text-[11px] text-muted-foreground">
            Your band is {result.bandLoKgPerWeek.toFixed(2)}–{result.bandHiKgPerWeek.toFixed(2)} kg/wk.
            {' '}
            {tone
              // Said plainly, because an interval is the one thing a coloured chip cannot carry and
              // the reason this one is sometimes grey.
              ? 'The whole range falls on one side of it.'
              : 'The range crosses a boundary, so this is not called either way yet.'}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {result.weighIns} weigh-ins over {Math.round(result.spanDays)} days. Weigh in more often to
            narrow this.
          </p>
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {/* Three is the floor for an interval at all; a useful one usually wants a fortnight. */}
          Needs at least three weigh-ins on different days since this vial was opened.
        </p>
      )}
    </section>
  );
}
