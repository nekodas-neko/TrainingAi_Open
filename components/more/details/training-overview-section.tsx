"use client";

import { useState } from "react";
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import { useCachedValue } from "@/lib/hooks/use-cached-value";
import { TTL_LONG } from "@trainingai/shared/cache-ttl";
import { ReadingGroupCard } from "./reading-group-card";
import { trainingGroups, type PersonalRecordRow } from "./training-overview";

/**
 * LB-95 — the lifting half of the measured overview.
 *
 * Personal records were the one thing this screen measured and never showed. The route returns
 * EVERY exercise rather than the active program's, so a record outlives the program that set it,
 * which is the point: a best lift does not stop being a best lift when the block changes.
 *
 * **Its own section rather than rows inside the daily one**, for the reason the tests-and-scans
 * section states: each half has to be able to render when the other has nothing.
 */
export function TrainingOverviewSection() {
  const tz = useUserTimezone();
  const [failed, setFailed] = useState(false);

  const data = useCachedValue<{ records: PersonalRecordRow[] }>(
    // One call site, so the raw TTL is the canonical one — a named constant in cache-ttl.ts is
    // what the rule asks for at two or more, and inventing one here would put a Lane A edit in a
    // Lane B change for no freshness benefit.
    'personal-records', '/api/personal-records', TTL_LONG,
    // `cachedFetch` swallows `!res.ok`, so without this a failed load is indistinguishable from
    // "no records yet" — and the empty branch below returns null, so the section would simply
    // vanish with nothing explaining it (RV-150).
    { onError: () => setFailed(true) },
  );

  const groups = trainingGroups(data?.records ?? [], tz);

  if (groups.length === 0) {
    if (!failed) return null;
    return (
      <section className="space-y-1">
        <h2 className="text-sm font-semibold">Lifting</h2>
        <p className="text-xs text-muted-foreground">
          Couldn&rsquo;t load your personal records. Check your connection and reopen this screen.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Lifting</h2>
        <p className="text-xs text-muted-foreground">
          Your best estimated one-rep max for each exercise, and the day it was set. Every exercise
          you have logged, not just the ones in your current program.
        </p>
      </div>

      {groups.map(g => <ReadingGroupCard key={g.title} title={g.title} readings={g.readings} />)}
    </section>
  );
}
