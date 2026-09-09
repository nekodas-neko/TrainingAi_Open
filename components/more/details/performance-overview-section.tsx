"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getLocalStore } from "@/lib/local-store";
import { cachedFetch } from "@/lib/sqlite/cache";
import { useCachedValue } from "@/lib/hooks/use-cached-value";
import { FITNESS_TESTS_TTL, TTL_LONG } from "@trainingai/shared/cache-ttl";
import { ReadingGroupCard } from "./reading-group-card";
import {
  performanceGroups,
  type DexaScanRow, type FitnessTestRow, type MeasuredRmrRow,
} from "./performance-overview";

/**
 * BF-133's clinical and test half: a body scan, a metabolic test and a timed fitness test, in the
 * same dense view as the daily readings above them.
 *
 * **Its own section rather than more groups inside the daily one**, for two reasons. It reads three
 * sources where the daily half reads one, so folding them together puts four fetches and two failure
 * modes in a component whose job is a list of rows. And the daily half returns null when it has
 * nothing — on an account with a scan and no scale, sharing that return would hide the scan behind
 * the absence of something else. Each half now decides its own emptiness.
 *
 * **The clinical numbers already have a home at More → DEXA & RMR results**, and this does not
 * replace it: that screen is where they are entered and where the full forty-column report lives.
 * What was missing is a reader seeing them beside the scale's and the ring's, which is the only
 * place their disagreement is visible — so the link out is part of the section, not an afterthought.
 */
export function PerformanceOverviewSection({ userId }: { userId?: string }) {
  // Local-first, because `fitness_tests` is a domain the app writes to the local store, and the
  // standing rule is that such a domain is READ locally — a test recorded offline must not vanish
  // from a screen that claims to list what the app has measured.
  const [tests, setTests] = useState<FitnessTestRow[]>([]);
  useEffect(() => {
    let alive = true;
    const store = userId ? getLocalStore(userId) : null;
    if (store) {
      // '0000-00-00' is the same all-time floor `latest-baseline-card.tsx` uses: this card wants the
      // most recent value of each metric, and a test is a once-in-months event.
      store.getFitnessTests('0000-00-00')
        .then(rows => { if (alive) setTests(rows as unknown as FitnessTestRow[]) })
        .catch(() => { if (alive) setTests([]) });
      return () => { alive = false };
    }
    cachedFetch<{ fitnessTests: FitnessTestRow[] }>(
      'fitness-tests', '/api/fitness-tests', FITNESS_TESTS_TTL,
      d => { if (alive) setTests(d.fitnessTests ?? []) },
    ).catch(() => { if (alive) setTests([]) });
    return () => { alive = false };
  }, [userId]);

  // The same two keys and the same TTL expression the DEXA & RMR screen fetches them with — one
  // canonical TTL per key, or freshness becomes last-writer-wins between the two screens.
  const rmr = useCachedValue<{ tests: MeasuredRmrRow[] }>('measured-rmr', '/api/measured-rmr', TTL_LONG);
  const dexa = useCachedValue<{ scans: DexaScanRow[] }>('dexa-scans', '/api/dexa-scans', TTL_LONG);

  const groups = performanceGroups({
    fitnessTests: tests,
    dexaScans: dexa?.scans,
    measuredRmr: rmr?.tests,
  });

  // Nothing recorded is not an error state and not an empty card — it is a section that has no
  // reason to exist yet. The invitation to record one lives on the screen that takes the entry.
  if (groups.length === 0) return null;

  const clinical = groups.some(g => g.title === 'Body scan' || g.title === 'Metabolic test');

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Tests and scans</h2>
        <p className="text-xs text-muted-foreground">
          One-off measurements, each with the day it was taken. These do not update on their own.
        </p>
      </div>

      {groups.map(g => <ReadingGroupCard key={g.title} title={g.title} readings={g.readings} />)}

      {clinical && (
        <Link
          href="/more/clinical"
          className="flex items-center justify-between gap-2 rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm active:bg-muted/60 transition-colors"
        >
          <span className="min-w-0">
            <span className="block">DEXA &amp; RMR results</span>
            <span className="block text-[11px] text-muted-foreground">
              The full report, and where a new one is entered
            </span>
          </span>
          <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" />
        </Link>
      )}
    </section>
  );
}
