"use client";

import { useEffect, useState } from "react";
import { cachedFetchToday, readTodayCacheSync } from "@/lib/sqlite/cache";
import { TTL_MEDIUM } from "@trainingai/shared/cache-ttl";
import { getLocalStore } from "@/lib/local-store";
import { todayInTz } from "@trainingai/shared/date-utils";
import { summariseSupplementDay } from "@trainingai/shared/nutrition/supplement-day-totals";
import type { SupplementWithStatus } from "@trainingai/shared/types/supplement";

/**
 * The nutrition tab's supplements, local-first.
 *
 * Extracted from `nutrition-content.tsx` rather than added to it — the file is at its size limit and
 * the rule is extract, don't append.
 */
export function useSupplements(userId: string | undefined, tz: string, tabEpoch: number) {
  const [supplements, setSupplements] = useState<SupplementWithStatus[]>([]);
  const [loading, setLoading] = useState(true);

  // Seeded in an effect, never a useState initializer: a skeleton flash on a repeat visit is a bug.
  useEffect(() => {
    const seed = readTodayCacheSync<SupplementWithStatus[]>('supplements');
    if (seed) { setSupplements(Array.isArray(seed) ? seed : []); setLoading(false); }
  }, []);

  useEffect(() => {
    // cachedFetchToday, not cachedFetch: the same key is written by the today-variant at the seed
    // site above, by the sync-provider's warm pass, and by the fallback below. Mixing variants on
    // one key means incompatible envelopes ({date,data} vs a raw array), so whichever wrote last
    // decided whether this saw an array at all — and when it did not, the section rendered empty
    // (Q-124b, the weekly-stats crash class).
    const fromServer = () => cachedFetchToday<SupplementWithStatus[]>(
      'supplements', '/api/supplements', TTL_MEDIUM,
      d => setSupplements(Array.isArray(d) ? d : []),
    ).catch(() => {}).finally(() => setLoading(false));

    const today = todayInTz(tz);
    // Reachable on device too, not just web: getLocalStore returns null whenever the store failed to
    // open or before userId resolves.
    const store = userId ? getLocalStore(userId) : null;
    if (!store) { fromServer(); return; }

    Promise.all([store.getSupplements(), store.getSupplementLogs(today)]).then(([defs, logs]) => {
      if (defs.length === 0) throw new Error('empty');
      // BF-112: this branch returns early, so anything it drops is absent ON THE DEVICE and present
      // on the web, where `getLocalStore` is null and the server's own mapping is used. The dose
      // fields were dropped here, which is why a prompt that worked in the browser would never have
      // fired on the APK.
      const day = summariseSupplementDay(logs);
      setSupplements(defs.map(s => ({
        id: s.id, userId: userId!, name: s.name, dose: s.dose,
        defaultAmount: s.defaultAmount ?? null, unit: s.unit ?? null,
        startedOn: s.startedOn ?? null, stoppedOn: s.stoppedOn ?? null,
        dosePrompt: s.dosePrompt === true,
        reminderEnabled: s.reminderEnabled, reminderTime: s.reminderTime,
        sortOrder: s.sortOrder, active: s.active,
        createdAt: s.updatedAt,
        loggedToday: day.get(s.id)?.loggedToday === true,
        loggedAmount: day.get(s.id)?.loggedAmount ?? null,
      })));
      setLoading(false);
    }).catch(fromServer);
  }, [userId, tabEpoch, tz]);

  return { supplements, setSupplements, loading };
}
