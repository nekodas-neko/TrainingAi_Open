"use client";

import { useMemo } from "react";
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import { computeWeightRateKgPerWeek, type WeightPoint } from "@trainingai/shared/health/long-term-goal-progress";
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

/** Points are the body-metadata `weightTrend` (30 local days, #2480), or `recent` as a fallback. */
export function useWeightTrend(points: WeightPoint[]) {
  // Dated points, not bare numbers (LB-67). Rows exist only on days carrying a metric, so fitting
  // the array position reported a slope per READING as though it were per day — which pushed an
  // ordinary −0.7 kg/wk past the 1.0 band and rendered "Faster than ideal pace". The shared fit
  // sorts and drops nulls itself, so the reverse here is no longer needed.
  return useMemo(() => computeWeightRateKgPerWeek(points), [points]);
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
/**
 * `opts` is optional so the existing callers keep working unchanged.
 *
 * **LB-176 — why a caller needs `onError` here.** `useCachedValue` swallows `!res.ok`, so a failed
 * read returns `null`, which is the same thing this hook returns while loading and for an account
 * with nothing stored. On the Health screen those three cases rendered identically, and the fallback
 * for the null case was a card telling the owner to add profile details he set months ago. A caller
 * that draws anything other than a skeleton for `null` has to be able to tell them apart.
 *
 * There is no `onLoaded` counterpart because `useCachedValue` has none, and it is not needed: a
 * caller clears its flag by ANDing it with `value == null`, so a retry that lands removes the failure
 * line by itself. `() => void` is assignable where the hook expects an info argument.
 */
export function useEnergyBalanceToday(
  opts?: { onError?: () => void },
): EnergyBalanceResponse | null {
  const tz = useUserTimezone();
  const today = todayInTz(tz);
  return useCachedValue<EnergyBalanceResponse>(
    `energy-balance:${today}`,
    `/api/nutrition/energy-balance?date=${today}`,
    ENERGY_BALANCE_TTL,
    opts,
  );
}
