"use client";

import { useMemo } from "react";
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import type { BodyMetaRow } from "@/app/api/body-metadata/route";
import { computeWeightRateKgPerWeek } from "@trainingai/shared/health/long-term-goal-progress";
import { useCachedValue } from "@/lib/hooks/use-cached-value";
import { todayInTz } from "@trainingai/shared/date-utils";
import { ENERGY_BALANCE_TTL } from "@trainingai/shared/cache-ttl";
import type { EnergyBalanceResponse } from "@/app/api/nutrition/energy-balance/route";

export function useBmiClassification(
  latestWeight: number | null,
  heightCm: number | null,
  latestBf: number | null,
  sexProp: string | null | undefined,
) {
  return useMemo(() => {
    const bmi = latestWeight != null && heightCm != null
      ? latestWeight / Math.pow(heightCm / 100, 2)
      : null;
    const bmiUsesBf = latestBf != null;
    const bmiLabel = bmi == null ? null : latestBf != null
      ? (sexProp === 'female'
          ? latestBf < 14 ? 'Essential fat' : latestBf < 21 ? 'Athletic' : latestBf < 25 ? 'Fitness' : latestBf < 32 ? 'Average' : 'High fat'
          : latestBf < 6  ? 'Essential fat' : latestBf < 14 ? 'Athletic' : latestBf < 18 ? 'Fitness' : latestBf < 25 ? 'Average' : 'High fat')
      : bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese';
    return { bmi, bmiUsesBf, bmiLabel };
  }, [latestWeight, heightCm, latestBf, sexProp]);
}

export function useWeightTrend(metaRecent: BodyMetaRow[]) {
  return useMemo(() => {
    const weights = [...metaRecent].reverse().map(r => r.weightKg).filter((w): w is number => w != null);
    return computeWeightRateKgPerWeek(weights);
  }, [metaRecent]);
}

/**
 * Today's calories-in-vs-out, server-computed.
 *
 * Owns its own fetch rather than riding the page's `fetchMeta` batch, so the Health tab and the
 * Nutrition tab read the identical payload from one route. The two surfaces previously each
 * derived their own TDEE — the "Balance" tile applied an activity multiplier AND subtracted
 * measured movement, double-counting it — and disagreed on the same screen.
 */
/**
 * Today's energy balance, live.
 *
 * **This used to seed and then fetch once in a `useEffect(…, [])`, and that is the Q-402 bug.**
 * `HomeEnergyBalanceCard` lives in the persistent tab shell, so it never unmounts, so the effect
 * never re-ran and the card held its first payload until the app was killed — which is exactly what
 * the owner reported. The eviction was never the problem: `lib/cache-groups.ts` clears
 * `energy-balance:` from six write groups and always did. Nothing asked the card to go and look
 * again.
 *
 * `useCachedValue` is that missing half. Do not replace it with a hand-rolled effect here, and do
 * not reach for a shorter `ENERGY_BALANCE_TTL` — an effect that never runs never consults a TTL.
 */
export function useEnergyBalanceToday(): EnergyBalanceResponse | null {
  const tz = useUserTimezone();
  const today = todayInTz(tz);
  return useCachedValue<EnergyBalanceResponse>(
    `energy-balance:${today}`,
    `/api/nutrition/energy-balance?date=${today}`,
    ENERGY_BALANCE_TTL,
  );
}
