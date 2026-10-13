export const BAR_WEIGHT_KG = 20;
export const PLATE_PAIRS_KG = [25, 20, 15, 10, 5, 2.5, 1.25] as const;
export interface PlateBreakdown {
  perSide: number[];    // plates on each side, heaviest first
  achievableKg: number; // bar + 2 × sum(perSide); equals the target when exact
  exact: boolean;
}

// Greedy per-side breakdown. Returns null when the target is below the empty bar.
// Weights are 1.25 kg multiples but the per-side value can land on a 0.625 step,
// so a breakdown may be inexact — achievableKg is then the closest load below.
export function plateBreakdown(targetKg: number, barKg: number = BAR_WEIGHT_KG): PlateBreakdown | null {
  if (targetKg < barKg) return null;
  let remaining = (targetKg - barKg) / 2;
  const perSide: number[] = [];
  for (const plate of PLATE_PAIRS_KG) {
    if (remaining >= plate - 1e-9) {
      perSide.push(plate);
      remaining -= plate;
    }
  }
  const achievableKg = barKg + 2 * perSide.reduce((sum, p) => sum + p, 0);
  return { perSide, achievableKg, exact: Math.abs(achievableKg - targetKg) < 1e-9 };
}
